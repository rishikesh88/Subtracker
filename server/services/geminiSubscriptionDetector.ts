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
  
  // Enhanced validation and detection evidence
  recurringKeywords: string[]; // Keywords found: "monthly", "auto-renew", etc.
  validationChecks: {
    subjectValid: boolean;
    contentValid: boolean;
    attachmentValid: boolean;
  };
  attachmentEvidence?: string; // Summary of findings from PDFs/images
  senderHistory?: string; // Pattern detected from sender's historical emails
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

  /**
   * Phase 1.5: Lightweight AI pre-filter
   * Quick assessment of email metadata to identify subscription candidates
   */
  async prefilterCandidates(
    candidates: Array<{ id: string; subject: string; fromEmail: string; fromName?: string; snippet?: string }>,
    onProgress?: (progress: number) => void
  ): Promise<string[]> {
    if (!candidates.length) return [];

    console.log(`🤖 AI Pre-filter: Analyzing ${candidates.length} candidates...`);

    try {
      const chunks = this.chunkArray(candidates, 200); // Optimized larger chunks for efficient pre-filtering
      const approvedIds: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        
        // Create lightweight prompt
        const emailSummaries = chunk.map((c, idx) => 
          `${idx + 1}. ID:${c.id} | From: ${c.fromEmail} | Subject: ${c.subject} | Preview: ${c.snippet?.substring(0, 100) || 'N/A'}`
        ).join('\n');

        const prompt = `You are analyzing email metadata to identify potential subscription/billing emails.

EMAILS TO ANALYZE:
${emailSummaries}

TASK: Return ONLY the IDs (comma-separated) of emails that are likely:
- Subscription renewals or renewal reminders (e.g., "will be charged in 2 days", "renews on Oct 5")
- Recurring payments/billings (completed or upcoming)
- Service invoices (SaaS, streaming, cloud services)
- Membership charges (active or upcoming)
- Regular service fees (hosting, domains, SSL certificates)
- Apple services (iCloud, Apple One, iTunes, App Store subscriptions)
- Hosting/domain services (GoDaddy, Namecheap, web hosting renewals)

IMPORTANT: Include BOTH completed transactions AND renewal reminders/notifications.
Examples to INCLUDE:
- "You will be charged ₹75 in 2 days for iCloud+"
- "Your Apple One subscription renews on Oct 5 for ₹365"
- "GoDaddy domain renewal - expires in 7 days"
- "Your Netflix subscription has been renewed"

Be CONSERVATIVE - only include emails with strong subscription indicators.
Respond with ONLY the IDs, nothing else. Format: ID1,ID2,ID3

If NONE qualify, respond with: NONE`;

        const result = await this.ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt
        });
        const rawResponse = (result.text || '').trim();
        
        // Validate candidate IDs for cross-checking
        const candidateIdSet = new Set(chunk.map(c => c.id));
        
        // Handle NONE case (no qualified emails) - flexible prefix matching
        // Catches: "NONE", "None", "none", "NONE.", "None – no matches", etc.
        const normalizedResponse = rawResponse.toUpperCase().trim();
        if (!rawResponse || normalizedResponse.startsWith('NONE')) {
          console.log(`  Chunk ${i + 1}: AI returned NONE - no qualified emails`);
          continue;
        }
        
        // Parse IDs from response - flexible extraction
        try {
          // Extract all potential IDs using regex and multiple delimiters
          // Gmail IDs are typically alphanumeric strings (16+ chars)
          const idPattern = /[a-zA-Z0-9_-]{16,}/g;
          const potentialIds = rawResponse.match(idPattern) || [];
          
          // Validate and filter IDs against candidate set
          const parsedIds = potentialIds.filter((id: string) => {
            if (candidateIdSet.has(id)) {
              return true;
            }
            console.warn(`  AI returned unknown ID (not in candidate set): ${id.substring(0, 20)}...`);
            return false;
          });
          
          // Critical: If parsing yields zero valid IDs, trigger fallback
          if (parsedIds.length === 0) {
            console.error(`  Chunk ${i + 1}: Parsing failed - no valid IDs extracted from response`);
            console.error(`  Raw response: ${rawResponse.substring(0, 200)}...`);
            console.warn(`  FALLBACK: Including all ${chunk.length} candidates from this chunk`);
            approvedIds.push(...chunk.map(c => c.id));
          } else {
            approvedIds.push(...parsedIds);
            console.log(`  Chunk ${i + 1}: Approved ${parsedIds.length}/${chunk.length} emails (${Math.round((parsedIds.length / chunk.length) * 100)}% pass rate)`);
          }
        } catch (parseError) {
          console.error(`  Chunk ${i + 1}: Exception during parsing:`, parseError);
          console.error(`  Raw response: ${rawResponse.substring(0, 200)}...`);
          console.warn(`  FALLBACK: Including all ${chunk.length} candidates from this chunk`);
          // Fail-safe: include all chunk candidates if parsing fails
          approvedIds.push(...chunk.map(c => c.id));
        }

        if (onProgress) {
          onProgress(((i + 1) / chunks.length) * 100);
        }

        // Rate limiting
        if (i < chunks.length - 1) {
          await this.delay(500);
        }
      }

      console.log(`✅ Pre-filter complete: ${approvedIds.length}/${candidates.length} approved`);
      return approvedIds;

    } catch (error) {
      console.error('AI pre-filter failed, falling back to all candidates:', error);
      // Fallback: return all candidate IDs if AI fails
      return candidates.map(c => c.id);
    }
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
      // Increased batch size from 10 to 25 for better efficiency with gemini-2.5-flash
      const chunks = this.chunkEmails(emails, 25);
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

    const systemPrompt = `You are an expert subscription detection system. You MUST perform comprehensive validation on emails before suggesting subscriptions.

IMPORTANT: Detect BOTH completed transactions AND renewal reminders/notifications.

VALIDATION REQUIREMENTS (flexible - at least ONE must pass):
1. Subject Line: Contains transaction/subscription indicators (invoice, receipt, payment, subscription, billing, charged, renewal, "will be charged", "renews on")
2. Content (Body/HTML): Contains payment/billing details, amounts, merchant info, renewal dates, upcoming charges
3. Attachments: If present, PDF/images contain billing info, amounts, or invoice details

RENEWAL REMINDER DETECTION (CRITICAL):
- Phrases: "will be charged", "you will be charged in X days", "renews on", "automatically renew", "renewal reminder"
- Amount position: Can appear anywhere in email (subject, body, snippet) - extract carefully
- Future dates: "renews on Oct 5", "in 2 days", "next billing date"
- Common services: Apple (iCloud+, Apple One, iTunes), Netflix, Spotify, Prime, hosting services

HOSTING & DOMAIN DETECTION (CRITICAL):
- Services: GoDaddy, Namecheap, Bluehost, HostGator, domain registrars
- Keywords: "domain", "hosting", "SSL certificate", "web hosting", "expires", "renewal"
- Patterns: Domain names (example.com), expiration dates, nameservers

RECURRING DETECTION (identify ALL patterns):
- Keywords: "monthly", "annual", "auto-renew", "recurring", "subscription", "membership", "plan"
- Sender History: Multiple emails from same sender with similar amounts
- Frequency Patterns: Weekly, monthly, quarterly, yearly billing cycles

For EACH subscription detected, you MUST provide:
1. Service name and merchant
2. Exact billing amount and currency
3. Billing frequency (monthly, quarterly, yearly, weekly)
4. Service category (streaming, software, utilities, telecom, fitness, etc.)
5. Validation results: Did subject, content, AND attachments all indicate a valid transaction?
6. Recurring keywords found in the email
7. Evidence from attachments (if any)
8. Pattern detected from sender's email history
9. Detailed reasoning explaining why this is a subscription

Confidence Levels (FLEXIBLE criteria):
- HIGH: Strong evidence (amount + frequency clearly stated) + Known service (Apple, Netflix, GoDaddy, etc.)
- MEDIUM: Clear amount and service name + Some recurring/renewal indicators
- LOW: Weak evidence OR unclear amount OR one-time purchase possibility

Focus on:
- Indian services (Airtel, Jio, Netflix India, Hotstar, Paytm, PhonePe, Replit)
- International services with INR billing (Apple, Netflix, Spotify, Adobe)
- Hosting/domain services (GoDaddy, Namecheap, web hosting)
- Apple ecosystem (iCloud+, Apple One, iTunes, App Store subscriptions)

CRITICAL EXAMPLES TO DETECT:
✅ "You will be charged ₹75 for your 50 GB iCloud+ plan in 2 days" → DETECT as iCloud subscription
✅ "Your Apple One subscription automatically renews on Oct 5 for ₹365/month" → DETECT as Apple One
✅ "GoDaddy domain renewal - example.com expires in 7 days - ₹800/year" → DETECT as GoDaddy hosting
✅ "Your Netflix subscription has been renewed - ₹649/month" → DETECT as Netflix

IMPORTANT: Include renewal reminders AND completed transactions. Amount can appear ANYWHERE in the email - extract carefully from subject, body, or snippet.`;

    const response = await this.ai.models.generateContent({
      model: "gemini-2.5-flash",
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
                  isActive: { type: "boolean" },
                  recurringKeywords: { type: "array", items: { type: "string" } },
                  validationChecks: {
                    type: "object",
                    properties: {
                      subjectValid: { type: "boolean" },
                      contentValid: { type: "boolean" },
                      attachmentValid: { type: "boolean" }
                    },
                    required: ["subjectValid", "contentValid", "attachmentValid"]
                  },
                  attachmentEvidence: { type: "string" },
                  senderHistory: { type: "string" }
                },
                required: ["serviceName", "merchantName", "amount", "currency", "frequency", "category", "confidence", "reasoning", "isActive", "recurringKeywords", "validationChecks"]
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

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
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
      merchantName: suggestion.merchantName,
      serviceName: suggestion.serviceName,
      serviceKey: `${suggestion.merchantName.toLowerCase()}_${suggestion.frequency}`.replace(/\s+/g, '_'),
      amount: suggestion.amount.toString(),
      currency: suggestion.currency,
      frequency: suggestion.frequency,
      category: suggestion.category,
      status: 'suggested',
      occurrences: 1,
      merchantEmail: null,
      nextBillingDate: suggestion.nextBillingDate ? new Date(suggestion.nextBillingDate) : null,
      lastEmailDate: null,
      detectedAt: new Date()
    }));
  }
}