import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, decimal, integer, boolean, index, jsonb, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Currency enum for validation
export const currencyEnum = z.enum(["INR", "USD", "EUR", "GBP"]);
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
}, (table) => [
  index("idx_subscriptions_user_provider").on(table.userId, table.emailProvider),
  index("idx_subscriptions_provider_account").on(table.providerAccountId),
  check("valid_email_provider", sql`email_provider IS NULL OR email_provider IN ('gmail', 'outlook')`),
  check("provider_fields_sync", sql`(email_provider IS NULL) = (provider_account_id IS NULL)`),
]);

export const emails = pgTable("emails", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  gmailAccountId: varchar("gmail_account_id"), // DEPRECATED: Legacy Gmail account link (nullable for backward compatibility)
  emailProvider: text("email_provider"), // 'gmail' | 'outlook' (nullable during migration)
  providerAccountId: varchar("provider_account_id"), // Polymorphic link to gmail_accounts.id OR outlook_accounts.id
  gmailId: text("gmail_id").notNull().unique(),
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
}, (table) => [
  index("idx_suggestions_user_provider").on(table.userId, table.emailProvider),
  index("idx_suggestions_provider_account").on(table.providerAccountId),
  check("valid_email_provider", sql`email_provider IS NULL OR email_provider IN ('gmail', 'outlook')`),
  check("provider_fields_sync", sql`(email_provider IS NULL) = (provider_account_id IS NULL)`),
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

export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({
  id: true,
  detectedAt: true,
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
}).partial();

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
