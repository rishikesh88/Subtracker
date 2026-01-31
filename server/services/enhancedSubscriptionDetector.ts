/**
 * Enhanced Subscription Detection Service
 * Combines recurrence analysis with LLM-powered suggestion generation
 * 
 * OPTIMIZED Hybrid Two-Stage Pipeline:
 * - Stage 1: Parallel batch classification (100 emails per API call, 5 concurrent)
 * - Stage 2: Parallel detailed analysis (15 emails per API call, 5 concurrent)
 * - Uses gemini-2.5-flash for Stage 1 (faster), gemini-2.5-pro for Stage 2 (accuracy)
 * - Reduced inter-batch delays for maximum throughput
 */

import { GoogleGenAI } from "@google/genai";
import { type Email, type InsertSubscriptionSuggestion } from "@shared/schema";
import { IStorage } from "../storage";
import { recurrenceAnalyzer, type EmailCluster } from "./recurrenceAnalyzer";
import { generateServiceKey, amountsAreSimilar } from "../utils/serviceKey";

// Concurrency limit for parallel API calls
const PARALLEL_CONCURRENCY = 5;

interface SuggestionGenerationResult {
  suggestions: InsertSubscriptionSuggestion[];
  totalAnalyzed: number;
  highConfidenceCount: number;
  recurrenceClusters: number;
  processingTime: number;
}

// Callback for progressive loading - called when each suggestion is saved
type ProgressCallback = (data: {
  stage: string;
  progress: number;
  message: string;
  details?: any;
}) => void;

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
  lastBillingDate?: string;
  nextBillingDate?: string;
  merchantName: string;
  merchantEmail: string;
  reasoning: string;
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
   * Now supports progressive loading - suggestions are saved immediately as they're found
   */
  async detectSubscriptionSuggestions(
    emails: Email[], 
    userId: string,
    onProgress?: ProgressCallback
  ): Promise<SuggestionGenerationResult> {
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
      
      // Send progress update after Stage 1
      if (onProgress) {
        onProgress({
          stage: 'stage1_complete',
          progress: 30,
          message: `Found ${subscriptionCandidates.length} potential subscriptions`,
          details: { candidates: subscriptionCandidates.length, totalEmails: emails.length }
        });
      }
      
      // STAGE 2: Detailed Batch Analysis with PROGRESSIVE SAVING
      console.log(`🎯 Stage 2: Detailed batch analysis of ${subscriptionCandidates.length} candidates...`);
      const individualSuggestions: InsertSubscriptionSuggestion[] = [];
      
      if (subscriptionCandidates.length > 0) {
        const detailedSuggestions = await this.batchAnalyzeSubscriptionCandidatesProgressive(
          subscriptionCandidates, 
          userId,
          onProgress
        );
        individualSuggestions.push(...detailedSuggestions);
      }

      const totalApiCalls = Math.ceil(potentialSubscriptionEmails.length / 100) + Math.ceil(subscriptionCandidates.length / 15);
      const pipelineDuration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✅ Hybrid pipeline complete: ${individualSuggestions.length} suggestions in ${pipelineDuration}s with ${totalApiCalls} API calls (parallel processing)`);

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
   * OPTIMIZED: Uses parallel processing, larger batches, and faster model
   */
  private async batchClassifyEmails(emails: Email[]): Promise<Email[]> {
    if (emails.length === 0) return [];

    const batchSize = 100; // Increased from 50 for fewer API calls
    const stageStartTime = Date.now();
    const totalBatches = Math.ceil(emails.length / batchSize);
    console.log(`⚡ Stage 1: Processing ${emails.length} emails in ${totalBatches} batches (parallel, ${PARALLEL_CONCURRENCY} concurrent)`);

    // Process a single batch - this function will be called in parallel
    const processBatch = async (batch: Email[], batchIndex: number): Promise<Email[]> => {
      const emailData = batch.map((email, idx) => ({
        id: idx,
        subject: email.subject,
        from: email.fromEmail,
        fromName: email.fromName || '',
        extractedAmount: email.extractedAmount || '',
        extractedCurrency: email.extractedCurrency || '',
        merchantName: email.merchantName || '',
        contentSnippet: email.content?.substring(0, 150) || '' // Reduced for speed
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
          model: "gemini-2.5-flash", // Faster model for classification
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
        const batchCandidates: Email[] = [];
          
        // Add high-confidence subscription candidates
        for (const result of results) {
          if (result.isSubscription && (result.confidence === 'high' || result.confidence === 'medium')) {
            batchCandidates.push(batch[result.id]);
          }
        }
        
        console.log(`📊 Batch ${batchIndex + 1}: ${results.filter((r: any) => r.isSubscription).length}/${batch.length} identified as subscriptions`);
        return batchCandidates;
      } catch (error) {
        console.error(`❌ Classification failed for batch ${batchIndex + 1}:`, error);
        // Fallback: include all emails if classification fails
        return batch;
      }
    };

    // Process all batches in parallel with concurrency limit
    const batchResults = await this.processInParallel(
      emails,
      batchSize,
      processBatch,
      200 // Reduced delay between waves (was 1000ms)
    );

    // Flatten results
    const candidates = batchResults.flat();
    const stageDuration = ((Date.now() - stageStartTime) / 1000).toFixed(1);
    console.log(`⏱️ Stage 1 completed in ${stageDuration}s (${candidates.length} candidates from ${emails.length} emails)`);
    
    return candidates;
  }

  /**
   * STAGE 2: Detailed batch analysis with PROGRESSIVE SAVING
   * Saves suggestions immediately as batches complete and emits SSE events
   */
  private async batchAnalyzeSubscriptionCandidatesProgressive(
    candidates: Email[], 
    userId: string,
    onProgress?: ProgressCallback
  ): Promise<InsertSubscriptionSuggestion[]> {
    if (candidates.length === 0) return [];

    const batchSize = 15;
    const stageStartTime = Date.now();
    const totalBatches = Math.ceil(candidates.length / batchSize);
    let totalSavedCount = 0;
    const allSuggestions: InsertSubscriptionSuggestion[] = [];
    
    console.log(`⚡ Stage 2 (Progressive): Processing ${candidates.length} candidates in ${totalBatches} batches`);

    // Process batches and save immediately as they complete
    const processBatchAndSave = async (batch: Email[], batchIndex: number): Promise<InsertSubscriptionSuggestion[]> => {
      try {
        const batchSuggestions = await this.analyzeBatchDetailed(batch, userId);
        
        // PROGRESSIVE SAVING: Save each suggestion immediately
        if (batchSuggestions.length > 0) {
          const savedSuggestions = await this.saveWithDeduplication(batchSuggestions, userId);
          totalSavedCount += savedSuggestions.length;
          
          // Emit SSE event for each new suggestion found
          if (onProgress && savedSuggestions.length > 0) {
            onProgress({
              stage: 'suggestion_found',
              progress: Math.round(30 + (batchIndex / totalBatches) * 60),
              message: `Found ${totalSavedCount} subscriptions so far...`,
              details: {
                newSuggestions: savedSuggestions.length,
                totalSuggestions: totalSavedCount,
                batchNumber: batchIndex + 1,
                totalBatches,
                suggestions: savedSuggestions.map(s => ({
                  serviceName: s.serviceName,
                  amount: s.amount,
                  currency: s.currency,
                  confidence: s.confidence
                }))
              }
            });
          }
          
          console.log(`🎯 Batch ${batchIndex + 1}: ${savedSuggestions.length} saved (total: ${totalSavedCount})`);
          return savedSuggestions as InsertSubscriptionSuggestion[];
        }
        
        console.log(`🎯 Batch ${batchIndex + 1}: 0 suggestions`);
        return [];
      } catch (error) {
        console.error(`❌ Batch ${batchIndex + 1} failed:`, error);
        return [];
      }
    };

    // Process all batches in parallel with concurrency limit
    const batchResults = await this.processInParallel(
      candidates,
      batchSize,
      processBatchAndSave,
      500
    );

    allSuggestions.push(...batchResults.flat());
    const stageDuration = ((Date.now() - stageStartTime) / 1000).toFixed(1);
    console.log(`⏱️ Stage 2 completed in ${stageDuration}s (${totalSavedCount} saved from ${candidates.length} candidates)`);
    
    // Send completion event
    if (onProgress) {
      onProgress({
        stage: 'stage2_complete',
        progress: 90,
        message: `Analysis complete! Found ${totalSavedCount} subscriptions`,
        details: { totalSuggestions: totalSavedCount }
      });
    }
    
    return allSuggestions;
  }

  /**
   * STAGE 2: Detailed batch analysis of subscription candidates (legacy - non-progressive)
   * OPTIMIZED: Uses parallel processing and larger batches
   */
  private async batchAnalyzeSubscriptionCandidates(candidates: Email[], userId: string): Promise<InsertSubscriptionSuggestion[]> {
    if (candidates.length === 0) return [];

    const batchSize = 15; // Increased from 8 for fewer API calls
    const stageStartTime = Date.now();
    const totalBatches = Math.ceil(candidates.length / batchSize);
    console.log(`⚡ Stage 2: Processing ${candidates.length} candidates in ${totalBatches} batches (parallel, ${PARALLEL_CONCURRENCY} concurrent)`);

    // Process a single batch - this function will be called in parallel
    const processBatch = async (batch: Email[], batchIndex: number): Promise<InsertSubscriptionSuggestion[]> => {
      try {
        const batchSuggestions = await this.analyzeBatchDetailed(batch, userId);
        console.log(`🎯 Analyzed batch ${batchIndex + 1}: ${batchSuggestions.length} suggestions generated`);
        return batchSuggestions;
      } catch (error) {
        console.error(`❌ Detailed analysis failed for batch ${batchIndex + 1}:`, error);
        // Fallback: try individual analysis for this batch
        const fallbackSuggestions: InsertSubscriptionSuggestion[] = [];
        for (const email of batch) {
          try {
            const suggestion = await this.analyzeIndividualEmail(email, userId);
            if (suggestion) fallbackSuggestions.push(suggestion);
          } catch (individualError) {
            console.error(`❌ Individual fallback failed for ${email.subject}:`, individualError);
          }
        }
        return fallbackSuggestions;
      }
    };

    // Process all batches in parallel with concurrency limit
    const batchResults = await this.processInParallel(
      candidates,
      batchSize,
      processBatch,
      500 // Reduced delay between waves (was 2000ms)
    );

    // Flatten results
    const suggestions = batchResults.flat();
    const stageDuration = ((Date.now() - stageStartTime) / 1000).toFixed(1);
    console.log(`⏱️ Stage 2 completed in ${stageDuration}s (${suggestions.length} suggestions from ${candidates.length} candidates)`);
    
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
      content: email.content?.substring(0, 400) || '' // Reduced from 800 to 400 chars
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
- lastBillingDate: The date when this payment was made (from email date or mentioned date)
- nextBillingDate: If explicitly mentioned in email, otherwise null (will be calculated from lastBillingDate + frequency)
- reasoning: Concise explanation (30-50 words) of WHY this is detected as a subscription. Include: what subscription signals were found in the email (subject keywords, body content, attachments), the detected billing pattern, and confidence justification. Example: "Detected recurring monthly payment of ₹75 to iCloud from subject 'Your receipt from Apple' and body content mentioning '50GB storage plan renewal'. High confidence due to explicit subscription terms."

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
    "lastBillingDate": "2025-01-15",
    "nextBillingDate": null,
    "merchantName": "Bharti Airtel",
    "merchantEmail": "noreply@airtel.com",
    "reasoning": "Detected recurring monthly postpaid bill from subject 'Your Airtel Bill' with amount ₹399. Body mentions 'monthly plan renewal'. High confidence due to telecom billing pattern."
  },
  ...
]`;

    const emailsToAnalyze = `EMAILS TO ANALYZE:
${JSON.stringify(emailData, null, 2)}`;

    // Retry logic for transient network issues
    let response;
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        response = await this.ai.models.generateContent({
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
                  lastBillingDate: { type: "string" },
                  nextBillingDate: { type: "string" },
                  merchantName: { type: "string" },
                  merchantEmail: { type: "string" },
                  reasoning: { type: "string" }
                },
                required: ["id", "isSubscription", "serviceName", "amount", "currency", "frequency", "category", "confidence", "reasoning"]
              }
            }
          },
          contents: emailsToAnalyze // Only email data, not duplicating systemPrompt
        });
        break; // Success, exit retry loop
      } catch (error: any) {
        lastError = error;
        console.log(`🔄 Retry ${attempt}/2 failed for detailed analysis:`, error.message);
        if (attempt < 2) {
          await this.delay(1500); // 1.5s backoff before retry
        }
      }
    }
    
    if (!response) {
      throw lastError;
    }
    
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
        
        // Calculate nextBillingDate from lastBillingDate if not provided
        let nextBillingDate: Date | null = null;
        if (result.nextBillingDate) {
          nextBillingDate = new Date(result.nextBillingDate);
        } else if (result.lastBillingDate) {
          const lastDate = new Date(result.lastBillingDate);
          switch (result.frequency) {
            case 'weekly':
              nextBillingDate = new Date(lastDate.setDate(lastDate.getDate() + 7));
              break;
            case 'monthly':
              nextBillingDate = new Date(lastDate.setMonth(lastDate.getMonth() + 1));
              break;
            case 'quarterly':
              nextBillingDate = new Date(lastDate.setMonth(lastDate.getMonth() + 3));
              break;
            case 'yearly':
              nextBillingDate = new Date(lastDate.setFullYear(lastDate.getFullYear() + 1));
              break;
          }
        }
        
        suggestions.push({
          userId,
          serviceName: result.serviceName,
          serviceKey: generateServiceKey(result.serviceName, result.merchantName || email.fromName || email.fromEmail, result.frequency),
          merchantName: result.merchantName || email.fromName || email.fromEmail,
          amount: result.amount.toString(),
          currency: result.currency || 'INR',
          frequency: result.frequency,
          category: result.category || 'other',
          confidence: result.confidence,
          confidenceScore: confidenceScoreMap[result.confidence].toString(),
          reasoning: result.reasoning || `Detected ${result.frequency} subscription to ${result.serviceName} from email patterns.`,
          evidenceEmailIds: [email.id],
          occurrences: 1,
          recurrenceType: null,
          recurrenceScore: 0,
          nextBillingDate,
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
          serviceKey: generateServiceKey(result.serviceName, result.merchantName, result.frequency),
          merchantName: result.merchantName,
          amount: result.amount.toString(),
          currency: result.currency || 'INR',
          frequency: result.frequency,
          category: result.category,
          confidence: result.confidence,
          confidenceScore: result.confidenceScore.toString(),
          reasoning: result.reasoning || `Detected ${result.frequency} subscription to ${result.serviceName} from email patterns.`,
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
   * Deduplicate suggestions based on serviceKey and amount similarity
   */
  private deduplicateSuggestions(suggestions: InsertSubscriptionSuggestion[]): InsertSubscriptionSuggestion[] {
    const serviceGroups = new Map<string, InsertSubscriptionSuggestion[]>();
    
    // First group by serviceKey (this handles "Airtel Black" -> "airtel_monthly")
    for (const suggestion of suggestions) {
      const serviceKey = suggestion.serviceKey || generateServiceKey(
        suggestion.serviceName, 
        suggestion.merchantName || undefined, 
        suggestion.frequency
      );
      
      if (!serviceGroups.has(serviceKey)) {
        serviceGroups.set(serviceKey, []);
      }
      serviceGroups.get(serviceKey)!.push(suggestion);
    }
    
    const deduplicated: InsertSubscriptionSuggestion[] = [];
    
    // For each service group, consolidate similar amounts
    for (const [serviceKey, groupSuggestions] of Array.from(serviceGroups.entries())) {
      if (groupSuggestions.length === 1) {
        deduplicated.push(groupSuggestions[0]);
        continue;
      }
      
      // Group by similar amounts (±5% tolerance)
      const amountGroups: InsertSubscriptionSuggestion[][] = [];
      
      for (const suggestion of groupSuggestions) {
        let foundGroup = false;
        
        for (const amountGroup of amountGroups) {
          if (amountsAreSimilar(suggestion.amount, amountGroup[0].amount)) {
            amountGroup.push(suggestion);
            foundGroup = true;
            break;
          }
        }
        
        if (!foundGroup) {
          amountGroups.push([suggestion]);
        }
      }
      
      // Keep the highest confidence suggestion from each amount group
      for (const amountGroup of amountGroups) {
        const bestSuggestion = amountGroup.reduce((best, current) => {
          const currentScore = parseFloat(current.confidenceScore || '0');
          const bestScore = parseFloat(best.confidenceScore || '0');
          return currentScore > bestScore ? current : best;
        });
        deduplicated.push(bestSuggestion);
      }
    }
    
    return deduplicated.sort((a, b) => {
      const scoreA = parseFloat(a.confidenceScore || '0');
      const scoreB = parseFloat(b.confidenceScore || '0');
      return scoreB - scoreA;
    });
  }

  /**
   * Utility method for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Process batches in parallel with concurrency limit
   * Runs up to PARALLEL_CONCURRENCY batches simultaneously for faster processing
   */
  private async processInParallel<T, R>(
    items: T[],
    batchSize: number,
    processor: (batch: T[], batchIndex: number) => Promise<R>,
    delayMs: number = 200
  ): Promise<R[]> {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    const results: R[] = [];
    
    // Process in waves of PARALLEL_CONCURRENCY
    for (let wave = 0; wave < batches.length; wave += PARALLEL_CONCURRENCY) {
      const waveBatches = batches.slice(wave, wave + PARALLEL_CONCURRENCY);
      const waveStartIndex = wave;
      
      const wavePromises = waveBatches.map((batch, idx) => 
        processor(batch, waveStartIndex + idx)
      );
      
      const waveResults = await Promise.all(wavePromises);
      results.push(...waveResults);
      
      // Small delay between waves to avoid rate limiting
      if (wave + PARALLEL_CONCURRENCY < batches.length) {
        await this.delay(delayMs);
      }
    }
    
    return results;
  }
}

// Import storage and export a singleton instance
import { storage } from "../storage";
export const enhancedSubscriptionDetector = new EnhancedSubscriptionDetector(storage);