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
      const merchantName = this.normalizeMerchantName(email.merchantName || email.fromEmail);
      const amount = typeof email.extractedAmount === 'string' 
        ? parseFloat(email.extractedAmount) 
        : (email.extractedAmount || 0);
      
      // Find existing group with similar merchant, currency, and amount (±10% tolerance)
      let foundGroup = false;
      const currentCurrency = email.extractedCurrency || 'USD';
      
      for (const [existingKey, existingEmails] of groups.entries()) {
        const keyParts = existingKey.split('_amount_');
        if (keyParts.length !== 2) continue;
        
        const merchantCurrencyPart = keyParts[0];
        const existingAmount = parseFloat(keyParts[1]);
        
        // Extract merchant and currency from the first part
        const merchantCurrencyMatch = merchantCurrencyPart.match(/^(.+)_([A-Z]{3})$/);
        if (!merchantCurrencyMatch) continue;
        
        const existingMerchant = merchantCurrencyMatch[1];
        const existingCurrency = merchantCurrencyMatch[2];
        
        // Check if merchant, currency match and amount is within 10% tolerance
        if (existingMerchant === merchantName && 
            existingCurrency === currentCurrency && 
            this.amountsAreSimilar(amount, existingAmount)) {
          existingEmails.push(email);
          foundGroup = true;
          break;
        }
      }
      
      // If no similar group found, create new one
      if (!foundGroup) {
        const currency = email.extractedCurrency || 'USD';
        const key = `${merchantName}_${currency}_amount_${amount.toFixed(2)}`;
        groups.set(key, [email]);
      }
    }

    return groups;
  }

  private normalizeMerchantName(merchantName: string): string {
    return merchantName.toLowerCase()
      .replace(/\b(pvt\.?|ltd\.?|inc\.?|llc|corp\.?|limited|private)\b/gi, '')
      .replace(/\b(india|indian)\b/gi, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  private amountsAreSimilar(amount1: number, amount2: number): boolean {
    if (amount1 === 0 || amount2 === 0) return amount1 === amount2;
    const tolerance = 0.1; // 10% tolerance
    const diff = Math.abs(amount1 - amount2);
    const maxAmount = Math.max(amount1, amount2);
    return (diff / maxAmount) <= tolerance;
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

    // Set reasonable subscription amount limits based on currency
    let minAmount = 1;
    let maxAmount = 500;
    
    if (candidate.currency === 'INR') {
      minAmount = 50;    // ₹50 minimum
      maxAmount = 50000; // ₹50,000 maximum (about $600)
    }
    
    if (candidate.amount < minAmount || candidate.amount > maxAmount) return false;

    // Check for subscription keywords in emails
    const hasSubscriptionKeywords = candidate.emails.some(email => {
      const text = (email.subject + ' ' + (email.content || '')).toLowerCase();
      return /subscription|recurring|monthly|yearly|renewal|auto.?pay|bill|invoice|payment|charged/i.test(text);
    });

    // More relaxed detection for Indian services
    const hasIndianServicePatterns = candidate.emails.some(email => {
      const text = (email.subject + ' ' + (email.content || '') + ' ' + email.fromEmail).toLowerCase();
      return /airtel|replit|bolt|jio|vodafone|idea|paytm|phonepe|zomato|swiggy|hotstar/i.test(text);
    });

    return hasSubscriptionKeywords || hasIndianServicePatterns || candidate.emails.length >= 3;
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
