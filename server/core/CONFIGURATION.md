# 🔒 CONFIGURATION PARAMETERS

This document defines which parameters are **locked** (require user approval) vs. **tunable** (can be adjusted with notification).

---

## LOCKED PARAMETERS

These parameters are **CORE ALGORITHM COMPONENTS** and cannot be changed without explicit user approval.

### Transaction Detector Scoring

| Parameter | Value | Location | Reason |
|-----------|-------|----------|--------|
| Merchant DB Bonus | 80 points | `transactionDetector.ts` | Core scoring logic |
| Payment Processor Score | 50 points | `transactionDetector.ts` | Core scoring logic |
| Subscription Platform Score | 45 points | `transactionDetector.ts` | Core scoring logic |
| Major Service Score | 40 points | `transactionDetector.ts` | Core scoring logic |
| Email Prefix Score | 30 points | `transactionDetector.ts` | Core scoring logic |
| Payment Keywords Score | 25 points | `transactionDetector.ts` | Core scoring logic |
| Renewal Keywords Score | 22 points | `transactionDetector.ts` | Core scoring logic |
| Reference Number Score | 20 points | `transactionDetector.ts` | Core scoring logic |
| Subscription Keywords Score | 20 points | `transactionDetector.ts` | Core scoring logic |
| Hosting Keywords Score | 18 points | `transactionDetector.ts` | Core scoring logic |
| SaaS Domain TLD Score | 15 points | `transactionDetector.ts` | Core scoring logic |
| Confirmation Keywords Score | 15 points | `transactionDetector.ts` | Core scoring logic |
| Business Indicator Score | 10 points | `transactionDetector.ts` | Core scoring logic |
| Service Subdomain Score | 10 points | `transactionDetector.ts` | Core scoring logic |
| **Candidate Threshold** | **50 points** | `transactionDetector.ts` | **Critical decision boundary** |

### Confidence Levels

| Level | Threshold | Location | Reason |
|-------|-----------|----------|--------|
| High Confidence | ≥ 80 points | `transactionDetector.ts` | Core logic |
| Medium Confidence | ≥ 50 points | `transactionDetector.ts` | Core logic |
| Low Confidence | < 50 points | `transactionDetector.ts` | Core logic |

### Keyword Lists

| Category | Location | Protection | Reason |
|----------|----------|------------|--------|
| Payment Processors | `transactionDetector.ts` | 🔒 LOCKED | Verified list |
| Subscription Platforms | `transactionDetector.ts` | 🔒 LOCKED | Verified list |
| Major Subscription Services | `transactionDetector.ts` | 🔒 LOCKED | Verified list |
| Payment Email Prefixes | `transactionDetector.ts` | 🔒 LOCKED | Core pattern |
| Subject Keywords (all) | `transactionDetector.ts` | 🔒 LOCKED | Core detection |
| Body Keywords (all) | `transactionDetector.ts` | 🔒 LOCKED | Core detection |
| Currency Patterns | `transactionDetector.ts` | 🔒 LOCKED | Regex patterns |

### AI Model Configuration

| Parameter | Value | Location | Reason |
|-----------|-------|----------|--------|
| Pre-filter Model | `gemini-2.5-flash` | `geminiSubscriptionDetector.ts` | Specified by user |
| Deep Analysis Model | `gemini-2.5-flash` | `geminiSubscriptionDetector.ts` | Specified by user |
| Pre-filter Prompt | See SPECIFICATION.md | `geminiSubscriptionDetector.ts` | Core IP |
| Deep Analysis Prompt | See SPECIFICATION.md | `geminiSubscriptionDetector.ts` | Core IP |
| Response Schema | See SPECIFICATION.md | `geminiSubscriptionDetector.ts` | Structured output |

### Fallback Strategy

| Parameter | Value | Location | Reason |
|-----------|-------|----------|--------|
| JSON Parse Failure | Approve chunk | `geminiSubscriptionDetector.ts` | Maximum detection priority |
| Invalid ID Mismatch | Approve chunk | `geminiSubscriptionDetector.ts` | Maximum detection priority |
| Catastrophic Error | Approve all | `geminiSubscriptionDetector.ts` | Fail-safe |

### Date Validation

| Parameter | Value | Location | Reason |
|-----------|-------|----------|--------|
| Min Valid Date | 2000-01-01 | `parseValidDate()` helper | Prevents database errors |
| Max Valid Date | Current year + 10 | `parseValidDate()` helper | Prevents database errors |

---

## TUNABLE PARAMETERS

These parameters can be adjusted with user notification and reason.

### Processing Batch Sizes

| Parameter | Current Value | Location | Tunable Range | Reason |
|-----------|--------------|----------|---------------|--------|
| Pre-filter Chunk Size | 200 emails | `geminiSubscriptionDetector.ts` | 100-300 | API efficiency |
| Deep Analysis Chunk Size | 25 emails | `geminiSubscriptionDetector.ts` | 15-50 | Token limits |

**Change Protocol:**
- Must notify user: "Adjusting [parameter] from X to Y for [reason]"
- Must document reason (e.g., "reducing API costs", "improving speed")
- Must stay within tunable range

### Rate Limiting Delays

| Parameter | Current Value | Location | Tunable Range | Reason |
|-----------|--------------|----------|---------------|--------|
| Pre-filter Delay | 500ms | `geminiSubscriptionDetector.ts` | 200-1000ms | API rate limits |
| Deep Analysis Delay | 1000ms | `geminiSubscriptionDetector.ts` | 500-2000ms | API rate limits |

**Change Protocol:**
- Must notify user with reason
- Adjustments for rate limit optimization acceptable
- Must test to avoid 429 errors

### Gmail API Batching

| Parameter | Current Value | Location | Tunable Range | Reason |
|-----------|--------------|----------|---------------|--------|
| Concurrent Requests | 50 requests | `gmail.ts` | 25-50 | Gmail rate limits |
| Batch Window | 12 seconds | `gmail.ts` | LOCKED | Gmail rate limit ceiling |

**Change Protocol:**
- Concurrent requests can be reduced if hitting rate limits
- Batch window is LOCKED (Gmail API constraint)

### Content Limits

| Parameter | Current Value | Location | Tunable Range | Reason |
|-----------|--------------|----------|---------------|--------|
| Email Content Limit | 2000 chars | `geminiSubscriptionDetector.ts` | 1000-5000 | Token optimization |

**Change Protocol:**
- Can adjust for cost/accuracy trade-off
- Must notify user with expected impact

---

## USER-CONFIGURABLE SETTINGS

These are **user preferences** and can be changed at any time through the UI.

| Setting | Default | Range | Location | Description |
|---------|---------|-------|----------|-------------|
| Email Sync Days | 90 days | 30-180 days | User settings | How far back to sync emails |
| Preferred Currency | INR | Any | User settings | Display currency |

**Note:** These are NOT core logic parameters. Users can modify these freely.

---

## PARAMETER CHANGE WORKFLOW

### For LOCKED Parameters

1. **STOP** - Do not proceed without approval
2. **REQUEST** - Ask user with detailed explanation:
   ```
   ⚠️ This requires changing a core algorithm parameter.
   
   Parameter: [name]
   Current Value: [value]
   Proposed Value: [new value]
   
   Expected Impact:
   - Detection Rate: [increase/decrease/same]
   - Cost: [increase/decrease/same]
   - Speed: [faster/slower/same]
   
   Reason: [why this change is needed]
   
   May I proceed with this change?
   ```
3. **WAIT** - Get explicit "yes" or "approved"
4. **DOCUMENT** - Log in README.md changelog
5. **UPDATE** - Modify SPECIFICATION.md if needed
6. **VERSION** - Bump version number

### For TUNABLE Parameters

1. **NOTIFY** - Inform user before changing:
   ```
   ℹ️ Adjusting tunable parameter for optimization.
   
   Parameter: [name]
   Current: [value]
   New: [value]
   Reason: [why]
   Expected Impact: [description]
   
   Proceeding with change...
   ```
2. **DOCUMENT** - Log in README.md if significant
3. **TEST** - Verify change works as expected

### For USER-CONFIGURABLE Settings

- No approval needed
- User changes these directly through UI
- Changes stored in user preferences table

---

## EXAMPLES

### ❌ WRONG - Modifying Locked Parameter Without Approval

```typescript
// DON'T DO THIS
const CANDIDATE_THRESHOLD = 40; // Changed from 50 to increase detection
```

**Correct Approach:**
1. Ask user: "I want to lower the candidate threshold from 50 to 40 to detect more subscriptions. This may increase false positives. May I proceed?"
2. Wait for approval
3. Make change if approved
4. Log in README.md

### ✅ CORRECT - Adjusting Tunable Parameter With Notification

```typescript
// NOTIFY FIRST
// "ℹ️ Reducing pre-filter chunk size from 200 to 150 to avoid rate limiting. No algorithm changes."

const PRE_FILTER_CHUNK_SIZE = 150; // Reduced for rate limiting
```

### ✅ CORRECT - User Preference (No Approval Needed)

```typescript
// User changes this in UI settings - no code change needed
const emailSyncDays = user.emailSyncDays || 90;
```

---

## PARAMETER SENSITIVITY ANALYSIS

### High Sensitivity (LOCKED)

**Candidate Threshold (50 points)**
- -10 points → +50% more emails processed (cost increase)
- +10 points → -30% fewer emails processed (miss subscriptions)
- **CRITICAL:** Directly affects detection rate

**Merchant DB Bonus (80 points)**
- Changes how known merchants are prioritized
- **CRITICAL:** Core competitive advantage

**AI Prompts**
- Changes what AI looks for
- **CRITICAL:** Affects accuracy and detection patterns

### Medium Sensitivity (TUNABLE with Notification)

**Chunk Sizes**
- Larger chunks → fewer API calls (faster, cheaper)
- Smaller chunks → more API calls (better error isolation)
- Safe range: 100-300 (pre-filter), 15-50 (deep)

**Rate Limit Delays**
- Shorter delays → faster processing (may hit rate limits)
- Longer delays → slower processing (safer)
- Safe range: 200-1000ms (pre-filter), 500-2000ms (deep)

### Low Sensitivity (User Preference)

**Email Sync Days**
- User decides how far back to look
- No impact on detection algorithm
- UI setting only

---

## TESTING REQUIREMENTS BY PARAMETER TYPE

### LOCKED Parameters
- Full regression test suite
- Manual verification by user
- A/B comparison with previous version
- Cost/performance benchmarks

### TUNABLE Parameters
- Focused integration tests
- Verify no rate limit errors
- Cost/performance check
- User notification sent

### USER-CONFIGURABLE
- No testing required (user preference)
- Validated by Zod schema in frontend

---

## CONFIGURATION VERSION HISTORY

| Version | Date | Changes | Type |
|---------|------|---------|------|
| 1.0.0 | 2025-11-10 | Initial configuration documentation | LOCKED |

---

**Last Updated:** 2025-11-10  
**Configuration Status:** 🔒 ACTIVE  
**Locked Parameters:** 30+ core algorithm values  
**Tunable Parameters:** 6 optimization values  
**User Settings:** 2 preference values
