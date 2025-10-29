import type { Express } from "express";
import { storage } from "../storage";
import { GmailService } from "../services/gmail";
import { EnhancedEmailParser } from "../services/enhancedEmailParser";
import { GeminiSubscriptionDetector } from "../services/geminiSubscriptionDetector";
import { generateServiceKey } from "../utils/serviceKey";
import { isAuthenticated } from "../replitAuth";

// Store LLM suggestions temporarily for user review
interface LLMSuggestionSession {
  userId: string;
  suggestions: any[];
  analysisDate: string;
  emailsAnalyzed: number;
}

const suggestionSessions = new Map<string, LLMSuggestionSession>();

export function registerGeminiRoutes(app: Express) {
  // Get progress notification function from parent scope
  const sendProgressUpdate = (globalThis as any).sendProgressUpdate || (() => {});
  // Enhanced sync with LLM analysis (AUTHENTICATED)
  app.post("/api/sync-emails-llm", isAuthenticated, async (req: any, res) => {
    try {
      // Get userId from authenticated user, ignore request body for security
      const userId = req.user?.claims?.sub;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const user = await storage.getUser(userId);
      if (!user || !user.gmailConnected || !user.gmailAccessToken) {
        return res.status(400).json({ message: "Gmail not connected" });
      }

      const gmailService = new GmailService();
      const enhancedParser = new EnhancedEmailParser();
      const geminiDetector = new GeminiSubscriptionDetector();
      
      console.log('Starting enhanced LLM-powered sync...');
      
      // Send initial progress update
      sendProgressUpdate(userId, {
        stage: 'starting',
        progress: 0,
        message: 'Initializing sync process...'
      });
      
      // Check if access token is expired and refresh if needed
      let accessToken = user.gmailAccessToken;
      const now = new Date();
      const tokenExpiry = user.gmailTokenExpiry ? new Date(user.gmailTokenExpiry) : null;
      
      if (tokenExpiry && now >= tokenExpiry) {
        console.log('⚠️ Access token expired, refreshing...');
        sendProgressUpdate(userId, {
          stage: 'token_refresh',
          progress: 5,
          message: 'Refreshing Gmail authentication...'
        });
        
        try {
          const newTokens = await gmailService.refreshAccessToken(user.gmailRefreshToken!);
          accessToken = newTokens.access_token!;
          
          // Update user with new tokens
          await storage.updateUser(userId, {
            gmailAccessToken: accessToken,
            gmailTokenExpiry: newTokens.expiry_date ? new Date(newTokens.expiry_date) : null,
          });
          
          console.log('✅ Access token refreshed successfully');
        } catch (error) {
          console.error('❌ Failed to refresh access token:', error);
          return res.status(401).json({ 
            message: "Gmail authentication expired. Please reconnect your Gmail account.",
            error: "token_refresh_failed"
          });
        }
      }
      
      // Get emails from Gmail (past 90 days)
      const gmailMessages = await gmailService.getEmails(
        accessToken,
        user.gmailRefreshToken!,
        1000, // Limit for LLM processing
        async (newAccessToken: string) => {
          await storage.updateUser(userId, { gmailAccessToken: newAccessToken });
        }
      );

      console.log(`📬 Gmail Fetch Complete: ${gmailMessages.length} emails (past 90 days)`);
      console.log(`🕰️ Estimated processing time: ${Math.ceil(gmailMessages.length / 50)} minutes for full analysis`);
      
      // Send Gmail fetch completion update
      sendProgressUpdate(userId, {
        stage: 'gmail_fetch',
        progress: 20,
        message: `Fetched ${gmailMessages.length} emails from Gmail`,
        details: { emailCount: gmailMessages.length }
      });

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
            sendProgressUpdate(userId, {
              stage: 'parsing',
              progress: 20 + Math.round((i / gmailMessages.length) * 30),
              message: `Parsing emails: ${i}/${gmailMessages.length}`,
              details: { parsed: i, total: gmailMessages.length }
            });
          }
        } catch (error) {
          console.error('Error parsing email:', error);
        }
      }

      // Step 2: ENHANCED wide-net rule-based filtering (based on user examples)
      const candidateEmails = parsedEmails.filter(email => {
        const content = (email.content + ' ' + email.subject + ' ' + email.fromEmail).toLowerCase();
        
        // Original transaction detection
        const hasTransactionKeywords = email.isTransaction;
        
        // Enhanced subscription patterns (much wider net)
        const subscriptionPatterns = /\$|\₹|rs\b|usd|inr|payment|bill|amount|price|cost|subscription|recurring|membership|trial|premium|upgrade|renewal|auto.?renew|billed|charged|invoice|receipt|statement|plan|order|purchase|transaction|confirmation|welcome|verify|verification|account|profile|thank.?you|feedback|update|notification|alert|reminder|expired|due|service|product|digest|summary|report/i;
        const hasSubscriptionKeywords = subscriptionPatterns.test(content);
        
        // Service/platform patterns (Indian + Global)
        const servicePatterns = /airtel|jio|vodafone|bsnl|replit|bolt|netflix|hotstar|primevideo|spotify|apple|google|microsoft|openai|github|aws|azure|stripe|razorpay|paytm|phonepe|gpay|upwork|freelancer|linkedin|zoom|slack|notion|figma|canva|dropbox|youtube|uber|ola|swiggy|zomato|flipkart|amazon|myntra|nykaa|bigbasket|grofers|dunzo/i;
        const hasServiceKeywords = servicePatterns.test(content);
        
        // Job/Application patterns (from user's screenshot)
        const jobPatterns = /application|job|position|career|interview|recruitment|hiring|vacancy|opportunity|apply|submit|submitted|candidate|cv|resume|profile|linkedin|tata|insurance|lead|manager|product/i;
        const hasJobKeywords = jobPatterns.test(content);
        
        // Communication/Verification patterns
        const communicationPatterns = /verify|verification|confirm|confirmation|activate|activation|welcome|getting.?started|onboard|setup|signin|login|password|security|otp|code|email.?address|phone.?number|profile/i;
        const hasCommunicationKeywords = communicationPatterns.test(content);
        
        // Merchant domains check
        const hasMerchantDomains = enhancedParser.merchantDomains.some(domain => 
          email.fromEmail.includes(domain) || email.content.includes(domain)
        );
        
        // MUCH WIDER NET: Include if ANY pattern matches
        return hasTransactionKeywords || hasSubscriptionKeywords || hasServiceKeywords || hasJobKeywords || hasCommunicationKeywords || hasMerchantDomains;
      });
      
      console.log(`🎯 Rule-based filtering results:`);
      console.log(`   • Total emails parsed: ${parsedEmails.length}`);
      console.log(`   • Candidate emails selected: ${candidateEmails.length}`);
      console.log(`   • Filter efficiency: ${Math.round((candidateEmails.length / parsedEmails.length) * 100)}% pass rate`);
      console.log(`   • This is a ${candidateEmails.length > parsedEmails.length * 0.5 ? 'WIDE' : candidateEmails.length > parsedEmails.length * 0.2 ? 'MODERATE' : 'NARROW'} filter strategy`);
      
      // Send filtering completion update
      sendProgressUpdate(userId, {
        stage: 'filtering_complete',
        progress: 60,
        message: `Filtered ${candidateEmails.length} candidate emails for AI analysis`,
        details: { candidates: candidateEmails.length, total: parsedEmails.length }
      });

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
        console.log(`🤖 Starting Gemini LLM analysis on ${savedEmails.length} emails...`);
        
        // Send LLM analysis start update
        sendProgressUpdate(userId, {
          stage: 'llm_analysis_start',
          progress: 70,
          message: `Starting AI analysis of ${savedEmails.length} emails...`,
          details: { emailCount: savedEmails.length }
        });
        const analysisStartTime = Date.now();
        
        geminiResults = await geminiDetector.analyzeEmailsForSubscriptions(savedEmails);
        
        const analysisTime = ((Date.now() - analysisStartTime) / 1000).toFixed(1);
        console.log(`✅ Gemini analysis complete in ${analysisTime}s:`);
        console.log(`   • Total suggestions: ${geminiResults.subscriptions.length}`);
        console.log(`   • High confidence: ${geminiResults.subscriptions.filter(s => s.confidence === 'high').length}`);
        console.log(`   • Medium confidence: ${geminiResults.subscriptions.filter(s => s.confidence === 'medium').length}`);
        console.log(`   • Low confidence: ${geminiResults.subscriptions.filter(s => s.confidence === 'low').length}`);
        console.log(`   • Processing rate: ${(savedEmails.length / parseFloat(analysisTime)).toFixed(1)} emails/second`);
        
        // Send LLM analysis completion update
        sendProgressUpdate(userId, {
          stage: 'llm_analysis_complete',
          progress: 90,
          message: `AI analysis complete! Found ${geminiResults.subscriptions.length} subscription suggestions`,
          details: { 
            total: geminiResults.subscriptions.length,
            high: geminiResults.subscriptions.filter(s => s.confidence === 'high').length,
            analysisTime: parseFloat(analysisTime)
          }
        });
      } catch (error) {
        console.error('Gemini analysis failed:', error);
        return res.status(500).json({ 
          message: "LLM analysis failed", 
          error: error instanceof Error ? error.message : 'Unknown error',
          fallbackToRegularSync: true
        });
      }

      // Step 5: Mark ALL analyzed emails as processed (CRITICAL BUG FIX)
      console.log(`📧 Marking ${savedEmails.length} analyzed emails as processed...`);
      for (const email of savedEmails) {
        try {
          await storage.updateEmail(email.id, { processed: true });
        } catch (error) {
          console.error(`Failed to mark email ${email.id} as processed:`, error);
        }
      }
      console.log(`✅ All ${savedEmails.length} emails marked as processed`);
      
      // Step 6: Store suggestions for user review
      const sessionId = `session_${userId}_${Date.now()}`;
      suggestionSessions.set(sessionId, {
        userId,
        suggestions: geminiResults.subscriptions,
        analysisDate: geminiResults.analysisDate,
        emailsAnalyzed: savedEmails.length
      });

      // Update user's last sync timestamp
      await storage.updateUser(userId, { lastSync: new Date() });

      // Send final completion update
      sendProgressUpdate(userId, {
        stage: 'sync_complete',
        progress: 100,
        message: `Sync complete! Generated ${geminiResults.subscriptions.length} subscription suggestions`,
        details: { 
          sessionId,
          total: geminiResults.subscriptions.length,
          confident: geminiResults.totalConfidentSubscriptions,
          emailsProcessed: savedEmails.length
        }
      });
      
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
              serviceKey: generateServiceKey(suggestion.serviceName),
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