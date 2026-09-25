/**
 * 🔒 PROTECTED CORE LOGIC - MODIFICATION REQUIRES USER APPROVAL
 * 
 * Gemini AI Subscription Detector
 * Two-phase AI analysis: Pre-filter (Phase 1.5) + Deep Analysis (Phase 2)
 * 
 * @version 1.0.0
 * @lastModified 2025-11-10
 * @protection LOCKED - See server/core/README.md for modification protocol
 * @model gemini-2.5-flash (specified by user - DO NOT CHANGE)
 * 
 * CRITICAL: This file contains AI prompts, fallback strategies, and analysis logic.
 * All prompts, chunk sizes, and fallback behaviors are locked and require user approval.
 * See SPECIFICATION.md for exact prompt text and algorithm details.
 * 
 * FALLBACK STRATEGY: Maximum detection priority - approve chunks on parsing failures
 * to ensure no subscription data is lost. This aligns with user's primary goal.
 */

import { GoogleGenAI } from "@google/genai";
import { withRetry } from "../lib/retryTransient";
import { parseEvidenceRef } from "../lib/evidence";
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

  /**
   * The emails this subscription was found in, as their message ids.
   *
   * Named by the model itself, which is the only party that knows. The sync
   * used to reconstruct this afterwards by searching subjects and senders for
   * the service's name, which attached every Apple email to both Apple One
   * and iCloud+, a terms-of-service notice to YouTube Premium, and nothing at
   * all to a Netflix the model had plainly read.
   */
  evidenceEmailIds?: string[];
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

TASK: Identify emails that are likely:
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

CRITICAL OUTPUT FORMAT REQUIREMENT:
You MUST respond with ONLY a valid JSON object in this exact format:
{"approved_ids": ["ID1", "ID2", "ID3"]}

Use the FULL Gmail ID from each email line (e.g., "ID:18f3c2a4b5e6d789" → use "18f3c2a4b5e6d789").
If NONE qualify, respond with: {"approved_ids": []}

NO other text, explanations, or formatting. ONLY the JSON object.`;

        /*
         * A chunk that fails every retry lets through its own candidates and
         * no one else's. This call used to sit directly in the outer try, so
         * one chunk failing jumped straight to the catch-all below and passed
         * EVERY candidate -- a failed chunk of 200 sent all 716 to deep
         * analysis, loading the service hardest at the moment it had just
         * shown it was struggling, and throwing away the chunks it had
         * already screened.
         */
        let result;
        try {
          result = await withRetry(
            () => this.ai.models.generateContent({
              model: "gemini-2.5-flash",
              contents: prompt
            }),
            { label: `Pre-filter chunk ${i + 1}/${chunks.length}` }
          );
        } catch (chunkError) {
          console.error(`  Chunk ${i + 1}: pre-filter failed after retries, passing its ${chunk.length} candidates through:`, chunkError);
          approvedIds.push(...chunk.map(c => c.id));
          if (onProgress) onProgress(((i + 1) / chunks.length) * 100);
          continue;
        }
        const rawResponse = (result.text || '').trim();
        
        // Validate candidate IDs for cross-checking
        const candidateIdSet = new Set(chunk.map(c => c.id));
        
        // Parse JSON response
        try {
          // Clean up response - remove markdown code blocks if present
          let cleanedResponse = rawResponse;
          if (rawResponse.includes('```')) {
            // Extract JSON from markdown code blocks: ```json {...} ```
            const jsonMatch = rawResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            if (jsonMatch) {
              cleanedResponse = jsonMatch[1];
            }
          }
          
          // Parse JSON
          const parsed = JSON.parse(cleanedResponse);
          
          // Validate structure
          if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.approved_ids)) {
            throw new Error('Invalid JSON structure - missing approved_ids array');
          }
          
          const approvedIdsFromAI = parsed.approved_ids;
          
          // Handle empty array (no qualified emails)
          if (approvedIdsFromAI.length === 0) {
            console.log(`  Chunk ${i + 1}: AI returned 0 approved emails`);
            continue;
          }
          
          // Validate and filter IDs against candidate set
          const validIds = approvedIdsFromAI.filter((id: string) => {
            if (candidateIdSet.has(id)) {
              return true;
            }
            console.warn(`  AI returned unknown ID (not in candidate set): ${id.substring(0, 20)}...`);
            return false;
          });
          
          // Critical: If no valid IDs after filtering, approve all as fallback
          if (validIds.length === 0 && approvedIdsFromAI.length > 0) {
            console.error(`  Chunk ${i + 1}: All AI-returned IDs were invalid (not in candidate set)`);
            console.error(`  Raw response: ${rawResponse.substring(0, 200)}...`);
            console.warn(`  FALLBACK: Approving all ${chunk.length} candidates from this chunk (ensures maximum detection)`);
            // Fail-safe: approve all chunk candidates to avoid missing subscriptions
            approvedIds.push(...chunk.map(c => c.id));
          } else {
            approvedIds.push(...validIds);
            console.log(`  Chunk ${i + 1}: Approved ${validIds.length}/${chunk.length} emails (${Math.round((validIds.length / chunk.length) * 100)}% pass rate)`);
          }
          
        } catch (parseError) {
          console.error(`  Chunk ${i + 1}: JSON parsing failed:`, parseError);
          console.error(`  Raw response: ${rawResponse.substring(0, 200)}...`);
          console.warn(`  FALLBACK: Approving all ${chunk.length} candidates from this chunk (ensures maximum detection)`);
          // Fail-safe: approve all chunk candidates to avoid missing subscriptions
          // User priority is maximum detection with accuracy, so when structured parsing fails, include all
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
      console.error('AI pre-filter catastrophic failure:', error);
      console.warn('Approving all candidates due to pre-filter system error (ensures maximum detection)');
      // Fail-safe fallback: approve all candidates to avoid missing subscriptions
      // User priority is maximum detection, so when pre-filter fails completely, pass all candidates to deep analysis
      return candidates.map(c => c.id);
    }
  }

  async analyzeEmailsForSubscriptions(
    emails: Email[],
    /**
     * Called after each chunk, so the sync modal can say "checked 300 of 716"
     * and how many subscriptions are in hand -- this is the longest stage of a
     * sync, and it used to report only its start and its end.
     */
    onProgress?: (progress: { checked: number; total: number; found: number; foundNames: string[] }) => void,
  ): Promise<GeminiAnalysisResult> {
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

      /*
       * A chunk that fails must not take the others with it.
       *
       * This loop used to sit inside one try, so a single chunk throwing
       * discarded every chunk before it and skipped every chunk after --
       * turning one bad second at Gemini into a sync that fetched thousands
       * of emails and produced nothing. Each chunk now carries its own
       * failure, and the run finishes with whatever the rest found.
       *
       * The calls inside already retry transient failures, so reaching this
       * handler means a chunk failed every attempt.
       */
      const failedChunks: number[] = [];

      for (let i = 0; i < chunks.length; i++) {
        console.log(`Processing chunk ${i + 1}/${chunks.length}...`);

        try {
          const chunkSuggestions = await this.analyzeEmailChunk(chunks[i]);
          allSuggestions.push(...chunkSuggestions);
        } catch (chunkError) {
          failedChunks.push(i + 1);
          console.error(`Chunk ${i + 1}/${chunks.length} failed after retries:`, chunkError);
        }

        if (onProgress) {
          // Deduplicated as the final list will be, so the running count does
          // not climb past what the review inbox ends up showing.
          const soFar = this.deduplicateSubscriptions(allSuggestions);
          try {
            onProgress({
              checked: Math.min((i + 1) * 25, emails.length),
              total: emails.length,
              found: soFar.length,
              foundNames: soFar.slice(0, 4).map((x) => x.serviceName),
            });
          } catch {
            // Reporting progress must never break the analysis.
          }
        }

        // Add small delay between chunks to respect rate limits
        if (i < chunks.length - 1) {
          await this.delay(1000);
        }
      }

      /*
       * Every chunk failing is not a run that found nothing -- it is a run
       * that never happened. Reporting it as a clean zero would be worse than
       * the crash this replaced, because it looks like an inbox with no
       * subscriptions in it.
       */
      if (failedChunks.length === chunks.length) {
        throw new Error(
          `All ${chunks.length} chunks failed. The analysis service did not respond to any of them.`
        );
      }

      if (failedChunks.length > 0) {
        console.warn(
          `⚠️  Analysed ${chunks.length - failedChunks.length} of ${chunks.length} chunks. ` +
          `Chunk(s) ${failedChunks.join(', ')} failed and were skipped, so some subscriptions may be missing.`
        );
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
    // E1, E2, ... rather than the message ids themselves: a short token is far
    // more reliably copied back than a 16-character hex id, and it is mapped
    // back to the real id below.
    const emailContext = emails.map((email, index) => ({
      ref: `E${index + 1}`,
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

CURRENCY (strict - this is the most common source of wrong data):
- Use the currency symbol or code printed next to the amount in THAT email.
- "extractedCurrency" is a regex hint for the email it appears on, and only
  that one. Never carry a currency from one email to another, even when they
  are in the same batch or from the same merchant.
- Never infer currency from a tax line, GST, an address, or the country of
  billing. A US dollar invoice can carry Indian GST and still be USD.
- If no symbol or code appears anywhere in the email, return "UNKNOWN".
  Do not guess. The user will be asked to confirm it.
- When the merchant's own receipt, invoice or payment confirmation states the
  price, use THAT amount and currency. A bank or card alert shows what the card
  was charged after conversion and fees, which is not the subscription's price;
  use it only when no email from the merchant states one.

EVIDENCE (required):
- Every email above has a "ref" (E1, E2, ...). For each subscription, list in
  "evidenceRefs" the refs of the emails that belong to THAT subscription: its
  receipts, invoices, renewal notices and payment confirmations.
- Never list an email that belongs to a different product, even from the same
  company. Apple One and iCloud+ are separate subscriptions; so are YouTube
  Premium and Google One. A general notice (terms of service, privacy policy,
  marketing) is not evidence for any subscription.

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

Common services include:
- Indian services (Airtel, Jio, Netflix India, Hotstar, Paytm, PhonePe, Replit)
- International services (Apple, Netflix, Spotify, Adobe, Anthropic, OpenAI)
- Hosting/domain services (GoDaddy, Namecheap, web hosting)
- Apple ecosystem (iCloud+, Apple One, iTunes, App Store subscriptions)

CRITICAL EXAMPLES TO DETECT:
✅ "You will be charged ₹75 for your 50 GB iCloud+ plan in 2 days" → DETECT as iCloud subscription
✅ "Your Apple One subscription automatically renews on Oct 5 for ₹365/month" → DETECT as Apple One
✅ "GoDaddy domain renewal - example.com expires in 7 days - ₹800/year" → DETECT as GoDaddy hosting
✅ "Your Netflix subscription has been renewed - ₹649/month" → DETECT as Netflix
✅ "Confirm your $23.60 payment to Anthropic, PBC" → DETECT as Claude, amount 23.60, currency USD
   (a "GST - India (18%)" line in that same invoice does NOT make it INR)

IMPORTANT: Include renewal reminders AND completed transactions. Amount can appear ANYWHERE in the email - extract carefully from subject, body, or snippet.`;

    const response = await withRetry(() => this.ai.models.generateContent({
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
                  senderHistory: { type: "string" },
                  evidenceRefs: { type: "array", items: { type: "string" } }
                },
                required: ["serviceName", "merchantName", "amount", "currency", "frequency", "category", "confidence", "reasoning", "isActive", "recurringKeywords", "validationChecks", "evidenceRefs"]
              }
            }
          },
          required: ["subscriptions"]
        }
      },
      contents: `Analyze these emails for subscription services:\n\n${JSON.stringify(emailContext, null, 2)}`
    }), { label: "Subscription analysis" });

    const rawJson = response.text;
    
    if (!rawJson) {
      throw new Error("Empty response from Gemini");
    }

    try {
      const result = JSON.parse(rawJson);
      return (result.subscriptions || []).map((suggestion: any) => {
        const refs: unknown[] = Array.isArray(suggestion.evidenceRefs) ? suggestion.evidenceRefs : [];
        // Read tolerantly ("E3", "[E3]", "e03", "3"), then mapped to this
        // chunk's emails by position. A ref that points past the chunk maps
        // to nothing and is dropped rather than guessed at.
        const ids = refs
          .map((ref) => parseEvidenceRef(ref))
          .map((position) => (position ? emails[position - 1]?.gmailId : undefined))
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
        const { evidenceRefs, ...rest } = suggestion;
        return { ...rest, evidenceEmailIds: Array.from(new Set(ids)) };
      });
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
      // The same subscription found in two chunks keeps its more confident
      // reading, but the emails from both: they are all evidence for it.
      const evidence = Array.from(new Set([
        ...(existing?.evidenceEmailIds ?? []),
        ...(suggestion.evidenceEmailIds ?? []),
      ]));
      if (!existing || this.getConfidenceScore(suggestion.confidence) > this.getConfidenceScore(existing.confidence)) {
        seen.set(key, { ...suggestion, evidenceEmailIds: evidence });
      } else {
        existing.evidenceEmailIds = evidence;
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