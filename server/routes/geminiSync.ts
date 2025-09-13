import type { Express } from "express";
import { storage } from "../storage";
import { GmailService } from "../services/gmail";
import { EnhancedEmailParser } from "../services/enhancedEmailParser";
import { GeminiSubscriptionDetector } from "../services/geminiSubscriptionDetector";

// Store LLM suggestions temporarily for user review
interface LLMSuggestionSession {
  userId: string;
  suggestions: any[];
  analysisDate: string;
  emailsAnalyzed: number;
}

const suggestionSessions = new Map<string, LLMSuggestionSession>();

export function registerGeminiRoutes(app: Express) {
  // Enhanced sync with LLM analysis
  app.post("/api/sync-emails-llm", async (req, res) => {
    try {
      const { userId } = req.body;
      
      if (!userId) {
        return res.status(400).json({ message: "Missing userId" });
      }

      const user = await storage.getUser(userId);
      if (!user || !user.gmailConnected || !user.gmailAccessToken) {
        return res.status(400).json({ message: "Gmail not connected" });
      }

      const gmailService = new GmailService();
      const enhancedParser = new EnhancedEmailParser();
      const geminiDetector = new GeminiSubscriptionDetector();
      
      console.log('Starting enhanced LLM-powered sync...');
      
      // Get emails from Gmail (past 90 days)
      const gmailMessages = await gmailService.getEmails(
        user.gmailAccessToken,
        user.gmailRefreshToken!,
        1000, // Limit for LLM processing
        async (newAccessToken: string) => {
          await storage.updateUser(userId, { gmailAccessToken: newAccessToken });
        }
      );

      console.log(`Fetched ${gmailMessages.length} emails from Gmail (past 90 days)`);

      // HYBRID APPROACH: First filter with rules, then LLM analysis
      
      // Step 1: Parse emails with enhanced parser (includes attachments)
      const parsedEmails = [];
      for (let i = 0; i < gmailMessages.length; i++) {
        const msg = gmailMessages[i];
        try {
          // Note: For now, we'll skip attachment processing to focus on core LLM functionality
          // TODO: Add full attachment processing after core implementation
          const basicEmail = enhancedParser.parseEmail(msg);
          parsedEmails.push({ ...basicEmail, attachments: [] });
          
          // Progress update every 50 emails
          if (i % 50 === 0) {
            console.log(`Parsed ${i}/${gmailMessages.length} emails...`);
          }
        } catch (error) {
          console.error('Error parsing email:', error);
        }
      }

      // Step 2: Cast wider net with rule-based filtering
      const candidateEmails = parsedEmails.filter(email => {
        const hasTransactionKeywords = email.isTransaction;
        const hasAmountMentions = /\$|\₹|Rs|USD|INR|payment|bill|amount|price|cost|subscription|recurring/i.test(email.content + ' ' + email.subject);
        const hasMerchantDomains = enhancedParser.merchantDomains.some(domain => 
          email.fromEmail.includes(domain) || email.content.includes(domain)
        );
        
        // Cast wider net - include any email with potential subscription indicators
        return hasTransactionKeywords || hasAmountMentions || hasMerchantDomains;
      });
      
      console.log(`Rule-based filtering: ${candidateEmails.length} candidate emails from ${parsedEmails.length} total`);

      // Step 3: Save candidate emails to database
      const savedEmails = [];
      for (const email of candidateEmails) {
        try {
          // Check if email already exists
          const existingEmail = await storage.getEmailByGmailId(
            gmailMessages.find(msg => 
              enhancedParser.getHeader(msg.payload?.headers || [], 'Subject') === email.subject &&
              enhancedParser.getHeader(msg.payload?.headers || [], 'From')?.includes(email.fromEmail)
            )?.id || `unknown_${Date.now()}`
          );
          
          if (!existingEmail) {
            const emailData = {
              userId,
              gmailId: gmailMessages.find(msg => 
                enhancedParser.getHeader(msg.payload?.headers || [], 'Subject') === email.subject &&
                enhancedParser.getHeader(msg.payload?.headers || [], 'From')?.includes(email.fromEmail)
              )?.id || `gmail_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              subject: email.subject,
              fromEmail: email.fromEmail,
              fromName: email.fromName || null,
              receivedAt: email.receivedAt,
              content: email.content,
              attachmentData: null, // TODO: Add attachment support
              isTransaction: email.isTransaction,
              extractedAmount: email.extractedAmount?.toString() || null,
              extractedCurrency: email.extractedCurrency || null,
              merchantName: email.merchantName || null,
              subscriptionId: null,
              processed: false
            };
            
            const saved = await storage.createEmail(emailData);
            if (saved) {
              savedEmails.push(saved);
            }
          } else {
            savedEmails.push(existingEmail);
          }
        } catch (error) {
          console.error('Error saving email:', error);
        }
      }

      // Step 4: LLM Analysis with Gemini
      let geminiResults;
      try {
        console.log('Starting Gemini LLM analysis...');
        geminiResults = await geminiDetector.analyzeEmailsForSubscriptions(savedEmails);
        console.log(`Gemini analysis complete: ${geminiResults.subscriptions.length} suggestions, ${geminiResults.totalConfidentSubscriptions} confident`);
      } catch (error) {
        console.error('Gemini analysis failed:', error);
        return res.status(500).json({ 
          message: "LLM analysis failed", 
          error: error instanceof Error ? error.message : 'Unknown error',
          fallbackToRegularSync: true
        });
      }

      // Step 5: Store suggestions for user review
      const sessionId = `session_${userId}_${Date.now()}`;
      suggestionSessions.set(sessionId, {
        userId,
        suggestions: geminiResults.subscriptions,
        analysisDate: geminiResults.analysisDate,
        emailsAnalyzed: savedEmails.length
      });

      // Update user's last sync timestamp
      await storage.updateUser(userId, { lastSync: new Date() });

      res.json({
        success: true,
        message: "Enhanced LLM sync completed - review suggestions",
        sessionId,
        emailsProcessed: savedEmails.length,
        candidateEmails: candidateEmails.length,
        totalEmails: parsedEmails.length,
        llmSuggestions: geminiResults.subscriptions.length,
        confidentSuggestions: geminiResults.totalConfidentSubscriptions,
        analysisDate: geminiResults.analysisDate,
        needsReview: true
      });

    } catch (error) {
      console.error("Enhanced sync error:", error);
      res.status(500).json({ 
        message: "Failed to perform enhanced sync",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get LLM suggestions for user review
  app.get("/api/llm-suggestions/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const session = suggestionSessions.get(sessionId);
      
      if (!session) {
        return res.status(404).json({ message: "Session not found or expired" });
      }

      // Group suggestions by confidence for better UX
      const grouped = {
        high: session.suggestions.filter(s => s.confidence === 'high'),
        medium: session.suggestions.filter(s => s.confidence === 'medium'),
        low: session.suggestions.filter(s => s.confidence === 'low')
      };

      res.json({
        sessionId,
        analysisDate: session.analysisDate,
        emailsAnalyzed: session.emailsAnalyzed,
        totalSuggestions: session.suggestions.length,
        groupedSuggestions: grouped,
        summary: {
          highConfidence: grouped.high.length,
          mediumConfidence: grouped.medium.length,
          lowConfidence: grouped.low.length
        }
      });
    } catch (error) {
      console.error("Get suggestions error:", error);
      res.status(500).json({ message: "Failed to fetch suggestions" });
    }
  });

  // Accept/reject LLM suggestions
  app.post("/api/llm-suggestions/:sessionId/review", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { acceptedSuggestions, rejectedSuggestions } = req.body;
      
      const session = suggestionSessions.get(sessionId);
      if (!session) {
        return res.status(404).json({ message: "Session not found or expired" });
      }

      const geminiDetector = new GeminiSubscriptionDetector();
      const createdSubscriptions = [];

      // Create subscriptions for accepted suggestions
      for (const suggestionId of acceptedSuggestions || []) {
        const suggestion = session.suggestions.find(s => s.serviceName === suggestionId);
        if (suggestion) {
          try {
            const subscriptionData = {
              userId: session.userId,
              serviceName: suggestion.serviceName,
              amount: suggestion.amount.toString(),
              currency: suggestion.currency,
              frequency: suggestion.frequency,
              category: suggestion.category,
              status: 'active',
              merchantEmail: null,
              nextBillingDate: suggestion.nextBillingDate ? new Date(suggestion.nextBillingDate) : null,
              lastEmailDate: null,
              detectedAt: new Date()
            };

            const created = await storage.createSubscription(subscriptionData);
            if (created) {
              createdSubscriptions.push(created);
            }
          } catch (error) {
            console.error('Error creating subscription:', error);
          }
        }
      }

      // Clean up session
      suggestionSessions.delete(sessionId);

      res.json({
        success: true,
        message: "Suggestions reviewed successfully",
        createdSubscriptions: createdSubscriptions.length,
        rejectedSuggestions: rejectedSuggestions?.length || 0,
        subscriptions: createdSubscriptions
      });

    } catch (error) {
      console.error("Review suggestions error:", error);
      res.status(500).json({ message: "Failed to process review" });
    }
  });
}