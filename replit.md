# Subscription Tracker Application

## Overview

SubTracker is a full-stack web application designed to automatically detect and track subscription services by analyzing user email accounts (Gmail and Outlook). It processes transaction emails using intelligent parsing algorithms and provides a clean dashboard for managing and monitoring recurring subscription costs. The project aims to offer deep insights into spending patterns, providing a clear overview of financial commitments from various subscription services, with ambitions for market potential as a leading personal finance tool.

## Recent Changes

### Multi-Account Support (November 2025)
- **Phase 1 Complete**: Implemented multi-account email support infrastructure
  - Created `email_accounts` table to manage multiple email accounts per user (Gmail and Outlook)
  - Updated `subscriptions` and `emails` tables with nullable `emailAccountId` foreign keys for backward compatibility
  - Built Account Management UI with connect/disconnect functionality for Gmail and Outlook
  - Added account filtering to subscription list view with provider badges
  - Implemented multi-account sync coordinator service architecture
  - Created API routes for account management and multi-account syncing

## User Preferences

Preferred communication style: Simple, everyday language.

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