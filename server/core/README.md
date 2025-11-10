# 🔒 PROTECTED CORE LOGIC

This directory contains SubTracker's core subscription detection intellectual property. **All files in this directory are protected and require explicit user approval before any modifications can be made.**

---

## PROTECTION RULES

### 🚨 MODIFICATION PROTOCOL

**REQUIRED BEFORE ANY CHANGE:**
1. ⚠️  Request explicit user approval with detailed change description
2. 📝 Document change reason and expected impact
3. ✅ Receive explicit "yes" confirmation from user
4. 📊 Log change in changelog below
5. 🔄 Update version number in affected files
6. 📋 Update SPECIFICATION.md if algorithm/prompt changes

### ❌ PROHIBITED ACTIONS (Without User Approval)

- Modifying scoring algorithms or thresholds
- Changing AI prompts or system instructions
- Altering fallback strategies
- Adjusting confidence level calculations
- Modifying merchant database lookup logic
- Changing deduplication algorithms
- Updating rate limiting parameters
- Removing or renaming existing files
- Any "optimization" or "refactoring" without explicit request

### ✅ ALLOWED ACTIONS (With Notification)

- **Bug fixes** (must notify user with details)
- **Adding comments** (documentation improvements)
- **Performance profiling** (non-intrusive logging)

**Note:** Even allowed actions should be minimized and user should be informed.

---

## PROTECTED FILES

### Core Algorithm Files

| File | Purpose | Version | Last Modified |
|------|---------|---------|---------------|
| `transactionDetector.ts` | Rule-based scoring engine | 1.0.0 | 2025-11-10 |
| `merchantDatabase.ts` | Verified merchant lookup | 1.0.0 | 2025-11-10 |
| `geminiSubscriptionDetector.ts` | AI pre-filter & deep analysis | 1.0.0 | 2025-11-10 |

### Documentation Files

| File | Purpose |
|------|---------|
| `SPECIFICATION.md` | Canonical algorithm specification |
| `README.md` | Protection rules (this file) |
| `CONFIGURATION.md` | Locked vs. tunable parameters |

### Data Files

| File | Purpose | Protection Level |
|------|---------|------------------|
| `../data/merchants.csv` | Verified merchant database (152 entries) | APPEND-ONLY |

---

## PROVIDER-AGNOSTIC ARCHITECTURE

### Multi-Provider Support (Future)

The core logic is designed to work with **any email provider** (Gmail, Outlook, etc.) without modification.

**Design Principle:**
```typescript
// Core logic operates on abstract Email interface
interface Email {
  id: string;
  subject: string;
  fromEmail: string;
  content: string;
  // ... provider-agnostic fields
}

// Provider-specific adapters fetch emails
class GmailAdapter implements EmailProvider { ... }
class OutlookAdapter implements EmailProvider { ... }

// Core logic remains unchanged
transactionDetector.detect(email);  // Same for all providers
geminiDetector.analyze(emails);     // Same for all providers
```

**Supported Providers (Current):**
- ✅ Gmail (Google Workspace)

**Planned Providers:**
- 📋 Outlook/Microsoft 365
- 📋 Multiple account support (Gmail + Outlook)

**IMPORTANT:** When adding new providers:
- ✅ Create new adapter in `server/services/`
- ✅ Reuse existing core logic (no modifications)
- ❌ DO NOT duplicate core algorithms per provider

---

## MERCHANT DATABASE MANAGEMENT

### Append-Only Policy

The `merchants.csv` file follows an **APPEND-ONLY** policy:

✅ **Allowed:**
- Adding new verified merchants to end of file
- Expanding coverage for additional services

❌ **Prohibited:**
- Modifying existing merchant entries
- Removing merchant entries
- Changing file structure/format

### Adding New Merchants

**Required Format:**
```csv
name,websiteDomain,billingEmailDomain,products,frequency,regions
```

**Process:**
1. Verify merchant is legitimate subscription service
2. Add entry to end of merchants.csv
3. Notify user of addition with merchant name
4. Update merchant count in SPECIFICATION.md

**Example:**
```csv
Zoom,zoom.us,no-reply@zoom.us,Video Conferencing,monthly,Global
```

---

## CONFIGURATION PARAMETERS

See `CONFIGURATION.md` for detailed breakdown of:
- 🔒 **Locked Parameters** (cannot change without approval)
- ⚙️ **Tunable Parameters** (can adjust with notification)

---

## CHANGE REQUEST TEMPLATE

Use this template when requesting core logic modifications:

```
🔒 CORE LOGIC CHANGE REQUEST

File(s) Affected: [list files]
Change Type: [Algorithm/Prompt/Threshold/Other]
Version Impact: [Major/Minor/Patch]

CURRENT BEHAVIOR:
[Describe what currently happens]

PROPOSED CHANGE:
[Describe what you want to change]

REASON/JUSTIFICATION:
[Why is this change needed?]

EXPECTED IMPACT:
- Performance: [Better/Worse/Same]
- Accuracy: [Better/Worse/Same]
- Cost: [Higher/Lower/Same]
- Subscription Detection: [More/Fewer/Same]

RISKS:
[What could go wrong?]

TESTING PLAN:
[How will you verify this works?]

USER APPROVAL: ⏳ Pending
```

---

## CHANGELOG

### Version 1.0.0 (2025-11-10)

**Initial Protection System Implementation**
- Created protected `server/core/` directory
- Moved core logic files from `server/services/`
- Established APPEND-ONLY policy for merchants.csv
- Documented canonical specifications
- Implemented protection markers and version tracking
- Updated replit.md with protection rules

**Files Protected:**
- `transactionDetector.ts` (v1.0.0)
- `merchantDatabase.ts` (v1.0.0)
- `geminiSubscriptionDetector.ts` (v1.0.0)

**Status:** ✅ Active Protection

---

## MODIFICATION HISTORY

| Date | File | Change | Approved By | Reason |
|------|------|--------|-------------|--------|
| 2025-11-10 | All | Initial protection setup | User | Protect core IP and ensure consistency across providers |

---

## AI AGENT INSTRUCTIONS

**⚠️ CRITICAL NOTICE TO AI AGENTS:**

If you are an AI agent reading this file, you **MUST** follow these rules:

1. **STOP** if asked to modify any file in `server/core/`
2. **ASK USER** for explicit approval before proceeding
3. **EXPLAIN** what you want to change and why
4. **WAIT** for user's explicit "yes" or "approved" response
5. **LOG** the change in this README.md after approval

**Example Response:**
```
⚠️ This change requires modifying core subscription detection logic.

I need to update the transaction detector scoring algorithm to [description].
This will affect how subscription emails are identified.

May I proceed with this change? Please respond "yes" to approve or "no" to cancel.
```

**DO NOT:**
- Modify core files without asking
- Make "optimizations" without approval
- Change prompts to "improve" them
- Adjust thresholds to "fix" issues
- Refactor "for better code quality"

**USER'S PRIORITY:** Maximum subscription detection with highest accuracy. Do not make changes that could reduce detection rate.

---

## TESTING REQUIREMENTS

### Before ANY Core Logic Change

1. **Unit Tests:** Verify scoring algorithm outputs
2. **Integration Tests:** Test email processing pipeline end-to-end
3. **Regression Tests:** Ensure existing subscriptions still detected
4. **Performance Tests:** Verify cost/speed within targets
5. **User Acceptance:** Get user confirmation that results match expectations

### Validation Metrics

- **Detection Rate:** % of known subscriptions found (target: 95%+)
- **False Positive Rate:** % of non-subscriptions detected (target: <5%)
- **Processing Cost:** API costs per sync (target: ₹30-50)
- **Processing Time:** End-to-end sync duration (target: <5 min)

---

## ROLLBACK PROCEDURE

If a change causes issues:

1. **Immediate:** Revert to previous version using git
2. **Notify User:** Explain what went wrong
3. **Document:** Log the failed change and lessons learned
4. **Analyze:** Understand why change caused issues
5. **Plan:** Develop better approach if change is still needed

**Replit Checkpoints:** User can rollback entire project to pre-change state if needed.

---

## SUPPORT & ESCALATION

**Questions about core logic?**
1. Check `SPECIFICATION.md` for algorithm details
2. Check `CONFIGURATION.md` for parameter definitions
3. Ask user if documentation unclear

**Need to make a change?**
1. Use Change Request Template above
2. Get explicit user approval
3. Log change in this README.md
4. Update version numbers

---

**Last Updated:** 2025-11-10  
**Protection Status:** 🔒 ACTIVE  
**Protected Files:** 3 code files, 1 data file, 3 documentation files
