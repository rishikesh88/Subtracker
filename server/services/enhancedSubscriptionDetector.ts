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
   * Main detection workflow: analyze emails for recurring patterns and generate suggestions
   */
  async detectSubscriptionSuggestions(emails: Email[], userId: string): Promise<SuggestionGenerationResult> {
    const startTime = Date.now();
    console.log(`🤖 Starting enhanced subscription detection for ${emails.length} emails...`);

    try {
      // Step 1: Analyze recurrence patterns
      console.log(`📊 Step 1: Analyzing recurring patterns...`);
      const clustersWithRecurrence = recurrenceAnalyzer.analyzeAllClusters(emails);
      console.log(`✅ Found ${clustersWithRecurrence.length} potential recurring clusters`);

      // Step 2: Use LLM to enrich high-confidence clusters
      console.log(`🧠 Step 2: Using LLM to analyze promising clusters...`);
      const suggestions: InsertSubscriptionSuggestion[] = [];
      
      for (const cluster of clustersWithRecurrence) {
        // Only process clusters with decent recurrence confidence
        if (cluster.recurrence.confidence >= 30) {
          const llmResult = await this.analyzeClusters([cluster], userId);
          suggestions.push(...llmResult);
          
          // Small delay to respect rate limits
          await this.delay(500);
        }
      }

      // Step 3: Store suggestions in database
      console.log(`💾 Step 3: Storing ${suggestions.length} suggestions...`);
      const createdSuggestions = await this.storage.createSuggestionsBulk(suggestions);
      
      const highConfidenceCount = suggestions.filter(s => s.confidence === 'high').length;
      const processingTime = Date.now() - startTime;

      console.log(`✨ Detection complete: ${suggestions.length} suggestions generated in ${processingTime}ms`);
      console.log(`📈 High confidence: ${highConfidenceCount}, Medium: ${suggestions.filter(s => s.confidence === 'medium').length}, Low: ${suggestions.filter(s => s.confidence === 'low').length}`);

      return {
        suggestions: createdSuggestions,
        totalAnalyzed: emails.length,
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

        const result = JSON.parse(response.text);
        
        if (result.isSubscription && result.confidenceScore >= 0.3) {
          // Calculate final confidence score combining LLM and recurrence
          const baseScore = result.confidenceScore;
          const recurrenceBonus = (cluster.recurrence.confidence / 100) * 0.15;
          const amountConsistencyBonus = cluster.amountVariance < 5 ? 0.1 : 0;
          const occurrenceBonus = cluster.emails.length >= 5 ? 0.1 : cluster.emails.length >= 3 ? 0.05 : 0;
          
          const finalScore = Math.min(1.0, baseScore + recurrenceBonus + amountConsistencyBonus + occurrenceBonus);
          
          // Map score to confidence level
          let confidenceLevel: 'high' | 'medium' | 'low';
          if (finalScore >= 0.8) confidenceLevel = 'high';
          else if (finalScore >= 0.6) confidenceLevel = 'medium';
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
            confidenceScore: finalScore.toString(),
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

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const enhancedSubscriptionDetector = new EnhancedSubscriptionDetector(require('../storage').storage);