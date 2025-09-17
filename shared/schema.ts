import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, decimal, integer, boolean, index, jsonb } from "drizzle-orm/pg-core";
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

// User storage table - Updated for Replit Auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  // Gmail integration fields
  gmailAccessToken: text("gmail_access_token"),
  gmailRefreshToken: text("gmail_refresh_token"),
  gmailTokenExpiry: timestamp("gmail_token_expiry"),
  gmailConnected: boolean("gmail_connected").default(false),
  gmailEmail: text("gmail_email"),
  lastSync: timestamp("last_sync"),
  // Currency preference
  preferredCurrency: text("preferred_currency").default("INR").notNull(),
});

export const subscriptions = pgTable("subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
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
});

export const emails = pgTable("emails", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
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
});

// Subscription Suggestions schema - for user verification workflow
export const subscriptionSuggestions = pgTable("subscription_suggestions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
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
  nextBillingDate: timestamp("next_billing_date"),
  lastSeen: timestamp("last_seen").notNull(),
  detectedAt: timestamp("detected_at").defaultNow(),
  status: text("status").default("pending").notNull(), // pending, approved, rejected
});

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  firstName: true,
  lastName: true,
  profileImageUrl: true,
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
  createdAt: true,
  updatedAt: true,
});

// Settings schema for currency preference updates
export const updateSettingsSchema = z.object({
  preferredCurrency: currencyEnum,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpsertUser = z.infer<typeof upsertUserSchema>;
export type User = typeof users.$inferSelect;
export type SafeUser = z.infer<typeof safeUserSchema>;
export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type SubscriptionSuggestion = typeof subscriptionSuggestions.$inferSelect;
export type InsertSubscriptionSuggestion = z.infer<typeof insertSubscriptionSuggestionSchema>;
export type Email = typeof emails.$inferSelect;
export type InsertEmail = z.infer<typeof insertEmailSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;
