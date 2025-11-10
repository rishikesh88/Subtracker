# Subscription Tracker Application

## Overview

SubTracker is a full-stack web application designed to automatically detect and track subscription services by analyzing user Gmail accounts. It processes transaction emails using intelligent parsing algorithms and provides a clean dashboard for managing and monitoring recurring subscription costs. The project aims to offer deep insights into spending patterns, providing a clear overview of financial commitments from various subscription services, with ambitions for market potential as a leading personal finance tool.

## User Preferences

Preferred communication style: Simple, everyday language.

## 🔒 PROTECTED CORE LOGIC

**CRITICAL NOTICE TO AI AGENTS:** The following files contain core subscription detection intellectual property and are **LOCKED**. Any modifications require explicit user approval.

### Protected Files

**Core Algorithm Files:**
- `server/core/transactionDetector.ts` (v1.0.0) - Rule-based scoring engine
- `server/core/merchantDatabase.ts` (v1.0.0) - Verified merchant lookup (152 merchants)
- `server/core/geminiSubscriptionDetector.ts` (v1.0.0) - AI pre-filter & deep analysis

**Protected Data:**
- `server/data/merchants.csv` (APPEND-ONLY) - 152 verified merchant database

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
- Keyword lists and patterns
- Fallback strategies and date validation
- Gmail API optimization details

See `server/core/CONFIGURATION.md` for:
- Locked parameters (require user approval)
- Tunable parameters (can adjust with notification)
- User-configurable settings

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

## System Architecture

### Frontend Architecture

The client-side is built with React and TypeScript, using Radix UI primitives and shadcn/ui components for a consistent design system, styled with TailwindCSS. State management is handled through TanStack Query for server state and React hooks for local state. Wouter is used for lightweight client-side navigation. The frontend follows a modular component structure with reusable UI components and custom hooks, implementing a theme-aware approach for light and dark modes.

### Backend Architecture

The server-side uses Express.js with TypeScript, following a service-oriented pattern. Key services include:
- **Gmail Service**: Manages OAuth2 authentication and optimized email fetching from Google APIs.
- **Transaction Detector**: A sophisticated multi-parameter scoring system for identifying transaction emails.
- **Email Parser**: Extracts transaction and merchant details from raw email content.
- **Gemini Subscription Detector**: Utilizes Google's Gemini AI for intelligent subscription detection.

The email sync system employs an optimized two-phase architecture:
1.  **Lightweight Screening**: Fetches email metadata, applies transaction detection with a merchant database (152 verified merchants), and pre-filters candidates using the `gemini-2.5-flash` model. This phase includes aggressive Gmail API batching (50 concurrent requests) and improved keyword coverage for renewal and hosting services.
2.  **Deep Processing**: Fetches full email content only for AI-approved candidates for detailed Gemini analysis, extracting comprehensive subscription information.

The system implements intelligent rate limiting for the Gmail API with exponential backoff for 429 errors and handles configurable email sync ranges (90/180 days).

### Database and Storage

The application uses Drizzle ORM with PostgreSQL (hosted on Neon Database) for data persistence. The schema includes tables for Users, Subscriptions, Emails, and `subscription_suggestions` for AI-generated recommendations. An in-memory storage implementation is available for development.

### Authentication and Authorization

Gmail integration uses the OAuth2 flow for secure email access, managing authorization URL generation, token exchange, refresh token handling, and secure storage of credentials.

### Build and Development Tools

Vite is used for fast development builds, and esbuild for production builds. TypeScript ensures type safety across the stack, with shared types between client and server.

## External Dependencies

### Core Services
- **Neon Database**: PostgreSQL hosting.
- **Google Gmail API**: Email access and OAuth2 authentication.
- **Google Cloud Console**: OAuth2 credentials and API key management.
- **Google Gemini API**: AI models (`gemini-2.5-flash`) for subscription detection.

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