import { type User, type InsertUser, type UpsertUser, type Subscription, type InsertSubscription, type Email, type InsertEmail, type UpdateUser, type SubscriptionSuggestion, type InsertSubscriptionSuggestion, type Invoice, type InsertInvoice, type GmailAccount, type InsertGmailAccount, type UpdateGmailAccount, type OutlookAccount, type InsertOutlookAccount, type UpdateOutlookAccount, type SyncJob, users, syncJobs, subscriptions, emails, screenedMessages, subscriptionSuggestions, invoices, gmailAccounts, outlookAccounts } from "@shared/schema";
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, and, desc, asc, count, sql, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import { neon } from '@neondatabase/serverless';
import { randomUUID } from "crypto";
import { convertCurrency } from "./utils/currencyConverter";
import { brandTokens } from "./lib/brandTokens";
import { advanceOnePeriod, ensureFutureBillingDate } from "./utils/billingDate";
import { findDuplicateHint } from "./utils/duplicateHints";
import { invoiceExtractor } from "./services/invoiceExtractor";
import { encryptFields, decryptFields } from "./lib/tokenCrypto";
import { revokeGoogleToken } from "./lib/oauthRevoke";
import { looksLikeBill } from "./lib/billingEmail";
import { ObjectStorageService } from "./objectStorage";

/**
 * Token columns encrypted at rest. Every read and write of these tables goes
 * through this file, which is why the wrapping lives here: the eleven other
 * modules that handle tokens keep seeing plaintext and needed no changes.
 */
const ACCOUNT_TOKEN_FIELDS = ["accessToken", "refreshToken"] as const;
const USER_TOKEN_FIELDS = ["gmailAccessToken", "gmailRefreshToken"] as const;


export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createUserWithPassword(userData: { email: string; firstName: string | null; lastName: string | null; passwordHash: string | null; profileImageUrl?: string | null }): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<UpdateUser>): Promise<User | undefined>;
  createVerificationCode(userId: string, code: string, expiresAt: Date): Promise<void>;
  getVerificationCode(userId: string, code: string): Promise<{ id: string; expiresAt: Date; used: boolean } | undefined>;
  markVerificationCodeUsed(id: string): Promise<void>;
  setEmailVerified(userId: string): Promise<void>;
  
  // Subscription methods
  getSubscriptions(userId: string): Promise<Subscription[]>;
  getSubscription(id: string): Promise<Subscription | undefined>;
  createSubscription(subscription: InsertSubscription): Promise<Subscription>;
  updateSubscription(id: string, updates: Partial<Subscription>): Promise<Subscription | undefined>;
  deleteSubscription(id: string): Promise<boolean>;
  
  // Email methods
  getEmails(userId: string, limit?: number): Promise<Email[]>;
  getEmail(id: string): Promise<Email | undefined>;
  getEmailsByIds(ids: string[]): Promise<Email[]>;
  getEmailByGmailId(gmailId: string): Promise<Email | undefined>;
  getSyncedGmailIds(userId: string): Promise<Set<string>>;
  startSyncJob(userId: string, triggerSource: string): Promise<{ outcome: 'claimed'; job: SyncJob } | { outcome: 'conflict' } | { outcome: 'unavailable' }>;
  finishSyncJob(jobId: string, status: 'succeeded' | 'failed', details?: { error?: string | null; emailsProcessed?: number; suggestionsGenerated?: number }): Promise<void>;
  sweepStuckSyncJobs(): Promise<number>;
  getScreenedMessageIds(userId: string, provider?: string): Promise<Set<string>>;
  recordScreenedMessages(userId: string, messageIds: string[], provider?: string): Promise<number>;
  clearScreenedMessages(userId: string): Promise<{ cleared: number }>;
  createEmail(email: InsertEmail): Promise<Email>;
  updateEmail(id: string, updates: Partial<Email>): Promise<Email | undefined>;
  deleteEmail(id: string): Promise<boolean>;
  getUnprocessedEmails(userId: string): Promise<Email[]>;
  
  // Suggestion methods
  getSuggestions(userId: string, options?: { page?: number; pageSize?: number; minConfidence?: string }): Promise<{ suggestions: SubscriptionSuggestion[]; total: number }>;
  createSuggestion(suggestion: InsertSubscriptionSuggestion): Promise<SubscriptionSuggestion>;
  createSuggestionsBulk(suggestions: InsertSubscriptionSuggestion[]): Promise<SubscriptionSuggestion[]>;
  approveSuggestions(suggestionIds: string[], userId: string): Promise<{ subscriptions: Subscription[]; approved: number }>;
  rejectSuggestions(suggestionIds: string[], userId: string): Promise<{ rejected: number }>;
  clearSuggestions(userId: string): Promise<{ cleared: number }>;
  
  // Email methods with pagination
  getEmailsPaginated(userId: string, options?: { page?: number; pageSize?: number }): Promise<{ emails: Email[]; total: number }>;
  
  // Analytics methods
  getSubscriptionStats(userId: string, preferredCurrency?: string): Promise<{
    totalMonthly: number;
    activeCount: number;
    emailsAnalyzed: number;
    avgPerService: number;
    newThisMonth: number;
    changePercent: number;
  }>;
  
  // Invoice methods
  getInvoices(subscriptionId: string): Promise<Invoice[]>;
  getInvoice(id: string): Promise<Invoice | undefined>;
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  deleteInvoice(id: string): Promise<boolean>;
  
  // Gmail Account methods
  getGmailAccounts(userId: string): Promise<GmailAccount[]>;
  getGmailAccount(id: string): Promise<GmailAccount | undefined>;
  getGmailAccountByEmail(userId: string, gmailEmail: string): Promise<GmailAccount | undefined>;
  createGmailAccount(account: InsertGmailAccount): Promise<GmailAccount>;
  updateGmailAccount(id: string, updates: UpdateGmailAccount): Promise<GmailAccount | undefined>;
  deleteGmailAccount(id: string): Promise<boolean>;
  
  // Outlook Account methods
  getOutlookAccounts(userId: string): Promise<OutlookAccount[]>;
  getOutlookAccount(id: string): Promise<OutlookAccount | undefined>;
  getOutlookAccountByEmail(userId: string, outlookEmail: string): Promise<OutlookAccount | undefined>;
  createOutlookAccount(account: InsertOutlookAccount): Promise<OutlookAccount>;
  updateOutlookAccount(id: string, updates: UpdateOutlookAccount): Promise<OutlookAccount | undefined>;
  deleteOutlookAccount(id: string): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  private db: any;

  constructor() {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    const sql = neon(process.env.DATABASE_URL);
    this.db = drizzle(sql);
  }

  // User methods
  async getUser(id: string): Promise<User | undefined> {
    try {
      const result = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
      return result[0] ? decryptFields(result[0], USER_TOKEN_FIELDS) : undefined;
    } catch (error) {
      console.error('Error getting user:', error);
      throw error;
    }
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    try {
      const result = await this.db.select().from(users).where(eq(users.email, username)).limit(1);
      return result[0] ? decryptFields(result[0], USER_TOKEN_FIELDS) : undefined;
    } catch (error) {
      console.error('Error getting user by username:', error);
      throw error;
    }
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    try {
      const result = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
      return result[0] ? decryptFields(result[0], USER_TOKEN_FIELDS) : undefined;
    } catch (error) {
      console.error('Error getting user by email:', error);
      throw error;
    }
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    try {
      const userData = {
        email: insertUser.email || null,
        firstName: insertUser.firstName || null,
        lastName: insertUser.lastName || null,
        profileImageUrl: insertUser.profileImageUrl || null,
      };
      
      const result = await this.db.insert(users).values(userData).returning();
      return result[0];
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  async createUserWithPassword(userData: { 
    email: string; 
    firstName: string | null; 
    lastName: string | null; 
    passwordHash: string | null; // Allow null for OAuth users
    profileImageUrl?: string | null;
  }): Promise<User> {
    try {
      // Hardcode safe defaults server-side - never accept from client
      // OAuth users (no password) have verified emails automatically
      const isOAuthUser = !userData.passwordHash;
      const newUserData = {
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        passwordHash: userData.passwordHash || null,
        profileImageUrl: userData.profileImageUrl || null,
        onboardingStatus: 'pending', // Always start as pending, never accept from client
        privacyConsentGiven: false, // Always start false, user must consent during onboarding
        emailVerified: isOAuthUser, // OAuth users have verified emails from provider
      };
      
      const result = await this.db.insert(users).values(newUserData).returning();
      return result[0];
    } catch (error) {
      console.error('Error creating user with password:', error);
      throw error;
    }
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    try {
      if (!userData.id) {
        throw new Error("User ID is required for upsert operation");
      }

      // Check if user exists
      const existingUser = await this.getUser(userData.id);
      
      if (existingUser) {
        // Update existing user
        const updateData = {
          email: userData.email || null,
          firstName: userData.firstName || null,
          lastName: userData.lastName || null,
          profileImageUrl: userData.profileImageUrl || null,
          updatedAt: new Date()
        };
        
        const result = await this.db
          .update(users)
          .set(updateData)
          .where(eq(users.id, userData.id))
          .returning();

        // This branch returns an existing row, so its token columns may hold
        // ciphertext even though this method never writes them.
        return decryptFields(result[0], USER_TOKEN_FIELDS);
      } else {
        // Create new user with specified ID
        const insertData = {
          id: userData.id,
          email: userData.email || null,
          firstName: userData.firstName || null,
          lastName: userData.lastName || null,
          profileImageUrl: userData.profileImageUrl || null,
        };
        
        const result = await this.db.insert(users).values(insertData).returning();
        return result[0];
      }
    } catch (error) {
      console.error('Error upserting user:', error);
      throw error;
    }
  }

  async updateUser(id: string, updates: Partial<UpdateUser>): Promise<User | undefined> {
    try {
      const result = await this.db
        .update(users)
        .set({ ...encryptFields(updates, USER_TOKEN_FIELDS), updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();

      return result[0] ? decryptFields(result[0], USER_TOKEN_FIELDS) : undefined;
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }

  async createVerificationCode(userId: string, code: string, expiresAt: Date): Promise<void> {
    try {
      const { verificationCodes } = await import("@shared/schema");
      await this.db.insert(verificationCodes).values({
        userId,
        code,
        expiresAt,
        used: false,
      });
    } catch (error) {
      console.error('Error creating verification code:', error);
      throw error;
    }
  }

  async getVerificationCode(userId: string, code: string): Promise<{ id: string; expiresAt: Date; used: boolean } | undefined> {
    try {
      const { verificationCodes } = await import("@shared/schema");
      const result = await this.db
        .select()
        .from(verificationCodes)
        .where(and(
          eq(verificationCodes.userId, userId),
          eq(verificationCodes.code, code)
        ))
        .orderBy(desc(verificationCodes.createdAt))
        .limit(1);
      
      return result[0] || undefined;
    } catch (error) {
      console.error('Error getting verification code:', error);
      throw error;
    }
  }

  async markVerificationCodeUsed(id: string): Promise<void> {
    try {
      const { verificationCodes } = await import("@shared/schema");
      await this.db
        .update(verificationCodes)
        .set({ used: true })
        .where(eq(verificationCodes.id, id));
    } catch (error) {
      console.error('Error marking verification code as used:', error);
      throw error;
    }
  }

  async setEmailVerified(userId: string): Promise<void> {
    try {
      await this.db
        .update(users)
        .set({
          emailVerified: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    } catch (error) {
      console.error('Error setting email verified:', error);
      throw error;
    }
  }


  // Subscription methods
  async getSubscriptions(userId: string): Promise<Subscription[]> {
    try {
      return await this.db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .orderBy(desc(subscriptions.detectedAt));
    } catch (error) {
      console.error('Error getting subscriptions:', error);
      throw error;
    }
  }

  /**
   * The address each subscription's receipts arrive from, keyed by id.
   *
   * `subscriptions.merchantEmail` is written as null by the detection
   * pipeline, so it is never a usable answer. The sender of the receipt is,
   * and it is on the emails themselves.
   *
   * Two passes, because one is not enough:
   *
   * 1. `emails.subscriptionId`, which is authoritative. It is also written in
   *    exactly one place -- approving a suggestion that matched evidence --
   *    and that column holds one id, so two subscriptions from the same
   *    vendor fight over the same receipts and the later approval wins. That
   *    is why iCloud+ showed Apple's logo while Apple One Family showed a
   *    letter.
   *
   * 2. The brand's name against the sending domains on the account. A
   *    subscription called "Google One (100 GB)" never matched its evidence
   *    because the matcher looks for the whole service name inside the email
   *    text; "google" against `payments-noreply@google.com` does.
   *
   * The second pass only matches inside the domain, never the subject, and
   * only on a token of four characters or more that is not a generic word.
   * A wrong logo is worse than no logo, so it would rather find nothing.
   */
  /** The address the evidence for a suggestion arrived from, newest first. */
  private async senderOfEvidence(
    userId: string,
    evidenceEmailIds: string[] | null | undefined,
  ): Promise<string | null> {
    if (!evidenceEmailIds || evidenceEmailIds.length === 0) return null;
    try {
      const rows = await this.db
        .select({ fromEmail: emails.fromEmail })
        .from(emails)
        .where(and(eq(emails.userId, userId), inArray(emails.gmailId, evidenceEmailIds)))
        .orderBy(desc(emails.receivedAt))
        .limit(1);
      return rows[0]?.fromEmail ?? null;
    } catch (error) {
      console.error('Error resolving sender of evidence:', error);
      return null;
    }
  }

  /**
   * Fill in `merchantEmail` for subscriptions created before it was written
   * at creation time.
   *
   * Runs the expensive resolution once and persists the answer, so the work
   * happens on one page load rather than every one. Rows it cannot resolve
   * stay null -- see the caller for why that does not become a loop.
   */
  async backfillMerchantEmails(userId: string): Promise<number> {
    try {
      const senders = await this.getSubscriptionSenders(userId);
      if (senders.size === 0) return 0;

      const rows = await this.db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(and(eq(subscriptions.userId, userId), isNull(subscriptions.merchantEmail)));

      let written = 0;
      for (const row of rows) {
        const sender = senders.get(row.id);
        if (!sender) continue;
        await this.db
          .update(subscriptions)
          .set({ merchantEmail: sender })
          .where(and(eq(subscriptions.id, row.id), eq(subscriptions.userId, userId)));
        written += 1;
      }
      if (written > 0) console.log(`🏷️  Filled merchantEmail on ${written} subscriptions for ${userId}`);
      return written;
    } catch (error) {
      // A missing logo is not worth failing a page load over.
      console.error('Error backfilling merchant emails:', error);
      return 0;
    }
  }

  /**
   * File the invoices a subscription actually has, and nothing else.
   *
   * An invoice is a document the merchant issued. If there is no document
   * there is no invoice -- not a row standing in for one, not a rendering of
   * the email body, not a reminder. An archive that lists things it cannot
   * produce is worse than an empty one, because it looks full.
   *
   * Two things were losing real files before this.
   *
   * The search was limited to a suggestion's evidence emails, of which there
   * are at most five, chosen by whether the subject or sender contains the
   * whole service name. "Auto Secure Private Car Package Policy" appears in
   * no subject line, so that subscription matched nothing and its policy
   * documents -- uploaded during the sync, sitting in object storage -- were
   * never reachable. The search now starts from the emails that carry a
   * stored file, which is a far smaller set, and asks which subscription each
   * belongs to.
   *
   * And every evidence email without a file used to produce a row anyway.
   * Those rows are gone.
   */
  private async createInvoicesFromAttachments(
    userId: string,
    subscription: { id: string; serviceName: string; amount: string; merchantName?: string | null },
    evidenceEmailIds?: string[] | null,
  ): Promise<{ created: number; skipped: number; emailsWithFiles: number }> {
    const evidence = new Set(evidenceEmailIds ?? []);

    // Only emails that actually carry something. Across a 30-day sync this is
    // a handful of rows out of thousands, so the whole set is cheap to read.
    const withFiles = await this.db
      .select({
        id: emails.id,
        gmailId: emails.gmailId,
        subject: emails.subject,
        fromEmail: emails.fromEmail,
        fromName: emails.fromName,
        receivedAt: emails.receivedAt,
        subscriptionId: emails.subscriptionId,
        attachmentData: emails.attachmentData,
        extractedAmount: emails.extractedAmount,
      })
      .from(emails)
      .where(and(eq(emails.userId, userId), isNotNull(emails.attachmentData)))
      .orderBy(desc(emails.receivedAt))
      .limit(500);

    const tokens = brandTokens(subscription.merchantName ?? null, subscription.serviceName);

    /** Does this email belong to this subscription? */
    const belongs = (email: typeof withFiles[number]): boolean => {
      if (email.subscriptionId === subscription.id) return true;
      if (email.gmailId && evidence.has(email.gmailId)) return true;
      if (tokens.length === 0) return false;

      // The sender's domain is the brand for a billing email, which is what
      // reaches a merchant whose name never appears in a subject line.
      const address = (email.fromEmail ?? '').toLowerCase();
      const domain = address.slice(address.lastIndexOf('@') + 1).replace(/[^a-z0-9]/g, '');
      if (domain && tokens.some((token) => domain.includes(token))) return true;

      const sender = (email.fromName ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return Boolean(sender) && tokens.some((token) => sender.includes(token));
    };

    let created = 0;
    let skipped = 0;
    let emailsWithFiles = 0;

    for (const email of withFiles) {
      if (!belongs(email)) continue;

      let attachments: any[] = [];
      try {
        attachments = JSON.parse(email.attachmentData || '{}').attachments || [];
      } catch {
        console.error(`Could not read the attachment list on email ${email.id}`);
        continue;
      }

      const stored = attachments.filter((a) => a?.objectStoragePath);
      if (stored.length === 0) continue;
      emailsWithFiles++;

      /*
       * Still checked, for the same reason it was written: a merchant that
       * also sells one-off things attaches an invoice to every order, and a
       * receipt for last Tuesday's takeaway filed under a membership makes
       * the whole archive untrustworthy.
       *
       * Judged knowing a document is attached, which is enough on its own for
       * a subject that reads as neither a bill nor a one-off.
       */
      const verdict = looksLikeBill(email, {
        serviceName: subscription.serviceName,
        amount: subscription.amount,
        hasStoredDocument: true,
      });
      if (!verdict.isBill) {
        console.log(`🚫 Has a file but is not a bill (${verdict.reason}): "${email.subject}"`);
        continue;
      }

      for (const attachment of stored) {
        const existing = await this.db
          .select({ id: invoices.id })
          .from(invoices)
          .where(
            and(
              eq(invoices.subscriptionId, subscription.id),
              eq(invoices.fileUrl, attachment.objectStoragePath),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          skipped++;
          continue;
        }

        // Inserted directly rather than through createInvoice, which has no
        // uploadedAt: the archive is read by the date on the receipt, not the
        // moment the sync happened to run.
        await this.db.insert(invoices).values({
          subscriptionId: subscription.id,
          userId,
          fileName: attachment.filename,
          fileType: attachment.mimeType,
          fileSize: attachment.size,
          fileUrl: attachment.objectStoragePath,
          source: 'gmail',
          uploadedAt: email.receivedAt ? new Date(email.receivedAt) : new Date(),
        });
        created++;
      }
    }

    return { created, skipped, emailsWithFiles };
  }

  async getSubscriptionSenders(userId: string): Promise<Map<string, string>> {
    try {
      type BrandRow = { id: string; serviceName: string; merchantName: string | null };
      const [linked, allSenders, subs] = await Promise.all([
        this.db
          .select({ subscriptionId: emails.subscriptionId, fromEmail: emails.fromEmail })
          .from(emails)
          .where(and(eq(emails.userId, userId), isNotNull(emails.subscriptionId)))
          .orderBy(desc(emails.receivedAt)),
        this.db
          .select({ fromEmail: emails.fromEmail })
          .from(emails)
          .where(eq(emails.userId, userId))
          .orderBy(desc(emails.receivedAt))
          .limit(2000),
        this.db
          .select({
            id: subscriptions.id,
            serviceName: subscriptions.serviceName,
            merchantName: subscriptions.merchantName,
          })
          .from(subscriptions)
          .where(eq(subscriptions.userId, userId)),
      ]);

      const byId = new Map<string, string>();
      for (const row of linked) {
        // Newest first, so the first one seen wins.
        if (row.subscriptionId && row.fromEmail && !byId.has(row.subscriptionId)) {
          byId.set(row.subscriptionId, row.fromEmail);
        }
      }

      const unresolved = (subs as BrandRow[]).filter((row) => !byId.has(row.id));
      if (unresolved.length === 0) return byId;

      // Newest first, so a brand that changed sender resolves to its latest.
      const senders: string[] = [];
      const seen = new Set<string>();
      for (const row of allSenders) {
        const address = row.fromEmail?.toLowerCase();
        if (address && !seen.has(address)) {
          seen.add(address);
          senders.push(address);
        }
      }

      for (const sub of unresolved) {
        const match = senders.find((address) => {
          const domain = address.slice(address.lastIndexOf('@') + 1);
          return brandTokens(sub.merchantName, sub.serviceName)
            .some((token) => domain.replace(/[^a-z0-9]/g, '').includes(token));
        });
        if (match) byId.set(sub.id, match);
      }

      return byId;
    } catch (error) {
      // A missing logo is not worth failing a page load over.
      console.error('Error getting subscription senders:', error);
      return new Map();
    }
  }

  async getSubscription(id: string): Promise<Subscription | undefined> {
    try {
      const result = await this.db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
      return result[0] || undefined;
    } catch (error) {
      console.error('Error getting subscription:', error);
      throw error;
    }
  }

  // Deduplication helper functions
  private normalizeServiceName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove special characters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  private calculateSimilarity(str1: string, str2: string): number {
    const normalize = (s: string) => s.toLowerCase().replace(/[^\w]/g, '');
    const s1 = normalize(str1);
    const s2 = normalize(str2);
    
    if (s1 === s2) return 1;
    
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    
    if (longer.length === 0) return 1;
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + indicator // substitution
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  async findDuplicateSubscription(
    userId: string, 
    serviceName: string, 
    amount: string, 
    currency: string, 
    frequency: string
  ): Promise<Subscription | null> {
    try {
      const userSubscriptions = await this.getSubscriptions(userId);
      const amountNum = Number(amount);
      
      for (const existing of userSubscriptions) {
        const existingAmount = Number(existing.amount);
        
        // Check for exact duplicates first
        const nameMatch = this.calculateSimilarity(serviceName, existing.serviceName) > 0.85;
        const amountMatch = Math.abs(amountNum - existingAmount) < Math.max(0.01, existingAmount * 0.05); // Within 5% or 1 cent
        const currencyMatch = (currency || 'INR').toUpperCase() === (existing.currency || 'INR').toUpperCase();
        const frequencyMatch = frequency === existing.frequency;
        
        if (nameMatch && amountMatch && currencyMatch && frequencyMatch) {
          return existing;
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error finding duplicate subscription:', error);
      return null;
    }
  }

  async createSubscription(insertSubscription: InsertSubscription): Promise<Subscription> {
    try {
      // Check for duplicates before creating
      const existingDuplicate = await this.findDuplicateSubscription(
        insertSubscription.userId,
        insertSubscription.serviceName,
        insertSubscription.amount,
        insertSubscription.currency || 'INR',
        insertSubscription.frequency
      );

      if (existingDuplicate) {
        console.log(`Duplicate subscription detected for ${insertSubscription.serviceName}, updating existing instead`);
        // Update the existing subscription's occurrence count and last seen date
        const updatedSubscription = await this.updateSubscription(existingDuplicate.id, {
          occurrences: (existingDuplicate.occurrences || 1) + 1,
          lastEmailDate: insertSubscription.lastEmailDate || new Date(),
          merchantEmail: insertSubscription.merchantEmail || existingDuplicate.merchantEmail,
          merchantName: insertSubscription.merchantName || existingDuplicate.merchantName,
        });
        return updatedSubscription!;
      }

      const subscriptionData = {
        ...insertSubscription,
        category: insertSubscription.category || null,
        merchantName: insertSubscription.merchantName || null,
        merchantEmail: insertSubscription.merchantEmail || null,
        occurrences: insertSubscription.occurrences || 1,
        nextBillingDate: insertSubscription.nextBillingDate || null,
        lastEmailDate: insertSubscription.lastEmailDate || null,
        status: insertSubscription.status || 'active',
        currency: insertSubscription.currency || 'INR',
      };
      
      const result = await this.db.insert(subscriptions).values(subscriptionData).returning();
      return result[0];
    } catch (error) {
      console.error('Error creating subscription:', error);
      throw error;
    }
  }

  async updateSubscription(id: string, updates: Partial<Subscription>): Promise<Subscription | undefined> {
    try {
      const result = await this.db
        .update(subscriptions)
        .set(updates)
        .where(eq(subscriptions.id, id))
        .returning();
      
      return result[0] || undefined;
    } catch (error) {
      console.error('Error updating subscription:', error);
      throw error;
    }
  }

  async deleteSubscription(id: string): Promise<boolean> {
    try {
      // First, get all invoices for this subscription
      const subscriptionInvoices = await this.getInvoices(id);
      
      // Delete invoice files from object storage
      if (subscriptionInvoices.length > 0) {
        const { ObjectStorageService } = await import('./objectStorage');
        const objectStorage = new ObjectStorageService();
        
        for (const invoice of subscriptionInvoices) {
          try {
            // A receipt that lived in the email body has no file to remove, and
            // the fallback branch below would otherwise build a path out of an
            // empty string and try to delete it.
            if (!invoice.fileUrl) continue;

            let objectPath: string;
            
            // Handle normalized /objects/... URLs
            if (invoice.fileUrl.startsWith('/objects/')) {
              // Get the file from normalized path to extract bucket/object names
              const file = await objectStorage.getObjectEntityFile(invoice.fileUrl);
              const bucketName = file.bucket.name;
              const objectName = file.name;
              
              // Construct the full path for deletion
              objectPath = `${bucketName}/${objectName}`;
            } 
            // Handle direct GCS URLs (https://storage.googleapis.com/bucket/object)
            else if (invoice.fileUrl.startsWith('https://storage.googleapis.com/')) {
              const url = new URL(invoice.fileUrl);
              const pathParts = url.pathname.slice(1).split('/');
              objectPath = pathParts.join('/');
            }
            // Handle any other format - extract the filename and use PRIVATE_OBJECT_DIR
            else {
              const urlParts = invoice.fileUrl.split('/');
              const fileName = urlParts[urlParts.length - 1];
              objectPath = `${process.env.PRIVATE_OBJECT_DIR}/${fileName}`;
            }
            
            // Delete the file from object storage
            await objectStorage.deleteObject(objectPath);
            console.log(`Deleted invoice file: ${objectPath}`);
          } catch (error) {
            console.error(`Failed to delete invoice file ${invoice.fileUrl}:`, error);
            // Continue with deletion even if file deletion fails (file may not exist)
          }
        }
        
        // Delete invoice records from database (even if some files failed to delete)
        await this.db.delete(invoices).where(eq(invoices.subscriptionId, id));
        console.log(`Deleted ${subscriptionInvoices.length} invoice records from database`);
      }
      
      // Finally, delete the subscription
      const result = await this.db.delete(subscriptions).where(eq(subscriptions.id, id));
      return result.rowCount > 0;
    } catch (error) {
      console.error('Error deleting subscription:', error);
      throw error;
    }
  }

  // Email methods
  async getEmails(userId: string, limit: number = 50): Promise<Email[]> {
    try {
      return await this.db
        .select()
        .from(emails)
        .where(eq(emails.userId, userId))
        .orderBy(desc(emails.receivedAt))
        .limit(limit);
    } catch (error) {
      console.error('Error getting emails:', error);
      throw error;
    }
  }

  async getEmail(id: string): Promise<Email | undefined> {
    try {
      const result = await this.db.select().from(emails).where(eq(emails.id, id)).limit(1);
      return result[0] || undefined;
    } catch (error) {
      console.error('Error getting email:', error);
      throw error;
    }
  }

  async getEmailsByIds(ids: string[]): Promise<Email[]> {
    try {
      if (!ids || ids.length === 0) return [];
      // evidenceEmailIds stores gmailId values, not internal database IDs
      const result = await this.db.select().from(emails).where(inArray(emails.gmailId, ids));
      return result;
    } catch (error) {
      console.error('Error getting emails by IDs:', error);
      throw error;
    }
  }

  async getEmailByGmailId(gmailId: string): Promise<Email | undefined> {
    try {
      const result = await this.db.select().from(emails).where(eq(emails.gmailId, gmailId)).limit(1);
      return result[0] || undefined;
    } catch (error) {
      console.error('Error getting email by Gmail ID:', error);
      throw error;
    }
  }

  /**
   * Provider message IDs already stored for this user.
   *
   * Used to skip re-fetching mail the sync has already seen. Selects only the
   * id column -- the full rows would be tens of MB on a large mailbox, and
   * nothing here needs their contents.
   */
  async getSyncedGmailIds(userId: string): Promise<Set<string>> {
    try {
      const rows = await this.db
        .select({ gmailId: emails.gmailId })
        .from(emails)
        .where(eq(emails.userId, userId));

      return new Set(rows.map((row: { gmailId: string }) => row.gmailId));
    } catch (error) {
      console.error('Error getting synced Gmail IDs:', error);
      // An empty set means "skip nothing", so a failure here costs a slow sync
      // rather than silently dropping mail from the run.
      return new Set();
    }
  }

  /**
   * Claim the right to run a sync for this user.
   *
   * The exclusion is enforced by a partial unique index rather than a preceding
   * SELECT, so two requests arriving together cannot both win it.
   *
   * The three outcomes are deliberately distinct. `conflict` means a sync is
   * genuinely in flight and the caller should refuse. `unavailable` means the
   * bookkeeping failed -- a missing table, a database blip -- and the caller
   * should run anyway: losing the audit row is a far smaller harm than refusing
   * every sync because one table is absent.
   */
  async startSyncJob(
    userId: string,
    triggerSource: string
  ): Promise<{ outcome: 'claimed'; job: SyncJob } | { outcome: 'conflict' } | { outcome: 'unavailable' }> {
    try {
      const result = await this.db
        .insert(syncJobs)
        .values({ userId, triggerSource, status: 'running' })
        .onConflictDoNothing()
        .returning();

      // onConflictDoNothing returns nothing when the partial unique index
      // rejected the row, which can only mean a run is already in flight.
      return result[0] ? { outcome: 'claimed', job: result[0] } : { outcome: 'conflict' };
    } catch (error) {
      console.error('Error starting sync job, proceeding without one:', error);
      return { outcome: 'unavailable' };
    }
  }

  async finishSyncJob(
    jobId: string,
    status: 'succeeded' | 'failed',
    details?: { error?: string | null; emailsProcessed?: number; suggestionsGenerated?: number }
  ): Promise<void> {
    try {
      await this.db
        .update(syncJobs)
        .set({
          status,
          finishedAt: new Date(),
          error: details?.error ?? null,
          emailsProcessed: details?.emailsProcessed ?? 0,
          suggestionsGenerated: details?.suggestionsGenerated ?? 0,
        })
        .where(eq(syncJobs.id, jobId));
    } catch (error) {
      // A job left `running` blocks the next sync until the boot sweep clears
      // it, so this is worth shouting about even though it cannot be retried
      // here.
      console.error(`Error finishing sync job ${jobId} -- it may block the next sync:`, error);
    }
  }

  /**
   * Mark every still-running job as failed.
   *
   * Called once at boot. A process that restarts mid-sync leaves its job
   * `running` forever, which the unique index would then read as "a sync is
   * already in progress" and refuse every future trigger.
   *
   * This assumes a single instance: with several replicas serving one database
   * it would kill jobs that are legitimately running elsewhere.
   */
  async sweepStuckSyncJobs(): Promise<number> {
    try {
      const swept = await this.db
        .update(syncJobs)
        .set({
          status: 'failed',
          finishedAt: new Date(),
          error: 'Interrupted by a service restart',
        })
        .where(eq(syncJobs.status, 'running'))
        .returning({ id: syncJobs.id });

      return swept.length;
    } catch (error) {
      console.error('Error sweeping stuck sync jobs:', error);
      return 0;
    }
  }

  /**
   * Message IDs this user's sync has already screened.
   *
   * The union of this and getSyncedGmailIds is what a repeat sync can skip.
   * `emails` alone is not enough: it holds only the pre-filter survivors, about
   * 120 rows against a 2,500 message window, so skipping on it skips nothing.
   */
  async getScreenedMessageIds(userId: string, provider: string = 'gmail'): Promise<Set<string>> {
    try {
      const rows = await this.db
        .select({ messageId: screenedMessages.messageId })
        .from(screenedMessages)
        .where(
          and(
            eq(screenedMessages.userId, userId),
            eq(screenedMessages.provider, provider)
          )
        );

      return new Set(rows.map((row: { messageId: string }) => row.messageId));
    } catch (error) {
      // Degrades to a full sync rather than dropping mail. Also covers the gap
      // between this code deploying and the table existing.
      console.error('Error getting screened message IDs:', error);
      return new Set();
    }
  }

  /**
   * Mark message IDs as screened. Idempotent -- re-screening an id is a no-op.
   *
   * Chunked: a full window is thousands of rows and the HTTP driver caps
   * request size.
   */
  async recordScreenedMessages(userId: string, messageIds: string[], provider: string = 'gmail'): Promise<number> {
    if (!messageIds.length) return 0;

    const CHUNK = 500;
    let recorded = 0;

    try {
      for (let i = 0; i < messageIds.length; i += CHUNK) {
        const rows = messageIds.slice(i, i + CHUNK).map(messageId => ({
          userId,
          provider,
          messageId,
        }));

        await this.db.insert(screenedMessages).values(rows).onConflictDoNothing();
        recorded += rows.length;
      }

      return recorded;
    } catch (error) {
      // Never fail a sync over bookkeeping. Losing this costs a re-screen next
      // run; it cannot make the current run wrong.
      console.error('Error recording screened messages:', error);
      return recorded;
    }
  }

  /**
   * Forget every message this user's sync has screened.
   *
   * Only for "clear all data". Without it a clear leaves the screened-id table
   * intact, so the next sync skips the entire window and the fresh start is not
   * fresh -- it produces zero suggestions against a mailbox that has not
   * changed. Bookkeeping has to be cleared with the data it describes.
   */
  async clearScreenedMessages(userId: string): Promise<{ cleared: number }> {
    try {
      const result = await this.db
        .delete(screenedMessages)
        .where(eq(screenedMessages.userId, userId));

      return { cleared: result.rowCount || 0 };
    } catch (error) {
      // A clear that half-works is worse than one that reports failure, but the
      // table may not exist yet on an older database -- so log and carry on.
      console.error('Error clearing screened messages:', error);
      return { cleared: 0 };
    }
  }

  async createEmail(insertEmail: InsertEmail): Promise<Email> {
    try {
      const emailData = {
        ...insertEmail,
        content: insertEmail.content || null,
        fromName: insertEmail.fromName || null,
        merchantName: insertEmail.merchantName || null,
        attachmentData: insertEmail.attachmentData || null,
        isTransaction: insertEmail.isTransaction || false,
        extractedAmount: insertEmail.extractedAmount || null,
        extractedCurrency: insertEmail.extractedCurrency || null,
        subscriptionId: insertEmail.subscriptionId || null,
        processed: insertEmail.processed || false,
      };
      
      const result = await this.db.insert(emails).values(emailData).returning();
      return result[0];
    } catch (error) {
      console.error('Error creating email:', error);
      throw error;
    }
  }

  async updateEmail(id: string, updates: Partial<Email>): Promise<Email | undefined> {
    try {
      const result = await this.db
        .update(emails)
        .set(updates)
        .where(eq(emails.id, id))
        .returning();
      
      return result[0] || undefined;
    } catch (error) {
      console.error('Error updating email:', error);
      throw error;
    }
  }

  async deleteEmail(id: string): Promise<boolean> {
    try {
      const result = await this.db.delete(emails).where(eq(emails.id, id));
      return result.rowCount > 0;
    } catch (error) {
      console.error('Error deleting email:', error);
      throw error;
    }
  }

  async getUnprocessedEmails(userId: string): Promise<Email[]> {
    try {
      return await this.db
        .select()
        .from(emails)
        .where(and(eq(emails.userId, userId), eq(emails.processed, false)))
        .orderBy(desc(emails.receivedAt));
    } catch (error) {
      console.error('Error getting unprocessed emails:', error);
      throw error;
    }
  }

  // Email pagination methods
  async getEmailsPaginated(userId: string, options?: { page?: number; pageSize?: number }): Promise<{ emails: Email[]; total: number }> {
    try {
      const page = options?.page || 1;
      const pageSize = options?.pageSize || 50;
      const offset = (page - 1) * pageSize;
      
      const [emailsResult, countResult] = await Promise.all([
        this.db
          .select()
          .from(emails)
          .where(eq(emails.userId, userId))
          .orderBy(desc(emails.receivedAt))
          .limit(pageSize)
          .offset(offset),
        this.db
          .select({ count: count() })
          .from(emails)
          .where(eq(emails.userId, userId))
      ]);
      
      return {
        emails: emailsResult,
        total: countResult[0].count
      };
    } catch (error) {
      console.error('Error getting paginated emails:', error);
      throw error;
    }
  }

  // Suggestion methods
  async getSuggestions(userId: string, options?: { page?: number; pageSize?: number; minConfidence?: string }): Promise<{ suggestions: SubscriptionSuggestion[]; total: number }> {
    try {
      const page = options?.page || 1;
      const pageSize = options?.pageSize || 50;
      const offset = (page - 1) * pageSize;
      
      let whereCondition = and(
        eq(subscriptionSuggestions.userId, userId),
        eq(subscriptionSuggestions.status, 'pending')
      );
      
      // Filter by confidence if specified
      if (options?.minConfidence) {
        whereCondition = and(
          whereCondition,
          eq(subscriptionSuggestions.confidence, options.minConfidence)
        );
      }
      
      const [suggestionsResult, countResult] = await Promise.all([
        this.db
          .select()
          .from(subscriptionSuggestions)
          .where(whereCondition)
          .orderBy(
            desc(
              sql`CASE WHEN ${subscriptionSuggestions.confidence} = 'high' THEN 3 WHEN ${subscriptionSuggestions.confidence} = 'medium' THEN 2 WHEN ${subscriptionSuggestions.confidence} = 'low' THEN 1 ELSE 0 END`
            ),
            desc(subscriptionSuggestions.detectedAt)
          )
          .limit(pageSize)
          .offset(offset),
        this.db
          .select({ count: count() })
          .from(subscriptionSuggestions)
          .where(whereCondition)
      ]);
      
      // Annotate anything that looks like a subscription the user already has
      // (#20). Advisory only -- nothing is merged or hidden, because merging two
      // genuinely distinct subscriptions is worse than showing both.
      const existing = await this.db
        .select({
          id: subscriptions.id,
          serviceName: subscriptions.serviceName,
          serviceKey: subscriptions.serviceKey,
          merchantName: subscriptions.merchantName,
          amount: subscriptions.amount,
          currency: subscriptions.currency,
          frequency: subscriptions.frequency,
        })
        .from(subscriptions)
        .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, 'active')));

      // A duplicate pair can also arrive as two suggestions in the same
      // batch -- neither is an existing subscription yet, so the check above
      // is blind to it. That was live in production: a 2026-09-09 cold sync
      // raised both "Airtel Black" and "Airtel Black Plan" at an identical
      // ₹1,885.64/month, and only the check above ran.
      //
      // Ordered by detectedAt then id so the same suggestion is always the
      // one flagged, regardless of what order the DB happens to return rows
      // in. Only compares within this page -- a duplicate pair split across
      // pages is missed, same limitation the existing-subscription check
      // doesn't have.
      const byDetectedAt = [...suggestionsResult].sort((a, b) => {
        const aTime = a.detectedAt ? new Date(a.detectedAt).getTime() : 0;
        const bTime = b.detectedAt ? new Date(b.detectedAt).getTime() : 0;
        if (aTime !== bTime) return aTime - bTime;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });

      const batchHints = new Map<string, ReturnType<typeof findDuplicateHint>>();
      const seen: SubscriptionSuggestion[] = [];
      for (const suggestion of byDetectedAt) {
        batchHints.set(suggestion.id, findDuplicateHint(suggestion, seen, 'suggestion'));
        seen.push(suggestion);
      }

      const annotated = suggestionsResult.map((suggestion: SubscriptionSuggestion) => ({
        ...suggestion,
        possibleDuplicateOf: findDuplicateHint(suggestion, existing) ?? batchHints.get(suggestion.id) ?? null,
      }));

      return {
        suggestions: annotated,
        total: countResult[0].count
      };
    } catch (error) {
      console.error('Error getting suggestions:', error);
      throw error;
    }
  }

  async createSuggestion(insertSuggestion: InsertSubscriptionSuggestion): Promise<SubscriptionSuggestion> {
    try {
      const suggestionData = {
        ...insertSuggestion,
        category: insertSuggestion.category || null,
        currency: insertSuggestion.currency || 'INR',
        merchantName: insertSuggestion.merchantName || null,
        reasoning: insertSuggestion.reasoning || null,
        evidenceEmailIds: insertSuggestion.evidenceEmailIds || [],
        occurrences: insertSuggestion.occurrences || 1,
        recurrenceType: insertSuggestion.recurrenceType || null,
        recurrenceScore: insertSuggestion.recurrenceScore || 0,
        nextBillingDate: insertSuggestion.nextBillingDate || null,
        status: insertSuggestion.status || 'pending'
      };
      
      const result = await this.db.insert(subscriptionSuggestions).values(suggestionData).returning();
      return result[0];
    } catch (error) {
      console.error('Error creating suggestion:', error);
      throw error;
    }
  }

  async createSuggestionsBulk(suggestions: InsertSubscriptionSuggestion[]): Promise<SubscriptionSuggestion[]> {
    try {
      if (suggestions.length === 0) return [];

      const deduped = await this.dropDuplicateSuggestions(suggestions);
      if (deduped.length === 0) return [];

      const suggestionData = deduped.map(suggestion => ({
        ...suggestion,
        category: suggestion.category || null,
        currency: suggestion.currency || 'INR',
        merchantName: suggestion.merchantName || null,
        reasoning: suggestion.reasoning || null,
        evidenceEmailIds: suggestion.evidenceEmailIds || [],
        occurrences: suggestion.occurrences || 1,
        recurrenceType: suggestion.recurrenceType || null,
        recurrenceScore: suggestion.recurrenceScore || 0,
        nextBillingDate: suggestion.nextBillingDate || null,
        status: suggestion.status || 'pending'
      }));
      
      const result = await this.db.insert(subscriptionSuggestions).values(suggestionData).returning();
      return result;
    } catch (error) {
      console.error('Error creating suggestions bulk:', error);
      throw error;
    }
  }

  /**
   * Collapse duplicate suggestions before they reach the review list.
   *
   * A single run can raise the same service twice -- 2026-08-22 produced two
   * Airtel Black suggestions -- because each Gemini result was inserted without
   * checking what was already there. Approval already merges these at the
   * subscription level, so the effect was cosmetic, but a review list with the
   * same service listed twice asks the user to adjudicate a difference that
   * does not exist.
   *
   * Matching is on `serviceKey` alone: a normalised service name plus
   * frequency. Two entries sharing one are the same service at the same billing
   * period, so collapsing them is safe. This is deliberately *not* the
   * cross-name, cross-currency case in #20 -- "Claude Pro" and "Anthropic Claude
   * Subscription" have different keys and are left well alone, because merging
   * genuinely distinct subscriptions is worse than showing both.
   */
  private async dropDuplicateSuggestions(
    suggestions: InsertSubscriptionSuggestion[]
  ): Promise<InsertSubscriptionSuggestion[]> {
    const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
    const rank = (s: InsertSubscriptionSuggestion) =>
      CONFIDENCE_RANK[s.confidence as string] ?? 0;

    // Within the batch, keep the strongest of each key.
    const strongest = new Map<string, InsertSubscriptionSuggestion>();
    for (const suggestion of suggestions) {
      if (!suggestion.serviceKey) continue;

      const key = `${suggestion.userId}::${suggestion.serviceKey}`;
      const held = strongest.get(key);
      if (!held || rank(suggestion) > rank(held)) {
        strongest.set(key, suggestion);
      }
    }

    const withinBatch = Array.from(strongest.values());
    const collapsed = suggestions.length - withinBatch.length;
    if (collapsed > 0) {
      console.log(`🔀 Collapsed ${collapsed} duplicate suggestion(s) within this run`);
    }

    // Then drop anything already awaiting review. Only `pending` is checked:
    // once a suggestion has been approved or rejected, a later detection is a
    // fresh event the user should see again.
    try {
      const userIds = Array.from(new Set(withinBatch.map(s => s.userId)));
      if (userIds.length === 0) return withinBatch;

      const existing = await this.db
        .select({ userId: subscriptionSuggestions.userId, serviceKey: subscriptionSuggestions.serviceKey })
        .from(subscriptionSuggestions)
        .where(
          and(
            inArray(subscriptionSuggestions.userId, userIds),
            eq(subscriptionSuggestions.status, 'pending')
          )
        );

      const pending = new Set(
        existing.map((row: { userId: string; serviceKey: string }) => `${row.userId}::${row.serviceKey}`)
      );

      const fresh = withinBatch.filter(s => !pending.has(`${s.userId}::${s.serviceKey}`));
      const alreadyPending = withinBatch.length - fresh.length;
      if (alreadyPending > 0) {
        console.log(`🔀 Skipped ${alreadyPending} suggestion(s) already awaiting review`);
      }

      return fresh;
    } catch (error) {
      // Duplicates in the review list are a nuisance; losing real detections is
      // not. On a lookup failure, insert what we have.
      console.error('Error checking existing suggestions, inserting without that filter:', error);
      return withinBatch;
    }
  }

  async approveSuggestions(suggestionIds: string[], userId: string): Promise<{ subscriptions: Subscription[]; approved: number }> {
    try {
      const suggestions = await this.db
        .select()
        .from(subscriptionSuggestions)
        .where(
          and(
            inArray(subscriptionSuggestions.id, suggestionIds), // Fixed: Use inArray instead of raw SQL
            eq(subscriptionSuggestions.userId, userId),
            eq(subscriptionSuggestions.status, 'pending')
          )
        );
      
      if (suggestions.length === 0) {
        return { subscriptions: [], approved: 0 };
      }
      
      const createdSubscriptions: Subscription[] = [];
      
      // Create subscriptions from approved suggestions (with deduplication)
      for (const suggestion of suggestions) {
        // Fetch actual email dates from evidence emails to get correct lastEmailDate
        let lastEmailDate: Date = suggestion.lastSeen || new Date();
        let nextBillingDate: Date | null = suggestion.nextBillingDate || null;
        
        if (suggestion.evidenceEmailIds && suggestion.evidenceEmailIds.length > 0) {
          try {
            const evidenceEmailDates = await this.db
              .select({ receivedAt: emails.receivedAt })
              .from(emails)
              .where(
                and(
                  inArray(emails.gmailId, suggestion.evidenceEmailIds),
                  eq(emails.userId, userId)
                )
              )
              .orderBy(desc(emails.receivedAt))
              .limit(1);
            
            if (evidenceEmailDates.length > 0 && evidenceEmailDates[0].receivedAt) {
              lastEmailDate = new Date(evidenceEmailDates[0].receivedAt);
            }
          } catch (err) {
            console.error('Error fetching evidence email dates:', err);
          }
        }
        
        // Calculate nextBillingDate if not set, using lastEmailDate + frequency
        if (!nextBillingDate && lastEmailDate) {
          nextBillingDate = advanceOnePeriod(lastEmailDate, suggestion.frequency);
        }

        // A model-supplied date is only as fresh as the email it was read from,
        // so roll it forward if it has already passed. A future date is kept
        // exactly as stated rather than recomputed.
        nextBillingDate = ensureFutureBillingDate(nextBillingDate, suggestion.frequency);
        
        const subscriptionData = {
          userId: suggestion.userId,
          gmailAccountId: suggestion.gmailAccountId || null,
          serviceName: suggestion.serviceName,
          serviceKey: suggestion.serviceKey,
          amount: suggestion.amount,
          currency: suggestion.currency,
          frequency: suggestion.frequency,
          category: suggestion.category,
          merchantName: suggestion.merchantName,
          occurrences: suggestion.occurrences,
          status: 'active' as const,
          nextBillingDate,
          lastEmailDate,
          /* The sender of the evidence is the vendor, and this is the moment
             we know it. Writing it here means the dashboard reads a column
             instead of recomputing the same answer on every page load. */
          merchantEmail: await this.senderOfEvidence(userId, suggestion.evidenceEmailIds),
        };
        
        // Use createSubscription method which has deduplication logic
        const createdSubscription = await this.createSubscription(subscriptionData);
        createdSubscriptions.push(createdSubscription);
        
        // Link evidence emails to subscription (SECURITY: Defense-in-depth with userId constraint)
        if (suggestion.evidenceEmailIds && suggestion.evidenceEmailIds.length > 0) {
          await this.db
            .update(emails)
            .set({ subscriptionId: createdSubscription.id, processed: true })
            .where(
              and(
                inArray(emails.gmailId, suggestion.evidenceEmailIds),
                eq(emails.userId, userId) // SECURITY: Ensure tenant isolation
              )
            );

          try {
            const made = await this.createInvoicesFromAttachments(
              userId,
              createdSubscription,
              suggestion.evidenceEmailIds,
            );
            console.log(
              `📎 ${createdSubscription.serviceName}: ${made.created} invoice(s) filed, ` +
              `${made.skipped} already present, from ${made.emailsWithFiles} email(s) carrying a file`
            );
          } catch (invoiceError) {
            // Don't fail the entire approval if invoice creation fails
            console.error('⚠️  Error creating invoices (non-fatal):', invoiceError);
          }
        }
      }
      
      // Mark suggestions as approved (SECURITY: Only update user's own suggestions!)
      await this.db
        .update(subscriptionSuggestions)
        .set({ status: 'approved' })
        .where(
          and(
            inArray(subscriptionSuggestions.id, suggestionIds),
            eq(subscriptionSuggestions.userId, userId), // SECURITY: User constraint
            eq(subscriptionSuggestions.status, 'pending') // Only pending suggestions
          )
        );
      
      return { subscriptions: createdSubscriptions, approved: suggestions.length };
    } catch (error) {
      console.error('Error approving suggestions:', error);
      throw error;
    }
  }

  async rejectSuggestions(suggestionIds: string[], userId: string): Promise<{ rejected: number }> {
    try {
      const result = await this.db
        .update(subscriptionSuggestions)
        .set({ status: 'rejected' })
        .where(
          and(
            inArray(subscriptionSuggestions.id, suggestionIds),
            eq(subscriptionSuggestions.userId, userId), // SECURITY: User constraint missing!
            eq(subscriptionSuggestions.status, 'pending')
          )
        );
      
      return { rejected: result.rowCount || 0 };
    } catch (error) {
      console.error('Error rejecting suggestions:', error);
      throw error;
    }
  }

  async clearSuggestions(userId: string): Promise<{ cleared: number }> {
    try {
      const result = await this.db
        .delete(subscriptionSuggestions)
        .where(eq(subscriptionSuggestions.userId, userId));
      
      return { cleared: result.rowCount || 0 };
    } catch (error) {
      console.error('Error clearing suggestions:', error);
      throw error;
    }
  }

  // Analytics methods
  async getSubscriptionStats(userId: string, preferredCurrency: string = 'INR'): Promise<{
    totalMonthly: number;
    activeCount: number;
    emailsAnalyzed: number;
    avgPerService: number;
    newThisMonth: number;
    changePercent: number;
  }> {
    try {
      const [userSubscriptions, emailCount] = await Promise.all([
        this.getSubscriptions(userId),
        this.db.select({ count: count() }).from(emails).where(eq(emails.userId, userId))
      ]);
      
      const activeSubscriptions = userSubscriptions.filter(sub => sub.status === 'active');
      
      // Calculate subscriptions added in the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const newThisMonth = userSubscriptions.filter(sub => 
        sub.detectedAt && new Date(sub.detectedAt) >= thirtyDaysAgo
      ).length;
      
      // Calculate current month's total
      const totalMonthly = activeSubscriptions.reduce((sum, sub) => {
        const amountNum = Number(sub.amount);
        
        // DATA SAFETY: Skip invalid/negative amounts (could be refunds/errors)
        if (!Number.isFinite(amountNum) || amountNum <= 0) {
          console.warn(`Skipping invalid subscription amount: ${sub.amount} for subscription ${sub.id}`);
          return sum;
        }
        
        // Convert to preferred currency first
        const convertedAmount = convertCurrency(amountNum, sub.currency, preferredCurrency);
        
        switch (sub.frequency) {
          case 'yearly':
            return sum + (convertedAmount / 12); // Convert yearly to monthly
          case 'quarterly':
            return sum + (convertedAmount / 3); // Convert quarterly to monthly
          case 'weekly':
            return sum + (convertedAmount * 4.33); // Convert weekly to monthly: 4.33 weeks per month
          case 'monthly':
          default:
            return sum + convertedAmount; // Already monthly
        }
      }, 0);
      
      // Calculate previous month's total (subscriptions created before last 30 days)
      const previousMonthSubs = activeSubscriptions.filter(sub => 
        !sub.detectedAt || new Date(sub.detectedAt) < thirtyDaysAgo
      );
      
      const previousMonthTotal = previousMonthSubs.reduce((sum, sub) => {
        const amountNum = Number(sub.amount);
        if (!Number.isFinite(amountNum) || amountNum <= 0) return sum;
        
        const convertedAmount = convertCurrency(amountNum, sub.currency, preferredCurrency);
        
        switch (sub.frequency) {
          case 'yearly':
            return sum + (convertedAmount / 12);
          case 'quarterly':
            return sum + (convertedAmount / 3);
          case 'weekly':
            return sum + (convertedAmount * 4.33);
          case 'monthly':
          default:
            return sum + convertedAmount;
        }
      }, 0);
      
      // Calculate percentage change
      const changePercent = previousMonthTotal > 0 
        ? Math.round(((totalMonthly - previousMonthTotal) / previousMonthTotal) * 100)
        : 0;

      const activeCount = activeSubscriptions.length;
      const emailsAnalyzed = emailCount[0].count;
      const avgPerService = activeCount > 0 ? totalMonthly / activeCount : 0;

      return {
        totalMonthly: Math.round(totalMonthly * 100) / 100,
        activeCount,
        emailsAnalyzed,
        avgPerService: Math.round(avgPerService * 100) / 100,
        newThisMonth,
        changePercent
      };
    } catch (error) {
      console.error('Error getting subscription stats:', error);
      throw error;
    }
  }

  // Invoice methods
  async getInvoices(subscriptionId: string): Promise<Invoice[]> {
    try {
      /*
       * Only rows with a file behind them.
       *
       * An earlier version recorded a row for every receipt email, with no
       * document attached, so that a subscription whose merchant sends
       * receipts in the body did not come back empty. That was the wrong
       * trade: an archive that lists things it cannot produce looks full and
       * is not. Those rows are filtered here rather than deleted, so nothing
       * of anyone's is destroyed by a deploy -- they simply stop showing.
       */
      const result = await this.db
        .select()
        .from(invoices)
        .where(and(eq(invoices.subscriptionId, subscriptionId), ne(invoices.fileUrl, '')))
        .orderBy(desc(invoices.uploadedAt));
      return result;
    } catch (error) {
      console.error('Error getting invoices:', error);
      throw error;
    }
  }

  async getInvoice(id: string): Promise<Invoice | undefined> {
    try {
      const result = await this.db
        .select()
        .from(invoices)
        .where(eq(invoices.id, id))
        .limit(1);
      return result[0] || undefined;
    } catch (error) {
      console.error('Error getting invoice:', error);
      throw error;
    }
  }

  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    try {
      const result = await this.db.insert(invoices).values(invoice).returning();
      return result[0];
    } catch (error) {
      console.error('Error creating invoice:', error);
      throw error;
    }
  }

  async deleteInvoice(id: string): Promise<boolean> {
    try {
      const result = await this.db.delete(invoices).where(eq(invoices.id, id)).returning();
      return result.length > 0;
    } catch (error) {
      console.error('Error deleting invoice:', error);
      throw error;
    }
  }

  // Gmail Account methods
  async getGmailAccounts(userId: string): Promise<GmailAccount[]> {
    try {
      const result = await this.db
        .select()
        .from(gmailAccounts)
        .where(eq(gmailAccounts.userId, userId))
        .orderBy(desc(gmailAccounts.createdAt));
      return result.map((row: any) => decryptFields(row, ACCOUNT_TOKEN_FIELDS));
    } catch (error) {
      console.error('Error getting Gmail accounts:', error);
      throw error;
    }
  }

  async getGmailAccount(id: string): Promise<GmailAccount | undefined> {
    try {
      const result = await this.db
        .select()
        .from(gmailAccounts)
        .where(eq(gmailAccounts.id, id))
        .limit(1);
      return result[0] ? decryptFields(result[0], ACCOUNT_TOKEN_FIELDS) : undefined;
    } catch (error) {
      console.error('Error getting Gmail account:', error);
      throw error;
    }
  }

  async getGmailAccountByEmail(userId: string, gmailEmail: string): Promise<GmailAccount | undefined> {
    try {
      const result = await this.db
        .select()
        .from(gmailAccounts)
        .where(and(
          eq(gmailAccounts.userId, userId),
          eq(gmailAccounts.gmailEmail, gmailEmail)
        ))
        .limit(1);
      return result[0] ? decryptFields(result[0], ACCOUNT_TOKEN_FIELDS) : undefined;
    } catch (error) {
      console.error('Error getting Gmail account by email:', error);
      throw error;
    }
  }

  async createGmailAccount(account: InsertGmailAccount): Promise<GmailAccount> {
    try {
      const result = await this.db
        .insert(gmailAccounts)
        .values(encryptFields(account, ACCOUNT_TOKEN_FIELDS))
        .returning();
      return decryptFields(result[0], ACCOUNT_TOKEN_FIELDS);
    } catch (error) {
      console.error('Error creating Gmail account:', error);
      throw error;
    }
  }

  async updateGmailAccount(id: string, updates: UpdateGmailAccount): Promise<GmailAccount | undefined> {
    try {
      const result = await this.db
        .update(gmailAccounts)
        .set(encryptFields(updates, ACCOUNT_TOKEN_FIELDS))
        .where(eq(gmailAccounts.id, id))
        .returning();
      return result[0] ? decryptFields(result[0], ACCOUNT_TOKEN_FIELDS) : undefined;
    } catch (error) {
      console.error('Error updating Gmail account:', error);
      throw error;
    }
  }


  /**
   * Deletes a user and everything belonging to them.
   *
   * There are no foreign keys in this schema, so nothing cascades: every table
   * has to be named explicitly. Miss one and rows holding that person's data
   * outlive the deletion, which would make privacy.html section 7 false. The
   * tables here were taken from every pgTable in shared/schema.ts carrying a
   * userId column, plus sessions, which stores the id inside its JSON payload.
   *
   * Order matters in two places. Invoice file paths are read before the
   * invoice rows go, or the pointers to the stored PDFs would be lost while
   * the files themselves remained. And the provider grants are revoked before
   * the tokens are deleted, for the same reason.
   *
   * Object storage is deleted first and the whole operation aborts if any file
   * fails, before a single row is touched. A half-deleted account, where the
   * database says gone but the invoices are still in the bucket, is worse than
   * one that failed cleanly and can be retried.
   */
  /**
   * Removes everything a user owns, but not the user row or their sessions.
   *
   * Shared by deleteUserData (which keeps the account) and deleteUserAccount
   * (which does not), so the two can never drift apart on which tables count
   * as "this person's data".
   */
  private async purgeUserOwnedRows(userId: string): Promise<{
    filesDeleted: number;
    grantsRevoked: number;
    rowsDeleted: Record<string, number>;
  }> {
    // --- 1. Object storage, before anything in the database changes --------
    const userInvoices = await this.db
      .select({ fileUrl: invoices.fileUrl })
      .from(invoices)
      .where(eq(invoices.userId, userId));

    const objectStorage = new ObjectStorageService();
    const failures: string[] = [];
    let filesDeleted = 0;

    for (const invoice of userInvoices) {
      if (!invoice.fileUrl) continue;
      try {
        if (await objectStorage.deleteObjectEntity(invoice.fileUrl)) filesDeleted++;
      } catch (error) {
        failures.push(`${invoice.fileUrl}: ${(error as Error).message}`);
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `Aborted before deleting any rows: ${failures.length} invoice file(s) could not be removed ` +
          `from object storage. Nothing has been deleted; fix and retry.\n  ` +
          failures.join("\n  ")
      );
    }

    // --- 2. Tell the providers, while the tokens still exist ---------------
    let grantsRevoked = 0;
    const gmail = await this.getGmailAccounts(userId);
    for (const account of gmail) {
      const token = account.refreshToken || account.accessToken;
      if (token && (await revokeGoogleToken(token))) grantsRevoked++;
    }

    // --- 3. Rows, child tables first ---------------------------------------
    const rowsDeleted: Record<string, number> = {};
    const tables: Array<[string, any, any]> = [
      ["invoices", invoices, invoices.userId],
      ["subscription_suggestions", subscriptionSuggestions, subscriptionSuggestions.userId],
      ["subscriptions", subscriptions, subscriptions.userId],
      ["emails", emails, emails.userId],
      ["screened_messages", screenedMessages, screenedMessages.userId],
      ["sync_jobs", syncJobs, syncJobs.userId],
      ["gmail_accounts", gmailAccounts, gmailAccounts.userId],
      ["outlook_accounts", outlookAccounts, outlookAccounts.userId],
    ];

    for (const [name, table, column] of tables) {
      const result = await this.db.delete(table).where(eq(column, userId)).returning();
      rowsDeleted[name] = result.length;
    }

    return { filesDeleted, grantsRevoked, rowsDeleted };
  }

  /**
   * Clears a user's data but leaves the account able to sign in.
   *
   * Everything they own goes: invoices and their stored files, detected
   * subscriptions, cached emails, sync history, and the mailbox connections
   * themselves -- with the Google grant revoked, not merely forgotten. What
   * survives is the user row, their password and their sessions, so they stay
   * signed in and can reconnect a mailbox and start again from empty.
   *
   * Their onboarding status is deliberately left alone. Someone who had
   * finished onboarding lands on an empty dashboard rather than being pushed
   * back through the flow, which is the right place to reconnect from.
   */
  async deleteUserData(userId: string): Promise<{
    filesDeleted: number;
    grantsRevoked: number;
    rowsDeleted: Record<string, number>;
  }> {
    const user = await this.getUser(userId);
    if (!user) throw new Error(`No user with id ${userId}`);
    return this.purgeUserOwnedRows(userId);
  }

  /**
   * Deletes a user and everything belonging to them.
   *
   * There are no foreign keys in this schema, so nothing cascades: every table
   * has to be named explicitly. Miss one and rows holding that person's data
   * outlive the deletion, which would make privacy.html section 7 false. The
   * tables here were taken from every pgTable in shared/schema.ts carrying a
   * userId column, plus sessions, which stores the id inside its JSON payload.
   *
   * Order matters in two places. Invoice file paths are read before the
   * invoice rows go, or the pointers to the stored PDFs would be lost while
   * the files themselves remained. And the provider grants are revoked before
   * the tokens are deleted, for the same reason.
   *
   * Object storage is deleted first and the whole operation aborts if any file
   * fails, before a single row is touched. A half-deleted account, where the
   * database says gone but the invoices are still in the bucket, is worse than
   * one that failed cleanly and can be retried.
   */
  async deleteUserAccount(userId: string): Promise<{
    filesDeleted: number;
    grantsRevoked: number;
    rowsDeleted: Record<string, number>;
  }> {
    const user = await this.getUser(userId);
    if (!user) throw new Error(`No user with id ${userId}`);

    const { filesDeleted, grantsRevoked, rowsDeleted } = await this.purgeUserOwnedRows(userId);

    // verification_codes is declared inside its own methods rather than at the
    // top of this file, so it is imported the same way here.
    const { verificationCodes } = await import("@shared/schema");
    const codes = await this.db
      .delete(verificationCodes)
      .where(eq(verificationCodes.userId, userId))
      .returning();
    rowsDeleted["verification_codes"] = codes.length;

    // Sessions are keyed by sid, with the user id inside the JSON payload, so
    // they cannot be matched by column. Left behind, a valid cookie would keep
    // working against a user row that no longer exists.
    // Passport stores the whole user object at sess.passport.user, shaped
    // { authType, userId, claims? }. Password and OAuth logins carry the id at
    // userId; Replit OIDC carries it at claims.sub, the same split getUserId
    // handles in routes.ts. Both are matched here.
    const sessionRows = await this.db.execute(
      sql`DELETE FROM sessions
          WHERE sess -> 'passport' -> 'user' ->> 'userId' = ${userId}
             OR sess -> 'passport' -> 'user' -> 'claims' ->> 'sub' = ${userId}
          RETURNING sid`
    );
    rowsDeleted["sessions"] = (sessionRows as any)?.rows?.length ?? 0;

    const deletedUser = await this.db.delete(users).where(eq(users.id, userId)).returning();
    rowsDeleted["users"] = deletedUser.length;

    return { filesDeleted, grantsRevoked, rowsDeleted };
  }

  // ---------------------------------------------------------------------
  // Admin console reads
  //
  // These exist to answer "who has signed up and is the app working for
  // them", so they return counts and timestamps only. No mailbox token is
  // selected by any of them, deliberately: the console never needs one, and a
  // read path that cannot fetch a token cannot leak one. That is why the
  // mailbox list below picks its columns by hand instead of calling
  // getGmailAccounts, which decrypts.
  // ---------------------------------------------------------------------

  async listUsersForAdmin(): Promise<any[]> {
    const result = await this.db.execute(sql`
      SELECT
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.created_at,
        u.email_verified,
        u.onboarding_status,
        u.organization_name,
        u.preferred_currency,
        (SELECT count(*) FROM gmail_accounts g WHERE g.user_id = u.id)          AS gmail_accounts,
        (SELECT count(*) FROM outlook_accounts o WHERE o.user_id = u.id)        AS outlook_accounts,
        (SELECT count(*) FROM gmail_accounts g
           WHERE g.user_id = u.id AND g.sync_status = 'error')                  AS mailboxes_in_error,
        (SELECT max(g.last_sync) FROM gmail_accounts g WHERE g.user_id = u.id)  AS last_mailbox_sync,
        (SELECT count(*) FROM subscriptions s
           WHERE s.user_id = u.id AND s.status = 'active')                      AS subscriptions,
        (SELECT count(*) FROM subscription_suggestions sg
           WHERE sg.user_id = u.id AND sg.status = 'pending')                   AS pending_suggestions,
        (SELECT count(*) FROM invoices i WHERE i.user_id = u.id)                AS invoices,
        (SELECT count(*) FROM invoices i
           WHERE i.user_id = u.id AND i.file_url <> '')                         AS invoices_with_file,
        (SELECT count(*) FROM emails e WHERE e.user_id = u.id)                  AS emails,
        j.status      AS last_sync_status,
        j.started_at  AS last_sync_started,
        j.finished_at AS last_sync_finished,
        j.error       AS last_sync_error
      FROM users u
      LEFT JOIN LATERAL (
        SELECT status, started_at, finished_at, error
        FROM sync_jobs
        WHERE user_id = u.id
        ORDER BY started_at DESC
        LIMIT 1
      ) j ON true
      ORDER BY u.created_at DESC NULLS LAST
    `);
    return ((result as any)?.rows ?? []) as any[];
  }

  async getUserDetailForAdmin(userId: string): Promise<any | undefined> {
    const rows = await this.listUsersForAdmin();
    const summary = rows.find((row: any) => row.id === userId);
    if (!summary) return undefined;

    const mailboxes = await this.db.execute(sql`
      SELECT 'gmail' AS provider, id, gmail_email AS address, last_sync, sync_status, sync_error, created_at
      FROM gmail_accounts WHERE user_id = ${userId}
      UNION ALL
      SELECT 'outlook' AS provider, id, outlook_email AS address, last_sync, sync_status, sync_error, created_at
      FROM outlook_accounts WHERE user_id = ${userId}
      ORDER BY created_at
    `);

    const subs = await this.db.execute(sql`
      SELECT s.id, s.service_name, s.amount, s.currency, s.frequency, s.status,
             s.next_billing_date, s.last_email_date,
             (SELECT count(*) FROM invoices i WHERE i.subscription_id = s.id)                    AS invoices,
             (SELECT count(*) FROM invoices i WHERE i.subscription_id = s.id AND i.file_url = '') AS invoices_without_file
      FROM subscriptions s
      WHERE s.user_id = ${userId}
      ORDER BY s.service_name
    `);

    const recentSyncs = await this.db.execute(sql`
      SELECT status, trigger_source, started_at, finished_at, error,
             emails_processed, suggestions_generated
      FROM sync_jobs WHERE user_id = ${userId}
      ORDER BY started_at DESC LIMIT 10
    `);

    return {
      ...summary,
      mailboxes: (mailboxes as any)?.rows ?? [],
      subscriptions_detail: (subs as any)?.rows ?? [],
      recent_syncs: (recentSyncs as any)?.rows ?? [],
    };
  }

  async deleteGmailAccount(id: string): Promise<boolean> {
    try {
      const result = await this.db.delete(gmailAccounts).where(eq(gmailAccounts.id, id)).returning();
      return result.length > 0;
    } catch (error) {
      console.error('Error deleting Gmail account:', error);
      throw error;
    }
  }

  // Outlook Account methods
  async getOutlookAccounts(userId: string): Promise<OutlookAccount[]> {
    try {
      const result = await this.db
        .select()
        .from(outlookAccounts)
        .where(eq(outlookAccounts.userId, userId))
        .orderBy(desc(outlookAccounts.createdAt));
      return result.map((row: any) => decryptFields(row, ACCOUNT_TOKEN_FIELDS));
    } catch (error) {
      console.error('Error getting Outlook accounts:', error);
      throw error;
    }
  }

  async getOutlookAccount(id: string): Promise<OutlookAccount | undefined> {
    try {
      const result = await this.db
        .select()
        .from(outlookAccounts)
        .where(eq(outlookAccounts.id, id))
        .limit(1);
      return result[0] ? decryptFields(result[0], ACCOUNT_TOKEN_FIELDS) : undefined;
    } catch (error) {
      console.error('Error getting Outlook account:', error);
      throw error;
    }
  }

  async getOutlookAccountByEmail(userId: string, outlookEmail: string): Promise<OutlookAccount | undefined> {
    try {
      const result = await this.db
        .select()
        .from(outlookAccounts)
        .where(and(
          eq(outlookAccounts.userId, userId),
          eq(outlookAccounts.outlookEmail, outlookEmail)
        ))
        .limit(1);
      return result[0] ? decryptFields(result[0], ACCOUNT_TOKEN_FIELDS) : undefined;
    } catch (error) {
      console.error('Error getting Outlook account by email:', error);
      throw error;
    }
  }

  async createOutlookAccount(account: InsertOutlookAccount): Promise<OutlookAccount> {
    try {
      const result = await this.db
        .insert(outlookAccounts)
        .values(encryptFields(account, ACCOUNT_TOKEN_FIELDS))
        .returning();
      return decryptFields(result[0], ACCOUNT_TOKEN_FIELDS);
    } catch (error) {
      console.error('Error creating Outlook account:', error);
      throw error;
    }
  }

  async updateOutlookAccount(id: string, updates: UpdateOutlookAccount): Promise<OutlookAccount | undefined> {
    try {
      const result = await this.db
        .update(outlookAccounts)
        .set(encryptFields(updates, ACCOUNT_TOKEN_FIELDS))
        .where(eq(outlookAccounts.id, id))
        .returning();
      return result[0] ? decryptFields(result[0], ACCOUNT_TOKEN_FIELDS) : undefined;
    } catch (error) {
      console.error('Error updating Outlook account:', error);
      throw error;
    }
  }

  async deleteOutlookAccount(id: string): Promise<boolean> {
    try {
      const result = await this.db.delete(outlookAccounts).where(eq(outlookAccounts.id, id)).returning();
      return result.length > 0;
    } catch (error) {
      console.error('Error deleting Outlook account:', error);
      throw error;
    }
  }
}

export const storage = new DatabaseStorage();