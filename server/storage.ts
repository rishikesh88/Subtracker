import { type User, type InsertUser, type UpsertUser, type Subscription, type InsertSubscription, type Email, type InsertEmail, type UpdateUser, type SubscriptionSuggestion, type InsertSubscriptionSuggestion, type EmailAccount, type InsertEmailAccount, type UpdateEmailAccount, users, subscriptions, emails, subscriptionSuggestions, emailAccounts } from "@shared/schema";
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, and, desc, asc, count, sql, inArray } from 'drizzle-orm';
import { neon } from '@neondatabase/serverless';
import { randomUUID } from "crypto";
import { convertCurrency } from "./utils/currencyConverter";

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<UpdateUser>): Promise<User | undefined>;
  
  // Email Account methods
  getEmailAccounts(userId: string): Promise<EmailAccount[]>;
  getEmailAccount(id: string): Promise<EmailAccount | undefined>;
  getEmailAccountByEmail(userId: string, email: string, provider: string): Promise<EmailAccount | undefined>;
  createEmailAccount(account: InsertEmailAccount): Promise<EmailAccount>;
  updateEmailAccount(id: string, updates: Partial<UpdateEmailAccount>): Promise<EmailAccount | undefined>;
  deleteEmailAccount(id: string): Promise<boolean>;
  getActiveEmailAccounts(userId: string): Promise<EmailAccount[]>;
  
  // Subscription methods
  getSubscriptions(userId: string): Promise<Subscription[]>;
  getSubscription(id: string): Promise<Subscription | undefined>;
  createSubscription(subscription: InsertSubscription): Promise<Subscription>;
  updateSubscription(id: string, updates: Partial<Subscription>): Promise<Subscription | undefined>;
  deleteSubscription(id: string): Promise<boolean>;
  
  // Email methods
  getEmails(userId: string, limit?: number): Promise<Email[]>;
  getEmail(id: string): Promise<Email | undefined>;
  getEmailByGmailId(gmailId: string): Promise<Email | undefined>;
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
  getSubscriptionStats(userId: string): Promise<{
    totalMonthly: number;
    activeCount: number;
    emailsAnalyzed: number;
    avgPerService: number;
  }>;
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
      return result[0] || undefined;
    } catch (error) {
      console.error('Error getting user:', error);
      throw error;
    }
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    try {
      const result = await this.db.select().from(users).where(eq(users.email, username)).limit(1);
      return result[0] || undefined;
    } catch (error) {
      console.error('Error getting user by username:', error);
      throw error;
    }
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    try {
      const result = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
      return result[0] || undefined;
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
        
        return result[0];
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
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();
      
      return result[0] || undefined;
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }

  // Email Account methods
  async getEmailAccounts(userId: string): Promise<EmailAccount[]> {
    try {
      return await this.db
        .select()
        .from(emailAccounts)
        .where(eq(emailAccounts.userId, userId))
        .orderBy(desc(emailAccounts.createdAt));
    } catch (error) {
      console.error('Error getting email accounts:', error);
      throw error;
    }
  }

  async getEmailAccount(id: string): Promise<EmailAccount | undefined> {
    try {
      const result = await this.db
        .select()
        .from(emailAccounts)
        .where(eq(emailAccounts.id, id))
        .limit(1);
      return result[0] || undefined;
    } catch (error) {
      console.error('Error getting email account:', error);
      throw error;
    }
  }

  async getEmailAccountByEmail(userId: string, email: string, provider: string): Promise<EmailAccount | undefined> {
    try {
      const result = await this.db
        .select()
        .from(emailAccounts)
        .where(
          and(
            eq(emailAccounts.userId, userId),
            eq(emailAccounts.email, email),
            eq(emailAccounts.provider, provider)
          )
        )
        .limit(1);
      return result[0] || undefined;
    } catch (error) {
      console.error('Error getting email account by email:', error);
      throw error;
    }
  }

  async createEmailAccount(account: InsertEmailAccount): Promise<EmailAccount> {
    try {
      const accountData = {
        userId: account.userId,
        provider: account.provider,
        email: account.email,
        accountName: account.accountName || account.email,
        accessToken: account.accessToken || null,
        refreshToken: account.refreshToken || null,
        tokenExpiry: account.tokenExpiry || null,
        isActive: account.isActive !== undefined ? account.isActive : true,
        lastSync: account.lastSync || null,
      };

      const result = await this.db.insert(emailAccounts).values(accountData).returning();
      return result[0];
    } catch (error) {
      console.error('Error creating email account:', error);
      throw error;
    }
  }

  async updateEmailAccount(id: string, updates: Partial<UpdateEmailAccount>): Promise<EmailAccount | undefined> {
    try {
      const result = await this.db
        .update(emailAccounts)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(emailAccounts.id, id))
        .returning();
      
      return result[0] || undefined;
    } catch (error) {
      console.error('Error updating email account:', error);
      throw error;
    }
  }

  async deleteEmailAccount(id: string): Promise<boolean> {
    try {
      await this.db.delete(emailAccounts).where(eq(emailAccounts.id, id));
      return true;
    } catch (error) {
      console.error('Error deleting email account:', error);
      throw error;
    }
  }

  async getActiveEmailAccounts(userId: string): Promise<EmailAccount[]> {
    try {
      return await this.db
        .select()
        .from(emailAccounts)
        .where(
          and(
            eq(emailAccounts.userId, userId),
            eq(emailAccounts.isActive, true)
          )
        )
        .orderBy(desc(emailAccounts.createdAt));
    } catch (error) {
      console.error('Error getting active email accounts:', error);
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

  async getEmailByGmailId(gmailId: string): Promise<Email | undefined> {
    try {
      const result = await this.db.select().from(emails).where(eq(emails.gmailId, gmailId)).limit(1);
      return result[0] || undefined;
    } catch (error) {
      console.error('Error getting email by Gmail ID:', error);
      throw error;
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
      
      return {
        suggestions: suggestionsResult,
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
      
      const suggestionData = suggestions.map(suggestion => ({
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
        const subscriptionData = {
          userId: suggestion.userId,
          serviceName: suggestion.serviceName,
          serviceKey: suggestion.serviceKey,
          amount: suggestion.amount,
          currency: suggestion.currency,
          frequency: suggestion.frequency,
          category: suggestion.category,
          merchantName: suggestion.merchantName,
          occurrences: suggestion.occurrences,
          status: 'active' as const,
          nextBillingDate: suggestion.nextBillingDate || null,
          lastEmailDate: suggestion.lastSeen,
          merchantEmail: null
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
                inArray(emails.id, suggestion.evidenceEmailIds),
                eq(emails.userId, userId) // SECURITY: Ensure tenant isolation
              )
            );
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
  }> {
    try {
      const [userSubscriptions, emailCount] = await Promise.all([
        this.getSubscriptions(userId),
        this.db.select({ count: count() }).from(emails).where(eq(emails.userId, userId))
      ]);
      
      const activeSubscriptions = userSubscriptions.filter(sub => sub.status === 'active');
      
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

      const activeCount = activeSubscriptions.length;
      const emailsAnalyzed = emailCount[0].count;
      const avgPerService = activeCount > 0 ? totalMonthly / activeCount : 0;

      return {
        totalMonthly: Math.round(totalMonthly * 100) / 100,
        activeCount,
        emailsAnalyzed,
        avgPerService: Math.round(avgPerService * 100) / 100
      };
    } catch (error) {
      console.error('Error getting subscription stats:', error);
      throw error;
    }
  }
}

export const storage = new DatabaseStorage();