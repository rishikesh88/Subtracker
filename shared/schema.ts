import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, decimal, integer, boolean, index, uniqueIndex, jsonb, check, primaryKey, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Currency enum for validation
// Must match CURRENCIES in client/src/lib/currencies.ts; its test checks this.
export const currencyEnum = z.enum(["USD", "EUR", "GBP", "INR", "AED", "CAD", "AUD", "SGD", "JPY", "CNY"]);
export type Currency = z.infer<typeof currencyEnum>;

// Session storage table - Required for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table - Updated for Replit Auth + Email/Password
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  // Gmail integration fields (DEPRECATED - migrated to gmail_accounts table)
  gmailAccessToken: text("gmail_access_token"),
  gmailRefreshToken: text("gmail_refresh_token"),
  gmailTokenExpiry: timestamp("gmail_token_expiry"),
  gmailConnected: boolean("gmail_connected").default(false),
  gmailEmail: text("gmail_email"),
  lastSync: timestamp("last_sync"),
  // Currency preference
  preferredCurrency: text("preferred_currency").default("INR").notNull(),
  // Email sync settings
  emailSyncDays: integer("email_sync_days").default(90).notNull(), // Number of days to fetch emails (1-180)
  // Email+Password authentication
  passwordHash: text("password_hash"), // bcrypt hash for email+password auth (null for OAuth users)
  emailVerified: boolean("email_verified").default(false).notNull(), // Email verification status
  emailVerificationToken: text("email_verification_token"), // 6-digit verification code
  emailVerificationExpiry: timestamp("email_verification_expiry"), // Token expiry time
  // Onboarding fields
  organizationName: text("organization_name"),
  countryCode: text("country_code"), // ISO country code (US, GB, IN, etc.)
  accountHolderName: text("account_holder_name"),
  onboardingStatus: text("onboarding_status").default("pending").notNull(), // pending, org_complete, complete
  privacyConsentGiven: boolean("privacy_consent_given").default(false).notNull(),
});

// Verification Codes table - for email verification
export const verificationCodes = pgTable("verification_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  code: varchar("code", { length: 6 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_verification_codes_user_id").on(table.userId),
  index("idx_verification_codes_code").on(table.code),
]);

// Gmail Accounts table - supports multiple Gmail accounts per user
export const gmailAccounts = pgTable("gmail_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  gmailEmail: text("gmail_email").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  tokenExpiry: timestamp("token_expiry"),
  lastSync: timestamp("last_sync"),
  syncStatus: text("sync_status").default("idle").notNull(), // idle, syncing, success, error
  syncError: text("sync_error"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_gmail_accounts_user_id").on(table.userId),
  index("idx_gmail_accounts_user_email").on(table.userId, table.gmailEmail),
]);

// Outlook Accounts table - supports multiple Outlook/Microsoft 365 accounts per user
export const outlookAccounts = pgTable("outlook_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  outlookEmail: text("outlook_email").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  tokenExpiry: timestamp("token_expiry"),
  tenantId: text("tenant_id"), // For Work/School accounts (Microsoft 365)
  accountType: text("account_type").default("personal").notNull(), // 'personal' | 'work_school'
  lastSync: timestamp("last_sync"),
  syncStatus: text("sync_status").default("idle").notNull(), // idle, syncing, error
  syncError: text("sync_error"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_outlook_accounts_user_id").on(table.userId),
  index("idx_outlook_accounts_user_email").on(table.userId, table.outlookEmail),
  check("valid_account_type", sql`account_type IN ('personal', 'work_school')`),
]);

export const subscriptions = pgTable("subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  gmailAccountId: varchar("gmail_account_id"), // DEPRECATED: Legacy Gmail account link (nullable for backward compatibility)
  emailProvider: text("email_provider"), // 'gmail' | 'outlook' (nullable during migration)
  providerAccountId: varchar("provider_account_id"), // Polymorphic link to gmail_accounts.id OR outlook_accounts.id
  serviceName: text("service_name").notNull(),
  serviceKey: text("service_key").notNull(), // For deduplication: normalized service + frequency
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").default("INR").notNull(),
  frequency: text("frequency").notNull(), // monthly, yearly, weekly
  category: text("category"), // entertainment, software, utilities, etc.
  status: text("status").default("active").notNull(), // active, cancelled, expiring_soon
  merchantEmail: text("merchant_email"),
  merchantName: text("merchant_name"),
  occurrences: integer("occurrences").default(1), // Number of supporting emails
  nextBillingDate: timestamp("next_billing_date"),
  lastEmailDate: timestamp("last_email_date"),
  detectedAt: timestamp("detected_at").defaultNow(),
  // Ownership and details
  ownerName: text("owner_name"),
  ownerEmail: text("owner_email"),
  description: text("description"),

  /*
   * Subscription status (feature switch `subscription_status`). Written only
   * for users who have that switch on, by server/services/subscriptionStatus.ts
   * from the rules in server/lib/statusRules.ts; null for everyone else. They
   * sit beside `status` above and never change it. Added at startup by
   * storage.ensureSubscriptionStatusTables(), which must match these.
   */
  lifecycleStatus: text("lifecycle_status"), // active | needs_review | inactive
  lifecycleReason: text("lifecycle_reason"), // short code, see REASON_TEXT in statusRules.ts
  lifecycleUpdatedAt: timestamp("lifecycle_updated_at"),
  lastPaymentAt: date("last_payment_at"),
  expectedNextPaymentAt: date("expected_next_payment_at"),
  endsOn: date("ends_on"), // access ends after a cancellation
  cancelledAt: date("cancelled_at"),
  inactiveSince: date("inactive_since"),
  inactiveSource: text("inactive_source"), // email | user
  stillActiveTaps: integer("still_active_taps").default(0).notNull(),
  stillActiveUntil: date("still_active_until"),

  /*
   * One-time history search (also only for users with `subscription_status`
   * on; see server/services/historySearch.ts). Null until a search is queued.
   * Added at startup by storage.ensureSubscriptionStatusTables().
   */
  historyStatus: text("history_status"), // pending | running | done | failed
  historySearchedSince: date("history_searched_since"), // earliest day actually searched
  historyAttempts: integer("history_attempts").default(0).notNull(),
  historyError: text("history_error"), // plain words: why it failed, or a note on a skipped search
  historyStartedAt: timestamp("history_started_at"), // start of the latest attempt
  historyFinishedAt: timestamp("history_finished_at"),
}, (table) => [
  index("idx_subscriptions_user_provider").on(table.userId, table.emailProvider),
  index("idx_subscriptions_provider_account").on(table.providerAccountId),
  check("valid_email_provider", sql`email_provider IS NULL OR email_provider IN ('gmail', 'outlook')`),
  check("provider_fields_sync", sql`(email_provider IS NULL) = (provider_account_id IS NULL)`),
  check("subscriptions_lifecycle_status_check", sql`lifecycle_status IS NULL OR lifecycle_status IN ('active', 'needs_review', 'inactive')`),
  check("subscriptions_inactive_source_check", sql`inactive_source IS NULL OR inactive_source IN ('email', 'user')`),
  check("subscriptions_history_status_check", sql`history_status IS NULL OR history_status IN ('pending', 'running', 'done', 'failed')`),
]);

/**
 * One row per sync run.
 *
 * Two jobs it does. It records honestly whether a sync finished: `lastSync` was
 * previously written when a sync *started*, so a crash was indistinguishable
 * from success. And it enforces one run at a time per user -- the partial unique
 * index below means a second trigger is rejected by the database rather than by
 * a check-then-insert that two requests can both pass.
 */
export const syncJobs = pgTable("sync_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  /** running | succeeded | failed */
  status: text("status").notNull().default('running'),
  triggerSource: text("trigger_source"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  error: text("error"),
  emailsProcessed: integer("emails_processed").default(0),
  suggestionsGenerated: integer("suggestions_generated").default(0),
}, (table) => [
  // The concurrency guard itself. Postgres allows only one running row per
  // user; finished rows are unconstrained, so history accumulates freely.
  uniqueIndex("uq_sync_jobs_one_running_per_user")
    .on(table.userId)
    .where(sql`status = 'running'`),
  index("idx_sync_jobs_user_started").on(table.userId, table.startedAt),
]);

/**
 * Provider message IDs this user's sync has already screened.
 *
 * Distinct from `emails`, which holds only the small subset that survives the
 * AI pre-filter and gets fully fetched -- roughly 120 rows against a 2,500
 * message window. Skipping work on the basis of `emails` therefore skips almost
 * nothing; the screened population is what a repeat sync needs to avoid.
 *
 * One row per message, no body, no metadata: the sync only ever asks "have I
 * looked at this id before".
 */
export const screenedMessages = pgTable("screened_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  provider: text("provider").notNull().default('gmail'),
  messageId: text("message_id").notNull(),
  screenedAt: timestamp("screened_at").defaultNow().notNull(),
}, (table) => [
  // Scoped per user, unlike emails.gmail_id which is globally unique. Two
  // mailboxes are free to carry the same provider id.
  uniqueIndex("uq_screened_user_provider_message").on(table.userId, table.provider, table.messageId),
  index("idx_screened_user_provider").on(table.userId, table.provider),
]);

export const emails = pgTable("emails", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  gmailAccountId: varchar("gmail_account_id"), // DEPRECATED: Legacy Gmail account link (nullable for backward compatibility)
  emailProvider: text("email_provider"), // 'gmail' | 'outlook' (nullable during migration)
  providerAccountId: varchar("provider_account_id"), // Polymorphic link to gmail_accounts.id OR outlook_accounts.id
  // Unique per account, not across the app: two Verloq accounts reading the
  // same mailbox each keep their own copy (uq_emails_user_gmail below).
  gmailId: text("gmail_id").notNull(),
  subject: text("subject").notNull(),
  fromEmail: text("from_email").notNull(),
  fromName: text("from_name"),
  receivedAt: timestamp("received_at").notNull(),
  content: text("content"),
  attachmentData: text("attachment_data"), // JSON array of attachment info
  isTransaction: boolean("is_transaction").default(false),
  extractedAmount: decimal("extracted_amount", { precision: 10, scale: 2 }),
  extractedCurrency: text("extracted_currency"),
  merchantName: text("merchant_name"),
  subscriptionId: varchar("subscription_id"),
  processed: boolean("processed").default(false),
  analyzedAt: timestamp("analyzed_at").defaultNow(),
}, (table) => [
  uniqueIndex("uq_emails_user_gmail").on(table.userId, table.gmailId),
  index("idx_emails_user_provider").on(table.userId, table.emailProvider),
  index("idx_emails_provider_account").on(table.providerAccountId),
  check("valid_email_provider", sql`email_provider IS NULL OR email_provider IN ('gmail', 'outlook')`),
  check("provider_fields_sync", sql`(email_provider IS NULL) = (provider_account_id IS NULL)`),
]);

// Subscription Suggestions schema - for user verification workflow
export const invoices = pgTable("invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  subscriptionId: varchar("subscription_id").notNull(),
  userId: varchar("user_id").notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(), // pdf, image, docx
  fileSize: integer("file_size").notNull(), // in bytes
  fileUrl: text("file_url").notNull(), // object storage URL
  source: text("source").default("manual").notNull(), // gmail or manual
  uploadedAt: timestamp("uploaded_at").defaultNow(),
});

export const subscriptionSuggestions = pgTable("subscription_suggestions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  gmailAccountId: varchar("gmail_account_id"), // DEPRECATED: Legacy Gmail account link (nullable for backward compatibility)
  emailProvider: text("email_provider"), // 'gmail' | 'outlook' (nullable during migration)
  providerAccountId: varchar("provider_account_id"), // Polymorphic link to gmail_accounts.id OR outlook_accounts.id
  serviceName: text("service_name").notNull(),
  serviceKey: text("service_key").notNull(), // For deduplication: normalized service + frequency
  merchantName: text("merchant_name"),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").default("INR").notNull(),
  frequency: text("frequency").notNull(), // monthly, yearly, weekly, quarterly
  category: text("category"),
  confidence: text("confidence").notNull(), // high, medium, low
  confidenceScore: decimal("confidence_score", { precision: 3, scale: 2 }).notNull(), // 0.00-1.00
  reasoning: text("reasoning"), // LLM explanation
  evidenceEmailIds: text("evidence_email_ids").array(), // Supporting email IDs
  occurrences: integer("occurrences").notNull().default(1), // Number of supporting emails
  recurrenceType: text("recurrence_type"), // detected pattern: weekly, monthly, yearly
  recurrenceScore: integer("recurrence_score").default(0), // 0-100 confidence in recurrence
  
  // Enhanced recurring detection evidence
  recurringKeywords: text("recurring_keywords").array(), // Keywords found: "monthly", "auto-renew", etc.
  senderHistory: text("sender_history"), // JSON: historical emails from same sender with amounts
  attachmentEvidence: text("attachment_evidence"), // JSON: PDF/image analysis results
  validationChecks: text("validation_checks"), // JSON: subject, content, attachment validation results
  
  nextBillingDate: timestamp("next_billing_date"),
  lastSeen: timestamp("last_seen").notNull(),
  detectedAt: timestamp("detected_at").defaultNow(),
  status: text("status").default("pending").notNull(), // pending, approved, rejected
  // Read from a cancellation email by the detector. Stored only for users with
  // the `subscription_status` switch on; carried to the subscription on approval.
  cancelledOn: date("cancelled_on"),
  accessEndsOn: date("access_ends_on"),
}, (table) => [
  index("idx_suggestions_user_provider").on(table.userId, table.emailProvider),
  index("idx_suggestions_provider_account").on(table.providerAccountId),
  check("valid_email_provider", sql`email_provider IS NULL OR email_provider IN ('gmail', 'outlook')`),
  check("provider_fields_sync", sql`(email_provider IS NULL) = (provider_account_id IS NULL)`),
]);

/*
 * Payments seen for a subscription (feature switch `subscription_status`).
 *
 * One row per charge-related email linked to a subscription: receipts,
 * invoices, card alerts, and also failures, refunds and pauses, which the
 * status rules read but do not count as payments. Created at startup by
 * storage.ensureSubscriptionStatusTables(), which must match this.
 */
export const PAYMENT_KINDS = ["receipt", "invoice", "card_alert", "failed", "refund", "pause"] as const;
export const PAYMENT_SOURCES = ["sync", "approval", "history"] as const;

export const payments = pgTable("payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  subscriptionId: varchar("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "cascade" }),
  emailId: varchar("email_id").references(() => emails.id, { onDelete: "set null" }),
  paidAt: date("paid_at").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }), // null: the email showed no amount
  currency: text("currency"),
  kind: text("kind").$type<(typeof PAYMENT_KINDS)[number]>().notNull(),
  pausedUntil: date("paused_until"),
  source: text("source").$type<(typeof PAYMENT_SOURCES)[number]>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  // The same email never yields two payments for one subscription.
  uniqueIndex("uq_payments_subscription_email").on(table.subscriptionId, table.emailId),
  index("idx_payments_user_subscription").on(table.userId, table.subscriptionId, table.paidAt),
  check("payments_kind_check", sql`kind IN ('receipt', 'invoice', 'card_alert', 'failed', 'refund', 'pause')`),
  check("payments_source_check", sql`source IN ('sync', 'approval', 'history')`),
]);

/*
 * Feature switches. A general mechanism: any feature can be gated on a key
 * here and turned on for no one, a hand-picked list of users, or everyone,
 * from the admin console. See server/lib/featureFlags.ts.
 *
 * These tables are created at startup by storage.ensureFeatureFlagTables()
 * (db:push is unreliable here), so the DDL there must match these shapes.
 */
export const FEATURE_ROLLOUTS = ["off", "selected", "everyone"] as const;
export type FeatureRollout = (typeof FEATURE_ROLLOUTS)[number];

export const featureFlags = pgTable("feature_flags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Used in code. Lowercase snake_case and never changed once created.
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  rollout: text("rollout").$type<FeatureRollout>().notNull().default("off"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, () => [
  check("feature_flags_rollout_check", sql`rollout IN ('off', 'selected', 'everyone')`),
]);

// Who is on a feature's list. Only consulted when its rollout is 'selected'.
export const featureFlagUsers = pgTable("feature_flag_users", {
  flagId: varchar("flag_id").notNull().references(() => featureFlags.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  addedAt: timestamp("added_at").defaultNow().notNull(),
  addedBy: text("added_by"), // admin email
}, (table) => [
  primaryKey({ columns: [table.flagId, table.userId] }),
  index("idx_feature_flag_users_user").on(table.userId),
]);

// Every admin change to a feature, one row each.
export const featureFlagAudit = pgTable("feature_flag_audit", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  flagId: varchar("flag_id").notNull(),
  actor: text("actor").notNull(), // admin email, or 'system' for the seed
  action: text("action").notNull(), // created, rollout_changed, user_added, user_removed, details_edited
  before: jsonb("before"),
  after: jsonb("after"),
  at: timestamp("at").defaultNow().notNull(),
}, (table) => [
  index("idx_feature_flag_audit_flag").on(table.flagId, table.at),
]);

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  firstName: true,
  lastName: true,
  profileImageUrl: true,
});

// Auth-specific schemas - never expose passwordHash or onboarding fields to client
export const signupSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const upsertUserSchema = createInsertSchema(users).pick({
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  profileImageUrl: true,
});

/*
 * JSON has no date type, so an HTTP client can only send a timestamp as a
 * string -- and the generated schema expects a Date, which rejects it. That
 * made every timestamp column on this table unreachable over the API: the
 * server-side sync pipeline passes real Dates and worked, while anything
 * posting JSON could not set a renewal date at all.
 *
 * `z.coerce.date()` accepts both, so the pipeline is unaffected.
 */
const jsonDate = z.coerce.date();

export const insertSubscriptionSchema = createInsertSchema(subscriptions)
  .omit({
    id: true,
    detectedAt: true,
    // Status fields are worked out by the server, never sent by a client.
    lifecycleStatus: true,
    lifecycleReason: true,
    lifecycleUpdatedAt: true,
    lastPaymentAt: true,
    expectedNextPaymentAt: true,
    endsOn: true,
    cancelledAt: true,
    inactiveSince: true,
    inactiveSource: true,
    stillActiveTaps: true,
    stillActiveUntil: true,
    historyStatus: true,
    historySearchedSince: true,
    historyAttempts: true,
    historyError: true,
    historyStartedAt: true,
    historyFinishedAt: true,
  })
  .extend({
    nextBillingDate: jsonDate.nullish(),
    lastEmailDate: jsonDate.nullish(),
  });

export const updateSubscriptionSchema = createInsertSchema(subscriptions).pick({
  serviceName: true,
  amount: true,
  currency: true,
  frequency: true,
  category: true,
  status: true,
  ownerName: true,
  ownerEmail: true,
  description: true,
  nextBillingDate: true,
})
  .extend({
    /* Same reason as the insert schema above: a browser can only send this as
       a string. It was previously left out of this list entirely, so a renewal
       date could be set when a subscription was added and never corrected. */
    nextBillingDate: jsonDate.nullish(),
  })
  .partial();

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  uploadedAt: true,
});

export const updateInvoiceSchema = createInsertSchema(invoices).pick({
  fileName: true,
}).partial();

export const insertEmailSchema = createInsertSchema(emails).omit({
  id: true,
  analyzedAt: true,
});

export const updateUserSchema = createInsertSchema(users).pick({
  gmailAccessToken: true,
  gmailRefreshToken: true,
  gmailTokenExpiry: true,
  gmailConnected: true,
  gmailEmail: true,
  lastSync: true,
  preferredCurrency: true,
  emailSyncDays: true,
  organizationName: true,
  countryCode: true,
  accountHolderName: true,
  onboardingStatus: true,
  privacyConsentGiven: true,
  profileImageUrl: true,
  updatedAt: true,
});

export const insertSubscriptionSuggestionSchema = createInsertSchema(subscriptionSuggestions).omit({
  id: true,
  detectedAt: true,
});

// SafeUser schema - excludes sensitive tokens for frontend consumption
export const safeUserSchema = createInsertSchema(users).pick({
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  profileImageUrl: true,
  gmailConnected: true,
  gmailEmail: true,
  lastSync: true,
  preferredCurrency: true,
  emailSyncDays: true,
  organizationName: true,
  countryCode: true,
  accountHolderName: true,
  onboardingStatus: true,
  privacyConsentGiven: true,
  emailVerified: true,
  createdAt: true,
  updatedAt: true,
});

// Settings schema for user preference updates
export const insertGmailAccountSchema = createInsertSchema(gmailAccounts).omit({
  id: true,
  createdAt: true,
});

export const updateGmailAccountSchema = createInsertSchema(gmailAccounts).pick({
  accessToken: true,
  refreshToken: true,
  tokenExpiry: true,
  lastSync: true,
  syncStatus: true,
  syncError: true,
}).partial();

export const insertOutlookAccountSchema = createInsertSchema(outlookAccounts).omit({
  id: true,
  createdAt: true,
});

export const updateOutlookAccountSchema = createInsertSchema(outlookAccounts).pick({
  accessToken: true,
  refreshToken: true,
  tokenExpiry: true,
  tenantId: true,
  accountType: true,
  lastSync: true,
  syncStatus: true,
  syncError: true,
}).partial();

export const updateSettingsSchema = z.object({
  preferredCurrency: currencyEnum.optional(),
  emailSyncDays: z.number().int().min(1).max(180).optional(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpsertUser = z.infer<typeof upsertUserSchema>;
export type SignupData = z.infer<typeof signupSchema>;
export type LoginData = z.infer<typeof loginSchema>;
export type User = typeof users.$inferSelect;
export type SafeUser = z.infer<typeof safeUserSchema>;
export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type UpdateSubscription = z.infer<typeof updateSubscriptionSchema>;
export type SyncJob = typeof syncJobs.$inferSelect;
export type SubscriptionSuggestion = typeof subscriptionSuggestions.$inferSelect;
export type InsertSubscriptionSuggestion = z.infer<typeof insertSubscriptionSuggestionSchema>;
export type Email = typeof emails.$inferSelect;
export type InsertEmail = z.infer<typeof insertEmailSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type UpdateInvoice = z.infer<typeof updateInvoiceSchema>;
export type GmailAccount = typeof gmailAccounts.$inferSelect;
export type InsertGmailAccount = z.infer<typeof insertGmailAccountSchema>;
export type UpdateGmailAccount = z.infer<typeof updateGmailAccountSchema>;
export type OutlookAccount = typeof outlookAccounts.$inferSelect;
export type InsertOutlookAccount = z.infer<typeof insertOutlookAccountSchema>;
export type UpdateOutlookAccount = z.infer<typeof updateOutlookAccountSchema>;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type FeatureFlagUser = typeof featureFlagUsers.$inferSelect;
export type FeatureFlagAudit = typeof featureFlagAudit.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;
