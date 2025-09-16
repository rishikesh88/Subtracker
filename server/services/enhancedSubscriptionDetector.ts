/**
 * Enhanced Subscription Detection Service
 * Combines recurrence analysis with LLM-powered suggestion generation
 * 
 * Hybrid Two-Stage Pipeline:
 * - Stage 1: Batch classification (50 emails per API call)
 * - Stage 2: Detailed batch analysis (8 emails per API call)
 * - Reduces API calls from 23 to 3-5 total
 */

import { GoogleGenAI } from "@google/genai";
import { type Email, type InsertSubscriptionSuggestion } from "@shared/schema";
import { IStorage } from "../storage";
import { recurrenceAnalyzer, type EmailCluster } from "./recurrenceAnalyzer";

interface SuggestionGenerationResult {
  suggestions: InsertSubscriptionSuggestion[];
  totalAnalyzed: number;
  highConfidenceCount: number;
  recurrenceClusters: number;
  processingTime: number;
}

interface BatchClassificationResult {
  id: number;
  isSubscription: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
}

interface BatchAnalysisResult {
  id: number;
  isSubscription: boolean;
  serviceName: string;
  amount: number;
  currency: string;
  frequency: "weekly" | "monthly" | "quarterly" | "yearly";
  category: string;
  confidence: "high" | "medium" | "low";
  nextBillingDate?: string;
  merchantName: string;
  merchantEmail: string;
}

export class EnhancedSubscriptionDetector {
  private ai: GoogleGenAI;
  private storage: IStorage;

  constructor(storage: IStorage) {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
    this.storage = storage;
  }

  /**
   * Main detection workflow: Hybrid two-stage pipeline for efficient API usage
   */
  async detectSubscriptionSuggestions(emails: Email[], userId: string): Promise<SuggestionGenerationResult> {
    const startTime = Date.now();
    console.log(`🤖 Starting enhanced subscription detection for ${emails.length} emails...`);

    try {
      // Step 1: Filter emails that are likely subscription-related (broad filter)
      console.log(`🔍 Step 1: Pre-filtering emails for subscription potential...`);
      const potentialSubscriptionEmails = this.filterPotentialSubscriptions(emails);
      console.log(`✅ Found ${potentialSubscriptionEmails.length} potentially subscription-related emails`);

      // Step 2: Hybrid Two-Stage Pipeline for Efficient API Usage
      console.log(`🧠 Step 2: Starting hybrid two-stage pipeline...`);
      
      // STAGE 1: Batch Classification (1-2 API calls total)
      console.log(`📊 Stage 1: Batch classification of ${potentialSubscriptionEmails.length} emails...`);
      const subscriptionCandidates = await this.batchClassifyEmails(potentialSubscriptionEmails);
      console.log(`✅ Stage 1 complete: ${subscriptionCandidates.length} high-confidence subscription candidates identified`);
      
      // STAGE 2: Detailed Batch Analysis (2-3 API calls total)
      console.log(`🎯 Stage 2: Detailed batch analysis of ${subscriptionCandidates.length} candidates...`);
      const individualSuggestions: InsertSubscriptionSuggestion[] = [];
      
      if (subscriptionCandidates.length > 0) {
        const detailedSuggestions = await this.batchAnalyzeSubscriptionCandidates(subscriptionCandidates, userId);
        individualSuggestions.push(...detailedSuggestions);
      }

      const totalApiCalls = Math.ceil(potentialSubscriptionEmails.length / 50) + Math.ceil(subscriptionCandidates.length / 8);
      console.log(`✅ Hybrid pipeline complete: ${individualSuggestions.length} suggestions generated with only ${totalApiCalls} API calls (${Math.round((1 - totalApiCalls / potentialSubscriptionEmails.length) * 100)}% reduction)`);

      // Step 3: Analyze recurrence patterns to boost confidence
      console.log(`📊 Step 3: Analyzing recurrence patterns to boost confidence...`);
      const clustersWithRecurrence = recurrenceAnalyzer.analyzeAllClusters(emails);
      console.log(`✅ Found ${clustersWithRecurrence.length} recurring clusters`);

      // Step 4: Boost confidence for suggestions that have recurrence patterns
      this.boostConfidenceWithRecurrence(individualSuggestions, clustersWithRecurrence);

      // Step 5: Save all boosted suggestions to storage with deduplication
      console.log(`💾 Step 5: Saving ${individualSuggestions.length} suggestions with boosted confidence...`);
      const savedSuggestions = await this.saveWithDeduplication(individualSuggestions, userId);
      console.log(`✅ Successfully saved ${savedSuggestions.length} unique suggestions`);

      // Step 6: Final summary and results
      const finalSuggestionsResult = await this.storage.getSuggestions(userId);
      const finalSuggestions = finalSuggestionsResult.suggestions;
      const highConfidenceCount = finalSuggestions.filter((s: any) => s.confidence === 'high').length;
      const processingTime = Date.now() - startTime;

      console.log(`✨ Detection complete: ${finalSuggestions.length} suggestions saved in ${processingTime}ms`);
      console.log(`📈 High confidence: ${highConfidenceCount}, Medium: ${finalSuggestions.filter((s: any) => s.confidence === 'medium').length}, Low: ${finalSuggestions.filter((s: any) => s.confidence === 'low').length}`);

      return {
        suggestions: finalSuggestions,
        totalAnalyzed: potentialSubscriptionEmails.length,
        highConfidenceCount,
        recurrenceClusters: clustersWithRecurrence.length,
        processingTime
      };

    } catch (error) {
      console.error('🚨 Enhanced detection failed:', error);
      throw new Error(`Subscription detection failed: ${error}`);
    }
  }

  /**
   * Broad filter for emails that might be subscription-related
   */
  private filterPotentialSubscriptions(emails: Email[]): Email[] {
    return emails.filter(email => {
      const content = (email.content + ' ' + email.subject + ' ' + email.fromEmail + ' ' + (email.fromName || '')).toLowerCase();
      
      // Broad subscription keywords - be inclusive rather than exclusive
      const subscriptionKeywords = [
        // Billing & Payment
        'invoice', 'receipt', 'payment', 'bill', 'charged', 'billing', 'due', 'renewal', 'renew',
        'subscription', 'plan', 'membership', 'premium', 'pro', 'upgrade',
        // Indian specific
        'sip', 'mutual fund', 'insurance', 'policy', 'premium', 'emi', 'loan',
        // Services
        'netflix', 'amazon', 'apple', 'google', 'microsoft', 'adobe', 'spotify',
        'dropbox', 'zoom', 'slack', 'github', 'office', 'cloud',
        // Financial
        'bank', 'credit card', 'debit', 'transaction', 'amount', 'rs.', '₹',
        // General indicators  
        'monthly', 'annual', 'yearly', 'quarterly', 'auto', 'recurring',
        'reminder', 'alert', 'notice', 'statement', 'confirmation'
      ];
      
      // Check if email has subscription indicators
      const hasSubscriptionKeywords = subscriptionKeywords.some(keyword => content.includes(keyword));
      
      // Check if email has financial amounts
      const hasAmount = email.extractedAmount && parseFloat(email.extractedAmount) > 0;
      
      // Check if from business/service domains
      const fromDomain = email.fromEmail.split('@')[1]?.toLowerCase() || '';
      const isBusinessDomain = !fromDomain.includes('gmail.com') && 
                               !fromDomain.includes('yahoo.com') && 
                               !fromDomain.includes('hotmail.com') &&
                               !fromDomain.includes('outlook.com');
      
      // Include email if it has subscription keywords OR financial amount OR from business domain
      return hasSubscriptionKeywords || hasAmount || isBusinessDomain;
    });
  }

  /**
   * STAGE 1: Batch classify all emails to identify subscription candidates
   * Reduces many emails to 1-2 API calls
   */
  private async batchClassifyEmails(emails: Email[]): Promise<Email[]> {
    if (emails.length === 0) return [];

    const batchSize = 50; // Can handle more emails in classification
    const candidates: Email[] = [];
    
    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      
      // Prepare lightweight email data for classification
      const emailData = batch.map((email, idx) => ({
        id: idx,
        subject: email.subject,
        from: email.fromEmail,
        fromName: email.fromName || '',
        extractedAmount: email.extractedAmount || '',
        extractedCurrency: email.extractedCurrency || '',
        merchantName: email.merchantName || '',
        contentSnippet: email.content?.substring(0, 200) || ''
      }));

      const systemPrompt = `You are an expert at identifying subscription-related emails. 

Analyze these ${batch.length} emails and classify each one with a confidence score for being subscription-related.

SUBSCRIPTION INDICATORS:
- Bills, invoices, receipts for recurring services
- Payment confirmations for subscriptions  
- Renewal notices, billing statements
- Service providers like telecom, streaming, software, utilities
- Words like: bill, invoice, subscription, payment, renewal, monthly, plan

RETURN: JSON array with exact format:
[
  {"id": 0, "isSubscription": true, "confidence": "high", "reason": "Airtel bill - telecom subscription"},
  {"id": 1, "isSubscription": false, "confidence": "low", "reason": "One-time purchase notification"},
  ...
]

EMAILS TO ANALYZE:
${JSON.stringify(emailData, null, 2)}`;

      try {
        const response = await this.ai.models.generateContent({
          model: "gemini-2.5-pro",
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: "application/json",
            responseSchema: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "number" },
                  isSubscription: { type: "boolean" },
                  confidence: { type: "string", enum: ["high", "medium", "low"] },
                  reason: { type: "string" }
                },
                required: ["id", "isSubscription", "confidence", "reason"]
              }
            }
          },
          contents: systemPrompt
        });
        
        const results: BatchClassificationResult[] = JSON.parse(response.text || '[]');
          
        // Add high-confidence subscription candidates
        for (const result of results) {
          if (result.isSubscription && (result.confidence === 'high' || result.confidence === 'medium')) {
            candidates.push(batch[result.id]);
          }
        }
        
        console.log(`📊 Batch ${Math.floor(i/batchSize) + 1}: ${results.filter((r: any) => r.isSubscription).length}/${batch.length} identified as subscriptions`);
      } catch (error) {
        console.error(`❌ Classification failed for batch ${Math.floor(i/batchSize) + 1}:`, error);
        // Fallback: include all emails if classification fails
        candidates.push(...batch);
      }
      
      // Rate limiting between classification batches
      if (i + batchSize < emails.length) {
        await this.delay(1000);
      }
    }
    
    return candidates;
  }

  /**
   * STAGE 2: Detailed batch analysis of subscription candidates
   * Processes 8 emails per API call for detailed extraction
   */
  private async batchAnalyzeSubscriptionCandidates(candidates: Email[], userId: string): Promise<InsertSubscriptionSuggestion[]> {
    if (candidates.length === 0) return [];

    const suggestions: InsertSubscriptionSuggestion[] = [];
    const batchSize = 8; // Optimal size for detailed analysis
    
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      
      try {
        const batchSuggestions = await this.analyzeBatchDetailed(batch, userId);
        suggestions.push(...batchSuggestions);
        
        console.log(`🎯 Analyzed batch ${Math.floor(i/batchSize) + 1}: ${batchSuggestions.length} suggestions generated`);
      } catch (error) {
        console.error(`❌ Detailed analysis failed for batch ${Math.floor(i/batchSize) + 1}:`, error);
        // Fallback: try individual analysis for this batch
        for (const email of batch) {
          try {
            const suggestion = await this.analyzeIndividualEmail(email, userId);
            if (suggestion) suggestions.push(suggestion);
          } catch (individualError) {
            console.error(`❌ Individual fallback failed for ${email.subject}:`, individualError);
          }
        }
      }
      
      // Rate limiting between analysis batches
      if (i + batchSize < candidates.length) {
        await this.delay(2000);
      }
    }
    
    return suggestions;
  }

  /**
   * Analyze a batch of emails for detailed subscription extraction
   */
  private async analyzeBatchDetailed(emails: Email[], userId: string): Promise<InsertSubscriptionSuggestion[]> {
    const emailData = emails.map((email, idx) => ({
      id: idx,
      subject: email.subject,
      from: email.fromEmail,
      fromName: email.fromName || '',
      receivedAt: email.receivedAt,
      extractedAmount: email.extractedAmount || '',
      extractedCurrency: email.extractedCurrency || '',
      merchantName: email.merchantName || '',
      content: email.content?.substring(0, 800) || ''
    }));

    const systemPrompt = `You are an expert at extracting subscription details from billing emails.

Analyze these ${emails.length} subscription-related emails and extract detailed subscription information for each.

EXTRACT for each email:
- serviceName: Clear service name (e.g., "Netflix Premium", "Airtel Postpaid")
- amount: Exact billing amount as number
- currency: Currency code (INR, USD, etc.)
- frequency: monthly/quarterly/yearly/weekly
- category: telecom/streaming/software/utilities/other
- confidence: high/medium/low based on subscription evidence
- nextBillingDate: If mentioned in email

RETURN: JSON array with exact format:
[
  {
    "id": 0,
    "isSubscription": true,
    "serviceName": "Airtel Black Plan",
    "amount": 399,
    "currency": "INR", 
    "frequency": "monthly",
    "category": "telecom",
    "confidence": "high",
    "nextBillingDate": null,
    "merchantName": "Bharti Airtel",
    "merchantEmail": "noreply@airtel.com"
  },
  ...
]

EMAILS TO ANALYZE:
${JSON.stringify(emailData, null, 2)}`;

    const response = await this.ai.models.generateContent({
      model: "gemini-2.5-pro",
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "number" },
              isSubscription: { type: "boolean" },
              serviceName: { type: "string" },
              amount: { type: "number" },
              currency: { type: "string" },
              frequency: { type: "string", enum: ["monthly", "quarterly", "yearly", "weekly"] },
              category: { type: "string", enum: ["telecom", "streaming", "software", "utilities", "other"] },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              nextBillingDate: { type: ["string", "null"] },
              merchantName: { type: "string" },
              merchantEmail: { type: "string" }
            },
            required: ["id", "isSubscription", "serviceName", "amount", "currency", "frequency", "category", "confidence"]
          }
        }
      },
      contents: systemPrompt
    });
    
    const results: BatchAnalysisResult[] = JSON.parse(response.text || '[]');
    const suggestions: InsertSubscriptionSuggestion[] = [];
    
    for (const result of results) {
      if (result.isSubscription && result.serviceName && result.amount) {
        const email = emails[result.id];
        
        // Calculate confidence score (0.00-1.00 as required by schema)
        const confidenceScoreMap = {
          'high': 0.85,
          'medium': 0.65,
          'low': 0.45
        };
        
        suggestions.push({
          userId,
          serviceName: result.serviceName,
          merchantName: result.merchantName || email.fromName || email.fromEmail,
          amount: result.amount.toString(),
          currency: result.currency || 'INR',
          frequency: result.frequency,
          category: result.category || 'other',
          confidence: result.confidence,
          confidenceScore: confidenceScoreMap[result.confidence].toString(),
          reasoning: `Detailed batch analysis: ${result.confidence} confidence subscription detection`,
          evidenceEmailIds: [email.id],
          occurrences: 1,
          recurrenceType: null,
          recurrenceScore: 0,
          nextBillingDate: result.nextBillingDate ? new Date(result.nextBillingDate) : null,
          lastSeen: new Date(email.receivedAt),
          status: 'pending'
        });
      }
    }
    
    return suggestions;
  }

  /**
   * Analyze individual email with AI to determine if it's a subscription (fallback)
   */
  private async analyzeIndividualEmail(email: Email, userId: string): Promise<InsertSubscriptionSuggestion | null> {
    try {
      const emailContext = {
        subject: email.subject,
        from: email.fromEmail,
        fromName: email.fromName,
        date: email.receivedAt,
        amount: email.extractedAmount,
        currency: email.extractedCurrency,
        content: email.content?.substring(0, 2000) || ''
      };

      const systemPrompt = `You are an expert at identifying subscription services from individual emails. Analyze this email to determine if it represents a subscription service.

Key indicators to look for:
- Recurring billing patterns (monthly, yearly, etc.)
- Subscription service names (Netflix, Apple, insurance, SIP, etc.)
- Payment confirmations or due notices
- Service renewals or upgrades
- Membership fees or premiums

Even a SINGLE email can indicate a subscription if it's clearly from a subscription service.

Focus on:
1. Service identification
2. Billing amount and currency
3. Billing frequency (infer from context)
4. Service category
5. Confidence assessment

Respond with valid JSON only:`;

      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-pro",
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              isSubscription: { type: "boolean" },
              serviceName: { type: "string" },
              merchantName: { type: "string" },
              amount: { type: "number" },
              currency: { type: "string" },
              frequency: { type: "string", enum: ["weekly", "monthly", "quarterly", "yearly"] },
              category: { type: "string" },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              confidenceScore: { type: "number", minimum: 0, maximum: 1 },
              reasoning: { type: "string" }
            },
            required: ["isSubscription", "serviceName", "merchantName", "amount", "currency", "frequency", "category", "confidence", "confidenceScore", "reasoning"]
          }
        },
        contents: `Individual email analysis:\n\nSubject: ${email.subject}\nFrom: ${email.fromEmail} (${email.fromName || 'N/A'})\nDate: ${email.receivedAt}\nExtracted Amount: ${email.extractedAmount || 'N/A'}\nExtracted Currency: ${email.extractedCurrency || 'N/A'}\n\nContent:\n${emailContext.content}`
      });

      const result = JSON.parse(response.text || '{}');
      
      if (result.isSubscription && result.confidenceScore >= 0.2) {
        const suggestion: InsertSubscriptionSuggestion = {
          userId,
          serviceName: result.serviceName,
          merchantName: result.merchantName,
          amount: result.amount.toString(),
          currency: result.currency || 'INR',
          frequency: result.frequency,
          category: result.category,
          confidence: result.confidence,
          confidenceScore: result.confidenceScore.toString(),
          reasoning: `Individual email analysis: ${result.reasoning}`,
          evidenceEmailIds: [email.id],
          occurrences: 1,
          recurrenceType: null,
          recurrenceScore: 0,
          nextBillingDate: null,
          lastSeen: new Date(email.receivedAt),
          status: 'pending'
        };

        return suggestion;
      }

      return null;
    } catch (error) {
      console.error(`❌ Failed to analyze individual email "${email.subject}":`, error);
      return null;
    }
  }

  /**
   * Boost confidence scores for suggestions that have recurrence patterns
   */
  private boostConfidenceWithRecurrence(suggestions: InsertSubscriptionSuggestion[], clusters: Array<any>): void {
    for (const suggestion of suggestions) {
      // Find matching cluster for this suggestion
      const matchingCluster = clusters.find(cluster => {
        const clusterEmails = cluster.emails || [];
        return clusterEmails.some((email: Email) => 
          suggestion.evidenceEmailIds?.includes(email.id)
        );
      });

      if (matchingCluster && matchingCluster.recurrence?.confidence > 30) {
        // Boost confidence score based on recurrence pattern
        const currentScore = parseFloat(suggestion.confidenceScore);
        const recurrenceBonus = (matchingCluster.recurrence.confidence / 100) * 0.2; // Max 20% boost
        const boostedScore = Math.min(1.0, currentScore + recurrenceBonus);
        
        suggestion.confidenceScore = boostedScore.toFixed(2);
        suggestion.recurrenceScore = matchingCluster.recurrence.confidence;
        suggestion.recurrenceType = matchingCluster.recurrence.frequency;
        suggestion.occurrences = matchingCluster.emails?.length || 1;
        suggestion.evidenceEmailIds = matchingCluster.emails?.map((e: Email) => e.id) || suggestion.evidenceEmailIds;
        suggestion.nextBillingDate = matchingCluster.recurrence.nextPredictedDate;
        
        // Update confidence level based on boosted score
        if (boostedScore >= 0.80) suggestion.confidence = 'high';
        else if (boostedScore >= 0.60) suggestion.confidence = 'medium';
        else suggestion.confidence = 'low';
        
        suggestion.reasoning += ` | Recurrence boost: ${matchingCluster.recurrence.confidence}% confidence in ${matchingCluster.recurrence.frequency} pattern with ${matchingCluster.emails?.length || 1} occurrences`;
        
        console.log(`🚀 Boosted confidence for ${suggestion.serviceName}: ${currentScore.toFixed(2)} → ${boostedScore.toFixed(2)} (recurrence: ${matchingCluster.recurrence.confidence}%)`);
      }
    }
  }

  /**
   * Save suggestions with deduplication
   */
  private async saveWithDeduplication(suggestions: InsertSubscriptionSuggestion[], userId: string): Promise<InsertSubscriptionSuggestion[]> {
    if (suggestions.length === 0) return [];

    // Deduplicate suggestions by service name and merchant
    const deduplicatedSuggestions = this.deduplicateSuggestions(suggestions);
    
    try {
      // Use bulk insert for efficiency
      const savedSuggestions = await this.storage.createSuggestionsBulk(deduplicatedSuggestions);
      return savedSuggestions;
    } catch (error) {
      console.error('❌ Failed to save suggestions in bulk, trying individual saves:', error);
      
      // Fallback: save individually
      const savedSuggestions: InsertSubscriptionSuggestion[] = [];
      for (const suggestion of deduplicatedSuggestions) {
        try {
          const saved = await this.storage.createSuggestion(suggestion);
          savedSuggestions.push(saved);
        } catch (individualError) {
          console.error(`❌ Failed to save suggestion for ${suggestion.serviceName}:`, individualError);
        }
      }
      return savedSuggestions;
    }
  }

  /**
   * Deduplicate suggestions based on service name and merchant
   */
  private deduplicateSuggestions(suggestions: InsertSubscriptionSuggestion[]): InsertSubscriptionSuggestion[] {
    const seen = new Map<string, InsertSubscriptionSuggestion>();
    
    for (const suggestion of suggestions) {
      const key = `${suggestion.serviceName.toLowerCase()}_${suggestion.merchantName?.toLowerCase() || 'unknown'}_${suggestion.currency}_${Math.round(parseFloat(suggestion.amount))}`;
      
      const existing = seen.get(key);
      if (!existing || parseFloat(suggestion.confidenceScore) > parseFloat(existing.confidenceScore)) {
        seen.set(key, suggestion);
      }
    }
    
    return Array.from(seen.values()).sort((a, b) => 
      parseFloat(b.confidenceScore) - parseFloat(a.confidenceScore)
    );
  }

  /**
   * Utility method for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export a singleton instance
export const enhancedSubscriptionDetector = new EnhancedSubscriptionDetector();