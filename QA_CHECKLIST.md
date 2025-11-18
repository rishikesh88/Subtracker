# SubTracker Onboarding Flow - QA Checklist

## Overview
This checklist covers manual testing of the complete onboarding flow (Phases 1-6) including enhanced HITL review and empty states.

---

## Phase 1: Email+Password Authentication

### Signup Flow
- [ ] Navigate to `/signup`
- [ ] Verify all form fields render correctly (email, password, confirm password)
- [ ] Test validation: Submit with empty fields → Shows validation errors
- [ ] Test password mismatch: Different passwords → Shows error
- [ ] Test duplicate email: Existing email → Shows "Email already registered"
- [ ] **Success**: Valid credentials → Creates account and redirects to org setup

### Login Flow
- [ ] Navigate to `/login`
- [ ] Test invalid credentials → Shows "Invalid email or password"
- [ ] Test valid credentials → Logs in and redirects to dashboard/org setup
- [ ] Verify session persists across page refreshes

---

## Phase 2: Organization Setup

### Setup Page
- [ ] Navigate to `/onboarding/org-setup` (or automatic redirect after signup)
- [ ] Verify all form fields render: Organization Name, Country, Account Holder Name
- [ ] Test validation: Submit with empty fields → Shows errors
- [ ] **Success**: Fill valid data → Saves and redirects to `/onboarding/connect`
- [ ] Verify country selection auto-maps to currency (e.g., US → USD, IN → INR)
- [ ] Verify onboardingStatus updates to `org_complete` in database

---

## Phase 3: Connect Email Accounts

### Connect Page - Privacy & OAuth
- [ ] Navigate to `/onboarding/connect`
- [ ] Verify "Connect Gmail" and "Connect Outlook" buttons render
- [ ] Click "Connect Gmail" → Privacy modal appears
- [ ] Verify privacy modal content: metadata-only access, read-only permissions, disconnect option
- [ ] Verify backfill window slider (30/60/90/180 days, default 90)
- [ ] Click "Accept & Continue" → Redirects to Google OAuth login

### OAuth Flow (Manual Testing Required)
⚠️ **Note**: Google OAuth blocks automated testing. Manual testing required.

**Gmail OAuth:**
- [ ] Complete Google OAuth login with real account
- [ ] Verify redirect back to `/auth/callback?provider=gmail&success=true`
- [ ] Verify Gmail account stored in `gmail_accounts` table
- [ ] Verify background sync triggers automatically (see Phase 4)

**Outlook OAuth:**
- [ ] Complete Microsoft OAuth login with real account
- [ ] Verify redirect back to `/auth/callback?provider=outlook&success=true`
- [ ] Verify Outlook account stored in `outlook_accounts` table
- [ ] ⚠️ Note: Email ingestion deferred until schema migration (see Known Limitations)

### Skip Flow
- [ ] Click "Skip for now" → Shows confirmation modal
- [ ] Confirm skip → Updates onboardingStatus to `complete`
- [ ] Redirects to dashboard with empty state

---

## Phase 4: Background Sync & Progress Panel

### Sync Trigger
- [ ] After OAuth callback, verify background sync starts automatically
- [ ] Check server logs for sync activity (emails fetched, candidates found)

### Progress Panel UI
- [ ] Verify `SyncProgressPanel` appears after OAuth redirect
- [ ] Check real-time updates via SSE:
  - Emails scanned count increments
  - Candidates found count increments
  - Suggestions generated count increments
- [ ] Verify minimize/maximize toggle works
- [ ] Verify close button works
- [ ] Test auto-reconnect: Force disconnect (close browser tab briefly) → Reconnects with exponential backoff

### Progress Panel Edge Cases
- [ ] Verify heartbeat monitoring (connection status indicator)
- [ ] Test sync completion → "Review Suggestions" CTA appears
- [ ] Click "Review Suggestions" → Opens SubscriptionSuggestionsModal

---

## Phase 5: Enhanced HITL Review (Subscription Suggestions Modal)

### Modal Opening
- [ ] Click "Review Suggestions" from progress panel OR dashboard
- [ ] Verify modal opens with pagination (8 items per page)
- [ ] **Auto-select**: High-confidence suggestions are auto-selected on load ✅

### Batch Action Buttons
- [ ] Verify "Select High Confidence (N)" button shows correct count
- [ ] Click "Select High Confidence" → Only high-confidence items selected
- [ ] Click "Select All" → All items on current page selected
- [ ] Click "Clear Selection" → All items deselected
- [ ] Verify buttons disabled when appropriate (e.g., Clear when none selected)

### Visual Hierarchy
- [ ] Verify high-confidence cards have green background (`bg-green-50/50`)
- [ ] Verify high-confidence cards have green border (`border-green-200`)
- [ ] Verify high-confidence badge has green styling

### Enhanced Metadata Display
For each suggestion card, verify:
- [ ] Confidence score percentage displays (e.g., "87% match")
- [ ] Occurrences count displays (e.g., "3 emails") when > 1
- [ ] Last seen date displays (e.g., "Last: 11/15/2025")
- [ ] Metadata section only shows fields with data (handles null/undefined)

### Selection Behavior Regression Tests
⚠️ **Critical fixes applied - Test thoroughly:**
- [ ] **Test 1**: Open modal → High-confidence auto-selected → Close modal → Reopen modal on SAME page → High-confidence auto-selected again ✅
- [ ] **Test 2**: Open modal → Navigate to page 2 → High-confidence on page 2 auto-selected ✅
- [ ] **Test 3**: Click "Select All" button → All items selected (not toggled) ✅
- [ ] **Test 4**: Some items selected → Click "Select All" → All items selected (overrides partial state) ✅
- [ ] **Test 5**: Approve suggestions → Refetch → High-confidence on new data auto-selected ✅

### Approve/Reject Actions
- [ ] Select suggestions → Click "Approve Selected" → Toast shows "Processing..."
- [ ] Verify optimistic UI: Selected cards dim/scale down
- [ ] Verify success toast: "Successfully approved N suggestions"
- [ ] Verify subscriptions appear in dashboard
- [ ] Test reject flow: Select → "Reject Selected" → Suggestions removed
- [ ] Test individual approve/reject quick actions

---

## Phase 6: Rich Empty States

### Empty Dashboard Variants
Test each variant with appropriate user state:

**Variant 1: No Accounts Connected**
- [ ] Fresh user account, no email accounts
- [ ] Verify `EmptyDashboard` shows `no-accounts` variant
- [ ] Verify icon: Mail envelope icon
- [ ] Verify title: "Welcome to SubTracker"
- [ ] Verify description: "Connect your email accounts to start tracking..."
- [ ] Verify CTA: "Connect Email Account" button
- [ ] Click CTA → Redirects to `/onboarding/connect`

**Variant 2: No Sync (Accounts Connected, No Emails)**
- [ ] User with connected accounts, but no sync run yet
- [ ] Verify `EmptyDashboard` shows `no-sync` variant
- [ ] Verify icon: RefreshCw icon
- [ ] Verify title: "Ready to Sync Emails"
- [ ] Verify CTA: "Run First Sync" button
- [ ] Click CTA → Triggers email sync

**Variant 3: No Subscriptions (Synced, No Results)**
- [ ] User with synced emails, but no approved subscriptions
- [ ] Verify `EmptyDashboard` shows `no-subscriptions` variant
- [ ] Verify icon: ListChecks icon
- [ ] Verify title: "No Active Subscriptions"
- [ ] Verify CTAs: "View Suggestions" + "Sync More Emails"
- [ ] Click "View Suggestions" → Redirects to `/suggestions`
- [ ] Click "Sync More Emails" → Triggers sync

### Onboarding Progress Indicator
- [ ] Verify progress bar shows when `onboardingProgress > 0 && < 100`
- [ ] Verify step indicators (3 steps): Connect Email, Sync Emails, Review Subs
- [ ] Verify completed steps show green checkmark icon
- [ ] Verify incomplete steps show gray icon

### Empty State Integration
- [ ] Verify `SubscriptionList` component shows EmptyDashboard when no subscriptions
- [ ] Verify dashed border styling on empty state card
- [ ] Verify responsive layout (mobile, tablet, desktop)

---

## Cross-Cutting Concerns

### Authentication State
- [ ] Test logged-out access: Restricted pages redirect to `/login`
- [ ] Test session persistence across browser refresh
- [ ] Test logout functionality

### Dashboard Statistics
- [ ] After approving subscriptions, verify stats update:
  - Total subscriptions count
  - Monthly spending calculation
  - Category breakdown
- [ ] After deleting subscription, verify stats refresh

### Error Handling
- [ ] Test network errors: Disconnect internet → Shows error messages
- [ ] Test API errors: Invalid data → Shows validation errors
- [ ] Test OAuth failures: Cancel OAuth flow → Shows error toast

### Dark Mode (if implemented)
- [ ] Test all UI components in dark mode
- [ ] Verify colors are accessible (contrast ratios)
- [ ] Verify green high-confidence styling works in dark mode

---

## Known Limitations & Workarounds

### Email Schema Multi-Provider Support
- ⚠️ **Current**: Only Gmail emails are stored in database
- ⚠️ **Workaround**: Outlook accounts connect successfully, but email ingestion deferred
- **Fix Required**: Schema migration to add `providerMessageId` field (see replit.md)

### OAuth Testing Limitation
- ⚠️ **Limitation**: Google OAuth blocks Playwright/Selenium automation
- **Workaround**: Manual testing required for full OAuth flow
- **Testable**: Organization setup, privacy modal, OAuth initiation
- **Manual Only**: OAuth callback → sync → progress panel flow

---

## Test Environment Setup

### Prerequisites
- [ ] Real Gmail account for testing (test@gmail.com or personal)
- [ ] Real Outlook account for testing (optional, for multi-account testing)
- [ ] Development environment running (`npm run dev`)
- [ ] Database accessible (`npm run db:push` completed)

### Test Data Cleanup
After testing, you may want to:
- [ ] Delete test user accounts from database
- [ ] Clear `gmail_accounts` and `outlook_accounts` tables
- [ ] Clear `subscription_suggestions` and `subscriptions` tables
- [ ] Revoke OAuth tokens in Google/Microsoft account settings

---

## Sign-Off

**Tester Name**: _________________  
**Test Date**: _________________  
**All Tests Passed**: ☐ Yes  ☐ No (list failures below)

**Failures/Issues Found**:
1. 
2. 
3. 

**Notes**:


---

**QA Checklist Version**: 1.0  
**Last Updated**: November 18, 2025  
**Coverage**: Phases 1-6 (Authentication → Empty States)
