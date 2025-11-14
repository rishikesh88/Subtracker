/**
 * 🔒 PROTECTED CORE LOGIC - MODIFICATION REQUIRES USER APPROVAL
 * 
 * Enhanced Transaction Detection Service
 * Multi-parameter scoring system to identify transaction/subscription emails
 * 
 * @version 1.0.0
 * @lastModified 2025-11-10
 * @protection LOCKED - See server/core/README.md for modification protocol
 * 
 * CRITICAL: This file contains core IP for subscription detection.
 * Any modifications to scoring algorithms, thresholds, or keyword lists
 * require explicit user approval. See SPECIFICATION.md for canonical algorithm.
 */

import { getMerchantDatabase } from './merchantDatabase';

interface EmailMetadata {
  id?: string; // Gmail message ID (optional for filtering)
  subject: string;
  fromEmail: string;
  fromName?: string;
  snippet?: string;
  bodyPreview?: string;
}

interface DetectionResult {
  isCandidate: boolean;
  score: number;
  reasons: string[];
  confidence: 'high' | 'medium' | 'low';
}

export class TransactionDetector {
  // Known payment processor domains
  private paymentProcessors = [
    'stripe.com', 'paypal.com', 'square.com', 'braintree.com', 'paddle.net',
    'razorpay.com', 'checkout.com', 'adyen.com', 'worldpay.com', 'authorize.net'
  ];

  // Known subscription platforms
  private subscriptionPlatforms = [
    'substack.com', 'patreon.com', 'memberful.com', 'gumroad.com',
    'teachable.com', 'podia.com', 'kajabi.com'
  ];

  // Major subscription services (Apple, streaming, hosting, etc.)
  private majorSubscriptionServices = [
    'apple.com', 'icloud.com', 'insideapple.apple.com',
    'netflix.com', 'spotify.com', 'amazon.com', 'prime.amazon.com',
    'google.com', 'youtube.com', 'microsoft.com', 'office.com',
    'adobe.com', 'dropbox.com', 'zoom.us',
    'godaddy.com', 'namecheap.com', 'bluehost.com', 'hostgator.com',
    'digitalocean.com', 'aws.amazon.com', 'cloudflare.com'
  ];

  // Payment-related email patterns
  private paymentEmailPrefixes = [
    'billing', 'noreply', 'no-reply', 'receipts', 'invoices', 'payments',
    'orders', 'transactions', 'accounts', 'support', 'hello', 'notifications'
  ];

  // Subject line keywords (case-insensitive)
  private subjectKeywords = {
    payment: ['receipt', 'invoice', 'payment', 'charged', 'billed', 'paid', 'purchase'],
    subscription: ['subscription', 'membership', 'plan', 'renewal', 'auto-renew', 'renews'],
    confirmation: ['confirmed', 'successful', 'processed', 'completed', 'thank you'],
    reference: ['order #', 'invoice #', 'receipt #', 'transaction', 'confirmation'],
    renewal: ['will be charged', 'renewing', 'renews on', 'renews in', 'expires in', 'expiring', 'expiration'],
    hosting: ['domain', 'hosting', 'ssl certificate', 'web hosting', 'server']
  };

  // Body content patterns
  private bodyKeywords = {
    recurring: ['next billing', 'renews on', 'auto-renewal', 'recurring charge', 'billing cycle', 'subscription period', 'automatically renew', 'will renew'],
    payment: ['card ending', 'paypal account', 'bank account', 'payment method', 'total amount', 'amount due'],
    service: ['manage subscription', 'view invoice', 'update payment', 'cancel anytime', 'billing details'],
    renewal: ['will be charged', 'you will be charged', 'upcoming charge', 'renewal date', 'renewal reminder', 'auto-renews'],
    hosting: ['domain expires', 'hosting expires', 'ssl expires', 'domain renewal', 'hosting renewal', 'nameservers']
  };

  // Currency patterns
  private currencyPatterns = [
    /\$\s?\d+\.?\d*/g,           // $10, $10.99
    /€\s?\d+[,.]?\d*/g,          // €10, €10,99
    /£\s?\d+\.?\d*/g,            // £10, £10.99
    /¥\s?\d+/g,                  // ¥1000
    /₹\s?\d+\.?\d*/g,            // ₹100, ₹100.50
    /USD\s?\d+\.?\d*/gi,         // USD 10.99
    /EUR\s?\d+[,.]?\d*/gi,       // EUR 10,99
    /GBP\s?\d+\.?\d*/gi,         // GBP 10.99
    /\d+\.\d{2}\s?(USD|EUR|GBP|CAD|AUD)/gi  // 10.99 USD
  ];

  /**
   * Analyze email metadata and return detection score
   */
  detect(email: EmailMetadata): DetectionResult {
    let score = 0;
    const reasons: string[] = [];

    // 1. Sender Domain Analysis (max 50 points)
    const senderScore = this.analyzeSender(email.fromEmail, email.fromName || '');
    score += senderScore.score;
    reasons.push(...senderScore.reasons);

    // 2. Subject Line Analysis (max 40 points)
    const subjectScore = this.analyzeSubject(email.subject);
    score += subjectScore.score;
    reasons.push(...subjectScore.reasons);

    // 3. Content Analysis (max 30 points)
    const contentScore = this.analyzeContent(email.snippet || '', email.bodyPreview || '');
    score += contentScore.score;
    reasons.push(...contentScore.reasons);

    // 4. Currency Detection (max 20 points)
    const currencyScore = this.detectCurrency(email.subject, email.snippet || '', email.bodyPreview || '');
    score += currencyScore.score;
    reasons.push(...currencyScore.reasons);

    // Determine confidence level
    let confidence: 'high' | 'medium' | 'low';
    if (score >= 80) confidence = 'high';
    else if (score >= 50) confidence = 'medium';
    else confidence = 'low';

    // Threshold: 50+ points = candidate
    const isCandidate = score >= 50;

    return {
      isCandidate,
      score,
      reasons,
      confidence
    };
  }

  /**
   * Analyze sender email and name
   */
  private analyzeSender(email: string, name: string): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];
    const emailLower = email.toLowerCase();
    const nameLower = name.toLowerCase();

    // PRIORITY 1: Check merchant database with tiered scoring
    try {
      const merchantDB = getMerchantDatabase();
      const merchantMatch = merchantDB.isKnownMerchantWithScore(emailLower);
      if (merchantMatch) {
        score += merchantMatch.score;
        const matchTypeLabel = {
          'exact_email': 'exact email',
          'root_domain': 'domain family',
          'pattern': 'email pattern'
        }[merchantMatch.matchType];
        reasons.push(`Verified merchant: ${merchantMatch.merchant.name} (${matchTypeLabel} match, +${merchantMatch.score} pts)`);
        return { score, reasons };
      }
    } catch (error) {
      // Non-fatal: continue with other detection if merchant DB fails
      console.warn('Merchant database lookup failed, continuing with fallback detection');
    }

    // Check for known payment processors (50 points - very strong signal)
    for (const domain of this.paymentProcessors) {
      if (emailLower.includes(domain)) {
        score += 50;
        reasons.push(`Known payment processor: ${domain}`);
        return { score, reasons };
      }
    }

    // Check for known subscription platforms (45 points)
    for (const platform of this.subscriptionPlatforms) {
      if (emailLower.includes(platform)) {
        score += 45;
        reasons.push(`Known subscription platform: ${platform}`);
        return { score, reasons };
      }
    }

    // Check for major subscription services (40 points)
    for (const service of this.majorSubscriptionServices) {
      if (emailLower.includes(service)) {
        score += 40;
        reasons.push(`Major subscription service: ${service}`);
        return { score, reasons };
      }
    }

    // Check for payment-related email prefixes (30 points)
    for (const prefix of this.paymentEmailPrefixes) {
      if (emailLower.startsWith(prefix + '@') || emailLower.startsWith(prefix + '.')) {
        score += 30;
        reasons.push(`Payment-related email prefix: ${prefix}`);
        break;
      }
    }

    // Check for business indicators in sender name (10 points)
    const businessIndicators = ['inc', 'llc', 'ltd', 'corp', 'limited', 'company'];
    for (const indicator of businessIndicators) {
      if (nameLower.includes(indicator)) {
        score += 10;
        reasons.push('Business entity in sender name');
        break;
      }
    }

    // Service/SaaS domain patterns (15 points)
    if (emailLower.match(/\.(io|app|tech|cloud|software)$/)) {
      score += 15;
      reasons.push('SaaS/tech domain TLD');
    }

    // Subdomain patterns (10 points)
    if (emailLower.match(/^(billing|payments|receipts|noreply|notifications)\./)) {
      score += 10;
      reasons.push('Service subdomain detected');
    }

    return { score, reasons };
  }

  /**
   * Analyze subject line
   */
  private analyzeSubject(subject: string): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];
    const subjectLower = subject.toLowerCase();

    // Payment keywords (25 points)
    for (const keyword of this.subjectKeywords.payment) {
      if (subjectLower.includes(keyword)) {
        score += 25;
        reasons.push(`Payment keyword in subject: ${keyword}`);
        break;
      }
    }

    // Subscription keywords (20 points)
    for (const keyword of this.subjectKeywords.subscription) {
      if (subjectLower.includes(keyword)) {
        score += 20;
        reasons.push(`Subscription keyword in subject: ${keyword}`);
        break;
      }
    }

    // Confirmation keywords (15 points)
    for (const keyword of this.subjectKeywords.confirmation) {
      if (subjectLower.includes(keyword)) {
        score += 15;
        reasons.push(`Confirmation keyword in subject: ${keyword}`);
        break;
      }
    }

    // Reference numbers (20 points)
    for (const keyword of this.subjectKeywords.reference) {
      if (subjectLower.includes(keyword)) {
        score += 20;
        reasons.push(`Reference number pattern in subject`);
        break;
      }
    }

    // Renewal keywords (22 points)
    for (const keyword of this.subjectKeywords.renewal) {
      if (subjectLower.includes(keyword)) {
        score += 22;
        reasons.push(`Renewal keyword in subject: ${keyword}`);
        break;
      }
    }

    // Hosting keywords (18 points)
    for (const keyword of this.subjectKeywords.hosting) {
      if (subjectLower.includes(keyword)) {
        score += 18;
        reasons.push(`Hosting keyword in subject: ${keyword}`);
        break;
      }
    }

    return { score: Math.min(score, 40), reasons }; // Cap at 40
  }

  /**
   * Analyze email content/snippet
   */
  private analyzeContent(snippet: string, bodyPreview: string): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];
    const content = (snippet + ' ' + bodyPreview).toLowerCase();

    // Recurring language (20 points)
    for (const keyword of this.bodyKeywords.recurring) {
      if (content.includes(keyword)) {
        score += 20;
        reasons.push(`Recurring billing language detected`);
        break;
      }
    }

    // Payment method references (15 points)
    for (const keyword of this.bodyKeywords.payment) {
      if (content.includes(keyword)) {
        score += 15;
        reasons.push(`Payment method reference found`);
        break;
      }
    }

    // Service management keywords (10 points)
    for (const keyword of this.bodyKeywords.service) {
      if (content.includes(keyword)) {
        score += 10;
        reasons.push(`Service management keywords found`);
        break;
      }
    }

    // Renewal language (15 points)
    for (const keyword of this.bodyKeywords.renewal) {
      if (content.includes(keyword)) {
        score += 15;
        reasons.push(`Renewal language detected: ${keyword}`);
        break;
      }
    }

    // Hosting language (12 points)
    for (const keyword of this.bodyKeywords.hosting) {
      if (content.includes(keyword)) {
        score += 12;
        reasons.push(`Hosting/domain language detected`);
        break;
      }
    }

    return { score: Math.min(score, 30), reasons }; // Cap at 30
  }

  /**
   * Detect currency and amounts
   */
  private detectCurrency(subject: string, snippet: string, bodyPreview: string): { score: number; reasons: string[] } {
    const content = subject + ' ' + snippet + ' ' + bodyPreview;
    let score = 0;
    const reasons: string[] = [];

    // Check all currency patterns
    for (const pattern of this.currencyPatterns) {
      const matches = content.match(pattern);
      if (matches && matches.length > 0) {
        score += 20;
        reasons.push(`Currency amount detected: ${matches[0]}`);
        break;
      }
    }

    return { score, reasons };
  }

  /**
   * Batch analyze multiple emails
   */
  batchDetect(emails: EmailMetadata[]): DetectionResult[] {
    return emails.map(email => this.detect(email));
  }

  /**
   * Filter candidates from a batch
   */
  filterCandidates(emails: EmailMetadata[]): { candidates: EmailMetadata[]; stats: { total: number; high: number; medium: number; low: number; rejected: number } } {
    const results = this.batchDetect(emails);
    const candidates: EmailMetadata[] = [];
    const stats = { total: emails.length, high: 0, medium: 0, low: 0, rejected: 0 };

    results.forEach((result, index) => {
      if (result.isCandidate) {
        candidates.push(emails[index]);
        if (result.confidence === 'high') stats.high++;
        else if (result.confidence === 'medium') stats.medium++;
        else stats.low++;
      } else {
        stats.rejected++;
      }
    });

    return { candidates, stats };
  }
}
