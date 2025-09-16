/**
 * Enhanced Subscription Detection Service
 * Combines recurrence analysis with LLM-powered suggestion generation
 */

import { GoogleGenAI } from "@google/genai";
import { type Email, type InsertSubscriptionSuggestion } from "@shared/schema";
import { IStorage } from "../storage";
import { recurrenceAnalyzer, type EmailCluster } from "./recurrenceAnalyzer";

interface LLMSuggestionResult {
  serviceName: string;
  merchantName: string;
  amount: number;
  currency: string;
  frequency: 'monthly' | 'quarterly' | 'yearly' | 'weekly';
  category: string;
  confidence: 'high' | 'medium' | 'low';
  confidenceScore: number;
  reasoning: string;
}

interface SuggestionGenerationResult {
  suggestions: InsertSubscriptionSuggestion[];
  totalAnalyzed: number;
  highConfidenceCount: number;
  recurrenceClusters: number;
  processingTime: number;
}

export class EnhancedSubscriptionDetector {
  private ai: GoogleGenAI;
  private storage: IStorage;

  constructor(storage: IStorage) {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
    this.storage = storage;
  }

  /**
   * Main detection workflow: analyze ALL emails individually with AI first, then use recurrence as confidence booster
   */
  async detectSubscriptionSuggestions(emails: Email[], userId: string): Promise<SuggestionGenerationResult> {
    const startTime = Date.now();
    console.log(`🤖 Starting enhanced subscription detection for ${emails.length} emails...`);

    try {
      // Step 1: Filter emails that are likely subscription-related (broad filter)
      console.log(`🔍 Step 1: Pre-filtering emails for subscription potential...`);
      const potentialSubscriptionEmails = this.filterPotentialSubscriptions(emails);
      console.log(`✅ Found ${potentialSubscriptionEmails.length} potentially subscription-related emails`);

      // Step 2: Analyze emails in small batches with robust error handling
      console.log(`🧠 Step 2: Analyzing emails in batches with error resilience...`);
      const individualSuggestions: InsertSubscriptionSuggestion[] = [];
      const batchSize = 3; // Process 3 emails at a time to avoid rate limits
      const emailBatches = this.chunkArray(potentialSubscriptionEmails, batchSize);
      
      for (let batchIndex = 0; batchIndex < emailBatches.length; batchIndex++) {
        const batch = emailBatches[batchIndex];
        console.log(`📦 Processing batch ${batchIndex + 1}/${emailBatches.length} (${batch.length} emails)`);
        
        // Process each email in batch with individual error handling
        for (let i = 0; i < batch.length; i++) {
          const email = batch[i];
          const emailNumber = batchIndex * batchSize + i + 1;
          console.log(`🔬 Analyzing email ${emailNumber}/${potentialSubscriptionEmails.length}: ${email.subject}`);
          
          try {
            const suggestion = await this.analyzeIndividualEmailWithRetry(email, userId);
            if (suggestion) {
              individualSuggestions.push(suggestion);
              console.log(`✅ Generated suggestion for: ${suggestion.serviceName}`);
            }
          } catch (error) {
            console.error(`❌ Failed to analyze email "${email.subject}":`, error);
            // Continue with next email instead of failing entire process
          }
          
          // Aggressive rate limiting: 2 second delay between emails
          await this.delay(2000);
        }
        
        // Continue collecting suggestions without saving yet (we'll save after boosting confidence)
        
        // Longer delay between batches
        if (batchIndex < emailBatches.length - 1) {
          console.log(`⏳ Waiting 3 seconds between batches...`);
          await this.delay(3000);
        }
      }

      console.log(`✅ Individual analysis complete: ${individualSuggestions.length} suggestions generated`);

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
   * Analyze email clusters using Gemini LLM
   */
  private async analyzeClusters(clusters: Array<EmailCluster & { recurrence: any }>, userId: string): Promise<InsertSubscriptionSuggestion[]> {
    if (clusters.length === 0) return [];

    const suggestions: InsertSubscriptionSuggestion[] = [];

    for (const cluster of clusters) {
      try {
        // Prepare email context for LLM analysis
        const emailContext = cluster.emails.slice(0, 5).map(email => ({
          subject: email.subject,
          from: email.fromEmail,
          fromName: email.fromName,
          date: email.receivedAt,
          amount: email.extractedAmount,
          currency: email.extractedCurrency,
          content: email.content?.substring(0, 1500) || ''
        }));

        const systemPrompt = `You are an expert at identifying recurring subscription billing patterns. Analyze this cluster of related emails to determine if they represent a genuine subscription service.

FOCUS ON BILLING INDICATORS:
- Payment due notices, bills, invoices
- Subscription renewal notifications  
- Regular payment confirmations
- Utility bills with recurring cycles
- Membership fee notices

STRICT CRITERIA FOR SUBSCRIPTIONS:
✅ ACCEPT: Bills/invoices with due dates, subscription renewals, payment reminders, utility bills
❌ REJECT: Marketing emails, order confirmations, account updates, one-time purchases

Given this email cluster has:
- ${cluster.emails.length} emails from ${cluster.merchantName}
- Average amount: ₹${cluster.avgAmount.toFixed(2)}
- Detected frequency: ${cluster.recurrence.frequency || 'unknown'}
- Recurrence confidence: ${cluster.recurrence.confidence}%

Analyze if this represents a genuine recurring subscription and provide:
1. Service identification and categorization
2. Billing details and frequency
3. Confidence assessment with reasoning

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
          contents: `Email cluster analysis:\n\nMerchant: ${cluster.merchantName}\nEmails: ${cluster.emails.length}\nAverage Amount: ${cluster.avgAmount}\nRecurrence Pattern: ${cluster.recurrence.frequency} (${cluster.recurrence.confidence}% confidence)\n\nEmails:\n${JSON.stringify(emailContext, null, 2)}`
        });

        const result = JSON.parse(response.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
        
        if (result.isSubscription && result.confidenceScore >= 0.3) {
          // Calculate unified confidence score (0-100) combining LLM and recurrence
          const llmScore = result.confidenceScore * 100; // Convert 0-1 to 0-100
          const recurrenceScore = cluster.recurrence.confidence;
          const amountConsistencyScore = cluster.amountVariance < 5 ? 10 : cluster.amountVariance < 10 ? 5 : 0;
          const occurrenceScore = cluster.emails.length >= 5 ? 10 : cluster.emails.length >= 3 ? 5 : 0;
          
          // Weighted combination: LLM (60%) + Recurrence (30%) + Consistency (5%) + Occurrences (5%)
          const finalScore = Math.min(100, Math.round(
            (llmScore * 0.6) + (recurrenceScore * 0.3) + (amountConsistencyScore * 0.05) + (occurrenceScore * 0.05)
          ));
          
          // Map unified score to confidence level
          let confidenceLevel: 'high' | 'medium' | 'low';
          if (finalScore >= 80) confidenceLevel = 'high';
          else if (finalScore >= 60) confidenceLevel = 'medium';
          else confidenceLevel = 'low';

          const suggestion: InsertSubscriptionSuggestion = {
            userId,
            serviceName: result.serviceName,
            merchantName: result.merchantName,
            amount: result.amount.toString(),
            currency: result.currency || 'INR',
            frequency: result.frequency,
            category: result.category,
            confidence: confidenceLevel,
            confidenceScore: finalScore.toString(), // Unified 0-100 score
            reasoning: `${result.reasoning} | Recurrence: ${cluster.recurrence.confidence}% confidence in ${cluster.recurrence.frequency} pattern | ${cluster.emails.length} supporting emails`,
            evidenceEmailIds: cluster.emails.map(e => e.id),
            occurrences: cluster.emails.length,
            recurrenceType: cluster.recurrence.frequency,
            recurrenceScore: cluster.recurrence.confidence,
            nextBillingDate: cluster.recurrence.nextPredictedDate,
            lastSeen: new Date(Math.max(...cluster.emails.map(e => new Date(e.receivedAt).getTime()))),
            status: 'pending'
          };

          suggestions.push(suggestion);
        }

      } catch (error) {
        console.error(`❌ Failed to analyze cluster for ${cluster.merchantName}:`, error);
        // Continue with other clusters even if one fails
      }
    }

    return suggestions;
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
   * Analyze individual email with AI to determine if it's a subscription
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
        model: "gemini-2.0-flash-exp",
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

      const result = JSON.parse(response.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
      
      if (result.isSubscription && result.confidenceScore >= 0.2) { // Lower threshold for individual emails
        // Calculate initial confidence score (0-100)
        const llmScore = result.confidenceScore * 100;
        const amountConsistencyScore = email.extractedAmount ? 10 : 0;
        const businessDomainScore = !email.fromEmail.includes('@gmail.com') ? 5 : 0;
        
        // Base score from LLM + small bonuses
        const initialScore = Math.min(100, Math.round(llmScore + amountConsistencyScore + businessDomainScore));
        
        // Map score to confidence level
        let confidenceLevel: 'high' | 'medium' | 'low';
        if (initialScore >= 80) confidenceLevel = 'high';
        else if (initialScore >= 50) confidenceLevel = 'medium';
        else confidenceLevel = 'low';

        const suggestion: InsertSubscriptionSuggestion = {
          userId,
          serviceName: result.serviceName,
          merchantName: result.merchantName,
          amount: result.amount.toString(),
          currency: result.currency || 'INR',
          frequency: result.frequency,
          category: result.category,
          confidence: confidenceLevel,
          confidenceScore: initialScore.toString(),
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
        const currentScore = parseInt(suggestion.confidenceScore);
        const recurrenceBonus = Math.round(matchingCluster.recurrence.confidence * 0.2);
        const boostedScore = Math.min(100, currentScore + recurrenceBonus);
        
        suggestion.confidenceScore = boostedScore.toString();
        suggestion.recurrenceScore = matchingCluster.recurrence.confidence;
        suggestion.recurrenceType = matchingCluster.recurrence.frequency;
        suggestion.occurrences = matchingCluster.emails?.length || 1;
        suggestion.evidenceEmailIds = matchingCluster.emails?.map((e: Email) => e.id) || suggestion.evidenceEmailIds;
        suggestion.nextBillingDate = matchingCluster.recurrence.nextPredictedDate;
        
        // Update confidence level based on boosted score
        if (boostedScore >= 80) suggestion.confidence = 'high';
        else if (boostedScore >= 60) suggestion.confidence = 'medium';
        else suggestion.confidence = 'low';
        
        suggestion.reasoning += ` | Recurrence boost: ${matchingCluster.recurrence.confidence}% confidence in ${matchingCluster.recurrence.frequency} pattern with ${matchingCluster.emails?.length || 1} occurrences`;
        
        console.log(`🚀 Boosted confidence for ${suggestion.serviceName}: ${currentScore} → ${boostedScore} (recurrence: ${matchingCluster.recurrence.confidence}%)`);
      }
    }
  }

  /**
   * Split array into chunks of specified size
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Analyze individual email with retry logic and exponential backoff
   */
  private async analyzeIndividualEmailWithRetry(email: Email, userId: string, maxRetries: number = 3): Promise<InsertSubscriptionSuggestion | null> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.analyzeIndividualEmail(email, userId);
      } catch (error: any) {
        const isRateLimit = error?.message?.includes('429') || error?.message?.includes('quota') || error?.message?.includes('rate');
        
        if (isRateLimit && attempt < maxRetries) {
          const backoffDelay = Math.pow(2, attempt) * 2000; // Exponential backoff: 4s, 8s, 16s
          console.log(`⏰ Rate limit hit for "${email.subject}". Retrying in ${backoffDelay/1000}s (attempt ${attempt}/${maxRetries})`);
          await this.delay(backoffDelay);
          continue;
        }
        
        if (attempt === maxRetries) {
          console.error(`❌ Failed to analyze "${email.subject}" after ${maxRetries} attempts:`, error?.message || error);
          return null; // Give up after max retries
        }
        
        throw error; // Re-throw non-rate-limit errors immediately
      }
    }
    return null;
  }

  /**
   * Save suggestions with deduplication to prevent duplicates
   */
  private async saveWithDeduplication(suggestions: InsertSubscriptionSuggestion[], userId: string): Promise<any[]> {
    if (suggestions.length === 0) return [];

    try {
      // Get existing suggestions to check for duplicates
      const existingResult = await this.storage.getSuggestions(userId);
      const existingSuggestions = existingResult.suggestions;
      
      // Create deduplication key for each suggestion using available fields
      const createDedupeKey = (s: any) => 
        `${s.userId || ''}|${(s.serviceName || '').toLowerCase().trim()}|${s.amount || 0}|${(s.currency || 'USD').toLowerCase()}|${(s.frequency || '').toLowerCase()}|${(s.merchantName || '').toLowerCase().trim()}`;
      
      // Build deduplication set starting with existing suggestions
      const dedupeKeys = new Set(existingSuggestions.map(createDedupeKey));
      
      // Filter out duplicates (both existing and within current run)
      const uniqueSuggestions: InsertSubscriptionSuggestion[] = [];
      for (const suggestion of suggestions) {
        const key = createDedupeKey(suggestion);
        if (!dedupeKeys.has(key)) {
          dedupeKeys.add(key); // Prevent within-run duplicates too
          uniqueSuggestions.push(suggestion);
        }
      }
      
      if (uniqueSuggestions.length === 0) {
        console.log(`📋 All ${suggestions.length} suggestions are duplicates, skipping save`);
        return [];
      }
      
      console.log(`📋 Saving ${uniqueSuggestions.length} unique suggestions (${suggestions.length - uniqueSuggestions.length} duplicates filtered)`);
      
      // Try bulk save first
      try {
        return await this.storage.createSuggestionsBulk(uniqueSuggestions);
      } catch (bulkError) {
        console.error(`❌ Bulk save failed, trying individual saves:`, bulkError);
        return await this.saveIndividualSuggestions(uniqueSuggestions);
      }
      
    } catch (error) {
      console.error(`❌ Deduplication failed, attempting direct save:`, error);
      // Fallback to direct save without deduplication
      try {
        return await this.storage.createSuggestionsBulk(suggestions);
      } catch (directError) {
        console.error(`❌ Direct bulk save failed, trying individual saves:`, directError);
        return await this.saveIndividualSuggestions(suggestions);
      }
    }
  }

  /**
   * Fallback method to save suggestions individually if bulk save fails
   */
  private async saveIndividualSuggestions(suggestions: InsertSubscriptionSuggestion[]): Promise<any[]> {
    console.log(`🔄 Attempting individual save for ${suggestions.length} suggestions...`);
    const savedSuggestions: any[] = [];
    
    for (const suggestion of suggestions) {
      try {
        const saved = await this.storage.createSuggestion(suggestion);
        savedSuggestions.push(saved);
      } catch (error) {
        console.error(`❌ Failed to save individual suggestion for ${suggestion.serviceName}:`, error);
      }
    }
    
    console.log(`💾 Individual save complete: ${savedSuggestions.length}/${suggestions.length} suggestions saved`);
    return savedSuggestions;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

import { storage } from '../storage';
export const enhancedSubscriptionDetector = new EnhancedSubscriptionDetector(storage);