import { storage } from "../storage";
import { GmailService } from "./gmail";
import { outlookService } from "./outlook";
import { GeminiSubscriptionDetector } from "./geminiSubscriptionDetector";
import { TransactionDetector } from "./transactionDetector";
import { EnhancedEmailParser } from "./enhancedEmailParser";
import type { EmailAccount, InsertEmail } from "@shared/schema";

interface EmailMetadata {
  id: string;
  subject: string;
  from: {
    email: string;
    name: string;
  };
  receivedAt: Date;
  snippet: string;
}

interface FullEmail extends EmailMetadata {
  content: string;
  hasAttachments: boolean;
}

export class MultiAccountSyncService {
  private geminiDetector: GeminiSubscriptionDetector;
  private transactionDetector: TransactionDetector;
  private enhancedParser: EnhancedEmailParser;

  constructor() {
    this.geminiDetector = new GeminiSubscriptionDetector();
    this.transactionDetector = new TransactionDetector();
    this.enhancedParser = new EnhancedEmailParser();
  }

  async syncAccount(
    userId: string,
    accountId: string,
    emailSyncDays: number,
    onProgress?: (data: any) => void
  ) {
    const account = await storage.getEmailAccount(accountId);
    
    if (!account || account.userId !== userId || !account.isActive) {
      throw new Error("Email account not found or inactive");
    }

    console.log(`📧 Starting sync for ${account.provider} account: ${account.email}`);

    if (account.provider === 'gmail') {
      return await this.syncGmailAccount(userId, account, emailSyncDays, onProgress);
    } else if (account.provider === 'outlook') {
      return await this.syncOutlookAccount(userId, account, emailSyncDays, onProgress);
    } else {
      throw new Error(`Unsupported provider: ${account.provider}`);
    }
  }

  async syncAllAccounts(
    userId: string,
    emailSyncDays: number,
    onProgress?: (data: any) => void
  ) {
    const accounts = await storage.getActiveEmailAccounts(userId);
    
    if (accounts.length === 0) {
      throw new Error("No active email accounts found");
    }

    console.log(`🔄 Syncing ${accounts.length} email accounts for user ${userId}`);

    const results = [];
    
    for (const account of accounts) {
      try {
        onProgress?.({
          stage: 'account_sync_start',
          progress: 0,
          message: `Starting sync for ${account.email}...`,
          details: { provider: account.provider, email: account.email }
        });

        const result = await this.syncAccount(userId, account.id, emailSyncDays, onProgress);
        results.push({
          accountId: account.id,
          email: account.email,
          provider: account.provider,
          success: true,
          ...result
        });

        onProgress?.({
          stage: 'account_sync_complete',
          progress: 100,
          message: `Completed sync for ${account.email}`,
          details: { provider: account.provider, email: account.email }
        });
      } catch (error) {
        console.error(`Failed to sync account ${account.email}:`, error);
        results.push({
          accountId: account.id,
          email: account.email,
          provider: account.provider,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return results;
  }

  private async syncGmailAccount(
    userId: string,
    account: EmailAccount,
    emailSyncDays: number,
    onProgress?: (data: any) => void
  ) {
    const gmailService = new GmailService();

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

    if (!accessToken) {
      throw new Error("No valid access token for Gmail account");
    }

    // Fetch email metadata only
    onProgress?.({
      stage: 'fetching_metadata',
      progress: 10,
      message: `Fetching Gmail emails from ${account.email}...`
    });

    const gmailClient = gmailService.getGmailClient(accessToken, account.refreshToken || '');
    const query = `newer_than:${emailSyncDays}d`;
    
    // Fetch metadata
    const messages = await gmailService.getEmails(accessToken, account.refreshToken || '', undefined, emailSyncDays);
    
    onProgress?.({
      stage: 'metadata_fetched',
      progress: 30,
      message: `Found ${messages.length} emails from Gmail`
    });

    // Process emails with transaction detector and Gemini
    return await this.processEmails(userId, account.id, messages, onProgress);
  }

  private async syncOutlookAccount(
    userId: string,
    account: EmailAccount,
    emailSyncDays: number,
    onProgress?: (data: any) => void
  ) {
    onProgress?.({
      stage: 'fetching_metadata',
      progress: 10,
      message: `Fetching Outlook emails from ${account.email}...`
    });

    const emailMetadata = await outlookService.getEmailMetadata(emailSyncDays);

    onProgress?.({
      stage: 'metadata_fetched',
      progress: 30,
      message: `Found ${emailMetadata.length} emails from Outlook`
    });

    // Convert to common format
    const messages = emailMetadata.map(msg => ({
      id: msg.id,
      subject: msg.subject,
      from: msg.from,
      receivedAt: msg.receivedAt,
      snippet: msg.snippet,
      content: '', // Will be fetched later for approved candidates
      hasAttachments: false
    }));

    return await this.processEmails(userId, account.id, messages, onProgress);
  }

  private async processEmails(
    userId: string,
    emailAccountId: string,
    emailMetadata: any[],
    onProgress?: (data: any) => void
  ) {
    // Phase 1: Transaction detection screening
    onProgress?.({
      stage: 'screening',
      progress: 40,
      message: `Screening ${emailMetadata.length} emails for transactions...`
    });

    const candidates: any[] = [];
    
    for (const email of emailMetadata) {
      const score = this.transactionDetector.scoreEmail(
        email.subject,
        email.from.email,
        email.from.name,
        email.snippet
      );

      if (score.isTransaction) {
        candidates.push({
          id: email.id,
          subject: email.subject,
          from: email.from,
          receivedAt: email.receivedAt,
          snippet: email.snippet,
          score: score.totalScore
        });
      }
    }

    console.log(`✅ Found ${candidates.length} transaction candidates`);

    if (candidates.length === 0) {
      return {
        emailsProcessed: 0,
        suggestionsGenerated: 0,
        message: "No transaction emails found"
      };
    }

    // Phase 1.5: AI Pre-screening
    onProgress?.({
      stage: 'ai_prescreening',
      progress: 50,
      message: `AI pre-screening ${candidates.length} candidates...`
    });

    const approvedIds = await this.geminiDetector.preFilterCandidates(
      candidates,
      (progress) => {
        onProgress?.({
          stage: 'ai_prescreening',
          progress: 50 + (progress / 2),
          message: `AI pre-screening progress: ${Math.round(progress)}%`
        });
      }
    );

    console.log(`✅ AI approved ${approvedIds.length}/${candidates.length} emails`);

    if (approvedIds.length === 0) {
      return {
        emailsProcessed: 0,
        suggestionsGenerated: 0,
        message: "No subscription candidates found after AI screening"
      };
    }

    // Phase 2: Fetch full content for approved emails
    onProgress?.({
      stage: 'fetching_full_content',
      progress: 75,
      message: `Fetching full content for ${approvedIds.length} approved emails...`
    });

    // TODO: Implement provider-specific full email fetch
    // For now, placeholder
    const fullEmails: any[] = [];

    // Phase 3: Deep Gemini analysis
    onProgress?.({
      stage: 'gemini_analysis',
      progress: 85,
      message: `Analyzing ${approvedIds.length} emails with Gemini AI...`
    });

    // Save to database and analyze
    const savedEmails: any[] = [];
    
    for (const email of fullEmails) {
      try {
        const existingEmail = await storage.getEmailByGmailId(email.id);
        
        if (!existingEmail) {
          const saved = await storage.createEmail({
            userId,
            emailAccountId,
            gmailId: email.id,
            subject: email.subject,
            fromEmail: email.from.email,
            fromName: email.from.name,
            receivedAt: email.receivedAt,
            content: email.content,
            isTransaction: true,
            processed: false
          });
          savedEmails.push(saved);
        }
      } catch (error) {
        console.error(`Failed to save email ${email.id}:`, error);
      }
    }

    // Run Gemini analysis
    const geminiResults = await this.geminiDetector.analyzeEmailsForSubscriptions(savedEmails);

    onProgress?.({
      stage: 'complete',
      progress: 100,
      message: `Sync complete! Found ${geminiResults.subscriptions.length} subscription suggestions`
    });

    return {
      emailsProcessed: savedEmails.length,
      suggestionsGenerated: geminiResults.subscriptions.length,
      subscriptions: geminiResults.subscriptions
    };
  }
}

export const multiAccountSync = new MultiAccountSyncService();
