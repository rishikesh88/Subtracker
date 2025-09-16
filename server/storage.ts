import { type User, type InsertUser, type Subscription, type InsertSubscription, type Email, type InsertEmail, type UpdateUser, type SubscriptionSuggestion, type InsertSubscriptionSuggestion } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<UpdateUser>): Promise<User | undefined>;
  
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
  rejectSuggestions(suggestionIds: string[]): Promise<{ rejected: number }>;
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

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private subscriptions: Map<string, Subscription>;
  private emails: Map<string, Email>;
  private suggestions: Map<string, SubscriptionSuggestion>;

  constructor() {
    this.users = new Map();
    this.subscriptions = new Map();
    this.emails = new Map();
    this.suggestions = new Map();
  }

  // User methods
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { 
      ...insertUser, 
      id, 
      gmailAccessToken: null,
      gmailRefreshToken: null,
      gmailConnected: false,
      lastSync: null
    };
    this.users.set(id, user);
    return user;
  }

  async updateUser(id: string, updates: Partial<UpdateUser>): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    
    const updatedUser = { ...user, ...updates };
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  // Subscription methods
  async getSubscriptions(userId: string): Promise<Subscription[]> {
    return Array.from(this.subscriptions.values()).filter(
      (sub) => sub.userId === userId
    );
  }

  async getSubscription(id: string): Promise<Subscription | undefined> {
    return this.subscriptions.get(id);
  }

  async createSubscription(insertSubscription: InsertSubscription): Promise<Subscription> {
    const id = randomUUID();
    const subscription: Subscription = {
      ...insertSubscription,
      id,
      status: insertSubscription.status || 'active',
      detectedAt: new Date()
    };
    this.subscriptions.set(id, subscription);
    return subscription;
  }

  async updateSubscription(id: string, updates: Partial<Subscription>): Promise<Subscription | undefined> {
    const subscription = this.subscriptions.get(id);
    if (!subscription) return undefined;
    
    const updatedSubscription = { ...subscription, ...updates };
    this.subscriptions.set(id, updatedSubscription);
    return updatedSubscription;
  }

  async deleteSubscription(id: string): Promise<boolean> {
    return this.subscriptions.delete(id);
  }

  // Email methods
  async getEmails(userId: string, limit: number = 50): Promise<Email[]> {
    const userEmails = Array.from(this.emails.values())
      .filter((email) => email.userId === userId)
      .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
    
    return userEmails.slice(0, limit);
  }

  async getEmail(id: string): Promise<Email | undefined> {
    return this.emails.get(id);
  }

  async getEmailByGmailId(gmailId: string): Promise<Email | undefined> {
    return Array.from(this.emails.values()).find(
      (email) => email.gmailId === gmailId
    );
  }

  async createEmail(insertEmail: InsertEmail): Promise<Email> {
    const id = randomUUID();
    const email: Email = {
      ...insertEmail,
      id,
      content: insertEmail.content || null,
      analyzedAt: new Date()
    };
    this.emails.set(id, email);
    return email;
  }

  async updateEmail(id: string, updates: Partial<Email>): Promise<Email | undefined> {
    const email = this.emails.get(id);
    if (!email) return undefined;
    
    const updatedEmail = { ...email, ...updates };
    this.emails.set(id, updatedEmail);
    return updatedEmail;
  }

  async deleteEmail(id: string): Promise<boolean> {
    return this.emails.delete(id);
  }

  async getUnprocessedEmails(userId: string): Promise<Email[]> {
    return Array.from(this.emails.values()).filter(
      (email) => email.userId === userId && !email.processed
    );
  }

  // Email pagination methods
  async getEmailsPaginated(userId: string, options?: { page?: number; pageSize?: number }): Promise<{ emails: Email[]; total: number }> {
    const page = options?.page || 1;
    const pageSize = options?.pageSize || 50;
    const offset = (page - 1) * pageSize;
    
    const userEmails = Array.from(this.emails.values())
      .filter((email) => email.userId === userId)
      .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
    
    const total = userEmails.length;
    const emails = userEmails.slice(offset, offset + pageSize);
    
    return { emails, total };
  }

  // Suggestion methods
  async getSuggestions(userId: string, options?: { page?: number; pageSize?: number; minConfidence?: string }): Promise<{ suggestions: SubscriptionSuggestion[]; total: number }> {
    const page = options?.page || 1;
    const pageSize = options?.pageSize || 50;
    const offset = (page - 1) * pageSize;
    
    let userSuggestions = Array.from(this.suggestions.values())
      .filter((suggestion) => suggestion.userId === userId && suggestion.status === 'pending');
    
    // Filter by confidence if specified
    if (options?.minConfidence) {
      userSuggestions = userSuggestions.filter(s => s.confidence === options.minConfidence);
    }
    
    // Sort by confidence score (highest first) then by detected date
    userSuggestions.sort((a, b) => {
      const confidenceOrder = { 'high': 3, 'medium': 2, 'low': 1 };
      const aConf = confidenceOrder[a.confidence as keyof typeof confidenceOrder] || 0;
      const bConf = confidenceOrder[b.confidence as keyof typeof confidenceOrder] || 0;
      if (aConf !== bConf) return bConf - aConf;
      return new Date(b.detectedAt!).getTime() - new Date(a.detectedAt!).getTime();
    });
    
    const total = userSuggestions.length;
    const suggestions = userSuggestions.slice(offset, offset + pageSize);
    
    return { suggestions, total };
  }

  async createSuggestion(insertSuggestion: InsertSubscriptionSuggestion): Promise<SubscriptionSuggestion> {
    const id = randomUUID();
    const suggestion: SubscriptionSuggestion = {
      ...insertSuggestion,
      id,
      detectedAt: new Date(),
      status: insertSuggestion.status || 'pending'
    };
    this.suggestions.set(id, suggestion);
    return suggestion;
  }

  async createSuggestionsBulk(suggestions: InsertSubscriptionSuggestion[]): Promise<SubscriptionSuggestion[]> {
    const created: SubscriptionSuggestion[] = [];
    for (const suggestion of suggestions) {
      const created_suggestion = await this.createSuggestion(suggestion);
      created.push(created_suggestion);
    }
    return created;
  }

  async approveSuggestions(suggestionIds: string[], userId: string): Promise<{ subscriptions: Subscription[]; approved: number }> {
    const subscriptions: Subscription[] = [];
    let approved = 0;
    
    for (const suggestionId of suggestionIds) {
      const suggestion = this.suggestions.get(suggestionId);
      if (!suggestion || suggestion.userId !== userId || suggestion.status !== 'pending') continue;
      
      // Convert suggestion to subscription
      const subscription = await this.createSubscription({
        userId: suggestion.userId,
        serviceName: suggestion.serviceName,
        merchantName: suggestion.merchantName,
        amount: suggestion.amount,
        currency: suggestion.currency,
        frequency: suggestion.frequency,
        category: suggestion.category,
        status: 'active',
        nextBillingDate: suggestion.nextBillingDate || null,
        lastEmailDate: suggestion.lastSeen,
        merchantEmail: null
      });
      
      // Mark suggestion as approved
      suggestion.status = 'approved';
      this.suggestions.set(suggestionId, suggestion);
      
      // Link evidence emails to subscription
      if (suggestion.evidenceEmailIds) {
        for (const emailId of suggestion.evidenceEmailIds) {
          await this.updateEmail(emailId, { subscriptionId: subscription.id, processed: true });
        }
      }
      
      subscriptions.push(subscription);
      approved++;
    }
    
    return { subscriptions, approved };
  }

  async rejectSuggestions(suggestionIds: string[]): Promise<{ rejected: number }> {
    let rejected = 0;
    for (const suggestionId of suggestionIds) {
      const suggestion = this.suggestions.get(suggestionId);
      if (suggestion && suggestion.status === 'pending') {
        suggestion.status = 'rejected';
        this.suggestions.set(suggestionId, suggestion);
        rejected++;
      }
    }
    return { rejected };
  }

  async clearSuggestions(userId: string): Promise<{ cleared: number }> {
    const userSuggestions = Array.from(this.suggestions.values())
      .filter(suggestion => suggestion.userId === userId);
    
    let cleared = 0;
    for (const suggestion of userSuggestions) {
      this.suggestions.delete(suggestion.id);
      cleared++;
    }
    
    return { cleared };
  }

  // Analytics methods
  async getSubscriptionStats(userId: string): Promise<{
    totalMonthly: number;
    activeCount: number;
    emailsAnalyzed: number;
    avgPerService: number;
  }> {
    const userSubscriptions = await this.getSubscriptions(userId);
    const { total: emailsAnalyzed } = await this.getEmailsPaginated(userId, { page: 1, pageSize: 999999 }); // Get total count
    
    const activeSubscriptions = userSubscriptions.filter(sub => sub.status === 'active');
    
    const totalMonthly = activeSubscriptions.reduce((sum, sub) => {
      const amount = parseFloat(sub.amount);
      if (sub.frequency === 'yearly') {
        return sum + (amount / 12);
      } else if (sub.frequency === 'weekly') {
        return sum + (amount * 4.33); // average weeks per month
      }
      return sum + amount; // monthly
    }, 0);

    const activeCount = activeSubscriptions.length;
    const avgPerService = activeCount > 0 ? totalMonthly / activeCount : 0;

    return {
      totalMonthly: Math.round(totalMonthly * 100) / 100,
      activeCount,
      emailsAnalyzed,
      avgPerService: Math.round(avgPerService * 100) / 100
    };
  }
}

export const storage = new MemStorage();
