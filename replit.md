# Subscription Tracker Application

## Overview

SubTracker is a full-stack web application designed to automatically detect and track subscription services by analyzing user email accounts (Gmail and Outlook). It processes transaction emails using intelligent parsing algorithms and provides a clean dashboard for managing and monitoring recurring subscription costs. The project aims to offer deep insights into spending patterns, providing a clear overview of financial commitments from various subscription services, with ambitions for market potential as a leading personal finance tool.

## Recent Changes

### Subscription Detection Pipeline Fixes (November 5, 2025)
**COMPREHENSIVE AI PIPELINE FIXES** - Resolved critical issues causing crashes, missing data, and duplicates
#### 1. **Fixed Date Parsing Crashes** (RangeError: Invalid time value)
- **Problem**: Invalid date strings from AI (e.g., "Oct 5", "in 2 days") caused database save crashes
- **Solution**: Created robust `parseFlexibleDate()` utility
  - Handles ISO dates, relative dates ("in 2 days"), partial dates ("Oct 5")
  - Returns `null` for invalid dates instead of crashing
  - Adds year inference for partial dates
- **Impact**: No more RangeError crashes during sync

#### 2. **Fixed Missing Amounts** (₹0.00 in suggestions)
- **Problem**: Gemini not extracting amounts from renewal reminder emails
- **Solution**: 
  - Enhanced AI prompt with "CRITICAL: AMOUNT EXTRACTION IS MANDATORY" section
  - Added validation to skip subscriptions with amount=0 or missing
  - Improved examples showing where amounts appear (subject, body, snippet)
- **Impact**: Subscriptions now have valid amounts, ₹0 suggestions rejected
- **Known limitation**: Emails with missing amounts will retry on next sync (creates log noise only)

#### 3. **Fixed Database Deduplication** (Repeated suggestions)
- **Problem**: No check against existing suggestions - every sync created duplicates
- **Solution**: Implemented database-level deduplication
  - Query existing suggestions by `serviceKey` before saving
  - If exists: Update (increment `occurrences`, update `lastSeen`, upgrade confidence)
  - If new: Create suggestion
  - Separate counters track: new / updated / skipped
- **Impact**: No more duplicate suggestions for same service within same account

#### 4. **Robust ServiceKey Normalization**
- **Problem**: AI variations in naming (casing, spacing, punctuation) created different keys
- **Solution**: Created `createRobustServiceKey()` using merchant + service + frequency
  - Normalization: lowercase, remove special chars, collapse whitespace
  - Applied consistently everywhere (Gemini dedup, database dedup, conversion)
- **Impact**: AI variations no longer create duplicate keys
- **Example**: "Netflix Premium", "netflix premium", "Netflix  Premium" → all same key
- **Known limitation**: First sync after deployment may create some duplicates for existing legacy data with significant merchant name variations (e.g., "Netflix Inc." vs "Netflix"). Subsequent syncs will not create duplicates.

- **Performance Enhancement**: Implemented parallel multi-account syncing
  - **Before**: Accounts synced sequentially (one after another)
  - **After**: All accounts sync simultaneously using `Promise.allSettled()`
  - **Result**: ~3x faster sync for users with 3 accounts
  - Error handling: one account failure doesn't stop others
  - Progress tracking maintained for concurrent execution

- **Improved Diagnostics**: Added comprehensive logging throughout sync pipeline
  - Detailed Gemini output logging (full JSON of detected subscriptions)
  - Per-subscription save attempt tracking
  - Detailed error information with stack traces
  - Success/failure ratios for debugging

#### 5. **UI/UX Improvements** (November 5, 2025)
- **Auto-open Suggestions Modal**: After sync completion, suggestions modal automatically opens for user review
- **Emails Analyzed Tracking**: 
  - Added `emailsAnalyzed` counter to `email_accounts` table
  - Incremented during each sync to track total emails processed per account
  - Dashboard stats now show accurate total across all accounts
- **Sync Days Filter**: Added 30, 60, 90, and 180 days options in email sync period selector

### Transaction Detector & AI Pre-Filter Improvements (November 5, 2025)
**MAJOR ACCURACY IMPROVEMENTS** - Fixed critical bottleneck causing 85% of subscription candidates to be rejected

#### Problem Identified
- **AI Pre-Filter Too Conservative**: Only 15% approval rate (194/1282 candidates) causing missing subscriptions
- **Missing Keywords**: Insurance, telecom, utilities, and maintenance subscriptions not detected
- **Scoring Cap Issue**: Subject analysis capped at 40 points prevented strong signals from reaching 50-point threshold

#### Solutions Implemented

1. **AI Pre-Filter Enhancement**
   - Changed from "Be CONSERVATIVE" to "Be COMPREHENSIVE"
   - Added 10 diverse subscription categories with examples:
     - Insurance (TATA AIG, HDFC ERGO)
     - Telecom (Airtel, Jio, ACT Fibernet)
     - Utilities (Electricity, Water, Gas)
     - Maintenance (Society fees, HOA)
     - SaaS (ChatGPT, GitHub, Linear)
     - Streaming (Netflix, Spotify)
     - Cloud Services (AWS, Google Cloud)
     - Professional Services (Legal retainers, Accounting)
   - Impact: Expected to increase approval rate from 15% to 40-60%

2. **Transaction Detector Keyword Expansion**
   - **Added Payment Keywords**: "premium", "charges", "fee" (enable stacking with category keywords)
   - **Added Category Keywords**:
     - Insurance: "insurance", "policy", "coverage"
     - Telecom: "mobile", "broadband", "recharge", "prepaid", "postpaid"
     - Utilities: "electricity", "water", "gas", "utility bill", "meter"
     - Maintenance: "maintenance", "society", "hoa", "association"
   - **Removed Duplicates**: Cleaned up keyword arrays to prevent confusion

3. **Subject Scoring Cap Increase**
   - **Before**: Subject capped at 40 points → couldn't reach 50-point threshold alone
   - **After**: Subject capped at 60 points → strong subscription signals pass without corroboration
   - **Impact**:
     - "TATA AIG Insurance Premium Due" → 72 points (capped 60) → ✅ PASS
     - "Airtel Mobile Bill" → 50 points → ✅ PASS
     - "Society Maintenance Charges" → 47 + currency (20) → ✅ PASS
     - "Invoice Payment Due" → 47 points → ❌ Correctly rejected (no subscription signal)

#### Expected Results
- **Missing subscriptions now detected**: Insurance (TATA AIG), Telecom (Airtel), Maintenance (Pebbels Urbania), SaaS (ChatGPT, Apple One)
- **Maintained precision**: Generic invoices still require corroborating signals (sender/body/currency)
- **Improved recall**: Target approval rate 40-60% (up from 15%)

### Multi-Account Support (November 2025)
- **Complete**: Implemented full multi-account email support with real-time sync progress tracking
  - Created `email_accounts` table to manage multiple email accounts per user (Gmail and Outlook)
  - Updated `subscriptions` and `emails` tables with nullable `emailAccountId` foreign keys for backward compatibility
  - Built Account Management UI with connect/disconnect functionality for Gmail and Outlook
  - Added account filtering to subscription list view with provider badges
  - Implemented multi-account sync coordinator with proper SSE event taxonomy:
    - Single account sync: emits terminal 'complete'/'error' events
    - Multi-account batch sync: emits per-account 'account_complete'/'account_error' + final terminal 'complete'/'error'
  - Created real-time progress tracking via Server-Sent Events (SSE) with automatic reconnection
  - Added individual account sync buttons and "Sync All Accounts" functionality
  - Integrated existing Gemini detection pipeline per account with proper batch context awareness
  - OAuth callbacks properly create email_accounts entries and redirect to accounts page

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

The client-side is built with React and TypeScript, using Radix UI primitives and shadcn/ui components for a consistent design system, styled with TailwindCSS. State management is handled through TanStack Query for server state and React hooks for local state. Wouter is used for lightweight client-side navigation. The frontend follows a modular component structure with reusable UI components and custom hooks, implementing a theme-aware approach for light and dark modes.

**Key Pages:**
- **Dashboard**: Subscription overview, stats, and sync controls
- **Accounts Page**: Central hub for managing multiple Gmail and Outlook accounts with connect/disconnect/sync functionality
- **Settings Page**: User profile, email sync period configuration, and detection preferences
- **Suggestions Page**: Review and approve AI-detected subscription suggestions

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