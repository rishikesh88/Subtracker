# Subscription Tracker Application

## Overview

SubTracker is a full-stack web application designed to automatically detect and track subscription services by analyzing user Gmail accounts. It processes transaction emails using intelligent parsing algorithms and provides a clean dashboard for managing and monitoring recurring subscription costs. The project aims to offer deep insights into spending patterns, providing a clear overview of financial commitments from various subscription services, with ambitions for market potential as a leading personal finance tool.

## User Preferences

Preferred communication style: Simple, everyday language.

## 🔒 PROTECTED CORE LOGIC

**CRITICAL NOTICE TO AI AGENTS:** The following files contain core subscription detection intellectual property and are **LOCKED**. Any modifications require explicit user approval.

### Protected Files

**Core Algorithm Files:**
- `server/core/transactionDetector.ts` (v1.0.1) - Rule-based scoring engine with tiered merchant matching
- `server/core/merchantDatabase.ts` (v1.2.0) - Verified merchant lookup (200 merchants) with multi-domain support
- `server/core/geminiSubscriptionDetector.ts` (v1.0.0) - AI pre-filter & deep analysis

**Protected Data:**
- `server/data/merchants.csv` (APPEND-ONLY) - 200 verified merchant database with multi-domain support

**Documentation:**
- `server/core/SPECIFICATION.md` - Canonical algorithm specification (exact prompts, scoring, thresholds)
- `server/core/README.md` - Protection rules and modification protocol
- `server/core/CONFIGURATION.md` - Locked vs. tunable parameters
- `server/data/MERCHANTS_README.md` - Merchant database protection rules

### Modification Protocol

**BEFORE ANY CHANGE TO PROTECTED FILES:**
1. ⚠️  **STOP** - Do not proceed without approval
2. **ASK USER** - Request explicit approval with detailed change description
3. **EXPLAIN** - What you want to change and why
4. **WAIT** - For user's explicit "yes" or "approved" response
5. **LOG** - Document change in `server/core/README.md` changelog after approval

### Prohibited Actions (Without User Approval)

- ❌ Modifying scoring algorithms or thresholds
- ❌ Changing AI prompts or system instructions
- ❌ Altering fallback strategies (maximum detection priority)
- ❌ Adjusting confidence level calculations
- ❌ Modifying merchant database lookup logic
- ❌ Changing deduplication algorithms
- ❌ Removing or renaming protected files
- ❌ Any "optimization" or "refactoring" without explicit request

### Provider-Agnostic Architecture

**Design Principle:** Core logic works with ANY email provider (Gmail, Outlook, etc.) without modification.

**Current Providers:**
- ✅ Gmail (Google Workspace)

**Planned Providers:**
- 📋 Outlook/Microsoft 365
- 📋 Multiple account support

**IMPORTANT:** When adding new providers:
- ✅ Create provider adapter in `server/services/`
- ✅ Reuse existing core logic without modifications
- ❌ DO NOT duplicate core algorithms per provider

### User Priority

**Maximum subscription detection with highest accuracy** (non-negotiable).

Fallback strategy approves chunks on parsing failures to ensure no subscription data is lost. This aligns with user's primary goal of comprehensive detection.

### Documentation

See `server/core/SPECIFICATION.md` for:
- Exact AI prompts (pre-filter & deep analysis)
- Complete scoring algorithm with all thresholds
- Tiered merchant matching system (80/60/45 pts)
- Multi-domain support and tldts library usage
- Keyword lists and patterns
- Fallback strategies and date validation
- Gmail API optimization details

See `server/core/CONFIGURATION.md` for:
- Locked parameters (require user approval)
- Tunable parameters (can adjust with notification)
- User-configurable settings

See `server/data/MERCHANTS_README.md` for:
- Merchant database protection rules
- Multi-domain support using pipe-separated format
- Tiered scoring system (exact email, root domain, pattern match)
- Adding new merchants protocol

### Change Request Template

When requesting changes to core logic:

```
🔒 CORE LOGIC CHANGE REQUEST

File(s): [list files]
Change: [description]
Reason: [justification]
Expected Impact:
- Performance: [Better/Worse/Same]
- Accuracy: [Better/Worse/Same]
- Detection: [More/Fewer/Same]

USER APPROVAL: ⏳ Pending
```

### Recent Changes

**November 14, 2025 - Multi-Account Gmail Support (v2.0.0)**

Implemented comprehensive multi-account Gmail integration, allowing users to connect unlimited Gmail accounts with independent management:

**Key Features:**
- **Unlimited Accounts**: Users can connect multiple Gmail accounts for comprehensive subscription tracking
- **Account Management**: Individual connect/disconnect controls per account in Settings page
- **Source Attribution**: Each subscription and suggestion is tagged with its source Gmail account
- **Independent Tokens**: Each account maintains its own OAuth tokens with automatic refresh handling
- **Account Status Tracking**: Per-account sync status (idle, syncing, error) and error messages

**Database Schema:**
- New `gmail_accounts` table with columns: id, userId, gmailEmail, accessToken, refreshToken, tokenExpiry, lastSync, syncStatus, syncError, createdAt
- Added `gmailAccountId` foreign key to `emails`, `subscriptions`, and `subscription_suggestions` tables
- Indexes added for performance: userId, gmailEmail, syncStatus
- Nullable gmailAccountId for backward compatibility during migration

**API Endpoints:**
- GET `/api/gmail/accounts` - List all connected accounts for authenticated user
- GET `/api/gmail/accounts/:id` - Get single account details with ownership validation
- DELETE `/api/gmail/accounts/:id` - Disconnect specific account with security checks
- OAuth callback updated to handle missing refresh_token on repeat authorization

**Frontend Updates:**
- **Settings Page**: Multi-account list view with empty state, individual disconnect buttons, status badges (idle/syncing/error), sync error messages, and "Add Another Account" button
- **Subscription Detail**: Shows source Gmail account email in "About Subscription" section when gmailAccountId exists
- **Status Badges**: Color-coded badges for account states (green for ready/idle, blue for syncing, red for error)

**Data Migration:**
Successfully migrated existing data from single-account (users table) to multi-account structure (gmail_accounts table):
- 1 user migrated
- 63 emails linked to Gmail account
- 13 subscriptions linked to Gmail account  
- 18 suggestions linked to Gmail account

**Security:**
- Ownership validation on all account operations
- User-scoped queries prevent cross-user data access
- Sanitized responses exclude access/refresh tokens from API responses

**Technical Details:**
- OAuth callback reuses stored refresh_token when Google omits new one (common on repeat auth)
- Per-account delete state tracking prevents UI blocking on individual account removal
- Conditional TanStack Query only fetches Gmail account when gmailAccountId exists
- 204 No Content response handling for DELETE operations

**Remaining Work (Future Enhancement):**
- Per-account Gemini sync pipeline (currently uses legacy user-based sync)
- Parallel sync across all accounts using Promise.allSettled()
- Dashboard global sync indicator showing "Syncing X of Y accounts"
- Per-account sync buttons with progress indicators

**November 14, 2025 - Tiered Merchant Matching System (v1.2.0)**

Implemented intelligent tiered merchant matching to handle email format variations and regional domain differences:

**Key Features:**
- **Multi-domain support**: Merchants can specify multiple domains using pipe-separated format (`airtel.com|airtel.in`)
- **Tiered scoring**:
  - Tier 1: Exact email match (+80 points) - Highest confidence
  - Tier 2: Root domain match (+60 points) - High confidence, handles subdomain variations
  - Tier 3: Pattern match (+45 points) - Medium-high confidence for account-specific emails
- **tldts library integration**: Correctly handles multi-level TLDs (.co.uk, .com.au) to prevent false positives

**Technical Implementation:**
- Enhanced `MerchantDatabase` loader to parse pipe-separated domains
- Added root domain index using `tldts` for public suffix-aware extraction
- Updated `TransactionDetector` to use tiered scoring via `isKnownMerchantWithScore()`
- Fixed Airtel detection issue: now matches `billing@airtel.in`, `ebill@airtel.com`, and subdomain variations

**Design Rationale:**
Favors domain-based matching over exact email addresses for resilience to vendor email format changes (billing@ → ebill@ → noreply@). Domains remain stable while email prefixes frequently change.

**Documentation Updates:**
- SPECIFICATION.md v1.0.1: Documented tiered matching system
- MERCHANTS_README.md v1.2.0: Updated with multi-domain support and tiered scoring
- Merchant count: 200 verified merchants

## System Architecture

### Frontend Architecture

The client-side is built with React and TypeScript, using Radix UI primitives and shadcn/ui components for a consistent design system, styled with TailwindCSS. State management is handled through TanStack Query for server state and React hooks for local state. Wouter is used for lightweight client-side navigation. The frontend follows a modular component structure with reusable UI components and custom hooks, implementing a theme-aware approach for light and dark modes.

### Backend Architecture

The server-side uses Express.js with TypeScript, following a service-oriented pattern. Key services include:
- **Gmail Service**: Manages OAuth2 authentication and optimized email fetching from Google APIs.
- **Transaction Detector**: A sophisticated multi-parameter scoring system for identifying transaction emails.
- **Email Parser**: Extracts transaction and merchant details from raw email content.
- **Gemini Subscription Detector**: Utilizes Google's Gemini AI for intelligent subscription detection.
- **Invoice Extractor** (NEW): Automatically downloads email attachments (PDFs, images) from Gmail and uploads them to object storage as invoice records when subscriptions are approved.

The email sync system employs an optimized two-phase architecture:
1.  **Lightweight Screening**: Fetches email metadata, applies transaction detection with a tiered merchant database (200 verified merchants with multi-domain support), and pre-filters candidates using the `gemini-2.5-flash` model. The merchant matching uses intelligent tiered scoring: exact email match (+80 pts), root domain match (+60 pts), and pattern match (+45 pts). This phase includes aggressive Gmail API batching (50 concurrent requests) and improved keyword coverage for renewal and hosting services.
2.  **Deep Processing**: Fetches full email content only for AI-approved candidates for detailed Gemini analysis, extracting comprehensive subscription information.

The system implements intelligent rate limiting for the Gmail API with exponential backoff for 429 errors and handles configurable email sync ranges (90/180 days).

**Automatic Invoice Extraction** (Added: November 2025):
When users approve subscription suggestions, the system automatically:
1. Parses `attachmentData` from evidence emails
2. Downloads PDF and image attachments from Gmail API
3. Uploads files to Replit Object Storage at `/objects/invoices/{uuid}/{filename}`
4. Sets ACL policy (private, owner-only access)
5. Creates invoice records with `source: 'gmail'`
6. Implements deduplication to prevent duplicate invoices
7. Uses non-fatal error handling (invoice failures don't block subscription approval)

### Database and Storage

The application uses Drizzle ORM with PostgreSQL (hosted on Neon Database) for data persistence. The schema includes tables for Users, Subscriptions, Emails, `subscription_suggestions` for AI-generated recommendations, and `invoices` for storing invoice file metadata.

**Object Storage Integration**:
- Replit Object Storage (GCS-backed) for invoice files
- Stable `/objects/...` paths (no expiring presigned URLs)
- ACL enforcement for private file access
- Direct buffer upload support via `ObjectStorageService.uploadBufferWithAcl()`

### Authentication and Authorization

Gmail integration uses the OAuth2 flow for secure email access, managing authorization URL generation, token exchange, refresh token handling, and secure storage of credentials.

### Build and Development Tools

Vite is used for fast development builds, and esbuild for production builds. TypeScript ensures type safety across the stack, with shared types between client and server.

## External Dependencies

### Core Services
- **Neon Database**: PostgreSQL hosting.
- **Google Gmail API**: Email access, OAuth2 authentication, and attachment downloads.
- **Google Cloud Console**: OAuth2 credentials and API key management.
- **Google Gemini API**: AI models (`gemini-2.5-flash`) for subscription detection.
- **Replit Object Storage**: GCS-backed storage for invoice files (PDFs, images, documents).

### UI and Styling
- **Radix UI**: Headless UI primitives.
- **shadcn/ui**: Pre-built component library.
- **TailwindCSS**: Utility-first CSS framework.
- **Lucide React**: Icon library.

### Data and State Management
- **TanStack Query**: Server state management.
- **Drizzle ORM**: Type-safe database queries.
- **Drizzle Kit**: Database migration tools.

### Development and Build Tools
- **Vite**: Development server and build tooling.
- **TypeScript**: Type safety.
- **React Hook Form**: Form management.
- **Zod**: Runtime type validation.