import type { Express } from "express";
import { storage } from "../storage";
import { GmailService } from "../services/gmail";
import { EnhancedEmailParser } from "../services/enhancedEmailParser";
import { GeminiSubscriptionDetector } from "../services/geminiSubscriptionDetector";
import { TransactionDetector } from "../services/transactionDetector";
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

// Helper function to safely parse dates from Gemini responses
function parseValidDate(dateValue: any): Date | null {
  if (!dateValue) return null;
  
  try {
    const parsed = new Date(dateValue);
    // Check if date is valid (not NaN) and not too far in past/future
    if (isNaN(parsed.getTime())) {
      return null;
    }
    // Reject dates before 2000 or more than 10 years in future
    const minDate = new Date('2000-01-01');
    const maxDate = new Date();
    maxDate.setFullYear(maxDate.getFullYear() + 10);
    
    if (parsed < minDate || parsed > maxDate) {
      console.warn(`Date out of reasonable range, ignoring: ${dateValue}`);
      return null;
    }
    
    return parsed;
  } catch (error) {
    console.warn(`Failed to parse date: ${dateValue}`, error);
    return null;
  }
}

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
      
      // Get user's email sync days setting (default 90, max 180)
      const emailSyncDays = user.emailSyncDays || 90;
      
      console.log('🚀 OPTIMIZED TWO-PHASE EMAIL PROCESSING');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      // ═══════════════════════════════════════════
      // PHASE 1: LIGHTWEIGHT SCREENING (FAST)
      // ═══════════════════════════════════════════
      
      console.log('\n📊 PHASE 1: Lightweight Email Screening');
      console.log('Fetching metadata only (subject, sender, snippet)...\n');
      
      // Phase 1a: Fetch lightweight metadata (much faster than full emails)
      sendProgressUpdate(userId, {
        stage: 'phase1_metadata_fetch',
        progress: 10,
        message: 'Fetching email metadata...'
      });
      
      const emailMetadata = await gmailService.getEmailMetadata(
        accessToken,
        user.gmailRefreshToken!,
        async (newAccessToken: string) => {
          await storage.updateUser(userId, { gmailAccessToken: newAccessToken });
        },
        emailSyncDays
      );
      
      console.log(`✅ Fetched metadata for ${emailMetadata.length} emails`);
      
      sendProgressUpdate(userId, {
        stage: 'phase1_metadata_complete',
        progress: 20,
        message: `Retrieved metadata for ${emailMetadata.length} emails`,
        details: { totalEmails: emailMetadata.length }
      });
      
      // Phase 1b: Extract metadata and apply enhanced transaction detection
      console.log('\n🎯 Applying enhanced transaction detection...');
      
      const transactionDetector = new TransactionDetector();
      const extractedMetadata = emailMetadata.map(msg => {
        // Extract subject, sender, and snippet from Gmail metadata format
        const headers = msg.payload?.headers || [];
        const subject = headers.find((h: any) => h.name === 'Subject')?.value || '';
        const from = headers.find((h: any) => h.name === 'From')?.value || '';
        const snippet = msg.snippet || '';
        
        // Parse sender email and name
        const emailMatch = from.match(/<(.+?)>/);
        const fromEmail = emailMatch ? emailMatch[1] : from;
        const fromName = from.replace(/<.+?>/, '').trim();
        
        return {
          id: msg.id!, // Include message ID for AI pre-filter
          subject,
          fromEmail,
          fromName,
          snippet,
          bodyPreview: snippet
        };
      });
      
      const detectionResults = transactionDetector.filterCandidates(extractedMetadata);
      
      console.log(`\n📊 Phase 1 Detection Results:`);
      console.log(`   ✅ High confidence: ${detectionResults.stats.high}`);
      console.log(`   ⚠️  Medium confidence: ${detectionResults.stats.medium}`);
      console.log(`   ⚡ Low confidence: ${detectionResults.stats.low}`);
      console.log(`   ❌ Rejected: ${detectionResults.stats.rejected}`);
      console.log(`   📈 Filter efficiency: ${Math.round((detectionResults.candidates.length / detectionResults.stats.total) * 100)}% pass rate`);
      
      sendProgressUpdate(userId, {
        stage: 'phase1_detection_complete',
        progress: 30,
        message: `Identified ${detectionResults.candidates.length} potential candidates`,
        details: { 
          candidates: detectionResults.candidates.length,
          total: emailMetadata.length,
          stats: detectionResults.stats
        }
      });
      
      // Phase 1c: AI Pre-filter on candidates (subject+snippet only)
      console.log(`\n🤖 PHASE 1.5: AI Pre-screening ${detectionResults.candidates.length} candidates...`);
      
      sendProgressUpdate(userId, {
        stage: 'phase1_ai_prefilter',
        progress: 40,
        message: `AI pre-filtering ${detectionResults.candidates.length} candidates...`
      });
      
      // Map candidates to include required id field
      const candidatesWithIds = detectionResults.candidates
        .filter(c => c.id) // Only include candidates with Gmail IDs
        .map(c => ({ ...c, id: c.id! })); // Make id non-nullable
      
      const aiApprovedIds = await geminiDetector.prefilterCandidates(
        candidatesWithIds,
        (progress) => {
          sendProgressUpdate(userId, {
            stage: 'phase1_ai_progress',
            progress: 40 + Math.round(progress * 0.2),
            message: `AI screening progress: ${Math.round(progress)}%`
          });
        }
      );
      
      console.log(`✅ AI approved ${aiApprovedIds.length} emails for deep processing`);
      console.log(`   Reduction: ${detectionResults.candidates.length} → ${aiApprovedIds.length} (${Math.round((1 - aiApprovedIds.length / detectionResults.candidates.length) * 100)}% filtered out)`);
      
      sendProgressUpdate(userId, {
        stage: 'phase1_complete',
        progress: 60,
        message: `Phase 1 complete: ${aiApprovedIds.length} emails selected for deep analysis`,
        details: { approved: aiApprovedIds.length }
      });
      
      // ═══════════════════════════════════════════
      // PHASE 2: DEEP PROCESSING (TARGETED)
      // ═══════════════════════════════════════════
      
      console.log('\n\n📥 PHASE 2: Deep Processing of Approved Emails');
      console.log('Fetching full content + attachments for selected emails only...\n');
      
      sendProgressUpdate(userId, {
        stage: 'phase2_start',
        progress: 65,
        message: `Starting deep processing of ${aiApprovedIds.length} emails...`
      });
      
      // Phase 2a: Fetch full email content for approved candidates only
      const gmailMessages = await gmailService.getEmailsByIds(
        accessToken,
        user.gmailRefreshToken!,
        aiApprovedIds
      );
      
      console.log(`✅ Fetched full content for ${gmailMessages.length} emails`);
      
      sendProgressUpdate(userId, {
        stage: 'phase2_content_fetched',
        progress: 70,
        message: `Retrieved full content for ${gmailMessages.length} emails`,
        details: { emailCount: gmailMessages.length }
      });
      
      // Phase 2b: Parse emails
      console.log('\n📝 Parsing email content...');
      const parsedEmails = [];
      for (let i = 0; i < gmailMessages.length; i++) {
        const msg = gmailMessages[i];
        try {
          const basicEmail = enhancedParser.parseEmail(msg);
          parsedEmails.push({ 
            ...basicEmail, 
            gmailId: msg.id,
            attachments: [] 
          });
        } catch (error) {
          console.error('Error parsing email:', error);
        }
      }
      
      console.log(`✅ Parsed ${parsedEmails.length} emails`);
      
      sendProgressUpdate(userId, {
        stage: 'phase2_parsing_complete',
        progress: 75,
        message: `Parsed ${parsedEmails.length} emails`,
        details: { parsed: parsedEmails.length }
      });

      // Phase 2c: Download and process attachments for approved emails only
      console.log(`\n📎 Phase 2c: Processing attachments for ${parsedEmails.length} approved emails...`);
      const savedEmails: any[] = [];
      let totalAttachments = 0;
      
      // Initialize Gmail client for attachment processing
      const gmail = gmailService.getGmailClient(accessToken, user.gmailRefreshToken!);
      
      // Create a lookup map for Gmail messages by ID for O(1) access
      const gmailMessageMap = new Map(gmailMessages.map(msg => [msg.id, msg]));
      
      for (const email of parsedEmails) {
        try {
          // CRITICAL FIX: Use Gmail message ID directly (already attached in Step 1)
          if (!email.gmailId) {
            console.error('Missing Gmail ID for email:', email.subject);
            continue;
          }
          
          const gmailMessage = gmailMessageMap.get(email.gmailId);
          if (!gmailMessage) {
            console.error('Gmail message not found for ID:', email.gmailId);
            continue;
          }
          
          // Check if email already exists
          const existingEmail = await storage.getEmailByGmailId(email.gmailId);
          
          // CRITICAL FIX: Always process attachments for each unique Gmail ID
          // Even if email exists, update attachment data if not already processed
          if (!existingEmail || !existingEmail.attachmentData) {
            // Process attachments using the correct method signature
            let attachmentData = null;
            if (gmailMessage.payload?.parts) {
              const attachmentProcessingResult = await gmailService.processAttachments(gmail, email.gmailId, gmailMessage);
              if (attachmentProcessingResult.attachments.length > 0) {
                attachmentData = JSON.stringify(attachmentProcessingResult);
                totalAttachments += attachmentProcessingResult.attachments.length;
                console.log(`  📎 Processed ${attachmentProcessingResult.attachments.length} attachments for email: ${email.subject.substring(0, 50)}...`);
              }
            }
            
            if (!existingEmail) {
              // Create new email
              const emailData = {
                userId,
                gmailId: email.gmailId,
                subject: email.subject,
                fromEmail: email.fromEmail,
                fromName: email.fromName || null,
                receivedAt: email.receivedAt,
                content: email.content,
                attachmentData,
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
            } else if (attachmentData) {
              // Update existing email with attachment data
              await storage.updateEmail(existingEmail.id, { attachmentData });
              savedEmails.push({ ...existingEmail, attachmentData });
            } else {
              savedEmails.push(existingEmail);
            }
          } else {
            savedEmails.push(existingEmail);
          }
        } catch (error) {
          console.error('Error processing email with attachments:', error);
        }
      }
      
      console.log(`✅ Processed ${savedEmails.length} emails with ${totalAttachments} total attachments`);

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
      
      // Step 6: Save suggestions to database for user review
      console.log(`💾 Saving ${geminiResults.subscriptions.length} suggestions to database...`);
      
      // Helper function to match emails to suggestions based on merchant/service name
      const findMatchingEmails = (suggestion: any, emails: any[]): string[] => {
        const searchTerms = [
          suggestion.serviceName?.toLowerCase(),
          suggestion.merchantName?.toLowerCase()
        ].filter(Boolean);
        
        if (searchTerms.length === 0) return [];
        
        return emails
          .filter(email => {
            const emailText = [
              email.subject?.toLowerCase(),
              email.fromEmail?.toLowerCase(),
              email.fromName?.toLowerCase()
            ].join(' ');
            
            // Check if any search term appears in email metadata
            return searchTerms.some(term => emailText.includes(term));
          })
          .map(email => email.gmailId)
          .slice(0, 5); // Limit to 5 most relevant emails
      };
      
      const suggestionInserts = geminiResults.subscriptions.map(suggestion => ({
        userId,
        serviceName: suggestion.serviceName,
        serviceKey: generateServiceKey(suggestion.serviceName, suggestion.frequency),
        merchantName: suggestion.merchantName || null,
        amount: suggestion.amount.toString(),
        currency: suggestion.currency || 'INR',
        frequency: suggestion.frequency,
        category: suggestion.category || null,
        confidence: suggestion.confidence,
        confidenceScore: suggestion.confidence === 'high' ? '0.85' : suggestion.confidence === 'medium' ? '0.65' : '0.45',
        reasoning: suggestion.reasoning || null,
        evidenceEmailIds: findMatchingEmails(suggestion, savedEmails),
        occurrences: 1,
        recurrenceType: suggestion.frequency,
        recurrenceScore: suggestion.confidence === 'high' ? 90 : suggestion.confidence === 'medium' ? 70 : 50,
        recurringKeywords: suggestion.recurringKeywords || [],
        senderHistory: suggestion.senderHistory ? (typeof suggestion.senderHistory === 'string' ? suggestion.senderHistory : JSON.stringify(suggestion.senderHistory)) : null,
        attachmentEvidence: suggestion.attachmentEvidence ? (typeof suggestion.attachmentEvidence === 'string' ? suggestion.attachmentEvidence : JSON.stringify(suggestion.attachmentEvidence)) : null,
        validationChecks: suggestion.validationChecks ? (typeof suggestion.validationChecks === 'string' ? suggestion.validationChecks : JSON.stringify(suggestion.validationChecks)) : null,
        nextBillingDate: parseValidDate(suggestion.nextBillingDate),
        lastSeen: new Date(),
        status: 'pending'
      }));

      let savedSuggestions = [];
      try {
        savedSuggestions = await storage.createSuggestionsBulk(suggestionInserts);
        console.log(`✅ Saved ${savedSuggestions.length} suggestions to database`);
      } catch (error) {
        console.error('Failed to save suggestions to database:', error);
        // Critical failure - without persisted suggestions, user can't review them
        return res.status(500).json({
          success: false,
          message: "Email analysis completed but failed to save suggestions",
          error: error instanceof Error ? error.message : 'Database save failed',
          emailsProcessed: savedEmails.length,
          suggestionsGenerated: 0
        });
      }

      // Update user's last sync timestamp
      await storage.updateUser(userId, { lastSync: new Date() });

      // Send final completion update
      sendProgressUpdate(userId, {
        stage: 'sync_complete',
        progress: 100,
        message: `Sync complete! Generated ${geminiResults.subscriptions.length} subscription suggestions`,
        details: { 
          total: geminiResults.subscriptions.length,
          confident: geminiResults.totalConfidentSubscriptions,
          emailsProcessed: savedEmails.length
        }
      });
      
      res.json({
        success: true,
        message: "Enhanced LLM sync completed - review suggestions",
        suggestionsGenerated: savedSuggestions.length,
        redirectToSuggestions: savedSuggestions.length > 0,
        emailsProcessed: savedEmails.length,
        candidateEmails: aiApprovedIds.length,
        totalEmails: emailMetadata.length,
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
              nextBillingDate: parseValidDate(suggestion.nextBillingDate),
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