import { GoogleGenAI } from "@google/genai";
import { Email, Subscription } from "@shared/schema";

// Reference to blueprint for Gemini integration
// DON'T DELETE THIS COMMENT
// Follow these instructions when using this blueprint:
// - Note that the newest Gemini model series is "gemini-2.5-flash" or gemini-2.5-pro"
//   - do not change this unless explicitly requested by the user

interface SubscriptionSuggestion {
  serviceName: string;
  merchantName: string;
  amount: number;
  currency: string;
  frequency: 'monthly' | 'quarterly' | 'yearly' | 'weekly';
  category: string;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  nextBillingDate?: string;
  isActive: boolean;
}

interface GeminiAnalysisResult {
  subscriptions: SubscriptionSuggestion[];
  totalConfidentSubscriptions: number;
  analysisDate: string;
}

export class GeminiSubscriptionDetector {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  }

  async analyzeEmailsForSubscriptions(emails: Email[]): Promise<GeminiAnalysisResult> {
    if (!emails.length) {
      return {
        subscriptions: [],
        totalConfidentSubscriptions: 0,
        analysisDate: new Date().toISOString()
      };
    }

    console.log(`Starting Gemini analysis of ${emails.length} emails...`);
    
    try {
      // Process emails in chunks to avoid token limits
      const chunks = this.chunkEmails(emails, 10);
      const allSuggestions: SubscriptionSuggestion[] = [];

      for (let i = 0; i < chunks.length; i++) {
        console.log(`Processing chunk ${i + 1}/${chunks.length}...`);
        
        const chunkSuggestions = await this.analyzeEmailChunk(chunks[i]);
        allSuggestions.push(...chunkSuggestions);
        
        // Add small delay between chunks to respect rate limits
        if (i < chunks.length - 1) {
          await this.delay(1000);
        }
      }

      // Deduplicate and merge similar subscriptions
      const deduplicatedSuggestions = this.deduplicateSubscriptions(allSuggestions);
      
      const confidentSubscriptions = deduplicatedSuggestions.filter(
        s => s.confidence === 'high' || s.confidence === 'medium'
      );

      console.log(`Gemini analysis complete: ${deduplicatedSuggestions.length} suggestions, ${confidentSubscriptions.length} confident`);

      return {
        subscriptions: deduplicatedSuggestions,
        totalConfidentSubscriptions: confidentSubscriptions.length,
        analysisDate: new Date().toISOString()
      };

    } catch (error) {
      console.error('Gemini analysis failed:', error);
      throw new Error(`Failed to analyze emails with Gemini: ${error}`);
    }
  }

  private async analyzeEmailChunk(emails: Email[]): Promise<SubscriptionSuggestion[]> {
    const emailContext = emails.map(email => ({
      subject: email.subject,
      from: email.fromEmail,
      date: email.receivedAt,
      content: email.content?.substring(0, 2000) || '', // Limit content length
      extractedAmount: email.extractedAmount,
      extractedCurrency: email.extractedCurrency,
      attachments: email.attachmentData ? JSON.parse(email.attachmentData) : []
    }));

    const systemPrompt = `You are an expert subscription detection system. Analyze the provided emails and their attachments to identify recurring subscription services.

For each subscription you detect, consider:
1. Service name and merchant
2. Billing amount and currency
3. Billing frequency (monthly, quarterly, yearly, weekly)
4. Service category (streaming, software, utilities, telecom, fitness, etc.)
5. Confidence level based on evidence strength
6. Whether it appears to be an active subscription

Assign confidence levels:
- HIGH: Clear subscription language, recurring billing terms, known subscription services
- MEDIUM: Strong indicators but some ambiguity
- LOW: Possible subscription but weak evidence

Focus on Indian services like Airtel, Jio, Netflix India, Hotstar, Paytm, PhonePe, Replit, and international services with INR billing.

Respond only with valid JSON matching this exact schema:
{
  "subscriptions": [
    {
      "serviceName": "string",
      "merchantName": "string", 
      "amount": number,
      "currency": "string",
      "frequency": "monthly|quarterly|yearly|weekly",
      "category": "string",
      "confidence": "high|medium|low",
      "reasoning": "string",
      "nextBillingDate": "YYYY-MM-DD or null",
      "isActive": boolean
    }
  ]
}`;

    const response = await this.ai.models.generateContent({
      model: "gemini-2.5-pro",
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            subscriptions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  serviceName: { type: "string" },
                  merchantName: { type: "string" },
                  amount: { type: "number" },
                  currency: { type: "string" },
                  frequency: { type: "string", enum: ["monthly", "quarterly", "yearly", "weekly"] },
                  category: { type: "string" },
                  confidence: { type: "string", enum: ["high", "medium", "low"] },
                  reasoning: { type: "string" },
                  nextBillingDate: { type: "string" },
                  isActive: { type: "boolean" }
                },
                required: ["serviceName", "merchantName", "amount", "currency", "frequency", "category", "confidence", "reasoning", "isActive"]
              }
            }
          },
          required: ["subscriptions"]
        }
      },
      contents: `Analyze these emails for subscription services:\n\n${JSON.stringify(emailContext, null, 2)}`
    });

    const rawJson = response.text;
    
    if (!rawJson) {
      throw new Error("Empty response from Gemini");
    }

    try {
      const result = JSON.parse(rawJson);
      return result.subscriptions || [];
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', rawJson);
      throw new Error(`Invalid JSON response from Gemini: ${parseError}`);
    }
  }

  private chunkEmails(emails: Email[], chunkSize: number): Email[][] {
    const chunks: Email[][] = [];
    for (let i = 0; i < emails.length; i += chunkSize) {
      chunks.push(emails.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private deduplicateSubscriptions(suggestions: SubscriptionSuggestion[]): SubscriptionSuggestion[] {
    const seen = new Map<string, SubscriptionSuggestion>();
    
    for (const suggestion of suggestions) {
      const key = `${suggestion.merchantName.toLowerCase()}_${suggestion.currency}_${Math.round(suggestion.amount)}`;
      
      const existing = seen.get(key);
      if (!existing || this.getConfidenceScore(suggestion.confidence) > this.getConfidenceScore(existing.confidence)) {
        seen.set(key, suggestion);
      }
    }
    
    return Array.from(seen.values()).sort((a, b) => 
      this.getConfidenceScore(b.confidence) - this.getConfidenceScore(a.confidence)
    );
  }

  private getConfidenceScore(confidence: 'high' | 'medium' | 'low'): number {
    switch (confidence) {
      case 'high': return 3;
      case 'medium': return 2;
      case 'low': return 1;
      default: return 0;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Convert Gemini suggestions to our Subscription format
  convertSuggestionsToSubscriptions(suggestions: SubscriptionSuggestion[], userId: string): Subscription[] {
    return suggestions.map(suggestion => ({
      id: `suggested_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      serviceName: suggestion.serviceName,
      amount: suggestion.amount.toString(),
      currency: suggestion.currency,
      frequency: suggestion.frequency,
      category: suggestion.category,
      status: 'suggested',
      merchantEmail: null,
      nextBillingDate: suggestion.nextBillingDate ? new Date(suggestion.nextBillingDate) : null,
      lastEmailDate: null,
      detectedAt: new Date()
    }));
  }
}