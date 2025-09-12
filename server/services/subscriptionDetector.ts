import { type Email, type Subscription } from "@shared/schema";
import { storage } from "../storage";

interface SubscriptionCandidate {
  serviceName: string;
  amount: number;
  currency: string;
  frequency: string;
  category?: string;
  merchantEmail: string;
  emails: Email[];
}

export class SubscriptionDetector {
  private categoryKeywords = {
    'entertainment': ['netflix', 'spotify', 'hulu', 'disney', 'youtube', 'prime video', 'hbo', 'paramount'],
    'software': ['adobe', 'microsoft', 'github', 'slack', 'dropbox', 'office', 'creative cloud'],
    'utilities': ['verizon', 'att', 'tmobile', 'comcast', 'xfinity', 'electric', 'gas', 'water'],
    'shopping': ['amazon', 'walmart', 'target', 'costco', 'prime'],
    'music': ['spotify', 'apple music', 'youtube music', 'pandora', 'tidal'],
    'cloud': ['aws', 'google cloud', 'azure', 'dropbox', 'icloud'],
    'fitness': ['peloton', 'fitbit', 'strava', 'myfitnesspal'],
    'news': ['nytimes', 'wsj', 'washington post', 'medium']
  };

  async detectSubscriptions(userId: string): Promise<Subscription[]> {
    const emails = await storage.getUnprocessedEmails(userId);
    const transactionEmails = emails.filter(email => email.isTransaction && email.extractedAmount);

    // Group emails by merchant
    const emailsByMerchant = this.groupEmailsByMerchant(transactionEmails);

    const detectedSubscriptions: Subscription[] = [];

    for (const [merchantKey, merchantEmails] of Array.from(emailsByMerchant.entries())) {
      const candidate = this.analyzeEmailGroup(merchantEmails);
      
      if (this.isRecurringSubscription(candidate)) {
        const subscription = await this.createSubscriptionFromCandidate(userId, candidate);
        if (subscription) {
          detectedSubscriptions.push(subscription);
          
          // Mark emails as processed and link to subscription
          for (const email of merchantEmails) {
            await storage.updateEmail(email.id, {
              processed: true,
              subscriptionId: subscription.id
            });
          }
        }
      }
    }

    return detectedSubscriptions;
  }

  private groupEmailsByMerchant(emails: Email[]): Map<string, Email[]> {
    const groups = new Map<string, Email[]>();

    for (const email of emails) {
      // Create a key based on merchant name and amount to group similar transactions
      const amount = email.extractedAmount?.toString() || '0';
      const merchantName = email.merchantName || email.fromEmail;
      const key = `${merchantName.toLowerCase()}_${amount}`;

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(email);
    }

    return groups;
  }

  private analyzeEmailGroup(emails: Email[]): SubscriptionCandidate {
    // Sort by date
    emails.sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());

    const firstEmail = emails[0];
    const merchantName = firstEmail.merchantName || this.extractMerchantFromEmail(firstEmail.fromEmail);
    const amount = typeof firstEmail.extractedAmount === 'string' 
      ? parseFloat(firstEmail.extractedAmount) 
      : (firstEmail.extractedAmount || 0);
    const currency = firstEmail.extractedCurrency || 'USD';
    
    const frequency = this.detectFrequency(emails);
    const category = this.categorizeService(merchantName);

    return {
      serviceName: merchantName,
      amount,
      currency,
      frequency,
      category,
      merchantEmail: firstEmail.fromEmail,
      emails
    };
  }

  private detectFrequency(emails: Email[]): string {
    if (emails.length < 2) return 'monthly'; // Default assumption

    const intervals: number[] = [];
    
    for (let i = 1; i < emails.length; i++) {
      const prevDate = new Date(emails[i - 1].receivedAt);
      const currDate = new Date(emails[i].receivedAt);
      const daysDiff = Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
      intervals.push(daysDiff);
    }

    const avgInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;

    // Classify based on average interval
    if (avgInterval >= 350 && avgInterval <= 380) return 'yearly';
    if (avgInterval >= 25 && avgInterval <= 35) return 'monthly';
    if (avgInterval >= 6 && avgInterval <= 8) return 'weekly';
    
    // Default to monthly for subscription services
    return 'monthly';
  }

  private categorizeService(serviceName: string): string {
    const lowerServiceName = serviceName.toLowerCase();

    for (const [category, keywords] of Object.entries(this.categoryKeywords)) {
      if (keywords.some(keyword => lowerServiceName.includes(keyword))) {
        return category;
      }
    }

    return 'other';
  }

  private isRecurringSubscription(candidate: SubscriptionCandidate): boolean {
    // Must have at least 2 transactions for recurring pattern
    if (candidate.emails.length < 2) return false;

    // Amount should be reasonable for subscription (between $1 and $500)
    if (candidate.amount < 1 || candidate.amount > 500) return false;

    // Check for subscription keywords in emails
    const hasSubscriptionKeywords = candidate.emails.some(email => {
      const text = (email.subject + ' ' + (email.content || '')).toLowerCase();
      return /subscription|recurring|monthly|yearly|renewal|auto.?pay/i.test(text);
    });

    return hasSubscriptionKeywords || candidate.emails.length >= 3;
  }

  private async createSubscriptionFromCandidate(userId: string, candidate: SubscriptionCandidate): Promise<Subscription | null> {
    try {
      // Check if subscription already exists
      const existingSubscriptions = await storage.getSubscriptions(userId);
      const existing = existingSubscriptions.find(sub => 
        sub.serviceName.toLowerCase() === candidate.serviceName.toLowerCase() &&
        Math.abs(parseFloat(sub.amount) - candidate.amount) < 0.01
      );

      if (existing) {
        // Update existing subscription with latest info
        const latestEmail = candidate.emails[candidate.emails.length - 1];
        return await storage.updateSubscription(existing.id, {
          lastEmailDate: latestEmail.receivedAt,
          status: 'active'
        }) || null;
      }

      // Create new subscription
      const latestEmail = candidate.emails[candidate.emails.length - 1];
      const nextBillingDate = this.calculateNextBillingDate(latestEmail.receivedAt, candidate.frequency);

      return await storage.createSubscription({
        userId,
        serviceName: candidate.serviceName,
        amount: candidate.amount.toString(),
        currency: candidate.currency,
        frequency: candidate.frequency,
        category: candidate.category,
        status: 'active',
        merchantEmail: candidate.merchantEmail,
        nextBillingDate,
        lastEmailDate: latestEmail.receivedAt
      });
    } catch (error) {
      console.error('Error creating subscription:', error);
      return null;
    }
  }

  private calculateNextBillingDate(lastDate: Date, frequency: string): Date {
    const next = new Date(lastDate);
    
    switch (frequency) {
      case 'weekly':
        next.setDate(next.getDate() + 7);
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        break;
      case 'yearly':
        next.setFullYear(next.getFullYear() + 1);
        break;
      default:
        next.setMonth(next.getMonth() + 1); // Default to monthly
    }

    return next;
  }

  private extractMerchantFromEmail(email: string): string {
    const domain = email.split('@')[1];
    if (domain) {
      const parts = domain.split('.');
      const mainDomain = parts[parts.length - 2];
      return mainDomain.charAt(0).toUpperCase() + mainDomain.slice(1);
    }
    return 'Unknown';
  }
}

export const subscriptionDetector = new SubscriptionDetector();
