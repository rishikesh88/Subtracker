import type { Express } from "express";
import { storage } from "../storage";
import { isAuthenticated } from "../replitAuth";
import { GmailService } from "../services/gmail";
import { outlookService } from "../services/outlook";
import { GeminiSubscriptionDetector } from "../services/geminiSubscriptionDetector";
import { TransactionDetector } from "../services/transactionDetector";
import { parseFlexibleDate } from "../utils/dateParser";
import { createRobustServiceKey } from "../utils/normalizeServiceKey";
import { subscriptionSuggestions } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';

// Initialize database connection for direct queries
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

export function registerMultiAccountSyncRoutes(app: Express) {
  // Get progress notification function from parent scope
  const sendProgressUpdate = (globalThis as any).sendProgressUpdate || (() => {});

  // Sync specific email account
  app.post("/api/sync-account/:accountId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      const { accountId } = req.params;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const account = await storage.getEmailAccount(accountId);
      
      if (!account || account.userId !== userId) {
        return res.status(404).json({ message: "Email account not found" });
      }

      if (!account.isActive) {
        return res.status(400).json({ message: "Email account is inactive" });
      }

      const user = await storage.getUser(userId);
      const emailSyncDays = user?.emailSyncDays || 90;

      console.log(`🔄 Syncing account: ${account.email} (${account.provider})`);

      sendProgressUpdate(userId, {
        stage: 'starting',
        progress: 0,
        message: `Starting sync for ${account.email}...`,
        details: { provider: account.provider, email: account.email }
      });

      // Trigger async sync process (wrapping for single-account flow)
      const singleAccountWrapper = async () => {
        try {
          // Pass isBatchContext=false to indicate standalone single-account sync
          const result = await syncSingleAccount(userId, account.id, emailSyncDays, sendProgressUpdate, false);
          console.log(`✅ Sync completed for ${account.email}:`, result);
          
          // Update last sync time
          await storage.updateEmailAccount(account.id, {
            lastSync: new Date(),
            updatedAt: new Date()
          }).catch(err => console.error('Failed to update lastSync:', err));
          
          // Send terminal completion event for single-account sync
          sendProgressUpdate(userId, {
            stage: 'complete',
            progress: 100,
            message: `Successfully synced ${account.email}`,
            details: result
          });
        } catch (error) {
          console.error(`❌ Sync failed for ${account.email}:`, error);
          sendProgressUpdate(userId, {
            stage: 'error',
            progress: 100,
            message: `Sync failed for ${account.email}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      };
      
      singleAccountWrapper();
      
      // Return immediately to avoid timeout
      res.json({
        success: true,
        message: `Sync initiated for ${account.email}`,
        accountId: account.id,
        provider: account.provider
      });
    } catch (error) {
      console.error("Account sync error:", error);
      res.status(500).json({ 
        message: "Failed to sync account",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Sync all active email accounts
  app.post("/api/sync-all-accounts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const accounts = await storage.getActiveEmailAccounts(userId);
      
      if (accounts.length === 0) {
        return res.status(400).json({ message: "No active email accounts found" });
      }

      const user = await storage.getUser(userId);
      const emailSyncDays = user?.emailSyncDays || 90;

      console.log(`🔄 Syncing ${accounts.length} accounts for user ${userId}`);

      sendProgressUpdate(userId, {
        stage: 'starting',
        progress: 0,
        message: `Syncing ${accounts.length} email accounts...`,
        details: { accountCount: accounts.length }
      });

      // Trigger async sync for all accounts
      syncMultipleAccounts(userId, accounts.map(a => a.id), emailSyncDays, sendProgressUpdate)
        .then(results => {
          console.log(`✅ Multi-account sync completed:`, results);
        })
        .catch(error => {
          console.error(`❌ Multi-account sync failed:`, error);
          sendProgressUpdate(userId, {
            stage: 'error',
            progress: 100,
            message: `Multi-account sync failed: ${error.message}`,
            error: error.message
          });
        });

      // Return immediately
      res.json({
        success: true,
        message: `Sync initiated for ${accounts.length} accounts`,
        accounts: accounts.map(a => ({
          id: a.id,
          email: a.email,
          provider: a.provider
        }))
      });
    } catch (error) {
      console.error("Multi-account sync error:", error);
      res.status(500).json({ 
        message: "Failed to sync accounts",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}

// Helper function to sync a single account
async function syncSingleAccount(
  userId: string,
  accountId: string,
  emailSyncDays: number,
  sendProgressUpdate: Function,
  isBatchContext: boolean = false
) {
  const account = await storage.getEmailAccount(accountId);
  if (!account) throw new Error("Account not found");

  const gmailService = new GmailService();
  const transactionDetector = new TransactionDetector();
  const geminiDetector = new GeminiSubscriptionDetector();

  if (account.provider === 'gmail') {
    return await syncGmailAccount(userId, account, emailSyncDays, sendProgressUpdate, gmailService, transactionDetector, geminiDetector);
  } else if (account.provider === 'outlook') {
    return await syncOutlookAccount(userId, account, emailSyncDays, sendProgressUpdate, transactionDetector, geminiDetector);
  }

  throw new Error(`Unsupported provider: ${account.provider}`);
}

// Helper function to sync multiple accounts (PARALLEL)
async function syncMultipleAccounts(
  userId: string,
  accountIds: string[],
  emailSyncDays: number,
  sendProgressUpdate: Function
) {
  console.log(`🚀 Starting PARALLEL sync for ${accountIds.length} accounts`);
  
  // Track completion count for progress updates
  let completedCount = 0;
  const totalAccounts = accountIds.length;
  
  // Sync all accounts in parallel using Promise.allSettled
  const syncPromises = accountIds.map(async (accountId, index) => {
    const account = await storage.getEmailAccount(accountId);
    
    if (!account) {
      console.error(`Account ${accountId} not found, skipping`);
      return { accountId, success: false, error: 'Account not found' };
    }

    sendProgressUpdate(userId, {
      stage: 'account_sync',
      progress: Math.round((completedCount / totalAccounts) * 100),
      message: `Syncing ${account.email}...`,
      details: { provider: account.provider, email: account.email }
    });

    try {
      // Pass isBatchContext=true to suppress terminal events from individual account sync
      const result = await syncSingleAccount(userId, accountId, emailSyncDays, sendProgressUpdate, true);
      
      // Update last sync time
      await storage.updateEmailAccount(accountId, {
        lastSync: new Date(),
        updatedAt: new Date()
      });
      
      // Increment completion count
      completedCount++;
      
      // Send per-account completion (not terminal)
      sendProgressUpdate(userId, {
        stage: 'account_complete',
        progress: Math.round((completedCount / totalAccounts) * 100),
        message: `Completed ${account.email} (${completedCount}/${totalAccounts})`,
        details: { accountId, email: account.email, ...result }
      });
      
      return { accountId, success: true, email: account.email, ...result };
    } catch (error) {
      console.error(`Failed to sync ${account.email}:`, error);
      
      // Increment completion count even on error
      completedCount++;
      
      // Send per-account error (not terminal)
      sendProgressUpdate(userId, {
        stage: 'account_error',
        progress: Math.round((completedCount / totalAccounts) * 100),
        message: `Failed to sync ${account.email}`,
        details: { accountId, email: account.email, error: error instanceof Error ? error.message : 'Unknown error' }
      });
      
      return {
        accountId,
        email: account.email,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Wait for all accounts to complete (parallel execution)
  const settledResults = await Promise.allSettled(syncPromises);
  
  // Extract results from settled promises
  const results = settledResults.map(result => 
    result.status === 'fulfilled' ? result.value : { success: false, error: 'Promise rejected' }
  );

  const successCount = results.filter(r => r.success).length;
  console.log(`✅ PARALLEL sync complete: ${successCount}/${totalAccounts} accounts successful`);

  sendProgressUpdate(userId, {
    stage: 'complete',
    progress: 100,
    message: `Synced ${successCount}/${totalAccounts} accounts successfully`,
    details: { results }
  });

  return results;
}

// Gmail-specific sync logic
async function syncGmailAccount(
  userId: string,
  account: any,
  emailSyncDays: number,
  sendProgressUpdate: Function,
  gmailService: GmailService,
  transactionDetector: TransactionDetector,
  geminiDetector: GeminiSubscriptionDetector
) {
  // Check/refresh token if needed
  let accessToken = account.accessToken;
  const now = new Date();
  const tokenExpiry = account.tokenExpiry ? new Date(account.tokenExpiry) : null;

  if (tokenExpiry && now >= tokenExpiry && account.refreshToken) {
    console.log('⚠️ Gmail access token expired, refreshing...');
    const newTokens = await gmailService.refreshAccessToken(account.refreshToken);
    accessToken = newTokens.access_token!;

    await storage.updateEmailAccount(account.id, {
      accessToken,
      tokenExpiry: newTokens.expiry_date ? new Date(newTokens.expiry_date) : null,
      updatedAt: new Date()
    });
  }

  if (!accessToken || !account.refreshToken) {
    throw new Error("No valid access token for Gmail account");
  }

  // Fetch email metadata
  sendProgressUpdate(userId, {
    stage: 'fetching_metadata',
    progress: 10,
    message: `Fetching emails from ${account.email}...`
  });

  const emailMetadata = await gmailService.getEmailMetadata(
    accessToken,
    account.refreshToken,
    async (newAccessToken: string) => {
      await storage.updateEmailAccount(account.id, { 
        accessToken: newAccessToken,
        updatedAt: new Date()
      });
    },
    emailSyncDays
  );

  console.log(`✅ Fetched ${emailMetadata.length} emails from Gmail`);

  // Extract and screen emails
  const extractedMetadata = emailMetadata.map((msg: any) => {
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

  // Apply transaction detection
  const candidates = extractedMetadata.filter(email => {
    const result = transactionDetector.detect({
      subject: email.subject,
      fromEmail: email.fromEmail,
      fromName: email.fromName,
      snippet: email.snippet,
      bodyPreview: email.bodyPreview
    });
    return result.isCandidate;
  });

  console.log(`✅ Found ${candidates.length} transaction candidates`);

  if (candidates.length === 0) {
    return {
      emailsProcessed: 0,
      suggestionsGenerated: 0,
      message: "No transaction emails found"
    };
  }

  // Phase 1.5: AI Pre-filtering
  console.log(`🤖 Phase 1.5: AI Pre-screening ${candidates.length} candidates...`);
  
  sendProgressUpdate(userId, {
    stage: 'ai_prefilter',
    progress: 40,
    message: `AI pre-filtering ${candidates.length} candidates...`
  });

  const aiApprovedIds = await geminiDetector.prefilterCandidates(
    candidates.map(c => ({ ...c, id: c.id! })),
    (progress) => {
      sendProgressUpdate(userId, {
        stage: 'ai_progress',
        progress: 40 + Math.round(progress * 0.15),
        message: `AI screening: ${Math.round(progress)}%`
      });
    }
  );

  console.log(`✅ AI approved ${aiApprovedIds.length}/${candidates.length} emails for deep processing`);

  if (aiApprovedIds.length === 0) {
    return {
      emailsProcessed: candidates.length,
      suggestionsGenerated: 0,
      message: `Screened ${candidates.length} emails, none approved by AI`
    };
  }

  // Phase 2: Deep Processing - Fetch full email content
  console.log(`📥 Phase 2: Fetching full content for ${aiApprovedIds.length} approved emails...`);
  
  sendProgressUpdate(userId, {
    stage: 'deep_processing',
    progress: 55,
    message: `Fetching full content for ${aiApprovedIds.length} emails...`
  });

  const fullEmails = await gmailService.getEmailsByIds(
    accessToken,
    account.refreshToken,
    aiApprovedIds
  );

  console.log(`✅ Fetched full content for ${fullEmails.length} emails`);

  // Parse emails for Gemini analysis - use Email schema shape
  const parsedEmails = fullEmails.map((msg: any) => {
    const headers = msg.payload?.headers || [];
    const subject = headers.find((h: any) => h.name === 'Subject')?.value || '';
    const from = headers.find((h: any) => h.name === 'From')?.value || '';
    const date = headers.find((h: any) => h.name === 'Date')?.value || '';
    
    const emailMatch = from.match(/<(.+?)>/);
    const fromEmail = emailMatch ? emailMatch[1] : from;
    const fromName = from.replace(/<.+?>/, '').trim();
    
    // Extract body content
    let content = '';
    const getBody = (part: any): string => {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
      if (part.parts) {
        return part.parts.map(getBody).join('\n');
      }
      return '';
    };
    content = getBody(msg.payload);

    return {
      id: msg.id || '',
      subject,
      fromEmail,
      fromName,
      receivedAt: new Date(date),
      content,
      snippet: msg.snippet || ''
    };
  });

  // Phase 2b: Gemini Deep Analysis
  console.log(`🤖 Phase 2: Running Gemini deep analysis on ${parsedEmails.length} emails...`);
  
  sendProgressUpdate(userId, {
    stage: 'gemini_analysis',
    progress: 70,
    message: `Analyzing ${parsedEmails.length} emails with AI...`
  });

  const geminiResult = await geminiDetector.analyzeEmailsForSubscriptions(parsedEmails);
  
  console.log(`✅ Gemini analysis complete: ${geminiResult.subscriptions.length} subscriptions found`);
  console.log(`📊 Gemini subscriptions:`, JSON.stringify(geminiResult.subscriptions, null, 2));

  // Save subscription suggestions to database with deduplication
  let savedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  
  for (const sub of geminiResult.subscriptions) {
    try {
      // Validate amount - skip if ₹0 or missing
      if (!sub.amount || sub.amount === 0) {
        console.warn(`⚠️ Skipping ${sub.serviceName}: Amount is ₹0 or missing (merchant: ${sub.merchantName})`);
        console.warn(`  This email will be reprocessed on next sync. Consider manual review.`);
        skippedCount++;
        continue;
      }
      
      // Generate robust serviceKey for deduplication (normalized merchant + service + frequency)
      // This handles AI variations in service naming between syncs
      const serviceKey = createRobustServiceKey(sub.serviceName, sub.merchantName, sub.frequency);
      
      // Convert confidence text to numeric score
      const confidenceScore = sub.confidence === 'high' ? 0.90 : sub.confidence === 'medium' ? 0.70 : 0.50;
      
      // Parse next billing date safely
      const nextBillingDate = parseFlexibleDate(sub.nextBillingDate);
      if (sub.nextBillingDate && !nextBillingDate) {
        console.warn(`⚠️ Could not parse billing date "${sub.nextBillingDate}" for ${sub.serviceName}`);
      }
      
      console.log(`💾 Processing ${sub.serviceName} (${sub.currency} ${sub.amount})...`);
      
      // Check if suggestion already exists (database deduplication with backward compatibility)
      // First try with new robust key format
      let existing = await db
        .select()
        .from(subscriptionSuggestions)
        .where(
          and(
            eq(subscriptionSuggestions.userId, userId),
            eq(subscriptionSuggestions.serviceKey, serviceKey),
            eq(subscriptionSuggestions.status, 'pending')
          )
        )
        .limit(1);
      
      // Backward compatibility: Client-side matching by stable fields
      // (merchantName + frequency, using same normalization as robust key)
      if (existing.length === 0) {
        // Fetch all pending suggestions for this user with matching frequency
        const candidates = await db
          .select()
          .from(subscriptionSuggestions)
          .where(
            and(
              eq(subscriptionSuggestions.userId, userId),
              eq(subscriptionSuggestions.frequency, sub.frequency),
              eq(subscriptionSuggestions.status, 'pending')
            )
          );
        
        // Normalize incoming merchant name
        const incomingNormalized = sub.merchantName
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .replace(/\s+/g, '_')
          .trim();
        
        // Client-side matching with same normalization logic
        const match = candidates.find(candidate => {
          const candidateNormalized = (candidate.merchantName || '')
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, '_')
            .trim();
          return candidateNormalized === incomingNormalized;
        });
        
        if (match) {
          existing = [match];
          console.log(`🔄 Migrating suggestion for "${sub.merchantName}" (${sub.frequency}) from legacy key "${match.serviceKey}" to new key "${serviceKey}"`);
          await db
            .update(subscriptionSuggestions)
            .set({ 
              serviceKey,
              serviceName: sub.serviceName // Also update service name to latest AI output
            })
            .where(eq(subscriptionSuggestions.id, match.id));
        }
      }
      
      if (existing.length > 0) {
        // Update existing suggestion: increment occurrences, update lastSeen
        await db
          .update(subscriptionSuggestions)
          .set({
            occurrences: (existing[0].occurrences || 1) + 1,
            lastSeen: new Date(),
            // Update to higher confidence if new detection is more confident
            ...(confidenceScore > parseFloat(existing[0].confidenceScore) ? {
              confidence: sub.confidence,
              confidenceScore: confidenceScore.toString(),
              reasoning: sub.reasoning
            } : {})
          })
          .where(eq(subscriptionSuggestions.id, existing[0].id));
        
        updatedCount++;
        console.log(`🔄 Updated existing suggestion for ${sub.serviceName} (occurrences: ${existing[0].occurrences + 1})`);
      } else {
        // Create new suggestion
        await storage.createSuggestion({
          userId,
          emailAccountId: account.id,
          serviceName: sub.serviceName,
          serviceKey,
          merchantName: sub.merchantName,
          amount: sub.amount.toString(),
          currency: sub.currency,
          frequency: sub.frequency,
          category: sub.category,
          confidence: sub.confidence,
          confidenceScore: confidenceScore.toString(),
          reasoning: sub.reasoning,
          nextBillingDate,
          lastSeen: new Date(),
          status: 'pending',
          recurringKeywords: sub.recurringKeywords || [],
          validationChecks: sub.validationChecks ? JSON.stringify(sub.validationChecks) : null,
          attachmentEvidence: sub.attachmentEvidence || null,
          senderHistory: sub.senderHistory || null
        });
        savedCount++;
        console.log(`✅ Created new suggestion for ${sub.serviceName}`);
      }
    } catch (error) {
      console.error(`❌ Failed to process subscription suggestion for ${sub.serviceName}:`, error);
      console.error('Error details:', {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : JSON.stringify(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      skippedCount++;
    }
  }

  console.log(`✅ Gmail suggestions processed: ${savedCount} new, ${updatedCount} updated, ${skippedCount} skipped (total: ${geminiResult.subscriptions.length})`);

  // Update email account's emailsAnalyzed counter
  const currentAccount = await storage.getEmailAccount(account.id);
  if (currentAccount) {
    await storage.updateEmailAccount(account.id, {
      emailsAnalyzed: (currentAccount.emailsAnalyzed || 0) + parsedEmails.length,
      lastSync: new Date()
    });
  }

  sendProgressUpdate(userId, {
    stage: 'complete',
    progress: 100,
    message: `Found ${savedCount} subscriptions from ${account.email}`
  });

  return {
    emailsProcessed: parsedEmails.length,
    suggestionsGenerated: savedCount,
    message: `Found ${savedCount} subscriptions from ${account.email}`
  };
}

// Outlook-specific sync logic
async function syncOutlookAccount(
  userId: string,
  account: any,
  emailSyncDays: number,
  sendProgressUpdate: Function,
  transactionDetector: TransactionDetector,
  geminiDetector: GeminiSubscriptionDetector
) {
  sendProgressUpdate(userId, {
    stage: 'fetching_metadata',
    progress: 10,
    message: `Fetching emails from ${account.email}...`
  });

  const emailMetadata = await outlookService.getEmailMetadata(emailSyncDays);

  console.log(`✅ Fetched ${emailMetadata.length} emails from Outlook`);

  // Apply transaction detection
  const candidates = emailMetadata.filter(email => {
    const result = transactionDetector.detect({
      subject: email.subject,
      fromEmail: email.from.email,
      fromName: email.from.name,
      snippet: email.snippet,
      bodyPreview: email.snippet
    });
    return result.isCandidate;
  });

  console.log(`✅ Found ${candidates.length} transaction candidates from Outlook`);

  if (candidates.length === 0) {
    return {
      emailsProcessed: 0,
      suggestionsGenerated: 0,
      message: "No transaction emails found"
    };
  }

  // Phase 1.5: AI Pre-filtering
  console.log(`🤖 Phase 1.5: AI Pre-screening ${candidates.length} Outlook candidates...`);
  
  sendProgressUpdate(userId, {
    stage: 'ai_prefilter',
    progress: 40,
    message: `AI pre-filtering ${candidates.length} candidates...`
  });

  // Map Outlook emails to match expected format
  const candidatesForAI = candidates.map(email => ({
    id: email.id,
    subject: email.subject,
    fromEmail: email.from.email,
    fromName: email.from.name,
    snippet: email.snippet
  }));

  const aiApprovedIds = await geminiDetector.prefilterCandidates(
    candidatesForAI,
    (progress) => {
      sendProgressUpdate(userId, {
        stage: 'ai_progress',
        progress: 40 + Math.round(progress * 0.15),
        message: `AI screening: ${Math.round(progress)}%`
      });
    }
  );

  console.log(`✅ AI approved ${aiApprovedIds.length}/${candidates.length} Outlook emails for deep processing`);

  if (aiApprovedIds.length === 0) {
    return {
      emailsProcessed: candidates.length,
      suggestionsGenerated: 0,
      message: `Screened ${candidates.length} emails, none approved by AI`
    };
  }

  // Phase 2: Deep Processing - Fetch full email content
  console.log(`📥 Phase 2: Fetching full content for ${aiApprovedIds.length} approved Outlook emails...`);
  
  sendProgressUpdate(userId, {
    stage: 'deep_processing',
    progress: 55,
    message: `Fetching full content for ${aiApprovedIds.length} emails...`
  });

  const fullEmails = await outlookService.getEmailsById(aiApprovedIds);

  console.log(`✅ Fetched full content for ${fullEmails.length} Outlook emails`);

  // Parse emails for Gemini analysis - use Email schema shape
  const parsedEmails = fullEmails.map((msg: any) => ({
    id: msg.id || '',
    subject: msg.subject,
    fromEmail: msg.from.email,
    fromName: msg.from.name,
    receivedAt: msg.receivedAt,
    content: msg.content,
    snippet: msg.content.substring(0, 200)
  }));

  // Phase 2b: Gemini Deep Analysis
  console.log(`🤖 Phase 2: Running Gemini deep analysis on ${parsedEmails.length} Outlook emails...`);
  
  sendProgressUpdate(userId, {
    stage: 'gemini_analysis',
    progress: 70,
    message: `Analyzing ${parsedEmails.length} emails with AI...`
  });

  const geminiResult = await geminiDetector.analyzeEmailsForSubscriptions(parsedEmails);
  
  console.log(`✅ Gemini analysis complete: ${geminiResult.subscriptions.length} subscriptions found from Outlook`);
  console.log(`📊 Outlook Gemini subscriptions:`, JSON.stringify(geminiResult.subscriptions, null, 2));

  // Save subscription suggestions to database with deduplication
  let savedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  
  for (const sub of geminiResult.subscriptions) {
    try {
      // Validate amount - skip if ₹0 or missing
      if (!sub.amount || sub.amount === 0) {
        console.warn(`⚠️ Skipping ${sub.serviceName}: Amount is ₹0 or missing (merchant: ${sub.merchantName})`);
        console.warn(`  This email will be reprocessed on next sync. Consider manual review.`);
        skippedCount++;
        continue;
      }
      
      // Generate robust serviceKey for deduplication (normalized merchant + service + frequency)
      // This handles AI variations in service naming between syncs
      const serviceKey = createRobustServiceKey(sub.serviceName, sub.merchantName, sub.frequency);
      
      // Convert confidence text to numeric score
      const confidenceScore = sub.confidence === 'high' ? 0.90 : sub.confidence === 'medium' ? 0.70 : 0.50;
      
      // Parse next billing date safely
      const nextBillingDate = parseFlexibleDate(sub.nextBillingDate);
      if (sub.nextBillingDate && !nextBillingDate) {
        console.warn(`⚠️ Could not parse billing date "${sub.nextBillingDate}" for ${sub.serviceName}`);
      }
      
      console.log(`💾 Processing ${sub.serviceName} (${sub.currency} ${sub.amount})...`);
      
      // Check if suggestion already exists (database deduplication with backward compatibility)
      // First try with new robust key format
      let existing = await db
        .select()
        .from(subscriptionSuggestions)
        .where(
          and(
            eq(subscriptionSuggestions.userId, userId),
            eq(subscriptionSuggestions.serviceKey, serviceKey),
            eq(subscriptionSuggestions.status, 'pending')
          )
        )
        .limit(1);
      
      // Backward compatibility: Client-side matching by stable fields
      // (merchantName + frequency, using same normalization as robust key)
      if (existing.length === 0) {
        // Fetch all pending suggestions for this user with matching frequency
        const candidates = await db
          .select()
          .from(subscriptionSuggestions)
          .where(
            and(
              eq(subscriptionSuggestions.userId, userId),
              eq(subscriptionSuggestions.frequency, sub.frequency),
              eq(subscriptionSuggestions.status, 'pending')
            )
          );
        
        // Normalize incoming merchant name
        const incomingNormalized = sub.merchantName
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .replace(/\s+/g, '_')
          .trim();
        
        // Client-side matching with same normalization logic
        const match = candidates.find(candidate => {
          const candidateNormalized = (candidate.merchantName || '')
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, '_')
            .trim();
          return candidateNormalized === incomingNormalized;
        });
        
        if (match) {
          existing = [match];
          console.log(`🔄 Migrating suggestion for "${sub.merchantName}" (${sub.frequency}) from legacy key "${match.serviceKey}" to new key "${serviceKey}"`);
          await db
            .update(subscriptionSuggestions)
            .set({ 
              serviceKey,
              serviceName: sub.serviceName // Also update service name to latest AI output
            })
            .where(eq(subscriptionSuggestions.id, match.id));
        }
      }
      
      if (existing.length > 0) {
        // Update existing suggestion: increment occurrences, update lastSeen
        await db
          .update(subscriptionSuggestions)
          .set({
            occurrences: (existing[0].occurrences || 1) + 1,
            lastSeen: new Date(),
            // Update to higher confidence if new detection is more confident
            ...(confidenceScore > parseFloat(existing[0].confidenceScore) ? {
              confidence: sub.confidence,
              confidenceScore: confidenceScore.toString(),
              reasoning: sub.reasoning
            } : {})
          })
          .where(eq(subscriptionSuggestions.id, existing[0].id));
        
        updatedCount++;
        console.log(`🔄 Updated existing suggestion for ${sub.serviceName} (occurrences: ${existing[0].occurrences + 1})`);
      } else {
        // Create new suggestion
        await storage.createSuggestion({
          userId,
          emailAccountId: account.id,
          serviceName: sub.serviceName,
          serviceKey,
          merchantName: sub.merchantName,
          amount: sub.amount.toString(),
          currency: sub.currency,
          frequency: sub.frequency,
          category: sub.category,
          confidence: sub.confidence,
          confidenceScore: confidenceScore.toString(),
          reasoning: sub.reasoning,
          nextBillingDate,
          lastSeen: new Date(),
          status: 'pending',
          recurringKeywords: sub.recurringKeywords || [],
          validationChecks: sub.validationChecks ? JSON.stringify(sub.validationChecks) : null,
          attachmentEvidence: sub.attachmentEvidence || null,
          senderHistory: sub.senderHistory || null
        });
        savedCount++;
        console.log(`✅ Created new suggestion for ${sub.serviceName}`);
      }
    } catch (error) {
      console.error(`❌ Failed to process Outlook subscription suggestion for ${sub.serviceName}:`, error);
      console.error('Error details:', {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : JSON.stringify(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      skippedCount++;
    }
  }

  console.log(`✅ Outlook suggestions processed: ${savedCount} new, ${updatedCount} updated, ${skippedCount} skipped (total: ${geminiResult.subscriptions.length})`);

  // Update email account's emailsAnalyzed counter
  const currentAccount = await storage.getEmailAccount(account.id);
  if (currentAccount) {
    await storage.updateEmailAccount(account.id, {
      emailsAnalyzed: (currentAccount.emailsAnalyzed || 0) + parsedEmails.length,
      lastSync: new Date()
    });
  }

  sendProgressUpdate(userId, {
    stage: 'complete',
    progress: 100,
    message: `Found ${savedCount} subscriptions from ${account.email}`
  });

  return {
    emailsProcessed: parsedEmails.length,
    suggestionsGenerated: savedCount,
    message: `Found ${savedCount} subscriptions from ${account.email}`
  };
}
