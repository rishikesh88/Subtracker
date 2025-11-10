# 🔒 CORE SUBSCRIPTION DETECTION SPECIFICATION

**VERSION:** 1.0.0  
**LAST MODIFIED:** November 10, 2025  
**STATUS:** LOCKED - Requires Explicit User Approval for Modifications

---

## OVERVIEW

This document defines the canonical specification for SubTracker's subscription detection system. The system employs a two-phase optimization architecture combining rule-based filtering with AI-powered analysis to maximize subscription detection accuracy while minimizing processing costs.

**User Priority:** Maximum subscription detection with highest accuracy (non-negotiable).

---

## ARCHITECTURE

### Two-Phase Processing Pipeline

```
Phase 1: Lightweight Screening (Fast, Inexpensive)
├── 1a. Email Metadata Fetch (subject, sender, snippet)
├── 1b. Transaction Detector (rule-based scoring)
├── 1c. Merchant Database Lookup (152 verified merchants)
└── 1d. AI Pre-filter (Gemini 2.5 Flash, batch 200 emails)
    
Phase 2: Deep Processing (Targeted, Accurate)
├── 2a. Full Email Content Fetch (approved candidates only)
├── 2b. Content Parsing & Attachment Processing
└── 2c. Deep AI Analysis (Gemini 2.5 Flash, batch 25 emails)
```

**Performance Target:** 90% cost reduction, 65% speed improvement vs. full processing.

**Monthly Sync Frequency:** ~1x per month per user.

---

## PHASE 1: TRANSACTION DETECTION ALGORITHM

### Scoring System

The Transaction Detector uses a multi-parameter scoring system with **threshold: 50+ points = candidate**.

#### Scoring Breakdown (Max 140 points)

| Category | Max Points | Description |
|----------|------------|-------------|
| Sender Domain Analysis | 50 | Payment processors, subscription platforms, merchant database |
| Subject Line Analysis | 40 | Payment, subscription, confirmation keywords |
| Content Analysis | 30 | Recurring language, renewal indicators |
| Currency Detection | 20 | Amount patterns in multiple currencies |

### 1. Sender Domain Analysis (Max 50 Points)

**Priority 1: Merchant Database (80 points)** ⭐ STRONGEST SIGNAL
```typescript
// Check against verified merchant database (152 merchants)
if (merchantDB.isKnownMerchant(emailLower)) {
  score += 80;
  reasons.push(`Verified merchant: ${knownMerchant.name}`);
  return { score, reasons }; // Early return for efficiency
}
```

**Known Payment Processors (50 points)**
```typescript
paymentProcessors = [
  'stripe.com', 'paypal.com', 'square.com', 'braintree.com', 'paddle.net',
  'razorpay.com', 'checkout.com', 'adyen.com', 'worldpay.com', 'authorize.net'
]
// Match: return early with 50 points
```

**Subscription Platforms (45 points)**
```typescript
subscriptionPlatforms = [
  'substack.com', 'patreon.com', 'memberful.com', 'gumroad.com',
  'teachable.com', 'podia.com', 'kajabi.com'
]
```

**Major Subscription Services (40 points)**
```typescript
majorSubscriptionServices = [
  'apple.com', 'icloud.com', 'insideapple.apple.com',
  'netflix.com', 'spotify.com', 'amazon.com', 'prime.amazon.com',
  'google.com', 'youtube.com', 'microsoft.com', 'office.com',
  'adobe.com', 'dropbox.com', 'zoom.us',
  'godaddy.com', 'namecheap.com', 'bluehost.com', 'hostgator.com',
  'digitalocean.com', 'aws.amazon.com', 'cloudflare.com'
]
```

**Payment-Related Email Prefixes (30 points)**
```typescript
paymentEmailPrefixes = [
  'billing', 'noreply', 'no-reply', 'receipts', 'invoices', 'payments',
  'orders', 'transactions', 'accounts', 'support', 'hello', 'notifications'
]
// Match pattern: prefix + '@' or prefix + '.'
```

**SaaS Domain TLDs (15 points)**
```regex
// Pattern: .(io|app|tech|cloud|software)$
if (emailLower.match(/\.(io|app|tech|cloud|software)$/)) {
  score += 15;
}
```

**Service Subdomains (10 points)**
```regex
// Pattern: ^(billing|payments|receipts|noreply|notifications).
if (emailLower.match(/^(billing|payments|receipts|noreply|notifications)\./)) {
  score += 10;
}
```

**Business Entity Indicators (10 points)**
```typescript
businessIndicators = ['inc', 'llc', 'ltd', 'corp', 'limited', 'company']
// Match in sender name
```

### 2. Subject Line Analysis (Max 40 Points, Capped)

**Payment Keywords (25 points)**
```typescript
payment = ['receipt', 'invoice', 'payment', 'charged', 'billed', 'paid', 'purchase']
```

**Reference Numbers (20 points)**
```typescript
reference = ['order #', 'invoice #', 'receipt #', 'transaction', 'confirmation']
```

**Renewal Keywords (22 points)**
```typescript
renewal = ['will be charged', 'renewing', 'renews on', 'renews in', 'expires in', 'expiring', 'expiration']
```

**Subscription Keywords (20 points)**
```typescript
subscription = ['subscription', 'membership', 'plan', 'renewal', 'auto-renew', 'renews']
```

**Hosting Keywords (18 points)**
```typescript
hosting = ['domain', 'hosting', 'ssl certificate', 'web hosting', 'server']
```

**Confirmation Keywords (15 points)**
```typescript
confirmation = ['confirmed', 'successful', 'processed', 'completed', 'thank you']
```

### 3. Content Analysis (Max 30 Points, Capped)

**Recurring Language (20 points)**
```typescript
recurring = [
  'next billing', 'renews on', 'auto-renewal', 'recurring charge',
  'billing cycle', 'subscription period', 'automatically renew', 'will renew'
]
```

**Payment Method References (15 points)**
```typescript
payment = [
  'card ending', 'paypal account', 'bank account',
  'payment method', 'total amount', 'amount due'
]
```

**Renewal Language (15 points)**
```typescript
renewal = [
  'will be charged', 'you will be charged', 'upcoming charge',
  'renewal date', 'renewal reminder', 'auto-renews'
]
```

**Hosting Language (12 points)**
```typescript
hosting = [
  'domain expires', 'hosting expires', 'ssl expires',
  'domain renewal', 'hosting renewal', 'nameservers'
]
```

**Service Management (10 points)**
```typescript
service = [
  'manage subscription', 'view invoice', 'update payment',
  'cancel anytime', 'billing details'
]
```

### 4. Currency Detection (20 Points)

**Patterns:**
```regex
$\s?\d+\.?\d*          // $10, $10.99
€\s?\d+[,.]?\d*        // €10, €10,99
£\s?\d+\.?\d*          // £10, £10.99
¥\s?\d+                // ¥1000
₹\s?\d+\.?\d*          // ₹100, ₹100.50
USD\s?\d+\.?\d*        // USD 10.99
EUR\s?\d+[,.]?\d*      // EUR 10,99
GBP\s?\d+\.?\d*        // GBP 10.99
\d+\.\d{2}\s?(USD|EUR|GBP|CAD|AUD)  // 10.99 USD
```

### Confidence Levels

```typescript
score >= 80  → HIGH confidence
score >= 50  → MEDIUM confidence
score < 50   → LOW confidence (rejected)
```

---

## PHASE 1.5: AI PRE-FILTER

### Model Configuration

**Model:** `gemini-2.5-flash`  
**Chunk Size:** 200 emails per batch  
**Rate Limiting:** 500ms delay between chunks  
**Structured Output:** Strict JSON schema enforced

### Pre-Filter Prompt (EXACT TEXT)

```
You are analyzing email metadata to identify potential subscription/billing emails.

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

NO other text, explanations, or formatting. ONLY the JSON object.
```

### Fallback Strategy (Maximum Detection Priority)

**Primary Path:** Strict JSON parsing with validation
- Clean markdown code blocks: ````json {...} ```
- Validate structure: `{"approved_ids": [...]}`
- Cross-check IDs against candidate set

**Fallback Scenarios:**
1. **JSON Parse Failure** → Approve entire chunk (ensures no data loss)
2. **Invalid ID Mismatch** → Approve entire chunk (ensures no data loss)
3. **Catastrophic System Error** → Approve all candidates (fail-safe)

**Rationale:** User priority is maximum detection. When AI misbehaves, approve all to avoid missing subscriptions (acceptable cost trade-off for monthly sync).

---

## PHASE 2: DEEP AI ANALYSIS

### Model Configuration

**Model:** `gemini-2.5-flash`  
**Chunk Size:** 25 emails per batch  
**Rate Limiting:** 1000ms delay between chunks  
**Content Limit:** 2000 characters per email  
**Structured Output:** JSON schema with validation

### System Prompt (EXACT TEXT)

```
You are an expert subscription detection system. You MUST perform comprehensive validation on emails before suggesting subscriptions.

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

IMPORTANT: Include renewal reminders AND completed transactions. Amount can appear ANYWHERE in the email - extract carefully from subject, body, or snippet.
```

### Response Schema

```json
{
  "type": "object",
  "properties": {
    "subscriptions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "serviceName": { "type": "string" },
          "merchantName": { "type": "string" },
          "amount": { "type": "number" },
          "currency": { "type": "string" },
          "frequency": { "type": "string", "enum": ["monthly", "quarterly", "yearly", "weekly"] },
          "category": { "type": "string" },
          "confidence": { "type": "string", "enum": ["high", "medium", "low"] },
          "reasoning": { "type": "string" },
          "nextBillingDate": { "type": "string" },
          "isActive": { "type": "boolean" },
          "recurringKeywords": { "type": "array", "items": { "type": "string" } },
          "validationChecks": {
            "type": "object",
            "properties": {
              "subjectValid": { "type": "boolean" },
              "contentValid": { "type": "boolean" },
              "attachmentValid": { "type": "boolean" }
            },
            "required": ["subjectValid", "contentValid", "attachmentValid"]
          },
          "attachmentEvidence": { "type": "string" },
          "senderHistory": { "type": "string" }
        },
        "required": ["serviceName", "merchantName", "amount", "currency", "frequency", "category", "confidence", "reasoning", "isActive", "recurringKeywords", "validationChecks"]
      }
    }
  },
  "required": ["subscriptions"]
}
```

---

## MERCHANT DATABASE

### Source File
`server/data/merchants.csv`

### Structure
```
name,websiteDomain,billingEmailDomain,products,frequency,regions
```

### Protection Level
**APPEND-ONLY:** New merchants can be added; existing entries CANNOT be modified or removed.

### Current Count
152 verified merchants (as of v1.0.0)

### Lookup Algorithm

**Priority Order:**
1. Exact email match
2. Email domain lookup
3. Website domain lookup
4. Pattern matching (e.g., `receipts+{account}@stripe.com`)

**Performance:**
- Domain map: O(1) lookup
- Email domain map: O(1) lookup
- Pattern map: O(n) regex matching (rare fallback)

---

## DATE VALIDATION

### parseValidDate() Helper

**Purpose:** Prevent database RangeError crashes from invalid date values.

**Algorithm:**
```typescript
function parseValidDate(dateValue: any): Date | null {
  if (!dateValue) return null;
  
  const parsed = new Date(dateValue);
  if (isNaN(parsed.getTime())) return null;
  
  // Reject dates before 2000 or more than 10 years in future
  const minDate = new Date('2000-01-01');
  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + 10);
  
  if (parsed < minDate || parsed > maxDate) {
    console.warn(`Date out of reasonable range, ignoring: ${dateValue}`);
    return null;
  }
  
  return parsed;
}
```

**Valid Range:** 2000-01-01 to (current year + 10)

---

## DEDUPLICATION LOGIC

### Subscription Deduplication

**Key Generation:**
```typescript
const key = `${merchantName.toLowerCase()}_${currency}_${Math.round(amount)}`;
```

**Conflict Resolution:**
- Keep highest confidence score
- Sort by confidence: HIGH (3) > MEDIUM (2) > LOW (1)

---

## GMAIL API OPTIMIZATION

### Batching Configuration

**Concurrent Requests:** 50 requests per batch  
**Rate Limit:** 250 requests per 12 seconds  
**Theoretical Maximum:** 250 req/min (at Gmail's ceiling)

**No Room for Optimization:** Already at Gmail API rate limit ceiling. Batch API not cost-effective for monthly sync (30-45 min implementation for 2-3 min savings).

---

## CHANGE CONTROL

### Modification Protocol

1. **All changes** to this specification require explicit user approval
2. **Log modifications** in server/core/README.md changelog
3. **Version bump** on any specification change
4. **Architect review** required for all core logic modifications

### Protected Files

- `server/core/transactionDetector.ts`
- `server/core/merchantDatabase.ts`
- `server/core/geminiSubscriptionDetector.ts`
- `server/data/merchants.csv`
- `server/core/SPECIFICATION.md` (this file)

---

## VERSION HISTORY

| Version | Date | Changes | Approved By |
|---------|------|---------|-------------|
| 1.0.0 | 2025-11-10 | Initial specification creation | User |

---

**END OF SPECIFICATION**
