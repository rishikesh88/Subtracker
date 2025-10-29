# Subscription Tracker Application

## Overview

SubTracker is a full-stack web application that automatically detects and tracks subscription services by analyzing Gmail emails. The app connects to users' Gmail accounts, processes transaction emails using intelligent parsing algorithms, and provides insights into recurring subscription costs. Built with modern technologies, it offers a clean dashboard interface for managing and monitoring subscription expenses.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

The client-side is built with **React** and **TypeScript**, utilizing a modern component-based architecture. The UI framework leverages **Radix UI** primitives with **shadcn/ui** components for a consistent design system, styled with **TailwindCSS** for utility-first styling. State management is handled through **TanStack Query** for server state and React hooks for local state. The routing system uses **Wouter** for lightweight client-side navigation.

The frontend follows a modular component structure with reusable UI components, page-level components, and custom hooks. The design system implements a theme-aware approach with CSS custom properties for consistent styling across light and dark modes.

### Backend Architecture

The server-side uses **Express.js** with **TypeScript** for type-safe API development. The architecture follows a service-oriented pattern with dedicated services for:

- **Gmail Service**: Handles OAuth2 authentication and email fetching using Google APIs with optimized methods for metadata-only and full-content retrieval
- **Transaction Detector**: Sophisticated multi-parameter scoring system that analyzes email metadata to identify transaction emails with confidence scoring
- **Email Parser**: Processes raw email content to extract transaction information and merchant details
- **Gemini Subscription Detector**: Uses Google's Gemini AI for intelligent subscription detection with two-phase processing optimization

The API layer provides RESTful endpoints for authentication, data synchronization, and subscription management. Error handling is centralized with proper HTTP status codes and structured error responses.

#### Two-Phase Email Processing Optimization

The email sync system uses an optimized two-phase architecture to dramatically improve performance and reduce resource usage:

**Phase 1: Lightweight Screening**
- Fetches only email metadata (subject, sender, snippet) for up to 5,000 emails - 10x faster than full fetch
- Applies enhanced transaction detection with multi-parameter scoring (sender patterns, keywords, currency detection, merchant indicators)
- Filters emails to ~500-1,000 high-confidence transaction candidates based on scoring threshold
- Sends candidates to Gemini AI in batches of 100 for pre-filtering using lightweight prompts
- AI pre-filter uses robust parsing to handle various Gemini response formats (NONE variants, comma/space/newline-delimited IDs)
- Reduces candidate set to ~200-500 high-probability subscription emails

**Phase 2: Deep Processing**
- Fetches full email content and attachments ONLY for AI-approved candidates
- Processes attachments and performs deep Gemini analysis exclusively on filtered set
- Extracts detailed subscription information with evidence and confidence scores

**Performance Benefits:**
- 80%+ reduction in attachment processing overhead
- 80%+ reduction in AI API costs
- 10x faster initial screening
- More accurate results through focused AI analysis on high-probability candidates
- Graceful degradation with fallback mechanisms for parsing failures

### Database and Storage

The application uses **Drizzle ORM** with **PostgreSQL** for data persistence, configured through **Neon Database** for serverless deployment. The database schema includes:

- **Users**: Authentication and Gmail connection status
- **Subscriptions**: Detected subscription services with pricing and frequency
- **Emails**: Processed email metadata and extracted transaction data

For development and testing, an in-memory storage implementation provides the same interface as the database layer, enabling rapid prototyping without external dependencies.

### Authentication and Authorization

Gmail integration uses **OAuth2** flow with Google APIs for secure email access. The authentication service manages:

- Authorization URL generation for Gmail consent
- Token exchange and refresh token handling
- Secure storage of access credentials per user
- Automatic token refresh for long-term access

### Build and Development Tools

The development environment uses **Vite** for fast development builds and hot module replacement. **esbuild** handles production builds for optimal performance. The build process separates client-side React application from server-side Express application, with proper asset optimization and code splitting.

TypeScript configuration ensures type safety across the entire stack with shared types between client and server through a common schema definition.

## External Dependencies

### Core Services
- **Neon Database**: PostgreSQL hosting for production data storage
- **Google Gmail API**: Email access and OAuth2 authentication
- **Google Cloud Console**: OAuth2 credentials and API key management

### UI and Styling
- **Radix UI**: Headless UI primitives for accessibility and functionality
- **shadcn/ui**: Pre-built component library with consistent design patterns
- **TailwindCSS**: Utility-first CSS framework for responsive design
- **Lucide React**: Icon library for consistent iconography

### Data and State Management
- **TanStack Query**: Server state management with caching and synchronization
- **Drizzle ORM**: Type-safe database queries and schema management
- **Drizzle Kit**: Database migration and schema synchronization tools

### Development and Build Tools
- **Vite**: Development server and build tooling
- **TypeScript**: Type safety across frontend and backend
- **React Hook Form**: Form state management and validation
- **Zod**: Runtime type validation and schema parsing