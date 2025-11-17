# Subscription Tracker Application

## Overview

SubTracker is a full-stack web application designed to automatically detect and track subscription services by analyzing user Gmail and Outlook accounts. It processes transaction emails using intelligent parsing and AI algorithms, providing a dashboard for managing recurring subscription costs. The project aims to offer deep insights into spending patterns and financial commitments, with ambitions to become a leading personal finance tool.

## User Preferences

Preferred communication style: Simple, everyday language.

**CRITICAL NOTICE TO AI AGENTS:** The following files contain core subscription detection intellectual property and are **LOCKED**. Any modifications require explicit user approval.

### Protected Files

**Core Algorithm Files:**
- `server/core/transactionDetector.ts`
- `server/core/merchantDatabase.ts`
- `server/core/geminiSubscriptionDetector.ts`

**Protected Data:**
- `server/data/merchants.csv` (APPEND-ONLY)

**Documentation:**
- `server/core/SPECIFICATION.md`
- `server/core/README.md`
- `server/core/CONFIGURATION.md`
- `server/data/MERCHANTS_README.md`

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

### User Priority

**Maximum subscription detection with highest accuracy** (non-negotiable).

## System Architecture

### Frontend Architecture

The client-side is built with React and TypeScript, utilizing Radix UI primitives and shadcn/ui components for a consistent design system, styled with TailwindCSS. State management is handled through TanStack Query for server state and React hooks for local state. Wouter is used for lightweight client-side navigation. The frontend follows a modular component structure with reusable UI components and custom hooks, implementing a theme-aware approach for light and dark modes.

### Backend Architecture

The server-side uses Express.js with TypeScript, following a service-oriented pattern. Key services include:
- **Email Services (Gmail, Outlook)**: Manages OAuth2 authentication and optimized email fetching from Google and Microsoft APIs.
- **Transaction Detector**: A multi-parameter scoring system for identifying transaction emails.
- **Email Parser**: Extracts transaction and merchant details from raw email content.
- **Gemini Subscription Detector**: Utilizes Google's Gemini AI for intelligent subscription detection.
- **Invoice Extractor**: Automatically downloads email attachments (PDFs, images) and uploads them to object storage as invoice records when subscriptions are approved.

The email sync system employs an optimized two-phase architecture:
1.  **Lightweight Screening**: Fetches email metadata, applies transaction detection with a tiered merchant database (200 verified merchants with multi-domain support), and pre-filters candidates using the `gemini-2.5-flash` model. This phase includes aggressive API batching and improved keyword coverage.
2.  **Deep Processing**: Fetches full email content only for AI-approved candidates for detailed Gemini analysis, extracting comprehensive subscription information.

The system supports multi-account integration for both Gmail and Outlook, with a global limit of 4 accounts (2 Gmail + 2 Outlook) and parallel syncing across all connected accounts. Core logic is provider-agnostic, designed to work with any email provider via adapters.

### Database and Storage

The application uses Drizzle ORM with PostgreSQL (hosted on Neon Database) for data persistence. The schema includes tables for Users, Subscriptions, Emails, `subscription_suggestions` for AI-generated recommendations, `gmail_accounts`, `outlook_accounts`, and `invoices` for storing invoice file metadata. Replit Object Storage (GCS-backed) is used for invoice files with ACL enforcement.

### Key Features

**Subscription Deletion with Cascade Cleanup:**
Users can delete subscriptions from the detail page with a comprehensive cleanup process:
- Confirmation modal warns about permanent deletion of subscription details, invoices, and invoice files
- Backend cascade deletion removes:
  - All related invoice records from the database
  - Invoice files from Google Cloud Storage (handles both normalized `/objects/...` URLs and direct GCS URLs)
  - The subscription record
- Graceful error handling ensures database cleanup proceeds even if some storage files are missing
- Dashboard statistics automatically refresh after deletion
- User is redirected to subscriptions list after successful deletion

### Authentication and Authorization

The application supports dual authentication methods:
1. **Replit Auth**: Existing OAuth-based authentication (original method)
2. **Email+Password Auth**: New signup/login system with bcrypt password hashing, added alongside Replit Auth

Gmail and Outlook integrations use the OAuth2 flow for secure email access, managing authorization, token exchange, refresh token handling, and secure storage of credentials.

### Incremental Onboarding Flow

**Status: Phases 1-3 Complete** ✅

The application includes a multi-step onboarding flow for new users:

**Phase 1 - Authentication** (✅ Complete):
- Email+password signup and login with secure bcrypt hashing
- Server-side validation with Zod schemas
- Protected fields (passwordHash, onboardingStatus, privacyConsentGiven) never exposed to client

**Phase 2 - Organization Setup** (✅ Complete):
- `/onboarding/org-setup` page collects organization name, country, and account holder name
- Country selection automatically maps to default currency (USD, EUR, GBP, etc.)
- Backend endpoint `/api/onboarding/org-setup` saves data and updates onboardingStatus to 'org_complete'

**Phase 3 - Connect Accounts** (✅ Complete):
- `/onboarding/connect` page with Connect Gmail/Outlook buttons
- Privacy modal explains metadata-only access, read-only permissions, and ability to disconnect
- Backfill window slider (30/60/90/180 days, default 90)
- Unified `/api/onboarding/connect` endpoint that saves consent, mints OAuth state with metadata, and returns authUrl
- Skip flow with `/api/onboarding/skip` endpoint marks onboarding complete without connecting accounts
- All OAuth flows redirect consistently to `/auth/callback?provider=X&success=true` or `&error=...`
- State metadata includes userId, provider, emailSyncDays, and privacyConsentGiven for security

**OAuth Flow Architecture:**
- **Onboarding flow**: Uses `/api/onboarding/connect` with full metadata (emailSyncDays, consent)
- **Reconnect flow**: Uses `/api/auth/google` or `/api/auth/outlook/connect` with userId and provider
- All OAuth state creators store consistent metadata in oauthStates Map
- Callbacks validate state, prefer stateData.userId over session for resilience
- Error handling standardized across all paths

**Onboarding Status Transitions:**
- `pending`: New user, needs to complete org setup
- `org_complete`: Organization setup done, needs to connect email accounts or skip
- `complete`: Fully onboarded (either connected accounts or skipped)

## External Dependencies

### Core Services
- **Neon Database**: PostgreSQL hosting.
- **Google Gmail API**: Email access, OAuth2, and attachment downloads.
- **Microsoft Graph API**: Email access, OAuth2 for Outlook.
- **Google Gemini API**: AI models (`gemini-2.5-flash`) for subscription detection.
- **Replit Object Storage**: GCS-backed storage for invoice files.

### UI and Styling
- **Radix UI**: Headless UI primitives.
- **shadcn/ui**: Pre-built component library.
- **TailwindCSS**: Utility-first CSS framework.
- **Lucide React**: Icon library.

### Data and State Management
- **TanStack Query**: Server state management.
- **Drizzle ORM**: Type-safe database queries.

### Development and Build Tools
- **Vite**: Development server and build tooling.
- **TypeScript**: Type safety.
- **React Hook Form**: Form management.
- **Zod**: Runtime type validation.