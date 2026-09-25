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
import { setSyncRunner } from "../services/syncRunner";
import { storeInvoiceAttachment } from "../lib/invoiceAttachment";
import { verifyCurrency } from "../lib/currencyCheck";
import { refreshRates } from "../lib/exchangeRates";
import { pickEvidence } from "../lib/evidence";

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
/**
 * The currency for a suggestion, checked against the emails it came from.
 *
 * The model is asked for the currency printed beside the amount, but it has
 * been wrong in a way worth guarding: on a Claude Pro invoice it read
 * "$23.60", saw an Indian GST line, and reported INR -- borrowing the
 * currency from a different email in the same batch.
 *
 * Whether a body contains "$23.60" is a regex, so it is checked here rather
 * than trusted. The email only overrides the model when it is unambiguous;
 * see `verifyCurrency`.
 *
 * "UNKNOWN" is a real answer and is kept. The review screen asks the user to
 * confirm it rather than the pipeline inventing a currency.
 */
/**
 * Each suggestion's evidence, chosen once, and its confidence brought into
 * line with it.
 *
 * The detector's named emails are used when they read like bills; otherwise
 * the brand is searched for, skipping emails the detector gave to another
 * suggestion. A suggestion left with no relevant email at all is still shown
 * -- the detector may know something the kept emails do not -- but never at
 * more than low confidence, and the review card says why.
 *
 * One line per suggestion goes to the log, so a missing piece of evidence can
 * be traced to where it was lost.
 */
function resolveEvidence(suggestions: any[], savedEmails: any[]): Map<any, any[]> {
  const claimedBy = new Map<string, any>();
  for (const suggestion of suggestions) {
    for (const id of suggestion.evidenceEmailIds ?? []) {
      if (!claimedBy.has(id)) claimedBy.set(id, suggestion);
    }
  }

  const result = new Map<any, any[]>();
  for (const suggestion of suggestions) {
    const claimedByOthers = new Set(
      Array.from(claimedBy.entries())
        .filter(([, owner]) => owner !== suggestion)
        .map(([id]) => id),
    );
    const pick = pickEvidence(suggestion, savedEmails, claimedByOthers);
    result.set(suggestion, pick.emails);

    if (pick.emails.length === 0 && suggestion.confidence !== 'low') {
      suggestion.confidence = 'low';
    }
    console.log(
      `   🧾 ${suggestion.serviceName}: ${pick.named} named by detector, ` +
      `${pick.found} found by search, ${pick.emails.length} kept (${pick.source})` +
      (pick.emails.length === 0 ? ' -> low confidence, no relevant email' : '')
    );
  }
  return result;
}

function resolveCurrency(suggestion: any, evidence: any[]): string {
  const text = evidence
    .map((email) => [email?.subject, email?.content].filter(Boolean).join('\n'))
    .join('\n\n');

  const verdict = verifyCurrency(text, Number(suggestion.amount), suggestion.currency);
  if (verdict.corrected) {
    console.log(`💱 ${suggestion.serviceName}: ${verdict.reason}`);
  }
  return verdict.currency;
}

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

      // Mail already screened is skipped before the metadata fetch, which keeps
      // it out of the AI pre-filter too -- together the bulk of a sync.
      //
      // Both sources are needed. `emails` holds only the pre-filter survivors,
      // so on its own it skips almost nothing; `screened_messages` covers every
      // id the sync has looked at. Stored emails stay in the union so mail
      // processed before that table existed is still recognised.
      const [screenedIds, syncedGmailIds] = await Promise.all([
        storage.getScreenedMessageIds(userId, 'gmail'),
        storage.getSyncedGmailIds(userId),
      ]);

      // Built with forEach rather than spread: this project's tsc target does
      // not allow iterating a Set directly.
      const alreadySeen = new Set<string>();
      screenedIds.forEach(id => alreadySeen.add(id));
      syncedGmailIds.forEach(id => alreadySeen.add(id));

      if (alreadySeen.size > 0) {
        console.log(`📇 ${alreadySeen.size} messages already seen (${screenedIds.size} screened, ${syncedGmailIds.size} stored)`);
      }

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
          }),
        alreadySeen
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

      // Record only after screening has actually completed. Writing these
      // earlier would mark mail as seen that a crash mid-pre-filter never
      // examined, and it would then be skipped permanently on every later run.
      const screenedThisRun = extractedMetadata.map(m => m.id).filter(Boolean);
      const recordedCount = await storage.recordScreenedMessages(userId, screenedThisRun, 'gmail');
      console.log(`📇 Recorded ${recordedCount} screened message IDs`);

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
      
      
      /* Matched once per suggestion, then read twice -- the currency check and
         evidenceEmailIds below both want the same emails. */
      // Chosen once per suggestion, then read by the currency check and by
      // evidenceEmailIds below.
      const evidenceBySuggestion = resolveEvidence(geminiResults.subscriptions, savedEmails);
      const evidenceFor = (suggestion: any) => evidenceBySuggestion.get(suggestion) ?? [];

      const suggestionInserts = geminiResults.subscriptions.map(suggestion => ({
        userId,
        gmailAccountId: gmailAccount.id,
        serviceName: suggestion.serviceName,
        serviceKey: generateServiceKey(suggestion.serviceName, suggestion.frequency),
        merchantName: suggestion.merchantName || null,
        amount: suggestion.amount.toString(),
        currency: resolveCurrency(suggestion, evidenceFor(suggestion)),
        frequency: suggestion.frequency,
        category: suggestion.category || null,
        confidence: suggestion.confidence,
        confidenceScore: suggestion.confidence === 'high' ? '0.85' : suggestion.confidence === 'medium' ? '0.65' : '0.45',
        reasoning: suggestion.reasoning || null,
        evidenceEmailIds: evidenceFor(suggestion).map((email) => email.gmailId),
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
            /*
             * Store the files before the row that points at them.
             *
             * Outlook receipts used to be saved with their filenames and
             * nothing behind them, so every Outlook invoice read "no file
             * attached" -- the upload step existed only in the Gmail path.
             * The bytes are dropped afterwards: attachmentData is a text
             * column, and base64 PDFs in it would make it unreadable.
             */
            const storedAttachments = email.attachments
              ? await Promise.all(
                  email.attachments.map(async (attachment) => {
                    const { contentBase64, ...rest } = attachment;
                    if (!contentBase64) return rest;
                    const objectStoragePath = await storeInvoiceAttachment({
                      buffer: Buffer.from(contentBase64, 'base64'),
                      filename: rest.filename,
                      mimeType: rest.mimeType,
                      userId,
                    });
                    return { ...rest, objectStoragePath };
                  })
                )
              : undefined;

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
              attachmentData: storedAttachments ? JSON.stringify({ attachments: storedAttachments }) : null,
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
      
      
      /* Matched once per suggestion, then read twice -- the currency check and
         evidenceEmailIds below both want the same emails. */
      // Chosen once per suggestion, then read by the currency check and by
      // evidenceEmailIds below.
      const evidenceBySuggestion = resolveEvidence(geminiResults.subscriptions, savedEmails);
      const evidenceFor = (suggestion: any) => evidenceBySuggestion.get(suggestion) ?? [];

      const suggestionInserts = geminiResults.subscriptions.map(suggestion => ({
        userId,
        emailProvider: 'outlook' as const,
        providerAccountId: outlookAccount.id,
        serviceName: suggestion.serviceName,
        serviceKey: generateServiceKey(suggestion.serviceName, suggestion.frequency),
        merchantName: suggestion.merchantName || null,
        amount: suggestion.amount.toString(),
        currency: resolveCurrency(suggestion, evidenceFor(suggestion)),
        frequency: suggestion.frequency,
        category: suggestion.category || null,
        confidence: suggestion.confidence,
        confidenceScore: suggestion.confidence === 'high' ? '0.85' : suggestion.confidence === 'medium' ? '0.65' : '0.45',
        reasoning: suggestion.reasoning || null,
        evidenceEmailIds: evidenceFor(suggestion).map((email) => email.gmailId),
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
  /**
   * Start a sync for every mailbox this user has connected, Gmail and Outlook
   * alike, and return once it is under way.
   *
   * Extracted from the route below so that it has one caller more than the
   * button: the sync that fires after onboarding used a different, older
   * implementation whose Outlook branch was an empty stub, so connecting an
   * Outlook mailbox during onboarding did nothing at all and the dashboard
   * stayed empty. Both paths now run this.
   *
   * It returns as soon as the work is scheduled. A wide date range can keep
   * the run going for tens of minutes, which no proxy in front of the app
   * would tolerate, so progress goes out over SSE rather than a response.
   */
  async function beginSyncForUser(
    userId: string,
    triggerSource: 'manual' | 'onboarding'
  ): Promise<
    | { ok: true; totalAccounts: number; gmailAccounts: number; outlookAccounts: number }
    | { ok: false; status: number; message: string; alreadyRunning?: boolean }
  > {
    try {
      // The caller has already established who this is.
      
      if (!userId) {
        return { ok: false as const, status: 401, message: "User not authenticated" };
      }

      // A sync is the moment a person is most likely to look at their totals,
      // so it is a good excuse to top up the rate table. Not awaited and
      // cannot throw: a rate service being slow must never hold up a scan.
      void refreshRates();

      // Fetch all Gmail and Outlook accounts for this user
      const gmailAccounts = await storage.getGmailAccounts(userId);
      const outlookAccounts = await storage.getOutlookAccounts(userId);
      
      const totalAccounts = gmailAccounts.length + outlookAccounts.length;
      
      if (totalAccounts === 0) {
        return { ok: false as const, status: 400, message: "No email accounts connected" };
      }
      
      // Get user's email sync days setting (default 30, max 180)
      const user = await storage.getUser(userId);
      if (!user) {
        return { ok: false as const, status: 404, message: "User not found" };
      }
      
      const emailSyncDays = user.emailSyncDays || 30;

      // Claim the run before acknowledging it. A second trigger while one is in
      // flight would duplicate every Gemini call and race on the same rows, so
      // it is refused here rather than left to sort itself out.
      const claim = await storage.startSyncJob(userId, triggerSource);
      if (claim.outcome === 'conflict') {
        console.log(`⛔ Sync already running for user ${userId}, rejecting duplicate trigger`);
        return {
          ok: false as const,
          status: 409,
          message: "A sync is already running for this account. Wait for it to finish before starting another.",
          alreadyRunning: true,
        };
      }

      // 'unavailable' means the job table could not be written. Run anyway --
      // an unrecorded sync beats refusing every sync over bookkeeping.
      const jobId = claim.outcome === 'claimed' ? claim.job.id : null;
      if (!jobId) {
        console.warn('⚠️  Running sync without a job record; the concurrency guard is inactive');
      }

      console.log(`🚀 Starting multi-provider sync: ${gmailAccounts.length} Gmail + ${outlookAccounts.length} Outlook = ${totalAccounts} total accounts`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // A wide date range can keep this running for tens of minutes, which no
      // proxy in front of the app will tolerate. Acknowledge the request now and
      // report progress over SSE (/api/sync-progress/:userId); the client picks
      // up completion from there, not from this response.
      const summary = {
        ok: true as const,
        totalAccounts,
        gmailAccounts: gmailAccounts.length,
        outlookAccounts: outlookAccounts.length,
      };

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
      
          // Send final update.
          //
          // Account failures are returned as {success:false} rather than
          // thrown, so reaching here says nothing about whether the sync
          // worked. This previously reported 'sync_complete' regardless and
          // built its message only from successfulResults, so a run where the
          // single account failed rendered as "Sync complete! Found 0
          // subscription suggestions across 0 accounts" -- indistinguishable
          // from a healthy sync of an already-screened mailbox. A fatal error
          // looked like a quiet day, and the message that would have explained
          // it was already sitting in failedResults.
          const everyAccountFailed = successfulResults.length === 0 && failedResults.length > 0;
          const failureDetail = failedResults
            .map(r => `${r.gmailEmail || (r as any).outlookEmail || r.accountId}: ${r.error || 'unknown error'}`)
            .join('; ');

          let finalStage: string;
          let finalMessage: string;

          if (everyAccountFailed) {
            finalStage = 'error';
            finalMessage = failedResults.length === 1
              ? `Sync failed. ${failedResults[0].error || 'Unknown error'}`
              : `Sync failed for all ${failedResults.length} accounts. ${failureDetail}`;
          } else if (failedResults.length > 0) {
            // Partial success still has to name what was lost, or the missing
            // mailbox reads as a mailbox with nothing in it.
            finalStage = 'sync_complete';
            finalMessage =
              `Synced ${successfulResults.length} of ${totalAccounts} accounts and found ` +
              `${totalSuggestionsGenerated} suggestion${totalSuggestionsGenerated === 1 ? '' : 's'}. ` +
              `${failedResults.length} account${failedResults.length === 1 ? '' : 's'} failed: ${failureDetail}`;
          } else {
            finalStage = 'sync_complete';
            finalMessage =
              `Sync complete! Found ${totalSuggestionsGenerated} subscription ` +
              `suggestion${totalSuggestionsGenerated === 1 ? '' : 's'} across ` +
              `${successfulResults.length} account${successfulResults.length === 1 ? '' : 's'}`;
          }

          sendProgressUpdate(userId, {
            stage: finalStage,
            // A failed run must not reach 100: the client treats progress >= 100
            // as completion and would show "Sync Complete!" over the error.
            progress: everyAccountFailed ? 99 : 100,
            message: finalMessage,
            details: {
              totalAccounts,
              gmailAccounts: gmailAccounts.length,
              outlookAccounts: outlookAccounts.length,
              successful: successfulResults.length,
              failed: failedResults.length,
              suggestionsGenerated: totalSuggestionsGenerated,
              errors: failedResults.length ? failureDetail : undefined
            }
          });
      
          if (jobId) {
            // Account failures are caught inside processGmailAccount and
            // returned as {success:false} rather than thrown, so reaching this
            // point does not mean the sync worked. A run where no account
            // succeeded is a failed run: recording it as succeeded is exactly
            // the dishonesty this job table exists to remove.
            const anySucceeded = successfulResults.length > 0;
            const failureSummary = failedResults.length
              ? failedResults.map(r => `${r.gmailEmail || r.accountId}: ${r.error || 'unknown error'}`).join('; ')
              : null;

            await storage.finishSyncJob(jobId, anySucceeded ? 'succeeded' : 'failed', {
              // Kept on partial success too, so a run that synced one mailbox
              // and lost another does not read as clean.
              error: failureSummary,
              emailsProcessed: totalEmailsProcessed,
              suggestionsGenerated: totalSuggestionsGenerated,
            });
          }

        } catch (error) {
          // The response has already been sent, so failures can only surface
          // over SSE.
          console.error("Multi-account sync error:", error);

          // Record the failure before the SSE event, so the job is never left
          // `running` -- that would block every later sync until the boot sweep.
          if (jobId) {
            await storage.finishSyncJob(jobId, 'failed', {
              error: error instanceof Error ? error.message : 'Sync failed',
            });
          }

          sendProgressUpdate(userId, {
            stage: 'error',
            progress: 0,
            message: error instanceof Error ? error.message : 'Sync failed',
            details: {}
          });
        }
      });

      return summary;
    } catch (error) {
      console.error("Multi-account sync error:", error);
      return {
        ok: false as const,
        status: 500,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // Published so the onboarding trigger can run exactly this, rather than a
  // second implementation that drifts from it.
  setSyncRunner((userId) => beginSyncForUser(userId, 'onboarding').then(() => undefined));

  app.post("/api/sync-emails-llm", isAuthenticated, async (req: any, res) => {
    const result = await beginSyncForUser(getUserId(req), 'manual');
    if (!result.ok) {
      return res.status(result.status).json({
        message: result.message,
        ...(result.alreadyRunning ? { alreadyRunning: true } : {}),
      });
    }
    res.status(202).json({
      success: true,
      started: true,
      totalAccounts: result.totalAccounts,
      gmailAccounts: result.gmailAccounts,
      outlookAccounts: result.outlookAccounts,
      message: `Sync started for ${result.totalAccounts} account(s)`,
    });
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
              serviceKey: generateServiceKey(suggestion.serviceName, suggestion.frequency),
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