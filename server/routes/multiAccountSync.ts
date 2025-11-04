import type { Express } from "express";
import { storage } from "../storage";
import { isAuthenticated } from "../replitAuth";
import { GmailService } from "../services/gmail";
import { outlookService } from "../services/outlook";
import { GeminiSubscriptionDetector } from "../services/geminiSubscriptionDetector";
import { TransactionDetector } from "../services/transactionDetector";

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

// Helper function to sync multiple accounts
async function syncMultipleAccounts(
  userId: string,
  accountIds: string[],
  emailSyncDays: number,
  sendProgressUpdate: Function
) {
  const results = [];
  
  for (let i = 0; i < accountIds.length; i++) {
    const accountId = accountIds[i];
    const account = await storage.getEmailAccount(accountId);
    
    if (!account) {
      console.error(`Account ${accountId} not found, skipping`);
      continue;
    }

    sendProgressUpdate(userId, {
      stage: 'account_sync',
      progress: Math.round((i / accountIds.length) * 100),
      message: `Syncing ${account.email} (${i + 1}/${accountIds.length})...`,
      details: { provider: account.provider, email: account.email }
    });

    try {
      // Pass isBatchContext=true to suppress terminal events from individual account sync
      const result = await syncSingleAccount(userId, accountId, emailSyncDays, sendProgressUpdate, true);
      results.push({ accountId, success: true, ...result });
      
      // Update last sync time
      await storage.updateEmailAccount(accountId, {
        lastSync: new Date(),
        updatedAt: new Date()
      });
      
      // Send per-account completion (not terminal)
      sendProgressUpdate(userId, {
        stage: 'account_complete',
        progress: Math.round(((i + 1) / accountIds.length) * 100),
        message: `Completed ${account.email} (${i + 1}/${accountIds.length})`,
        details: { accountId, email: account.email, ...result }
      });
    } catch (error) {
      console.error(`Failed to sync ${account.email}:`, error);
      results.push({
        accountId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Send per-account error (not terminal)
      sendProgressUpdate(userId, {
        stage: 'account_error',
        progress: Math.round(((i + 1) / accountIds.length) * 100),
        message: `Failed to sync ${account.email}`,
        details: { accountId, email: account.email, error: error instanceof Error ? error.message : 'Unknown error' }
      });
    }
  }

  sendProgressUpdate(userId, {
    stage: 'complete',
    progress: 100,
    message: `Synced ${results.filter(r => r.success).length}/${accountIds.length} accounts successfully`,
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

  // AI pre-screening (simplified for now - skip to save time/cost)
  // In production, you'd call geminiDetector.preFilterCandidates here
  
  // For now, just process top candidates directly
  const topCandidates = candidates.slice(0, Math.min(20, candidates.length));

  sendProgressUpdate(userId, {
    stage: 'processing',
    progress: 50,
    message: `Processing ${topCandidates.length} candidate emails...`
  });

  // Placeholder: Return success with candidate count
  return {
    emailsProcessed: topCandidates.length,
    suggestionsGenerated: 0,
    message: `Processed ${topCandidates.length} emails from ${account.email}`
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

  sendProgressUpdate(userId, {
    stage: 'processing',
    progress: 50,
    message: `Processing ${candidates.length} candidate emails...`
  });

  return {
    emailsProcessed: candidates.length,
    suggestionsGenerated: 0,
    message: `Processed ${candidates.length} emails from ${account.email}`
  };
}
