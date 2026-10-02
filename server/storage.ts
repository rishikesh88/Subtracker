import { type User, type InsertUser, type UpsertUser, type Subscription, type InsertSubscription, type Email, type InsertEmail, type UpdateUser, type SubscriptionSuggestion, type InsertSubscriptionSuggestion, type Invoice, type InsertInvoice, type GmailAccount, type InsertGmailAccount, type UpdateGmailAccount, type OutlookAccount, type InsertOutlookAccount, type UpdateOutlookAccount, type SyncJob, users, syncJobs, subscriptions, emails, screenedMessages, subscriptionSuggestions, invoices, gmailAccounts, outlookAccounts, featureFlags, featureFlagUsers, featureFlagAudit, type FeatureFlag, type FeatureRollout, payments, type Payment, type InsertPayment, subscriptionNameHistory } from "@shared/schema";
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, and, desc, asc, count, sql, inArray, isNotNull, isNull, ne, gte } from 'drizzle-orm';
import { neon } from '@neondatabase/serverless';
import { randomUUID } from "crypto";
import { convertCurrency } from "./utils/currencyConverter";
import { brandTokens } from "./lib/brandTokens";
import { merchantSender } from "./lib/evidence";
import { advanceOnePeriod, ensureFutureBillingDate } from "./utils/billingDate";
import { findDuplicateHint } from "./utils/duplicateHints";
import { invoiceExtractor } from "./services/invoiceExtractor";
import { encryptFields, decryptFields } from "./lib/tokenCrypto";
import { revokeGoogleToken } from "./lib/oauthRevoke";
import { looksLikeBill } from "./lib/billingEmail";
import { attachmentTextOf } from "./lib/statusRules";
import { ObjectStorageService } from "./objectStorage";
import { invoiceIdentity, type InvoiceRowForDuplicates } from "./lib/invoiceDuplicates";

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
  getEmailsByIds(ids: string[], userId?: string): Promise<Email[]>;
  getEmailByGmailId(gmailId: string, userId: string): Promise<Email | undefined>;
  getSyncedGmailIds(userId: string): Promise<Set<string>>;
  startSyncJob(userId: string, triggerSource: string): Promise<{ outcome: 'claimed'; job: SyncJob } | { outcome: 'conflict' } | { outcome: 'unavailable' }>;
  finishSyncJob(jobId: string, status: 'succeeded' | 'failed', details?: { error?: string | null; emailsProcessed?: number; suggestionsGenerated?: number }): Promise<void>;
  sweepStuckSyncJobs(): Promise<number>;
  ensureEmailsUniquePerAccount(): Promise<'changed' | 'already'>;
  getRunningSyncJob(userId: string): Promise<SyncJob | undefined>;
  getPendingSuggestionsSince(userId: string, since: Date): Promise<SubscriptionSuggestion[]>;
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
  approveSuggestions(suggestionIds: string[], userId: string): Promise<{ subscriptions: Subscription[]; createdSubscriptionIds: string[]; approved: number }>;
  undoSuggestionDecisions(userId: string, suggestionIds: string[], createdSubscriptionIds: string[]): Promise<{ restored: number; removed: number }>;
  rejectSuggestions(suggestionIds: string[], userId: string): Promise<{ rejected: number }>;
  clearSuggestions(userId: string): Promise<{ cleared: number }>;
  
  // Email methods with pagination
  getEmailsPaginated(userId: string, options?: { page?: number; pageSize?: number }): Promise<{ emails: Email[]; total: number }>;
  
  // Analytics methods
  getSubscriptionStats(userId: string, preferredCurrency?: string, byLifecycle?: boolean): Promise<{
    totalMonthly: number;
    activeCount: number;
    emailsAnalyzed: number;
    avgPerService: number;
    newThisMonth: number;
    changePercent: number;
    /* Currency codes held by active subscriptions that no rate could reach,
       so they are missing from totalMonthly. Empty in the normal case. */
    unconvertedCurrencies: string[];
    /* Only when counting by lifecycle status (switch `subscription_status`). */
    needsReviewCount?: number;
    inactiveCount?: number;
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

/** One approved suggestion, as the status recorder needs it. */
export interface ApprovedForStatus {
  subscriptionId: string;
  currency: string;
  /** The name the suggestion was approved under, remembered as a search clue. */
  approvedName?: string | null;
  evidenceEmailIds: string[];
  cancelledOn: string | null;
  accessEndsOn: string | null;
}

/** An email as the payment recorder reads it. */
export interface PaymentSourceEmail {
  id: string;
  subject: string;
  content: string | null;
  receivedAt: Date | string;
  extractedAmount: string | null;
  extractedCurrency: string | null;
  /** File names and the text read from PDFs attached to it, an extra source for reading a payment. */
  attachmentText?: string | null;
}

/** The switches this release knows about. Seeded if missing; see ensureFeatureFlagTables. */
const SEED_FEATURE_FLAGS = [
  {
    key: 'subscription_status',
    name: 'Subscription status & payment history',
    description: 'Marks each subscription Active, Needs review or Inactive, and shows its payment history from the user’s emails.',
    tags: ['Beta', 'Sync', 'Billing', 'UI'],
  },
  {
    key: 'new_invoice_checks',
    name: 'New invoice checks',
    description: 'Looks for new bills and receipts for approved subscriptions around their renewal date.',
    tags: ['Beta', 'Background', 'Billing'],
  },
];

/** The editable part of a switch, as an audit row records it. */
function flagDetails(flag: { name: string; description: string; tags: string[] }) {
  return { name: flag.name, description: flag.description, tags: flag.tags };
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
    names: { merchantName?: string | null; serviceName?: string | null } = {},
  ): Promise<string | null> {
    if (!evidenceEmailIds || evidenceEmailIds.length === 0) return null;
    try {
      const rows = await this.db
        .select({ fromEmail: emails.fromEmail })
        .from(emails)
        .where(and(eq(emails.userId, userId), inArray(emails.gmailId, evidenceEmailIds)))
        .orderBy(desc(emails.receivedAt));
      /* Not simply the newest sender: for Claude Pro that was the card
         issuer's transaction alert, and the subscription wore Federal Bank's
         logo. The brand's own sender wins; banks and processors never do. */
      return merchantSender(rows.map((r: { fromEmail: string | null }) => r.fromEmail), names);
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
    /** Only these emails (by row id), however old: a history search's own finds. */
    onlyEmailIds?: string[],
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
      .where(and(
        eq(emails.userId, userId),
        isNotNull(emails.attachmentData),
        ...(onlyEmailIds ? [inArray(emails.id, onlyEmailIds)] : []),
      ))
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

    // What this subscription already holds, read once.
    const held = await this.db
      .select({
        fileName: invoices.fileName,
        fileSize: invoices.fileSize,
        fileUrl: invoices.fileUrl,
        uploadedAt: invoices.uploadedAt,
      })
      .from(invoices)
      .where(eq(invoices.subscriptionId, subscription.id));
    const known = { paths: new Set<string>(), identities: new Set<string>() };
    for (const h of held) {
      known.paths.add(h.fileUrl);
      const identity = invoiceIdentity({ subscriptionId: subscription.id, fileName: h.fileName, fileSize: h.fileSize, uploadedAt: h.uploadedAt });
      if (identity) known.identities.add(identity);
    }

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
        const uploadedAt = email.receivedAt ? new Date(email.receivedAt) : new Date();
        // A search re-run uploads the same PDF to a new object-storage path,
        // so the path alone never matches. The same file name and size on
        // the same day is one document, however many runs or emails carry it.
        const identity = invoiceIdentity({
          subscriptionId: subscription.id,
          fileName: attachment.filename,
          fileSize: attachment.size,
          uploadedAt,
        });
        if (known.paths.has(attachment.objectStoragePath) || (identity && known.identities.has(identity))) {
          skipped++;
          continue;
        }
        known.paths.add(attachment.objectStoragePath);
        if (identity) known.identities.add(identity);

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
          uploadedAt,
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

  async getEmailsByIds(ids: string[], userId?: string): Promise<Email[]> {
    try {
      if (!ids || ids.length === 0) return [];
      // evidenceEmailIds stores gmailId values, not internal database IDs.
      // Scoped to the user where the caller knows it: a message id is only
      // unique within one mailbox, so without this two people's mail could in
      // principle answer the same id.
      const where = userId
        ? and(inArray(emails.gmailId, ids), eq(emails.userId, userId))
        : inArray(emails.gmailId, ids);
      const result = await this.db.select().from(emails).where(where);
      return result;
    } catch (error) {
      console.error('Error getting emails by IDs:', error);
      throw error;
    }
  }

  /**
   * This account's stored copy of a message, if it has one.
   *
   * Scoped to the account. It used to match on the message id alone, so when
   * the same mailbox was connected to two Verloq accounts, the second one's
   * sync picked up the first one's row -- and the review page, which only
   * shows an account its own emails, showed that evidence as missing.
   */
  async getEmailByGmailId(gmailId: string, userId: string): Promise<Email | undefined> {
    try {
      const result = await this.db
        .select()
        .from(emails)
        .where(and(eq(emails.gmailId, gmailId), eq(emails.userId, userId)))
        .limit(1);
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
  /**
   * The sync this user has running, if any. The job row is written when a
   * sync starts and closed when it ends, so -- unlike anything held in the
   * browser -- it survives a refresh, a closed tab and a new login.
   */
  /** What one sync found and nobody has decided yet: the summary email's list. */
  async getPendingSuggestionsSince(userId: string, since: Date): Promise<SubscriptionSuggestion[]> {
    return this.db
      .select()
      .from(subscriptionSuggestions)
      .where(
        and(
          eq(subscriptionSuggestions.userId, userId),
          eq(subscriptionSuggestions.status, 'pending'),
          gte(subscriptionSuggestions.detectedAt, since),
        ),
      );
  }

  async getRunningSyncJob(userId: string): Promise<SyncJob | undefined> {
    const rows = await this.db
      .select()
      .from(syncJobs)
      .where(and(eq(syncJobs.userId, userId), eq(syncJobs.status, 'running')))
      .limit(1);
    return rows[0];
  }

  /**
   * Make a stored email unique per account instead of across the whole app.
   *
   * Schema changes here are applied by hand with db:push, which currently
   * reports drift, so this one is applied at startup instead. It is safe to
   * run on every boot: the new rule is added first (every existing row
   * already satisfies it, since the old rule was stricter), then the old
   * app-wide rule on gmail_id alone is dropped, whatever it happens to be
   * named. All of it runs as one statement, so it applies whole or not at
   * all. Once done, the check at the top makes later boots a no-op.
   */
  async ensureEmailsUniquePerAccount(): Promise<'changed' | 'already'> {
    const state = await this.db.execute(sql`
      SELECT
        EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'emails' AND indexname = 'uq_emails_user_gmail') AS has_new,
        EXISTS (
          SELECT 1 FROM pg_index x
          WHERE x.indrelid = 'emails'::regclass AND x.indisunique AND NOT x.indisprimary
            AND x.indnatts = 1
            AND x.indkey[0] = (SELECT attnum FROM pg_attribute WHERE attrelid = 'emails'::regclass AND attname = 'gmail_id')
        ) AS has_old
    `);
    const row = ((state as any).rows ?? state)[0] ?? {};
    if (row.has_new && !row.has_old) return 'already';

    await this.db.execute(sql`
      DO $$
      DECLARE
        r record;
        gmail_col int2 := (SELECT attnum FROM pg_attribute WHERE attrelid = 'emails'::regclass AND attname = 'gmail_id');
      BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS uq_emails_user_gmail ON emails (user_id, gmail_id);

        FOR r IN
          SELECT c.conname FROM pg_constraint c
          WHERE c.conrelid = 'emails'::regclass AND c.contype = 'u' AND c.conkey = ARRAY[gmail_col]
        LOOP
          EXECUTE format('ALTER TABLE emails DROP CONSTRAINT %I', r.conname);
        END LOOP;

        FOR r IN
          SELECT i.relname FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
          WHERE x.indrelid = 'emails'::regclass AND x.indisunique AND NOT x.indisprimary
            AND x.indnatts = 1 AND x.indkey[0] = gmail_col
        LOOP
          EXECUTE format('DROP INDEX %I', r.relname);
        END LOOP;
      END $$;
    `);
    return 'changed';
  }

  // ---------------------------------------------------------------------
  // Feature switches
  //
  // Read by server/lib/featureFlags.ts and written by the admin console. Every
  // write here is paired with its audit row in one batch, which neon-http runs
  // as a single transaction: a change is never recorded without happening, or
  // made without being recorded.
  // ---------------------------------------------------------------------

  /**
   * Create the feature switch tables and seed the known switches.
   *
   * Applied at startup for the same reason as ensureEmailsUniquePerAccount:
   * db:push is not usable here. Every statement is idempotent, so this is safe
   * on every boot; the seed only inserts keys that are missing, and never
   * touches a switch an admin has since edited. Must match shared/schema.ts.
   */
  async ensureFeatureFlagTables(): Promise<{ seeded: string[] }> {
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS feature_flags (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        key text NOT NULL UNIQUE,
        name text NOT NULL,
        description text NOT NULL DEFAULT '',
        tags text[] NOT NULL DEFAULT '{}'::text[],
        rollout text NOT NULL DEFAULT 'off',
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT feature_flags_rollout_check CHECK (rollout IN ('off', 'selected', 'everyone'))
      )
    `);
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS feature_flag_users (
        flag_id varchar NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
        user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        added_at timestamp NOT NULL DEFAULT now(),
        added_by text,
        PRIMARY KEY (flag_id, user_id)
      )
    `);
    await this.db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_feature_flag_users_user ON feature_flag_users (user_id)
    `);
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS feature_flag_audit (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        flag_id varchar NOT NULL,
        actor text NOT NULL,
        action text NOT NULL,
        before jsonb,
        after jsonb,
        at timestamp NOT NULL DEFAULT now()
      )
    `);
    await this.db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_feature_flag_audit_flag ON feature_flag_audit (flag_id, at)
    `);

    const inserted: FeatureFlag[] = await this.db
      .insert(featureFlags)
      .values(SEED_FEATURE_FLAGS.map((flag) => ({ ...flag, rollout: 'off' as const })))
      .onConflictDoNothing({ target: featureFlags.key })
      .returning();

    if (inserted.length > 0) {
      await this.db.insert(featureFlagAudit).values(
        inserted.map((flag) => ({
          flagId: flag.id,
          actor: 'system',
          action: 'created',
          before: null,
          after: flagDetails(flag),
        })),
      );
    }
    return { seeded: inserted.map((flag) => flag.key) };
  }

  /** Everything isEnabled needs, in two small reads. */
  async getFeatureFlagSnapshot(): Promise<{
    flags: { id: string; key: string; rollout: string }[];
    members: { flagId: string; userId: string }[];
  }> {
    const flags = await this.db
      .select({ id: featureFlags.id, key: featureFlags.key, rollout: featureFlags.rollout })
      .from(featureFlags);
    const members = await this.db
      .select({ flagId: featureFlagUsers.flagId, userId: featureFlagUsers.userId })
      .from(featureFlagUsers);
    return { flags, members };
  }

  async countUsers(): Promise<number> {
    const rows = await this.db.select({ n: count() }).from(users);
    return Number(rows[0]?.n ?? 0);
  }

  /** Every switch, with how many users are on its list. */
  async listFeatureFlagsForAdmin(): Promise<(FeatureFlag & { listedUsers: number })[]> {
    const flags: FeatureFlag[] = await this.db.select().from(featureFlags).orderBy(asc(featureFlags.name));
    const counts = await this.db
      .select({ flagId: featureFlagUsers.flagId, n: count() })
      .from(featureFlagUsers)
      .groupBy(featureFlagUsers.flagId);
    const byFlag = new Map<string, number>(counts.map((row: any) => [row.flagId, Number(row.n)]));
    return flags.map((flag) => ({ ...flag, listedUsers: byFlag.get(flag.id) ?? 0 }));
  }

  async getFeatureFlag(id: string): Promise<FeatureFlag | undefined> {
    const rows = await this.db.select().from(featureFlags).where(eq(featureFlags.id, id)).limit(1);
    return rows[0];
  }

  async getFeatureFlagByKey(key: string): Promise<FeatureFlag | undefined> {
    const rows = await this.db.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
    return rows[0];
  }

  /** The users on a switch's list, newest first. Names and emails only. */
  async getFeatureFlagUsersForAdmin(flagId: string): Promise<any[]> {
    return this.db
      .select({
        userId: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        addedAt: featureFlagUsers.addedAt,
        addedBy: featureFlagUsers.addedBy,
      })
      .from(featureFlagUsers)
      .innerJoin(users, eq(users.id, featureFlagUsers.userId))
      .where(eq(featureFlagUsers.flagId, flagId))
      .orderBy(desc(featureFlagUsers.addedAt));
  }

  /** A user's place on every list they are on: flag id, when, by whom. */
  async getFeatureFlagMembershipsForUser(userId: string): Promise<{ flagId: string; addedAt: Date; addedBy: string | null }[]> {
    return this.db
      .select({ flagId: featureFlagUsers.flagId, addedAt: featureFlagUsers.addedAt, addedBy: featureFlagUsers.addedBy })
      .from(featureFlagUsers)
      .where(eq(featureFlagUsers.userId, userId));
  }

  /**
   * Existing users whose email or name contains the query, for adding to a
   * switch's list. Users already on it are left out.
   */
  async searchUsersForFeatureFlag(flagId: string, query: string, limit = 8): Promise<any[]> {
    const pattern = `%${query.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const result = await this.db.execute(sql`
      SELECT u.id, u.email, u.first_name, u.last_name, u.created_at
      FROM users u
      WHERE (
        u.email ILIKE ${pattern}
        OR u.first_name ILIKE ${pattern}
        OR u.last_name ILIKE ${pattern}
        OR (coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) ILIKE ${pattern}
      )
      AND NOT EXISTS (
        SELECT 1 FROM feature_flag_users fu WHERE fu.flag_id = ${flagId} AND fu.user_id = u.id
      )
      ORDER BY u.email
      LIMIT ${limit}
    `);
    return ((result as any)?.rows ?? []) as any[];
  }

  async createFeatureFlag(
    input: { key: string; name: string; description: string; tags: string[] },
    actor: string,
  ): Promise<FeatureFlag> {
    const id = randomUUID();
    const [rows] = await this.db.batch([
      this.db.insert(featureFlags).values({ id, ...input, rollout: 'off' }).returning(),
      this.db.insert(featureFlagAudit).values({
        flagId: id,
        actor,
        action: 'created',
        before: null,
        after: { ...flagDetails(input), key: input.key, rollout: 'off' },
      }),
    ]);
    return rows[0];
  }

  async updateFeatureFlagDetails(
    id: string,
    changes: { name: string; description: string; tags: string[] },
    actor: string,
  ): Promise<FeatureFlag | undefined> {
    const before = await this.getFeatureFlag(id);
    if (!before) return undefined;
    const [rows] = await this.db.batch([
      this.db
        .update(featureFlags)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(featureFlags.id, id))
        .returning(),
      this.db.insert(featureFlagAudit).values({
        flagId: id,
        actor,
        action: 'details_edited',
        before: flagDetails(before),
        after: flagDetails(changes),
      }),
    ]);
    return rows[0];
  }

  async setFeatureFlagRollout(id: string, rollout: FeatureRollout, actor: string): Promise<FeatureFlag | undefined> {
    const before = await this.getFeatureFlag(id);
    if (!before) return undefined;
    if (before.rollout === rollout) return before;
    const [rows] = await this.db.batch([
      this.db
        .update(featureFlags)
        .set({ rollout, updatedAt: new Date() })
        .where(eq(featureFlags.id, id))
        .returning(),
      this.db.insert(featureFlagAudit).values({
        flagId: id,
        actor,
        action: 'rollout_changed',
        before: { rollout: before.rollout },
        after: { rollout },
      }),
    ]);
    return rows[0];
  }

  /** Adds users to a switch's list. Anyone already on it is skipped. */
  async addFeatureFlagUsers(flagId: string, userIds: string[], actor: string): Promise<number> {
    if (userIds.length === 0) return 0;
    const existing: { id: string; email: string | null }[] = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.id, userIds));
    const already = new Set(
      (
        await this.db
          .select({ userId: featureFlagUsers.userId })
          .from(featureFlagUsers)
          .where(and(eq(featureFlagUsers.flagId, flagId), inArray(featureFlagUsers.userId, userIds)))
      ).map((row: { userId: string }) => row.userId),
    );
    const toAdd = existing.filter((user) => !already.has(user.id));
    if (toAdd.length === 0) return 0;

    await this.db.batch([
      this.db
        .insert(featureFlagUsers)
        .values(toAdd.map((user) => ({ flagId, userId: user.id, addedBy: actor })))
        .onConflictDoNothing(),
      this.db.insert(featureFlagAudit).values(
        toAdd.map((user) => ({
          flagId,
          actor,
          action: 'user_added',
          before: null,
          after: { userId: user.id, email: user.email },
        })),
      ),
    ]);
    return toAdd.length;
  }

  async removeFeatureFlagUser(flagId: string, userId: string, actor: string): Promise<boolean> {
    const rows = await this.db
      .select({ addedAt: featureFlagUsers.addedAt, addedBy: featureFlagUsers.addedBy, email: users.email })
      .from(featureFlagUsers)
      .leftJoin(users, eq(users.id, featureFlagUsers.userId))
      .where(and(eq(featureFlagUsers.flagId, flagId), eq(featureFlagUsers.userId, userId)))
      .limit(1);
    const row = rows[0];
    if (!row) return false;

    await this.db.batch([
      this.db
        .delete(featureFlagUsers)
        .where(and(eq(featureFlagUsers.flagId, flagId), eq(featureFlagUsers.userId, userId))),
      this.db.insert(featureFlagAudit).values({
        flagId,
        actor,
        action: 'user_removed',
        before: { userId, email: row.email, addedAt: row.addedAt, addedBy: row.addedBy },
        after: null,
      }),
    ]);
    return true;
  }

  // ---------------------------------------------------------------------
  // Subscription status and payments (feature switch `subscription_status`)
  //
  // Storage only. What to record and what it means is decided by
  // server/services/subscriptionStatus.ts and server/lib/statusRules.ts, and
  // nothing here is called for a user without the switch.
  // ---------------------------------------------------------------------

  /**
   * Create the payments table and the status columns.
   *
   * Applied at startup for the same reason as ensureFeatureFlagTables:
   * db:push is not usable here. Every statement is idempotent. The new
   * columns are all nullable (or defaulted), so existing rows and every
   * existing query are unaffected; `subscriptions.status` is not touched.
   * Must match shared/schema.ts.
   */
  async ensureSubscriptionStatusTables(): Promise<void> {
    await this.db.execute(sql`
      ALTER TABLE subscriptions
        ADD COLUMN IF NOT EXISTS lifecycle_status text,
        ADD COLUMN IF NOT EXISTS lifecycle_reason text,
        ADD COLUMN IF NOT EXISTS lifecycle_updated_at timestamp,
        ADD COLUMN IF NOT EXISTS last_payment_at date,
        ADD COLUMN IF NOT EXISTS expected_next_payment_at date,
        ADD COLUMN IF NOT EXISTS ends_on date,
        ADD COLUMN IF NOT EXISTS cancelled_at date,
        ADD COLUMN IF NOT EXISTS inactive_since date,
        ADD COLUMN IF NOT EXISTS inactive_source text,
        ADD COLUMN IF NOT EXISTS still_active_taps integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS still_active_until date
    `);
    await this.db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'subscriptions'::regclass AND conname = 'subscriptions_lifecycle_status_check'
        ) THEN
          ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_lifecycle_status_check
            CHECK (lifecycle_status IS NULL OR lifecycle_status IN ('active', 'needs_review', 'inactive'));
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'subscriptions'::regclass AND conname = 'subscriptions_inactive_source_check'
        ) THEN
          ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_inactive_source_check
            CHECK (inactive_source IS NULL OR inactive_source IN ('email', 'user'));
        END IF;
      END $$;
    `);
    await this.db.execute(sql`
      ALTER TABLE subscription_suggestions
        ADD COLUMN IF NOT EXISTS cancelled_on date,
        ADD COLUMN IF NOT EXISTS access_ends_on date
    `);
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS payments (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL,
        subscription_id varchar NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
        email_id varchar REFERENCES emails(id) ON DELETE SET NULL,
        paid_at date NOT NULL,
        amount numeric(10, 2),
        currency text,
        kind text NOT NULL,
        paused_until date,
        source text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT payments_kind_check CHECK (kind IN ('receipt', 'invoice', 'card_alert', 'failed', 'refund', 'pause')),
        CONSTRAINT payments_source_check CHECK (source IN ('sync', 'approval', 'history'))
      )
    `);
    await this.db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_subscription_email ON payments (subscription_id, email_id)
    `);
    await this.db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_payments_user_subscription ON payments (user_id, subscription_id, paid_at)
    `);
    // Bank alerts read and discarded: a keyed fingerprint instead of an email row.
    await this.db.execute(sql`
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS evidence_fingerprint text
    `);
    await this.db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_subscription_fingerprint
        ON payments (subscription_id, evidence_fingerprint) WHERE evidence_fingerprint IS NOT NULL
    `);
    // One-time history search (server/services/historySearch.ts).
    await this.db.execute(sql`
      ALTER TABLE subscriptions
        ADD COLUMN IF NOT EXISTS history_status text,
        ADD COLUMN IF NOT EXISTS history_searched_since date,
        ADD COLUMN IF NOT EXISTS history_attempts integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS history_error text,
        ADD COLUMN IF NOT EXISTS history_started_at timestamp,
        ADD COLUMN IF NOT EXISTS history_finished_at timestamp
    `);
    await this.db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'subscriptions'::regclass AND conname = 'subscriptions_history_status_check'
        ) THEN
          ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_history_status_check
            CHECK (history_status IS NULL OR history_status IN ('pending', 'running', 'done', 'failed'));
        END IF;
      END $$;
    `);
    // Counts and honesty about how far back the search got, the bill/receipt
    // labels on payments, and the names a subscription has had.
    await this.db.execute(sql`
      ALTER TABLE subscriptions
        ADD COLUMN IF NOT EXISTS history_read integer,
        ADD COLUMN IF NOT EXISTS history_saved integer,
        ADD COLUMN IF NOT EXISTS history_skipped integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS history_partial boolean NOT NULL DEFAULT false
    `);
    await this.db.execute(sql`
      ALTER TABLE payments
        ADD COLUMN IF NOT EXISTS document_type text,
        ADD COLUMN IF NOT EXISTS paid_status text,
        ADD COLUMN IF NOT EXISTS due_on date
    `);
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS subscription_name_history (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL,
        subscription_id varchar NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
        name text NOT NULL,
        origin text NOT NULL DEFAULT 'rename',
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await this.db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_name_history
        ON subscription_name_history (subscription_id, lower(name))
    `);
    await this.ensureRenewalCheckTables();
  }

  // ---------------------------------------------------------------------
  // Renewal-based background checks (also only for `subscription_status`)
  // ---------------------------------------------------------------------

  /** Tables of the daily renewal job (server/lib/renewalChecks.ts). Idempotent; must match shared/schema.ts. */
  async ensureRenewalCheckTables(): Promise<void> {
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS renewal_check_state (
        subscription_id varchar PRIMARY KEY REFERENCES subscriptions(id) ON DELETE CASCADE,
        user_id varchar NOT NULL,
        cycle_renewal_on date,
        attempts integer NOT NULL DEFAULT 0,
        first_attempt_on date,
        last_checked_on date,
        last_checked_at timestamp,
        next_check_on date,
        error_count integer NOT NULL DEFAULT 0,
        last_error text
      )
    `);
    await this.db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_renewal_check_state_user ON renewal_check_state (user_id)
    `);
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS renewal_job_state (
        name text PRIMARY KEY,
        last_run_day date,
        started_at timestamp,
        finished_at timestamp,
        users integer NOT NULL DEFAULT 0,
        checked integer NOT NULL DEFAULT 0,
        found integer NOT NULL DEFAULT 0,
        failures integer NOT NULL DEFAULT 0,
        reconnect_marked integer NOT NULL DEFAULT 0,
        emails_sent integer NOT NULL DEFAULT 0
      )
    `);
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS mailbox_reconnect_state (
        account_id varchar NOT NULL,
        provider text NOT NULL,
        user_id varchar NOT NULL,
        flagged_at timestamp NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, provider)
      )
    `);
    await this.db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_mailbox_reconnect_user ON mailbox_reconnect_state (user_id)
    `);
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS reconnect_email_state (
        user_id varchar PRIMARY KEY,
        last_sent_at timestamp NOT NULL
      )
    `);
  }

  /**
   * Takes today's run of the daily job, atomically: true for exactly one
   * caller per day (across restarts and instances). A same-day run that
   * started over `staleMs` ago and never finished can be taken over, so a
   * restart mid-run still finishes the day. Same rule as decideClaim.
   */
  async claimRenewalRun(today: string, staleMs: number): Promise<boolean> {
    const staleSeconds = Math.max(1, Math.round(staleMs / 1000));
    const result = await this.db.execute(sql`
      INSERT INTO renewal_job_state AS r (name, last_run_day, started_at, finished_at)
      VALUES ('daily', ${today}::date, now(), NULL)
      ON CONFLICT (name) DO UPDATE SET
        users = CASE WHEN r.last_run_day = EXCLUDED.last_run_day THEN r.users ELSE 0 END,
        checked = CASE WHEN r.last_run_day = EXCLUDED.last_run_day THEN r.checked ELSE 0 END,
        found = CASE WHEN r.last_run_day = EXCLUDED.last_run_day THEN r.found ELSE 0 END,
        failures = CASE WHEN r.last_run_day = EXCLUDED.last_run_day THEN r.failures ELSE 0 END,
        reconnect_marked = CASE WHEN r.last_run_day = EXCLUDED.last_run_day THEN r.reconnect_marked ELSE 0 END,
        emails_sent = CASE WHEN r.last_run_day = EXCLUDED.last_run_day THEN r.emails_sent ELSE 0 END,
        last_run_day = EXCLUDED.last_run_day,
        started_at = EXCLUDED.started_at,
        finished_at = NULL
      WHERE r.last_run_day IS NULL
         OR r.last_run_day < EXCLUDED.last_run_day
         OR (r.last_run_day = EXCLUDED.last_run_day AND r.finished_at IS NULL
             AND r.started_at < now() - make_interval(secs => ${staleSeconds}))
      RETURNING r.name
    `);
    return (((result as any)?.rows ?? []) as any[]).length > 0;
  }

  /** Records the counts of the run that just ended (added to what an earlier, interrupted run of the same day recorded). */
  async finishRenewalRun(stats: { users: number; checked: number; found: number; failures: number; reconnectMarked: number; emailsSent: number }): Promise<void> {
    await this.db.execute(sql`
      UPDATE renewal_job_state SET
        finished_at = now(),
        users = users + ${stats.users},
        checked = checked + ${stats.checked},
        found = found + ${stats.found},
        failures = failures + ${stats.failures},
        reconnect_marked = reconnect_marked + ${stats.reconnectMarked},
        emails_sent = emails_sent + ${stats.emailsSent}
      WHERE name = 'daily'
    `);
  }

  /** The last run's numbers and the mailboxes waiting to be reconnected, for the admin console. */
  async getRenewalSummary(): Promise<{
    lastRunDay: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    users: number;
    checked: number;
    found: number;
    failures: number;
    reconnectMarked: number;
    emailsSent: number;
    mailboxesNeedingReconnect: number;
  }> {
    const run = await this.db.execute(sql`
      SELECT to_char(last_run_day, 'YYYY-MM-DD') AS last_run_day, started_at, finished_at,
             users, checked, found, failures, reconnect_marked, emails_sent
      FROM renewal_job_state WHERE name = 'daily'
    `);
    const flagged = await this.db.execute(sql`SELECT count(*)::int AS n FROM mailbox_reconnect_state`);
    const row = ((run as any)?.rows ?? [])[0] as any;
    const iso = (v: any) => (v ? new Date(v).toISOString() : null);
    return {
      lastRunDay: row?.last_run_day ?? null,
      startedAt: iso(row?.started_at),
      finishedAt: iso(row?.finished_at),
      users: Number(row?.users ?? 0),
      checked: Number(row?.checked ?? 0),
      found: Number(row?.found ?? 0),
      failures: Number(row?.failures ?? 0),
      reconnectMarked: Number(row?.reconnect_marked ?? 0),
      emailsSent: Number(row?.emails_sent ?? 0),
      mailboxesNeedingReconnect: Number((((flagged as any)?.rows ?? [])[0] as any)?.n ?? 0),
    };
  }

  /** Everyone who has at least one subscription: the people the daily job considers (each is then switch-checked). */
  async getUserIdsWithSubscriptions(): Promise<string[]> {
    const result = await this.db.execute(sql`SELECT DISTINCT user_id FROM subscriptions ORDER BY user_id`);
    return (((result as any)?.rows ?? []) as any[]).map((r) => String(r.user_id));
  }

  async getRenewalCheckStates(userId: string): Promise<{
    subscriptionId: string;
    cycleRenewalOn: string | null;
    attempts: number;
    firstAttemptOn: string | null;
    lastCheckedOn: string | null;
    nextCheckOn: string | null;
    errorCount: number;
  }[]> {
    const result = await this.db.execute(sql`
      SELECT subscription_id, to_char(cycle_renewal_on, 'YYYY-MM-DD') AS cycle_renewal_on, attempts,
             to_char(first_attempt_on, 'YYYY-MM-DD') AS first_attempt_on,
             to_char(last_checked_on, 'YYYY-MM-DD') AS last_checked_on,
             to_char(next_check_on, 'YYYY-MM-DD') AS next_check_on, error_count
      FROM renewal_check_state WHERE user_id = ${userId}
    `);
    return (((result as any)?.rows ?? []) as any[]).map((r) => ({
      subscriptionId: String(r.subscription_id),
      cycleRenewalOn: r.cycle_renewal_on ?? null,
      attempts: Number(r.attempts ?? 0),
      firstAttemptOn: r.first_attempt_on ?? null,
      lastCheckedOn: r.last_checked_on ?? null,
      nextCheckOn: r.next_check_on ?? null,
      errorCount: Number(r.error_count ?? 0),
    }));
  }

  async saveRenewalCheckState(
    userId: string,
    s: { subscriptionId: string; cycleRenewalOn: string | null; attempts: number; firstAttemptOn: string | null; lastCheckedOn: string | null; nextCheckOn: string | null; errorCount: number },
    lastError: string | null = null,
  ): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO renewal_check_state AS c
        (subscription_id, user_id, cycle_renewal_on, attempts, first_attempt_on, last_checked_on, last_checked_at, next_check_on, error_count, last_error)
      VALUES
        (${s.subscriptionId}, ${userId}, ${s.cycleRenewalOn}::date, ${s.attempts}, ${s.firstAttemptOn}::date, ${s.lastCheckedOn}::date, now(),
         ${s.nextCheckOn}::date, ${s.errorCount}, ${lastError})
      ON CONFLICT (subscription_id) DO UPDATE SET
        cycle_renewal_on = EXCLUDED.cycle_renewal_on, attempts = EXCLUDED.attempts, first_attempt_on = EXCLUDED.first_attempt_on,
        last_checked_on = EXCLUDED.last_checked_on, last_checked_at = EXCLUDED.last_checked_at, next_check_on = EXCLUDED.next_check_on,
        error_count = EXCLUDED.error_count, last_error = EXCLUDED.last_error
    `);
  }

  /** Mailboxes (by "provider:id") flagged as needing a reconnect, all people. */
  async getReconnectFlags(userId: string): Promise<{ accountId: string; provider: string; flaggedAt: Date }[]> {
    const result = await this.db.execute(sql`
      SELECT account_id, provider, flagged_at FROM mailbox_reconnect_state WHERE user_id = ${userId}
    `);
    return (((result as any)?.rows ?? []) as any[]).map((r) => ({
      accountId: String(r.account_id),
      provider: String(r.provider),
      flaggedAt: new Date(r.flagged_at),
    }));
  }

  async flagMailboxNeedsReconnect(userId: string, accountId: string, provider: string): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO mailbox_reconnect_state (account_id, provider, user_id) VALUES (${accountId}, ${provider}, ${userId})
      ON CONFLICT (account_id, provider) DO NOTHING
    `);
  }

  /** Called when the mailbox's tokens are replaced through the connect flow. Never throws: it must not break connecting. */
  async clearMailboxNeedsReconnect(accountId: string, provider: string): Promise<void> {
    try {
      await this.db.execute(sql`DELETE FROM mailbox_reconnect_state WHERE account_id = ${accountId} AND provider = ${provider}`);
    } catch (error) {
      console.error('[Renewal] Could not clear a mailbox reconnect flag (non-fatal):', error);
    }
  }

  async getReconnectEmailLastSent(userId: string): Promise<Date | null> {
    const result = await this.db.execute(sql`SELECT last_sent_at FROM reconnect_email_state WHERE user_id = ${userId}`);
    const row = ((result as any)?.rows ?? [])[0] as any;
    return row?.last_sent_at ? new Date(row.last_sent_at) : null;
  }

  async markReconnectEmailSent(userId: string): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO reconnect_email_state (user_id, last_sent_at) VALUES (${userId}, now())
      ON CONFLICT (user_id) DO UPDATE SET last_sent_at = EXCLUDED.last_sent_at
    `);
  }

  // ---------------------------------------------------------------------
  // History search (also only for users with `subscription_status` on)
  // ---------------------------------------------------------------------

  /**
   * Marks subscriptions of this user as waiting for a history search and
   * returns the ids marked. Without `force`, only ones never searched (or
   * whose search failed); with it, anything not already queued or running.
   */
  async markHistoryPending(userId: string, subscriptionIds: string[], force = false): Promise<string[]> {
    if (subscriptionIds.length === 0) return [];
    const eligible = force
      ? sql`(${subscriptions.historyStatus} IS NULL OR ${subscriptions.historyStatus} IN ('done', 'failed'))`
      : sql`(${subscriptions.historyStatus} IS NULL OR ${subscriptions.historyStatus} = 'failed')`;
    const rows = await this.db
      .update(subscriptions)
      .set({
        historyStatus: 'pending',
        historyAttempts: 0,
        historyError: null,
        historyStartedAt: null,
        historyFinishedAt: null,
        historyRead: null,
        historySaved: null,
        historySkipped: 0,
        historyPartial: false,
      })
      .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.id, subscriptionIds), eligible))
      .returning({ id: subscriptions.id });
    return rows.map((r: { id: string }) => r.id);
  }

  /**
   * Forgets what the history search recorded for these subscriptions so a
   * fresh search starts clean: their history-sourced payments, and the emails
   * only those payments pointed at (a search skips emails already stored, so
   * leaving them would make the redo find nothing). Payments from the sync or
   * an approval, and the emails behind them, are kept. Returns how many
   * payments and emails were removed. Bank alerts kept as fingerprinted payments
   * (no email, see server/lib/bankAlert.ts) are history-sourced too and go with them.
   */
  async clearHistoryFindings(userId: string, subscriptionIds: string[]): Promise<{ payments: number; emails: number }> {
    if (subscriptionIds.length === 0) return { payments: 0, emails: 0 };
    const rows = await this.db
      .delete(payments)
      .where(and(eq(payments.userId, userId), eq(payments.source, 'history'), inArray(payments.subscriptionId, subscriptionIds)))
      .returning({ emailId: payments.emailId });
    const emailIds: string[] = Array.from(new Set<string>(rows.map((r: { emailId: string | null }) => r.emailId).filter((id: string | null): id is string => !!id)));
    let removedEmails = 0;
    if (emailIds.length > 0) {
      const stillUsed = await this.db
        .select({ emailId: payments.emailId })
        .from(payments)
        .where(and(eq(payments.userId, userId), inArray(payments.emailId, emailIds)));
      const keep = new Set(stillUsed.map((r: { emailId: string | null }) => r.emailId));
      const toDelete = emailIds.filter((id) => !keep.has(id));
      if (toDelete.length > 0) {
        const gone = await this.db
          .delete(emails)
          .where(and(eq(emails.userId, userId), inArray(emails.id, toDelete)))
          .returning({ id: emails.id });
        removedEmails = gone.length;
      }
    }
    return { payments: rows.length, emails: removedEmails };
  }

  /** Writes history-search fields on one of this user's subscriptions. */
  async updateHistoryFields(
    id: string,
    userId: string,
    fields: Partial<Pick<Subscription,
      'historyStatus' | 'historySearchedSince' | 'historyAttempts' | 'historyError' | 'historyStartedAt' | 'historyFinishedAt' |
      'historyRead' | 'historySaved' | 'historySkipped' | 'historyPartial'>>,
  ): Promise<void> {
    await this.db
      .update(subscriptions)
      .set(fields)
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)));
  }

  /** Every queued or running search, across all users (read at boot). */
  async getUnfinishedHistorySearches(): Promise<{
    id: string; userId: string; historyStatus: string | null; historyAttempts: number; historyStartedAt: Date | null;
  }[]> {
    return this.db
      .select({
        id: subscriptions.id,
        userId: subscriptions.userId,
        historyStatus: subscriptions.historyStatus,
        historyAttempts: subscriptions.historyAttempts,
        historyStartedAt: subscriptions.historyStartedAt,
      })
      .from(subscriptions)
      .where(inArray(subscriptions.historyStatus, ['pending', 'running']));
  }

  /** The senders of the emails linked to one subscription, newest first. */
  async getLinkedSenders(userId: string, subscriptionId: string): Promise<string[]> {
    const rows = await this.db
      .select({ fromEmail: emails.fromEmail })
      .from(emails)
      .where(and(eq(emails.userId, userId), eq(emails.subscriptionId, subscriptionId)))
      .orderBy(desc(emails.receivedAt))
      .limit(200);
    return rows.map((r: { fromEmail: string }) => r.fromEmail);
  }

  /** The senders of the emails linked to each of this user's subscriptions (newest first, up to 200 each). */
  async getLinkedSendersBySubscription(userId: string): Promise<Map<string, string[]>> {
    const rows = await this.db
      .select({ subscriptionId: emails.subscriptionId, fromEmail: emails.fromEmail })
      .from(emails)
      .where(and(eq(emails.userId, userId), isNotNull(emails.subscriptionId)))
      .orderBy(desc(emails.receivedAt))
      .limit(5000);
    const bySub = new Map<string, string[]>();
    for (const row of rows as { subscriptionId: string; fromEmail: string }[]) {
      const list = bySub.get(row.subscriptionId) ?? [];
      if (list.length < 200) list.push(row.fromEmail);
      bySub.set(row.subscriptionId, list);
    }
    return bySub;
  }

  /**
   * Remembers a name a subscription has had (a rename's old name, or the name
   * it was approved under). Names repeat ignoring case, kept once.
   */
  async rememberSubscriptionName(
    userId: string,
    subscriptionId: string,
    name: string,
    origin: 'approval' | 'rename',
  ): Promise<void> {
    const clean = name.trim();
    if (!clean) return;
    await this.db
      .insert(subscriptionNameHistory)
      .values({ userId, subscriptionId, name: clean, origin })
      .onConflictDoNothing();
  }

  /** The names remembered for a subscription, oldest first. */
  async getRememberedNames(userId: string, subscriptionId: string): Promise<{ name: string; origin: string }[]> {
    return this.db
      .select({ name: subscriptionNameHistory.name, origin: subscriptionNameHistory.origin })
      .from(subscriptionNameHistory)
      .where(and(eq(subscriptionNameHistory.userId, userId), eq(subscriptionNameHistory.subscriptionId, subscriptionId)))
      .orderBy(asc(subscriptionNameHistory.createdAt));
  }

  /** Invoice rows for files stored on these emails (a history search's finds). */
  async fileInvoicesForEmails(
    userId: string,
    subscription: { id: string; serviceName: string; amount: string; merchantName?: string | null },
    emailIds: string[],
  ): Promise<{ created: number; skipped: number; emailsWithFiles: number }> {
    if (emailIds.length === 0) return { created: 0, skipped: 0, emailsWithFiles: 0 };
    return this.createInvoicesFromAttachments(userId, subscription, null, emailIds);
  }

  /** Inserts payments, skipping any email already recorded for that subscription. */
  async insertPayments(rows: InsertPayment[]): Promise<number> {
    if (rows.length === 0) return 0;
    const inserted = await this.db
      .insert(payments)
      .values(rows)
      .onConflictDoNothing({ target: [payments.subscriptionId, payments.emailId] })
      .returning({ id: payments.id });
    return inserted.length;
  }

  async getPaymentsForUser(userId: string): Promise<Payment[]> {
    return this.db.select().from(payments).where(eq(payments.userId, userId));
  }

  /** Subject lines only (never the body), for this person's own emails. */
  async getEmailSubjects(userId: string, emailIds: string[]): Promise<Map<string, string>> {
    if (emailIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: emails.id, subject: emails.subject })
      .from(emails)
      .where(and(eq(emails.userId, userId), inArray(emails.id, emailIds)));
    return new Map(rows.map((r: { id: string; subject: string }) => [r.id, r.subject] as [string, string]));
  }

  /**
   * Payments saved at an approval or a sync (never a history search's) for
   * these subscriptions, each with the stored email it was read from. Rows
   * without an email are left out: there is nothing to read again.
   */
  async getStoredPaymentsWithEmails(
    userId: string,
    subscriptionIds: string[],
  ): Promise<{ payment: Payment; email: PaymentSourceEmail; subscriptionCurrency: string }[]> {
    if (subscriptionIds.length === 0) return [];
    const rows = await this.db
      .select({
        payment: payments,
        subscriptionCurrency: subscriptions.currency,
        id: emails.id,
        subject: emails.subject,
        content: sql<string | null>`left(${emails.content}, 1500)`,
        receivedAt: emails.receivedAt,
        extractedAmount: emails.extractedAmount,
        extractedCurrency: emails.extractedCurrency,
        attachmentData: sql<string | null>`CASE WHEN length(${emails.attachmentData}) <= 400000 THEN ${emails.attachmentData} END`,
      })
      .from(payments)
      .innerJoin(emails, and(eq(emails.id, payments.emailId), eq(emails.userId, userId)))
      .innerJoin(subscriptions, and(eq(subscriptions.id, payments.subscriptionId), eq(subscriptions.userId, userId)))
      .where(and(
        eq(payments.userId, userId),
        inArray(payments.subscriptionId, subscriptionIds),
        inArray(payments.source, ['sync', 'approval']),
      ));
    return rows.map((r: any) => ({
      payment: r.payment as Payment,
      subscriptionCurrency: r.subscriptionCurrency as string,
      email: {
        id: r.id,
        subject: r.subject,
        content: r.content,
        receivedAt: r.receivedAt,
        extractedAmount: r.extractedAmount,
        extractedCurrency: r.extractedCurrency,
        attachmentText: attachmentTextOf(r.attachmentData),
      },
    }));
  }

  /**
   * Applies a re-reading of stored payments: new values for some rows, and
   * some rows deleted. Only payment rows change; emails are never touched.
   */
  async applyPaymentRereads(
    userId: string,
    updates: { id: string; fields: Partial<InsertPayment> }[],
    removeIds: string[],
  ): Promise<void> {
    for (const u of updates) {
      await this.db.update(payments).set(u.fields).where(and(eq(payments.id, u.id), eq(payments.userId, userId)));
    }
    if (removeIds.length > 0) {
      await this.db.delete(payments).where(and(eq(payments.userId, userId), inArray(payments.id, removeIds)));
    }
  }

  /** Subject and the start of the body of every stored email of this person (for the credit card clean-up). */
  async getEmailsForCreditCardCheck(userId: string): Promise<{ id: string; subject: string; content: string | null }[]> {
    return this.db
      .select({ id: emails.id, subject: emails.subject, content: sql<string | null>`left(${emails.content}, 1500)` })
      .from(emails)
      .where(eq(emails.userId, userId));
  }

  /** Deletes these emails of this person and the payments read from them. Returns the counts. */
  async deleteEmailsWithPayments(userId: string, emailIds: string[]): Promise<{ emails: number; payments: number }> {
    if (emailIds.length === 0) return { emails: 0, payments: 0 };
    let removedPayments = 0;
    let removedEmails = 0;
    for (let i = 0; i < emailIds.length; i += 500) {
      const chunk = emailIds.slice(i, i + 500);
      const p = await this.db
        .delete(payments)
        .where(and(eq(payments.userId, userId), inArray(payments.emailId, chunk)))
        .returning({ id: payments.id });
      const e = await this.db
        .delete(emails)
        .where(and(eq(emails.userId, userId), inArray(emails.id, chunk)))
        .returning({ id: emails.id });
      removedPayments += p.length;
      removedEmails += e.length;
    }
    return { emails: removedEmails, payments: removedPayments };
  }

  /**
   * Inserts bank-alert payments (no email row): one per (subscription,
   * fingerprint), a repeat is skipped. Returns how many were new.
   */
  async insertFingerprintedPayments(rows: InsertPayment[]): Promise<number> {
    if (rows.length === 0) return 0;
    const inserted = await this.db
      .insert(payments)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: payments.id });
    return inserted.length;
  }

  /** Fingerprints already recorded for a subscription. */
  async getEvidenceFingerprints(userId: string, subscriptionId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ f: payments.evidenceFingerprint })
      .from(payments)
      .where(and(eq(payments.userId, userId), eq(payments.subscriptionId, subscriptionId), sql`${payments.evidenceFingerprint} IS NOT NULL`));
    return new Set<string>(rows.map((r: { f: string | null }) => r.f as string));
  }

  /** What the bank-mail clean-up needs of each stored email: ids, sender, subject and the start of the body. No attachments. */
  async getEmailsForBankCheck(userId: string): Promise<{
    id: string; gmailId: string; emailProvider: string | null; fromEmail: string; subject: string; content: string | null;
  }[]> {
    return this.db
      .select({
        id: emails.id,
        gmailId: emails.gmailId,
        emailProvider: emails.emailProvider,
        fromEmail: emails.fromEmail,
        subject: emails.subject,
        content: sql<string | null>`left(${emails.content}, 1500)`,
      })
      .from(emails)
      .where(eq(emails.userId, userId));
  }

  /** This person's payments that point at any of these emails. */
  async getPaymentsForEmailIds(userId: string, emailIds: string[]): Promise<Payment[]> {
    const out: Payment[] = [];
    for (let i = 0; i < emailIds.length; i += 500) {
      const chunk = emailIds.slice(i, i + 500);
      out.push(...(await this.db.select().from(payments).where(and(eq(payments.userId, userId), inArray(payments.emailId, chunk)))));
    }
    return out;
  }

  /** The attachment data of these emails, a few at a time (it can be large). Calls back with each one's data. */
  async forEachAttachmentData(userId: string, emailIds: string[], fn: (attachmentData: string | null) => void | Promise<void>): Promise<void> {
    for (let i = 0; i < emailIds.length; i += 10) {
      const chunk = emailIds.slice(i, i + 10);
      const rows = await this.db
        .select({ attachmentData: emails.attachmentData })
        .from(emails)
        .where(and(eq(emails.userId, userId), inArray(emails.id, chunk)));
      for (const row of rows) await fn(row.attachmentData);
    }
  }

  /** Every invoice row of a person, for the duplicate clean-up. */
  async getInvoiceRowsForDuplicates(userId: string): Promise<InvoiceRowForDuplicates[]> {
    return this.db
      .select({
        id: invoices.id,
        subscriptionId: invoices.subscriptionId,
        fileName: invoices.fileName,
        fileSize: invoices.fileSize,
        fileUrl: invoices.fileUrl,
        source: invoices.source,
        uploadedAt: invoices.uploadedAt,
      })
      .from(invoices)
      .where(eq(invoices.userId, userId));
  }

  async deleteInvoicesByIds(userId: string, ids: string[]): Promise<number> {
    let removed = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const gone = await this.db
        .delete(invoices)
        .where(and(eq(invoices.userId, userId), inArray(invoices.id, ids.slice(i, i + 500))))
        .returning({ id: invoices.id });
      removed += gone.length;
    }
    return removed;
  }

  /** Invoices filed from files that are being deleted. */
  async deleteInvoicesByFileUrls(userId: string, fileUrls: string[]): Promise<number> {
    let removed = 0;
    for (let i = 0; i < fileUrls.length; i += 500) {
      const gone = await this.db
        .delete(invoices)
        .where(and(eq(invoices.userId, userId), inArray(invoices.fileUrl, fileUrls.slice(i, i + 500))))
        .returning({ id: invoices.id });
      removed += gone.length;
    }
    return removed;
  }

  /**
   * Suggestions that cited any of these provider message ids: the model-written
   * notes (reasoning, sender history, attachment evidence) are cleared and the
   * ids removed from evidence_email_ids. The service, merchant, amount,
   * currency, frequency and the remaining ids stay. Returns how many suggestions changed.
   */
  async clearSuggestionsCiting(userId: string, messageIds: string[]): Promise<number> {
    let changed = 0;
    for (let i = 0; i < messageIds.length; i += 500) {
      const list = sql`ARRAY[${sql.join(messageIds.slice(i, i + 500).map((id) => sql`${id}`), sql`, `)}]::text[]`;
      const result = await this.db.execute(sql`
        UPDATE subscription_suggestions
        SET reasoning = NULL,
            sender_history = NULL,
            attachment_evidence = NULL,
            evidence_email_ids = ARRAY(SELECT x FROM unnest(evidence_email_ids) AS x WHERE NOT (x = ANY(${list})))
        WHERE user_id = ${userId} AND evidence_email_ids && ${list}
        RETURNING id
      `);
      changed += (result as any).rows?.length ?? (result as any).rowCount ?? 0;
    }
    return changed;
  }

  /** Newest first. */
  async getPaymentsForSubscription(subscriptionId: string, userId: string): Promise<Payment[]> {
    return this.db
      .select()
      .from(payments)
      .where(and(eq(payments.subscriptionId, subscriptionId), eq(payments.userId, userId)))
      .orderBy(desc(payments.paidAt), desc(payments.createdAt));
  }

  /** What a payment is read from: the email's subject, the start of its body, amount and date. */
  async getEmailsForPayments(userId: string, gmailIds: string[]): Promise<PaymentSourceEmail[]> {
    if (gmailIds.length === 0) return [];
    return this.db
      .select({
        id: emails.id,
        subject: emails.subject,
        content: sql<string | null>`left(${emails.content}, 1500)`,
        receivedAt: emails.receivedAt,
        extractedAmount: emails.extractedAmount,
        extractedCurrency: emails.extractedCurrency,
        attachmentData: sql<string | null>`CASE WHEN length(${emails.attachmentData}) <= 400000 THEN ${emails.attachmentData} END`,
      })
      .from(emails)
      .where(and(eq(emails.userId, userId), inArray(emails.gmailId, gmailIds)))
      .then((rows: any[]) => rows.map(({ attachmentData, ...rest }) => ({ ...rest, attachmentText: attachmentTextOf(attachmentData) })));
  }

  /**
   * Emails already linked to one of this user's subscriptions (at an approval
   * before the switch was on) that have no payment row yet.
   */
  async getLinkedEmailsWithoutPayments(userId: string): Promise<(PaymentSourceEmail & { subscriptionId: string; subscriptionCurrency: string })[]> {
    const result = await this.db.execute(sql`
      SELECT e.id, e.subject, left(e.content, 1500) AS content,
             to_char(e.received_at, 'YYYY-MM-DD') AS received_day,
             e.extracted_amount, e.extracted_currency,
             CASE WHEN length(e.attachment_data) <= 400000 THEN e.attachment_data END AS attachment_data,
             s.id AS subscription_id, s.currency AS subscription_currency
      FROM emails e
      JOIN subscriptions s ON s.id = e.subscription_id AND s.user_id = ${userId}
      WHERE e.user_id = ${userId}
        AND NOT EXISTS (
          SELECT 1 FROM payments p WHERE p.subscription_id = s.id AND p.email_id = e.id
        )
      LIMIT 2000
    `);
    return (((result as any)?.rows ?? []) as any[]).map((row) => ({
      id: row.id,
      subject: row.subject,
      content: row.content,
      receivedAt: row.received_day,
      extractedAmount: row.extracted_amount,
      extractedCurrency: row.extracted_currency,
      attachmentText: attachmentTextOf(row.attachment_data),
      subscriptionId: row.subscription_id,
      subscriptionCurrency: row.subscription_currency,
    }));
  }

  /**
   * The tracked subscription a new detection is about, if any: the same
   * service key, or failing that a near-identical name at the same frequency.
   * The amount is deliberately not compared -- a price change is still the
   * same subscription, and its receipts belong to it.
   */
  async findSubscriptionForDetection(
    userId: string,
    serviceName: string,
    serviceKey: string,
    frequency: string,
  ): Promise<{ id: string; currency: string } | null> {
    const rows: { id: string; serviceName: string; serviceKey: string; frequency: string; currency: string }[] = await this.db
      .select({
        id: subscriptions.id,
        serviceName: subscriptions.serviceName,
        serviceKey: subscriptions.serviceKey,
        frequency: subscriptions.frequency,
        currency: subscriptions.currency,
      })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId));

    const byKey = rows.find((row) => row.serviceKey === serviceKey);
    if (byKey) return { id: byKey.id, currency: byKey.currency };

    let best: { id: string; currency: string; score: number } | null = null;
    for (const row of rows) {
      if (row.frequency !== frequency) continue;
      const score = this.calculateSimilarity(serviceName, row.serviceName);
      if (score > 0.85 && (!best || score > best.score)) best = { id: row.id, currency: row.currency, score };
    }
    return best ? { id: best.id, currency: best.currency } : null;
  }

  /** Writes status fields on one of this user's subscriptions. */
  async updateSubscriptionStatusFields(
    id: string,
    userId: string,
    fields: Partial<Pick<Subscription,
      'lifecycleStatus' | 'lifecycleReason' | 'lifecycleUpdatedAt' | 'lastPaymentAt' | 'expectedNextPaymentAt' |
      'endsOn' | 'cancelledAt' | 'inactiveSince' | 'inactiveSource' | 'stillActiveTaps' | 'stillActiveUntil'>>,
  ): Promise<Subscription | undefined> {
    const result = await this.db
      .update(subscriptions)
      .set(fields)
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)))
      .returning();
    return result[0];
  }

  /** Every mailbox's health, without any token column. */
  async getMailboxHealth(userId: string): Promise<{ id: string; syncStatus: string; lastSync: Date | null }[]> {
    const [gmail, outlook] = await Promise.all([
      this.db
        .select({ id: gmailAccounts.id, syncStatus: gmailAccounts.syncStatus, lastSync: gmailAccounts.lastSync })
        .from(gmailAccounts)
        .where(eq(gmailAccounts.userId, userId)),
      this.db
        .select({ id: outlookAccounts.id, syncStatus: outlookAccounts.syncStatus, lastSync: outlookAccounts.lastSync })
        .from(outlookAccounts)
        .where(eq(outlookAccounts.userId, userId)),
    ]);
    return [...gmail, ...outlook];
  }

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
        .select({
          id: subscriptionSuggestions.id,
          userId: subscriptionSuggestions.userId,
          serviceKey: subscriptionSuggestions.serviceKey,
          evidenceEmailIds: subscriptionSuggestions.evidenceEmailIds,
        })
        .from(subscriptionSuggestions)
        .where(
          and(
            inArray(subscriptionSuggestions.userId, userIds),
            eq(subscriptionSuggestions.status, 'pending')
          )
        );

      type PendingRow = { id: string; userId: string; serviceKey: string; evidenceEmailIds: string[] | null };
      const pending = new Map<string, PendingRow>(
        existing.map((row: PendingRow) => [`${row.userId}::${row.serviceKey}`, row])
      );

      const fresh = withinBatch.filter(s => !pending.has(`${s.userId}::${s.serviceKey}`));
      const alreadyPending = withinBatch.length - fresh.length;
      if (alreadyPending > 0) {
        console.log(`🔀 Skipped ${alreadyPending} suggestion(s) already awaiting review`);
      }

      // The card already waiting is kept, but if it has no evidence and this
      // run found some, it takes the new evidence. Otherwise a card saved
      // before its emails could be found would stay empty however many times
      // the mailbox is synced again.
      for (const s of withinBatch) {
        const held = pending.get(`${s.userId}::${s.serviceKey}`);
        const found = s.evidenceEmailIds ?? [];
        if (!held || found.length === 0 || (held.evidenceEmailIds?.length ?? 0) > 0) continue;
        try {
          await this.db
            .update(subscriptionSuggestions)
            .set({ evidenceEmailIds: found, lastSeen: new Date() })
            .where(and(eq(subscriptionSuggestions.id, held.id), eq(subscriptionSuggestions.userId, s.userId)));
          console.log(`🧾 ${s.serviceName}: waiting card had no evidence, took ${found.length} email(s) from this run`);
        } catch (error) {
          console.error(`Could not add evidence to the waiting ${s.serviceName} card:`, error);
        }
      }

      return fresh;
    } catch (error) {
      // Duplicates in the review list are a nuisance; losing real detections is
      // not. On a lookup failure, insert what we have.
      console.error('Error checking existing suggestions, inserting without that filter:', error);
      return withinBatch;
    }
  }

  async approveSuggestions(suggestionIds: string[], userId: string): Promise<{ subscriptions: Subscription[]; createdSubscriptionIds: string[]; approved: number }> {
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
        return { subscriptions: [], createdSubscriptionIds: [], approved: 0 };
      }
      
      const createdSubscriptions: Subscription[] = [];
      /* Which of the subscriptions above this approval brought into being, as
         opposed to ones it merged into. createSubscription folds a duplicate
         into the subscription already tracked, and undoing an approval must
         never delete that: it existed before anyone pressed Approve. */
      const createdSubscriptionIds: string[] = [];
      /* What the status recorder needs from each approval. Only read when the
         user has the subscription_status switch on; see below. */
      const approvedForStatus: ApprovedForStatus[] = [];
      
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
          merchantEmail: await this.senderOfEvidence(userId, suggestion.evidenceEmailIds, {
            merchantName: suggestion.merchantName,
            serviceName: suggestion.serviceName,
          }),
        };
        
        // Asked with exactly the arguments createSubscription uses, so the
        // answer is the branch it is about to take.
        const alreadyTracked = await this.findDuplicateSubscription(
          subscriptionData.userId,
          subscriptionData.serviceName,
          subscriptionData.amount,
          subscriptionData.currency || 'INR',
          subscriptionData.frequency
        );

        // Use createSubscription method which has deduplication logic
        const createdSubscription = await this.createSubscription(subscriptionData);
        createdSubscriptions.push(createdSubscription);
        if (!alreadyTracked) createdSubscriptionIds.push(createdSubscription.id);
        approvedForStatus.push({
          subscriptionId: createdSubscription.id,
          currency: createdSubscription.currency,
          approvedName: suggestion.serviceName,
          evidenceEmailIds: suggestion.evidenceEmailIds ?? [],
          cancelledOn: suggestion.cancelledOn ?? null,
          accessEndsOn: suggestion.accessEndsOn ?? null,
        });
        
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

      // Payments and status, recorded quietly for users with the
      // subscription_status switch; a no-op for everyone else. It never
      // fails an approval: anything that goes wrong is logged and dropped.
      try {
        const { recordAfterApproval } = await import('./services/subscriptionStatus');
        await recordAfterApproval(userId, approvedForStatus);
      } catch (statusError) {
        console.error('[Status] Could not record payments after approval (non-fatal):', statusError);
      }
      
      return { subscriptions: createdSubscriptions, createdSubscriptionIds, approved: suggestions.length };
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

  /**
   * Put approved or rejected suggestions back in the inbox, as if nobody had
   * pressed the button.
   *
   * A rejection only needs its status reset. An approval also created a
   * subscription, which has to go -- but only one this approval created.
   * Approving something already tracked merges into the existing subscription
   * rather than making a new one, and deleting that would take away something
   * the person had before they opened the inbox. So the caller passes the ids
   * approve reported as created, and each is checked here against the
   * suggestions being undone: it must belong to this user and carry one of
   * their service keys, or it is left alone.
   *
   * Invoice ROWS go with the subscription; invoice FILES do not. The files
   * were uploaded during the sync and the synced emails still point at them,
   * so approving the same card again rebuilds its invoices from those same
   * files. deleteSubscription removes the files too, which is right for a
   * deliberate delete and wrong here.
   *
   * The suggestion is restored first. There are no transactions on this
   * driver, so the order decides what a failure halfway leaves behind: a
   * pending suggestion beside a subscription that still exists is harmless --
   * approving it again merges into that subscription -- whereas a deleted
   * subscription beside a suggestion still marked approved would vanish from
   * both screens at once.
   */
  async undoSuggestionDecisions(
    userId: string,
    suggestionIds: string[],
    createdSubscriptionIds: string[],
  ): Promise<{ restored: number; removed: number }> {
    if (suggestionIds.length === 0) return { restored: 0, removed: 0 };

    const decided = await this.db
      .select({ id: subscriptionSuggestions.id, serviceKey: subscriptionSuggestions.serviceKey })
      .from(subscriptionSuggestions)
      .where(
        and(
          inArray(subscriptionSuggestions.id, suggestionIds),
          eq(subscriptionSuggestions.userId, userId),
          inArray(subscriptionSuggestions.status, ['approved', 'rejected']),
        ),
      );
    if (decided.length === 0) return { restored: 0, removed: 0 };

    const restored = await this.db
      .update(subscriptionSuggestions)
      .set({ status: 'pending' })
      .where(
        and(
          inArray(subscriptionSuggestions.id, decided.map((d: { id: string }) => d.id)),
          eq(subscriptionSuggestions.userId, userId),
        ),
      );

    const keys = new Set(decided.map((d: { serviceKey: string | null }) => d.serviceKey).filter(Boolean));
    let removed = 0;

    if (createdSubscriptionIds.length > 0) {
      const candidates = await this.db
        .select({ id: subscriptions.id, serviceKey: subscriptions.serviceKey })
        .from(subscriptions)
        .where(and(inArray(subscriptions.id, createdSubscriptionIds), eq(subscriptions.userId, userId)));

      for (const sub of candidates) {
        if (!sub.serviceKey || !keys.has(sub.serviceKey)) {
          console.warn(`Undo refused to remove subscription ${sub.id}: it does not belong to the suggestions being undone`);
          continue;
        }
        await this.db.delete(invoices).where(and(eq(invoices.subscriptionId, sub.id), eq(invoices.userId, userId)));
        await this.db
          .update(emails)
          .set({ subscriptionId: null })
          .where(and(eq(emails.subscriptionId, sub.id), eq(emails.userId, userId)));
        await this.db.delete(subscriptions).where(and(eq(subscriptions.id, sub.id), eq(subscriptions.userId, userId)));
        removed++;
      }
    }

    return { restored: restored.rowCount || decided.length, removed };
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
  async getSubscriptionStats(userId: string, preferredCurrency: string = 'INR', byLifecycle: boolean = false): Promise<{
    totalMonthly: number;
    activeCount: number;
    emailsAnalyzed: number;
    avgPerService: number;
    newThisMonth: number;
    changePercent: number;
    unconvertedCurrencies: string[];
    needsReviewCount?: number;
    inactiveCount?: number;
  }> {
    try {
      const [userSubscriptions, emailCount] = await Promise.all([
        this.getSubscriptions(userId),
        this.db.select({ count: count() }).from(emails).where(eq(emails.userId, userId))
      ]);
      
      /*
       * By lifecycle (feature switch `subscription_status`): Active and
       * Needs review count, Inactive does not. A row the rules have not
       * reached yet falls back to the old `status`. Without the switch this is
       * the filter it always was.
       */
      const lifecycleOf = (sub: Subscription): string =>
        sub.lifecycleStatus ?? (sub.status === 'cancelled' || sub.status === 'ended' ? 'inactive' : 'active');
      const activeSubscriptions = byLifecycle
        ? userSubscriptions.filter(sub => lifecycleOf(sub) !== 'inactive')
        : userSubscriptions.filter(sub => sub.status === 'active');
      
      // Calculate subscriptions added in the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const newThisMonth = userSubscriptions.filter(sub => 
        sub.detectedAt && new Date(sub.detectedAt) >= thirtyDaysAgo
      ).length;
      
      /* Currencies that could not be converted into the one this account is
         read in, so the caller can say the total is missing something. */
      const unconvertible = new Set<string>();

      // Calculate current month's total
      const totalMonthly = activeSubscriptions.reduce((sum, sub) => {
        const amountNum = Number(sub.amount);
        
        // DATA SAFETY: Skip invalid/negative amounts (could be refunds/errors)
        if (!Number.isFinite(amountNum) || amountNum <= 0) {
          console.warn(`Skipping invalid subscription amount: ${sub.amount} for subscription ${sub.id}`);
          return sum;
        }
        
        /*
         * No rate between this subscription's currency and the one the
         * account is read in. It is left out of the total and counted, so
         * the dashboard can say the total is short rather than presenting an
         * incomplete figure as a complete one.
         */
        const convertedAmount = convertCurrency(amountNum, sub.currency, preferredCurrency);
        if (convertedAmount === null) {
          unconvertible.add(sub.currency || 'UNKNOWN');
          return sum;
        }

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
        if (convertedAmount === null) return sum;

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

      const countedCount = activeSubscriptions.length;
      // The tile says "Active": only those the rules call Active, so it matches
      // the dashboard's Active filter. The average is over everything counted.
      const activeCount = byLifecycle
        ? userSubscriptions.filter(sub => lifecycleOf(sub) === 'active').length
        : countedCount;
      const emailsAnalyzed = emailCount[0].count;
      const avgPerService = countedCount > 0 ? totalMonthly / countedCount : 0;

      return {
        ...(byLifecycle
          ? {
              needsReviewCount: userSubscriptions.filter(sub => lifecycleOf(sub) === 'needs_review').length,
              inactiveCount: userSubscriptions.filter(sub => lifecycleOf(sub) === 'inactive').length,
            }
          : {}),
        totalMonthly: Math.round(totalMonthly * 100) / 100,
        activeCount,
        emailsAnalyzed,
        avgPerService: Math.round(avgPerService * 100) / 100,
        newThisMonth,
        changePercent,
        unconvertedCurrencies: Array.from(unconvertible),
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
      ["payments", payments, payments.userId],
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