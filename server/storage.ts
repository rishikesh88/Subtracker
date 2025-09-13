import { type User, type InsertUser, type Subscription, type InsertSubscription, type Email, type InsertEmail, type UpdateUser } from "@shared/schema";
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

  constructor() {
    this.users = new Map();
    this.subscriptions = new Map();
    this.emails = new Map();
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

  // Analytics methods
  async getSubscriptionStats(userId: string): Promise<{
    totalMonthly: number;
    activeCount: number;
    emailsAnalyzed: number;
    avgPerService: number;
  }> {
    const userSubscriptions = await this.getSubscriptions(userId);
    const userEmails = await this.getEmails(userId);
    
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
    const emailsAnalyzed = userEmails.length;
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
