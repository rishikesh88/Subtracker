import type { Express } from "express";
import { storage } from "../storage";
import { GmailService } from "../services/gmail";
import { EnhancedEmailParser } from "../services/enhancedEmailParser";
import { GeminiSubscriptionDetector } from "../core/geminiSubscriptionDetector";
import { TransactionDetector } from "../core/transactionDetector";
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
  
  // Helper function to process a single Gmail account through the complete pipeline
  async function processGmailAccount(
    userId: string,
    gmailAccount: any,
    emailSyncDays: number
  ): Promise<{
    success: boolean;
    accountId: string;
    gmailEmail: string;
    error?: string;
    emailsProcessed?: number;
    suggestionsGenerated?: number;
    candidateEmails?: number;
    totalEmails?: number;
  }> {
    const gmailService = new GmailService();
    const enhancedParser = new EnhancedEmailParser();
    const geminiDetector = new GeminiSubscriptionDetector();
    let processingSuccessful = false;
    let lastErrorMessage: string | null = null;
    
    try {
      console.log(`\n🔄 Processing account: ${gmailAccount.gmailEmail}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      // Update account status to syncing
      await storage.updateGmailAccount(gmailAccount.id, { 
        syncStatus: 'syncing',
        syncError: null
      });
      
      // Check if access token is expired and refresh if needed
      let accessToken = gmailAccount.accessToken;
      const now = new Date();
      const tokenExpiry = gmailAccount.tokenExpiry ? new Date(gmailAccount.tokenExpiry) : null;
      
      if (tokenExpiry && now >= tokenExpiry) {
        console.log(`⚠️  Access token expired for ${gmailAccount.gmailEmail}, refreshing...`);
        
        try {
          const newTokens = await gmailService.refreshAccessToken(gmailAccount.refreshToken);
          accessToken = newTokens.access_token!;
          
          // Update account with new tokens
          await storage.updateGmailAccount(gmailAccount.id, {
            accessToken: accessToken,
            tokenExpiry: newTokens.expiry_date ? new Date(newTokens.expiry_date) : null,
          });
          
          console.log(`✅ Access token refreshed for ${gmailAccount.gmailEmail}`);
        } catch (error) {
          lastErrorMessage = 'Token refresh failed. Please reconnect this account.';
          console.error(`❌ ${lastErrorMessage}:`, error);
          
          return {
            success: false,
            accountId: gmailAccount.id,
            gmailEmail: gmailAccount.gmailEmail,
            error: lastErrorMessage
          };
        }
      }
      
      console.log(`🚀 TWO-PHASE PROCESSING: ${gmailAccount.gmailEmail}`);
      
      // ═══════════════════════════════════════════
      // PHASE 1: LIGHTWEIGHT SCREENING (FAST)
      // ═══════════════════════════════════════════
      
      console.log(`\n📊 PHASE 1: Lightweight Email Screening`);
      
      const emailMetadata = await gmailService.getEmailMetadata(
        accessToken,
        gmailAccount.refreshToken,
        async (newAccessToken: string) => {
          await storage.updateGmailAccount(gmailAccount.id, { accessToken: newAccessToken });
        },
        emailSyncDays
      );
      
      console.log(`✅ Fetched metadata for ${emailMetadata.length} emails`);
      
      // Phase 1b: Extract metadata and apply enhanced transaction detection
      const transactionDetector = new TransactionDetector();
      const extractedMetadata = emailMetadata.map(msg => {
        const headers = msg.payload?.headers || [];
        const subject = headers.find((h: any) => h.name === 'Subject')?.value || '';
        const from = headers.find((h: any) => h.name === 'From')?.value || '';
        const snippet = msg.snippet || '';
        
        const emailMatch = from.match(/<(.+?)>/);
        const fromEmail = emailMatch ? emailMatch[1] : from;
        const fromName = from.replace(/<.+?>/, '').trim();
        
        return {
          id: msg.id!,
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
      
      // Phase 1c: AI Pre-filter
      const candidatesWithIds = detectionResults.candidates
        .filter(c => c.id)
        .map(c => ({ ...c, id: c.id! }));
      
      const aiApprovedIds = await geminiDetector.prefilterCandidates(candidatesWithIds);
      
      console.log(`✅ AI approved ${aiApprovedIds.length} emails for deep processing`);
      
      // ═══════════════════════════════════════════
      // PHASE 2: DEEP PROCESSING (TARGETED)
      // ═══════════════════════════════════════════
      
      console.log(`\n📥 PHASE 2: Deep Processing`);
      
      const gmailMessages = await gmailService.getEmailsByIds(
        accessToken,
        gmailAccount.refreshToken,
        aiApprovedIds
      );
      
      console.log(`✅ Fetched full content for ${gmailMessages.length} emails`);
      
      // Phase 2b: Parse emails
      const parsedEmails = [];
      for (const msg of gmailMessages) {
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
      
      // Phase 2c: Download and process attachments
      const savedEmails: any[] = [];
      let totalAttachments = 0;
      
      const gmail = gmailService.getGmailClient(accessToken, gmailAccount.refreshToken);
      const gmailMessageMap = new Map(gmailMessages.map(msg => [msg.id, msg]));
      
      for (const email of parsedEmails) {
        try {
          if (!email.gmailId) continue;
          
          const gmailMessage = gmailMessageMap.get(email.gmailId);
          if (!gmailMessage) continue;
          
          const existingEmail = await storage.getEmailByGmailId(email.gmailId);
          
          if (!existingEmail || !existingEmail.attachmentData) {
            let attachmentData = null;
            if (gmailMessage.payload?.parts) {
              const attachmentProcessingResult = await gmailService.processAttachments(
                gmail, 
                email.gmailId, 
                gmailMessage, 
                userId
              );
              if (attachmentProcessingResult.attachments.length > 0) {
                attachmentData = JSON.stringify(attachmentProcessingResult);
                totalAttachments += attachmentProcessingResult.attachments.length;
              }
            }
            
            if (!existingEmail) {
              const emailData = {
                userId,
                gmailAccountId: gmailAccount.id,
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
              await storage.updateEmail(existingEmail.id, { 
                attachmentData,
                gmailAccountId: gmailAccount.id
              });
              savedEmails.push({ ...existingEmail, attachmentData, gmailAccountId: gmailAccount.id });
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
      
      console.log(`✅ Processed ${savedEmails.length} emails with ${totalAttachments} attachments`);
      
      // Step 4: LLM Analysis with Gemini
      console.log(`🤖 Starting Gemini analysis on ${savedEmails.length} emails...`);
      
      const geminiResults = await geminiDetector.analyzeEmailsForSubscriptions(savedEmails);
      
      console.log(`✅ Gemini analysis complete:`);
      console.log(`   • Total suggestions: ${geminiResults.subscriptions.length}`);
      console.log(`   • High confidence: ${geminiResults.subscriptions.filter(s => s.confidence === 'high').length}`);
      
      // Step 5: Mark analyzed emails as processed
      for (const email of savedEmails) {
        try {
          await storage.updateEmail(email.id, { processed: true });
        } catch (error) {
          console.error(`Failed to mark email ${email.id} as processed:`, error);
        }
      }
      
      // Step 6: Save suggestions to database
      console.log(`💾 Saving ${geminiResults.subscriptions.length} suggestions...`);
      
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
            
            return searchTerms.some(term => emailText.includes(term));
          })
          .map(email => email.gmailId)
          .slice(0, 5);
      };
      
      const suggestionInserts = geminiResults.subscriptions.map(suggestion => ({
        userId,
        gmailAccountId: gmailAccount.id,
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
      
      const savedSuggestions = await storage.createSuggestionsBulk(suggestionInserts);
      console.log(`✅ Saved ${savedSuggestions.length} suggestions for ${gmailAccount.gmailEmail}`);
      
      // Mark as successful before returning
      processingSuccessful = true;
      
      return {
        success: true,
        accountId: gmailAccount.id,
        gmailEmail: gmailAccount.gmailEmail,
        emailsProcessed: savedEmails.length,
        suggestionsGenerated: savedSuggestions.length,
        candidateEmails: aiApprovedIds.length,
        totalEmails: emailMetadata.length
      };
      
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Error processing ${gmailAccount.gmailEmail}:`, error);
      
      return {
        success: false,
        accountId: gmailAccount.id,
        gmailEmail: gmailAccount.gmailEmail,
        error: lastErrorMessage
      };
    } finally {
      // Always update final sync status with error message
      await storage.updateGmailAccount(gmailAccount.id, {
        syncStatus: processingSuccessful ? 'idle' : 'error',
        lastSync: new Date(),
        syncError: processingSuccessful ? null : lastErrorMessage
      });
    }
  }
  
  // Enhanced sync with LLM analysis (AUTHENTICATED) - Multi-Account Support
  app.post("/api/sync-emails-llm", isAuthenticated, async (req: any, res) => {
    try {
      // Get userId from authenticated user, ignore request body for security
      const userId = req.user?.claims?.sub;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Fetch all Gmail accounts for this user
      const gmailAccounts = await storage.getGmailAccounts(userId);
      
      if (!gmailAccounts || gmailAccounts.length === 0) {
        return res.status(400).json({ message: "No Gmail accounts connected" });
      }
      
      // Get user's email sync days setting (default 90, max 180)
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const emailSyncDays = user.emailSyncDays || 90;
      
      console.log(`🚀 Starting multi-account sync for ${gmailAccounts.length} Gmail account(s)...`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      // Send initial progress update
      sendProgressUpdate(userId, {
        stage: 'multi_account_sync_start',
        progress: 0,
        message: `Starting sync for ${gmailAccounts.length} Gmail account(s)...`,
        details: { totalAccounts: gmailAccounts.length }
      });
      
      // Simple concurrency limiter - process max 3 accounts in parallel
      const CONCURRENCY_LIMIT = 3;
      const results: any[] = [];
      let completed = 0;
      
      for (let i = 0; i < gmailAccounts.length; i += CONCURRENCY_LIMIT) {
        const batch = gmailAccounts.slice(i, i + CONCURRENCY_LIMIT);
        
        const batchResults = await Promise.allSettled(
          batch.map(account => processGmailAccount(userId, account, emailSyncDays))
        );
        
        results.push(...batchResults);
        completed += batch.length;
        
        // Send progress update after each batch
        const progressPercentage = Math.round((completed / gmailAccounts.length) * 90);
        sendProgressUpdate(userId, {
          stage: 'accounts_syncing',
          progress: progressPercentage,
          message: `Synced ${completed} of ${gmailAccounts.length} accounts...`,
          details: { 
            completed,
            total: gmailAccounts.length
          }
        });
      }
      
      // Process results
      const successfulResults = results
        .filter(r => r.status === 'fulfilled' && r.value.success)
        .map(r => r.value);
      
      const failedResults = results
        .filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success))
        .map(r => {
          if (r.status === 'rejected') {
            return {
              success: false,
              accountId: 'unknown',
              gmailEmail: 'unknown',
              error: r.reason?.message || 'Unknown error'
            };
          }
          return r.value;
        });
      
      // Aggregate metrics
      const totalEmailsProcessed = successfulResults.reduce((sum, r) => sum + (r.emailsProcessed || 0), 0);
      const totalSuggestionsGenerated = successfulResults.reduce((sum, r) => sum + (r.suggestionsGenerated || 0), 0);
      
      console.log(`\n✅ Multi-account sync complete!`);
      console.log(`   • Accounts processed: ${gmailAccounts.length}`);
      console.log(`   • Successful: ${successfulResults.length}`);
      console.log(`   • Failed: ${failedResults.length}`);
      console.log(`   • Total emails processed: ${totalEmailsProcessed}`);
      console.log(`   • Total suggestions generated: ${totalSuggestionsGenerated}`);
      
      // Send final completion update
      sendProgressUpdate(userId, {
        stage: 'sync_complete',
        progress: 100,
        message: `Sync complete! Found ${totalSuggestionsGenerated} subscription suggestions across ${successfulResults.length} accounts`,
        details: { 
          totalAccounts: gmailAccounts.length,
          successful: successfulResults.length,
          failed: failedResults.length,
          suggestionsGenerated: totalSuggestionsGenerated
        }
      });
      
      // Return structured response
      res.json({
        success: true,
        totalAccounts: gmailAccounts.length,
        successful: successfulResults.length,
        failed: failedResults.length,
        suggestionsGenerated: totalSuggestionsGenerated,
        emailsProcessed: totalEmailsProcessed,
        redirectToSuggestions: totalSuggestionsGenerated > 0,
        results: results.map((r, index) => {
          if (r.status === 'fulfilled') {
            return {
              accountId: r.value.accountId,
              gmailEmail: r.value.gmailEmail,
              success: r.value.success,
              error: r.value.error,
              emailsProcessed: r.value.emailsProcessed,
              suggestionsGenerated: r.value.suggestionsGenerated
            };
          } else {
            return {
              accountId: gmailAccounts[index]?.id || 'unknown',
              gmailEmail: gmailAccounts[index]?.gmailEmail || 'unknown',
              success: false,
              error: r.reason?.message || 'Unknown error'
            };
          }
        })
      });

    } catch (error) {
      console.error("Multi-account sync error:", error);
      res.status(500).json({ 
        message: "Failed to perform multi-account sync",
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