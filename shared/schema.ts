import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, decimal, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  gmailAccessToken: text("gmail_access_token"),
  gmailRefreshToken: text("gmail_refresh_token"),
  gmailConnected: boolean("gmail_connected").default(false),
  lastSync: timestamp("last_sync"),
});

export const subscriptions = pgTable("subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  serviceName: text("service_name").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").default("USD").notNull(),
  frequency: text("frequency").notNull(), // monthly, yearly, weekly
  category: text("category"), // entertainment, software, utilities, etc.
  status: text("status").default("active").notNull(), // active, cancelled, expiring_soon
  merchantEmail: text("merchant_email"),
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

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
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
  gmailConnected: true,
  lastSync: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Email = typeof emails.$inferSelect;
export type InsertEmail = z.infer<typeof insertEmailSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
