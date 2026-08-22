import type { Express } from "express";
import { storage } from "../storage";
import { GmailService } from "../services/gmail";
import { OutlookService } from "../services/outlook";
import { EnhancedEmailParser } from "../services/enhancedEmailParser";
import { GeminiSubscriptionDetector } from "../core/geminiSubscriptionDetector";
import { TransactionDetector } from "../core/transactionDetector";
import { generateServiceKey } from "../utils/serviceKey";
import { ensureFutureBillingDate } from "../utils/billingDate";
import { isAuthenticated } from "../auth";

// Helper function to get userId from normalized session structure
function getUserId(req: any): string {
  // For all non-OIDC auth types (password, google_oauth, microsoft_oauth), use userId
  // For OIDC (replit_oidc), use claims.sub
  return req.user.authType === 'replit_oidc' ? req.user.claims.sub : req.user.userId;
}

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

/**
 * Share of an account's progress bar owned by each pipeline stage, as
 * [start, end] fractions. Weights follow observed durations: on a ~2,500 email
 * mailbox the AI pre-filter is the longest stage by a wide margin, not the
 * Gmail fetch.
 */
const STAGE_SPANS = {
  metadata: [0.00, 0.35],
  prefilter: [0.35, 0.70],
  fetch_full: [0.70, 0.80],
  analysis: [0.80, 0.98],
} as const;

type StageName = keyof typeof STAGE_SPANS;

/** Reports progress within one account's slice of the overall sync. */
type StageReporter = (
  stage: StageName,
  fraction: number,
  message: string,
  details?: Record<string, unknown>
) => void;

export function registerGeminiRoutes(app: Express) {
  // Get progress notification function from parent scope
  const sendProgressUpdate = (globalThis as any).sendProgressUpdate || (() => {});

  /**
   * Build a reporter that maps stage-local progress into the overall bar.
   *
   * Accounts run concurrently, so with several mailboxes the bar reflects
   * whichever account reported last. That is acceptable: the point is a steady
   * event stream the client can distinguish from a hang, and the message names
   * the account. Single-account syncs -- the common case -- are exact.
   */
  function makeStageReporter(
    userId: string,
    accountLabel: string,
    accountIndex: number,
    totalAccounts: number
  ): StageReporter {
    return (stage, fraction, message, details) => {
      const [from, to] = STAGE_SPANS[stage];
      const withinAccount = from + (to - from) * Math.min(Math.max(fraction, 0), 1);
      const overall = ((accountIndex + withinAccount) / totalAccounts) * 100;

      sendProgressUpdate(userId, {
        stage,
        progress: Math.round(overall),
        message: totalAccounts > 1 ? `${accountLabel}: ${message}` : message,
        details: { account: accountLabel, ...details },
      });
    };
  }

  // Helper function to process a single Gmail account through the complete pipeline
  async function processGmailAccount(
    userId: string,
    gmailAccount: any,
    emailSyncDays: number,
    report: StageReporter = () => {}
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
      
      report('metadata', 0, 'Scanning mailbox...');

      const emailMetadata = await gmailService.getEmailMetadata(
        accessToken,
        gmailAccount.refreshToken,
        async (tokens) => {
          const updateData: any = { accessToken: tokens.access_token };
          if (tokens.refresh_token) updateData.refreshToken = tokens.refresh_token;
          if (tokens.expiry_date) updateData.tokenExpiry = new Date(tokens.expiry_date);
          await storage.updateGmailAccount(gmailAccount.id, updateData);
        },
        emailSyncDays,
        (done, total) =>
          report('metadata', done / total, `Scanned ${done} of ${total} emails`, {
            emailsProcessed: done,
            totalEmails: total,
          })
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
      
      report(
        'prefilter',
        0,
        `Screening ${candidatesWithIds.length} candidate emails...`,
        { candidateEmails: candidatesWithIds.length }
      );

      // prefilterCandidates already accepts a progress callback; it was simply
      // never passed. This is the longest stage of the sync.
      const aiApprovedIds = await geminiDetector.prefilterCandidates(
        candidatesWithIds,
        (percent: number) =>
          report('prefilter', percent / 100, `Screening candidates... ${Math.round(percent)}%`, {
            candidateEmails: candidatesWithIds.length,
          })
      );

      console.log(`✅ AI approved ${aiApprovedIds.length} emails for deep processing`);

      // ═══════════════════════════════════════════
      // PHASE 2: DEEP PROCESSING (TARGETED)
      // ═══════════════════════════════════════════

      console.log(`\n📥 PHASE 2: Deep Processing`);

      report('fetch_full', 0, `Fetching ${aiApprovedIds.length} matching emails...`);

      const gmailMessages = await gmailService.getEmailsByIds(
        accessToken,
        gmailAccount.refreshToken,
        aiApprovedIds,
        (done, total) =>
          report('fetch_full', done / total, `Fetching emails ${done} of ${total}...`)
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

      // analyzeEmailsForSubscriptions has no progress hook and lives in the
      // protected core, so this stage is bracketed rather than sampled. It runs
      // well inside the client's stall threshold.
      report('analysis', 0, `Analysing ${savedEmails.length} emails for subscriptions...`, {
        emailsProcessed: savedEmails.length,
      });

      const geminiResults = await geminiDetector.analyzeEmailsForSubscriptions(savedEmails);

      report('analysis', 1, `Found ${geminiResults.subscriptions.length} possible subscriptions`, {
        suggestionsGenerated: geminiResults.subscriptions.length,
      });

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
        nextBillingDate: ensureFutureBillingDate(parseValidDate(suggestion.nextBillingDate), suggestion.frequency),
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
  
  // Helper function to process a single Outlook account through the complete pipeline
  async function processOutlookAccount(
    userId: string,
    outlookAccount: any,
    emailSyncDays: number,
    report: StageReporter = () => {}
  ): Promise<{
    success: boolean;
    accountId: string;
    outlookEmail: string;
    error?: string;
    emailsProcessed?: number;
    suggestionsGenerated?: number;
    candidateEmails?: number;
    totalEmails?: number;
  }> {
    const outlookService = new OutlookService();
    const geminiDetector = new GeminiSubscriptionDetector();
    let processingSuccessful = false;
    let lastErrorMessage: string | null = null;
    
    try {
      console.log(`\n🔄 Processing Outlook account: ${outlookAccount.outlookEmail}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      // Update account status to syncing
      await storage.updateOutlookAccount(outlookAccount.id, { 
        syncStatus: 'syncing',
        syncError: null
      });
      
      // Check if access token is expired and refresh if needed
      let accessToken = outlookAccount.accessToken;
      const now = new Date();
      const tokenExpiry = outlookAccount.tokenExpiry ? new Date(outlookAccount.tokenExpiry) : null;
      
      if (tokenExpiry && now >= tokenExpiry) {
        console.log(`⚠️  Access token expired for ${outlookAccount.outlookEmail}, refreshing...`);
        
        try {
          const newTokens = await outlookService.refreshToken(outlookAccount.refreshToken);
          accessToken = newTokens.access_token;
          
          // Update account with new tokens
          const updateData: any = {
            accessToken: accessToken,
            tokenExpiry: newTokens.expiry_date ? new Date(newTokens.expiry_date) : null,
          };
          if (newTokens.refresh_token) {
            updateData.refreshToken = newTokens.refresh_token;
          }
          
          await storage.updateOutlookAccount(outlookAccount.id, updateData);
          
          console.log(`✅ Access token refreshed for ${outlookAccount.outlookEmail}`);
        } catch (error) {
          lastErrorMessage = 'Token refresh failed. Please reconnect this account.';
          console.error(`❌ ${lastErrorMessage}:`, error);
          
          return {
            success: false,
            accountId: outlookAccount.id,
            outlookEmail: outlookAccount.outlookEmail,
            error: lastErrorMessage
          };
        }
      }
      
      console.log(`🚀 TWO-PHASE PROCESSING: ${outlookAccount.outlookEmail}`);
      
      // ═══════════════════════════════════════════
      // PHASE 1: LIGHTWEIGHT SCREENING (FAST)
      // ═══════════════════════════════════════════
      
      console.log(`\n📊 PHASE 1: Lightweight Email Screening`);
      
      report('metadata', 0, 'Scanning mailbox...');

      const emailMetadata = await outlookService.fetchEmailMetadata(
        accessToken,
        outlookAccount.refreshToken,
        async (tokens) => {
          const updateData: any = { accessToken: tokens.access_token };
          if (tokens.refresh_token) updateData.refreshToken = tokens.refresh_token;
          if (tokens.expiry_date) updateData.tokenExpiry = new Date(tokens.expiry_date);
          await storage.updateOutlookAccount(outlookAccount.id, updateData);
        },
        emailSyncDays
      );

      report('metadata', 1, `Scanned ${emailMetadata.length} emails`, {
        emailsProcessed: emailMetadata.length,
        totalEmails: emailMetadata.length,
      });

      console.log(`✅ Fetched metadata for ${emailMetadata.length} emails`);
      
      // Phase 1b: Apply enhanced transaction detection to normalized metadata
      const transactionDetector = new TransactionDetector();
      const extractedMetadata = emailMetadata.map(msg => ({
        id: msg.id,
        subject: msg.subject,
        fromEmail: msg.fromEmail,
        fromName: msg.fromName,
        snippet: msg.snippet,
        bodyPreview: msg.snippet
      }));
      
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
      
      report(
        'prefilter',
        0,
        `Screening ${candidatesWithIds.length} candidate emails...`,
        { candidateEmails: candidatesWithIds.length }
      );

      const aiApprovedIds = await geminiDetector.prefilterCandidates(
        candidatesWithIds,
        (percent: number) =>
          report('prefilter', percent / 100, `Screening candidates... ${Math.round(percent)}%`, {
            candidateEmails: candidatesWithIds.length,
          })
      );

      console.log(`✅ AI approved ${aiApprovedIds.length} emails for deep processing`);

      // ═══════════════════════════════════════════
      // PHASE 2: DEEP PROCESSING (TARGETED)
      // ═══════════════════════════════════════════

      console.log(`\n📥 PHASE 2: Deep Processing`);

      report('fetch_full', 0, `Fetching ${aiApprovedIds.length} matching emails...`);

      // Fetch full emails for AI-approved candidates
      const fullEmails = await Promise.all(
        aiApprovedIds.map(msgId => 
          outlookService.fetchFullEmail(
            accessToken,
            outlookAccount.refreshToken,
            msgId,
            async (tokens) => {
              // Update local accessToken for subsequent requests
              accessToken = tokens.access_token;
              
              // Update storage
              const updateData: any = { accessToken: tokens.access_token };
              if (tokens.refresh_token) {
                updateData.refreshToken = tokens.refresh_token;
                outlookAccount.refreshToken = tokens.refresh_token;
              }
              if (tokens.expiry_date) updateData.tokenExpiry = new Date(tokens.expiry_date);
              await storage.updateOutlookAccount(outlookAccount.id, updateData);
            }
          )
        )
      );
      
      console.log(`✅ Fetched full content for ${fullEmails.length} emails`);
      
      // Phase 2b: Save emails to database with provider tags
      const savedEmails: any[] = [];
      
      for (const email of fullEmails) {
        try {
          const existingEmail = await storage.getEmailByGmailId(email.id);
          
          if (!existingEmail) {
            const emailData = {
              userId,
              emailProvider: 'outlook' as const,
              providerAccountId: outlookAccount.id,
              gmailId: email.id, // Reusing gmailId column for Outlook message IDs (legacy field name)
              subject: email.subject,
              fromEmail: email.fromEmail,
              fromName: email.fromName || null,
              receivedAt: email.receivedAt,
              content: email.body,
              attachmentData: email.attachments ? JSON.stringify({ attachments: email.attachments }) : null,
              isTransaction: true,
              extractedAmount: null,
              extractedCurrency: null,
              merchantName: null,
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
          console.error('Error saving Outlook email:', error);
        }
      }
      
      console.log(`✅ Saved ${savedEmails.length} Outlook emails`);
      
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
      
      // Step 6: Save suggestions to database with provider tags
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
        emailProvider: 'outlook' as const,
        providerAccountId: outlookAccount.id,
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
        nextBillingDate: ensureFutureBillingDate(parseValidDate(suggestion.nextBillingDate), suggestion.frequency),
        lastSeen: new Date(),
        status: 'pending'
      }));
      
      const savedSuggestions = await storage.createSuggestionsBulk(suggestionInserts);
      console.log(`✅ Saved ${savedSuggestions.length} suggestions for ${outlookAccount.outlookEmail}`);
      
      // Mark as successful before returning
      processingSuccessful = true;
      
      return {
        success: true,
        accountId: outlookAccount.id,
        outlookEmail: outlookAccount.outlookEmail,
        emailsProcessed: savedEmails.length,
        suggestionsGenerated: savedSuggestions.length,
        candidateEmails: aiApprovedIds.length,
        totalEmails: emailMetadata.length
      };
      
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Error processing ${outlookAccount.outlookEmail}:`, error);
      
      return {
        success: false,
        accountId: outlookAccount.id,
        outlookEmail: outlookAccount.outlookEmail,
        error: lastErrorMessage
      };
    } finally {
      // Always update final sync status with error message
      await storage.updateOutlookAccount(outlookAccount.id, {
        syncStatus: processingSuccessful ? 'idle' : 'error',
        lastSync: new Date(),
        syncError: processingSuccessful ? null : lastErrorMessage
      });
    }
  }
  
  // Enhanced sync with LLM analysis (AUTHENTICATED) - Multi-Provider Multi-Account Support
  app.post("/api/sync-emails-llm", isAuthenticated, async (req: any, res) => {
    try {
      // Get userId from authenticated user, ignore request body for security
      const userId = getUserId(req);
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Fetch all Gmail and Outlook accounts for this user
      const gmailAccounts = await storage.getGmailAccounts(userId);
      const outlookAccounts = await storage.getOutlookAccounts(userId);
      
      const totalAccounts = gmailAccounts.length + outlookAccounts.length;
      
      if (totalAccounts === 0) {
        return res.status(400).json({ message: "No email accounts connected" });
      }
      
      // Get user's email sync days setting (default 30, max 180)
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const emailSyncDays = user.emailSyncDays || 30;
      
      console.log(`🚀 Starting multi-provider sync: ${gmailAccounts.length} Gmail + ${outlookAccounts.length} Outlook = ${totalAccounts} total accounts`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // A wide date range can keep this running for tens of minutes, which no
      // proxy in front of the app will tolerate. Acknowledge the request now and
      // report progress over SSE (/api/sync-progress/:userId); the client picks
      // up completion from there, not from this response.
      res.status(202).json({
        success: true,
        started: true,
        totalAccounts,
        gmailAccounts: gmailAccounts.length,
        outlookAccounts: outlookAccounts.length,
        message: `Sync started for ${totalAccounts} account(s)`
      });

      setImmediate(async () => {
        try {
          // Send initial progress update
          sendProgressUpdate(userId, {
            stage: 'multi_account_sync_start',
            progress: 0,
            message: `Starting sync for ${totalAccounts} account(s) across Gmail and Outlook...`,
            details: { 
              totalAccounts,
              gmailAccounts: gmailAccounts.length,
              outlookAccounts: outlookAccounts.length
            }
          });
      
          // Multi-provider concurrency: max 4 total (2 per provider)
          const CONCURRENCY_LIMIT = 4;
          const PROVIDER_LIMIT = 2;
      
          // Create account tasks with provider metadata
          type AccountTask = {
            provider: 'gmail' | 'outlook';
            account: any;
            /** `index` is the account's position in the overall progress bar. */
            process: (index: number) => Promise<any>;
          };
      
          const gmailTasks: AccountTask[] = gmailAccounts.map(account => ({
            provider: 'gmail' as const,
            account,
            process: (index: number) =>
              processGmailAccount(
                userId,
                account,
                emailSyncDays,
                makeStageReporter(userId, account.gmailEmail, index, totalAccounts)
              )
          }));

          const outlookTasks: AccountTask[] = outlookAccounts.map(account => ({
            provider: 'outlook' as const,
            account,
            process: (index: number) =>
              processOutlookAccount(
                userId,
                account,
                emailSyncDays,
                makeStageReporter(userId, account.outlookEmail, index, totalAccounts)
              )
          }));

          // Interleave Gmail and Outlook tasks for balanced processing
          const allTasks: AccountTask[] = [];
          const maxLength = Math.max(gmailTasks.length, outlookTasks.length);
          for (let i = 0; i < maxLength; i++) {
            if (i < gmailTasks.length) allTasks.push(gmailTasks[i]);
            if (i < outlookTasks.length) allTasks.push(outlookTasks[i]);
          }
      
          const results: any[] = [];
          let completed = 0;
      
          for (let i = 0; i < allTasks.length; i += CONCURRENCY_LIMIT) {
            const batch = allTasks.slice(i, i + CONCURRENCY_LIMIT);
        
            // Enforce per-provider limits within batch
            const gmailBatch = batch.filter(t => t.provider === 'gmail').slice(0, PROVIDER_LIMIT);
            const outlookBatch = batch.filter(t => t.provider === 'outlook').slice(0, PROVIDER_LIMIT);
            const limitedBatch = [...gmailBatch, ...outlookBatch];
        
            const batchResults = await Promise.allSettled(
              limitedBatch.map(task => task.process(allTasks.indexOf(task)))
            );

            results.push(...batchResults);
            completed += limitedBatch.length;

            // Send progress update after each batch
            const progressPercentage = Math.round((completed / totalAccounts) * 90);
            sendProgressUpdate(userId, {
              stage: 'accounts_syncing',
              progress: progressPercentage,
              message: `Synced ${completed} of ${totalAccounts} accounts...`,
              details: {
                completed,
                total: totalAccounts
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
      
          console.log(`\n✅ Multi-provider sync complete!`);
          console.log(`   • Total accounts: ${totalAccounts} (${gmailAccounts.length} Gmail + ${outlookAccounts.length} Outlook)`);
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
              totalAccounts,
              gmailAccounts: gmailAccounts.length,
              outlookAccounts: outlookAccounts.length,
              successful: successfulResults.length,
              failed: failedResults.length,
              suggestionsGenerated: totalSuggestionsGenerated
            }
          });
      
        } catch (error) {
          // The response has already been sent, so failures can only surface
          // over SSE.
          console.error("Multi-account sync error:", error);
          sendProgressUpdate(userId, {
            stage: 'error',
            progress: 0,
            message: error instanceof Error ? error.message : 'Sync failed',
            details: {}
          });
        }
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
              nextBillingDate: ensureFutureBillingDate(parseValidDate(suggestion.nextBillingDate), suggestion.frequency),
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