import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { GmailService } from "./services/gmail";
import { OutlookService } from "./services/outlook";
import { emailParser } from "./services/emailParser";
import { EnhancedEmailParser } from "./services/enhancedEmailParser";
import { subscriptionDetector } from "./services/subscriptionDetector";
import { GeminiSubscriptionDetector } from "./core/geminiSubscriptionDetector";
import { triggerEmailSync } from "./services/syncTrigger";
import { insertEmailSchema, insertUserSchema, updateSettingsSchema, insertSubscriptionSchema, updateSubscriptionSchema, insertInvoiceSchema, signupSchema, loginSchema, type SafeUser } from "@shared/schema";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { ObjectPermission } from "./objectAcl";
import { randomBytes } from "crypto";
import { z } from "zod";
import { registerGeminiRoutes } from "./routes/geminiSync";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { generateServiceKey } from "./utils/serviceKey";
import bcrypt from "bcrypt";
import passport from "passport";
import { setupGoogleAuthStrategy } from "./auth/googleAuthStrategy";
import { MicrosoftAuthService } from "./auth/microsoftAuthService";
import { sendVerificationEmail, generateVerificationCode } from "./services/emailVerificationService";

// Helper function to get userId from normalized session structure
function getUserId(req: any): string {
  // For all non-OIDC auth types (password, google_oauth, microsoft_oauth), use userId
  // For OIDC (replit_oidc), use claims.sub
  return req.user.authType === 'replit_oidc' ? req.user.claims.sub : req.user.userId;
}

// Request validation schemas
const approveSuggestionsSchema = z.object({
  suggestionIds: z.array(z.string().uuid()).nonempty()
});

const rejectSuggestionsSchema = z.object({
  suggestionIds: z.array(z.string().uuid()).nonempty()
});

// Simple in-memory store for OAuth states (in production, use Redis or database)
const oauthStates = new Map<string, { 
  timestamp: number;
  userId?: string;
  provider?: 'gmail' | 'outlook';
  emailSyncDays?: number;
  privacyConsentGiven?: boolean;
}>();

// Clean up old states (older than 10 minutes)
const cleanupOldStates = () => {
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  for (const [state, data] of Array.from(oauthStates.entries())) {
    if (data.timestamp < tenMinutesAgo) {
      oauthStates.delete(state);
    }
  }
};

// Cleanup every 5 minutes
setInterval(cleanupOldStates, 5 * 60 * 1000);

// SSE connections by userId for real-time progress notifications
const sseConnections = new Map<string, Set<any>>();

// Progress notification helper using Server-Sent Events
export function sendProgressUpdate(userId: string, data: {
  stage: string;
  progress: number;
  message: string;
  details?: any;
}) {
  const connections = sseConnections.get(userId);
  if (connections && connections.size > 0) {
    const eventData = JSON.stringify({
      type: 'progress',
      timestamp: new Date().toISOString(),
      ...data
    });
    
    // Send to all SSE connections for this user
    connections.forEach(res => {
      // Only skip if connection is ended or destroyed
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.write(`data: ${eventData}\n\n`);
        } catch (error) {
          console.error('Failed to write progress update:', error);
        }
      }
    });
  }
}

// Expose sendProgressUpdate globally for use by sync trigger and other services
(globalThis as any).sendProgressUpdate = sendProgressUpdate;

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup Replit Auth
  await setupAuth(app);

  // Setup Google OAuth Strategy for authentication
  setupGoogleAuthStrategy(storage);

  // Email+Password authentication routes
  app.post('/api/auth/signup', async (req, res) => {
    try {
      // Validate request body with Zod schema
      const validationResult = signupSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: validationResult.error.errors
        });
      }

      const { email, password, firstName, lastName } = validationResult.data;

      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(409).json({ message: "Email already exists" });
      }

      // Hash password server-side only - never accept passwordHash from client
      const passwordHash = await bcrypt.hash(password, 10);
      
      // Create user - onboardingStatus and privacyConsentGiven hardcoded in storage layer
      const newUser = await storage.createUserWithPassword({
        email,
        firstName: firstName || null,
        lastName: lastName || null,
        passwordHash,
      });

      console.log('[Event: account_created]', { userId: newUser.id, email: newUser.email, method: 'email_password' });

      // Generate and send verification code
      const verificationCode = generateVerificationCode();
      const expiryDate = new Date();
      expiryDate.setMinutes(expiryDate.getMinutes() + 15); // 15 minutes expiry

      try {
        await storage.createVerificationCode(newUser.id, verificationCode, expiryDate);
        await sendVerificationEmail({
          to: newUser.email!,
          code: verificationCode,
          firstName: newUser.firstName || undefined,
        });
        console.log(`[Email] Verification code sent to ${newUser.email}`);
      } catch (emailError) {
        console.error('Failed to send verification email:', emailError);
        // Don't block signup if email fails - user can resend later
      }

      // Create session using passport with normalized user object
      const userSession = {
        authType: 'password',
        userId: newUser.id,
      };
      
      (req as any).login(userSession, (err: any) => {
        if (err) {
          console.error("Session creation error:", err);
          return res.status(500).json({ message: "Failed to create session" });
        }
        
        console.log('[Session] Created session for user:', newUser.id);
        console.log('[Session] Session ID:', (req as any).sessionID);
        
        // Explicitly save session to ensure it's persisted before response
        (req as any).session.save((saveErr: any) => {
          if (saveErr) {
            console.error('[Session] Failed to save session:', saveErr);
            return res.status(500).json({ message: "Failed to save session" });
          }
          
          console.log('[Session] Session saved successfully');
          
          const safeUser: SafeUser = {
            id: newUser.id,
            email: newUser.email,
            firstName: newUser.firstName,
            lastName: newUser.lastName,
            profileImageUrl: newUser.profileImageUrl,
            gmailConnected: newUser.gmailConnected,
            gmailEmail: newUser.gmailEmail,
            lastSync: newUser.lastSync,
            preferredCurrency: newUser.preferredCurrency,
            emailSyncDays: newUser.emailSyncDays,
            organizationName: newUser.organizationName,
            countryCode: newUser.countryCode,
            accountHolderName: newUser.accountHolderName,
            onboardingStatus: newUser.onboardingStatus,
            privacyConsentGiven: newUser.privacyConsentGiven,
            emailVerified: newUser.emailVerified,
            createdAt: newUser.createdAt,
            updatedAt: newUser.updatedAt,
          };
          
          res.status(201).json(safeUser);
        });
      });
    } catch (error) {
      console.error("Signup error:", error);
      res.status(500).json({ message: "Failed to create account" });
    }
  });

  // Email verification endpoint
  app.post('/api/auth/verify-email', isAuthenticated, async (req: any, res) => {
    try {
      // Get userId from normalized session structure
      const userId = getUserId(req);
      const { code } = req.body;

      if (!code || code.length !== 6) {
        return res.status(400).json({ message: "Invalid verification code" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.emailVerified) {
        return res.status(400).json({ message: "Email already verified" });
      }

      // Check verification code
      const verificationRecord = await storage.getVerificationCode(userId, code);

      if (!verificationRecord) {
        return res.status(400).json({ message: "Invalid verification code" });
      }

      if (verificationRecord.used) {
        return res.status(400).json({ message: "Verification code already used" });
      }

      if (new Date() > verificationRecord.expiresAt) {
        return res.status(400).json({ message: "Verification code expired" });
      }

      // Mark code as used and verify email
      await storage.markVerificationCodeUsed(verificationRecord.id);
      await storage.setEmailVerified(userId);

      console.log(`[Event: email_verified] User ${userId} verified email`);
      res.json({ message: "Email verified successfully" });
    } catch (error) {
      console.error("Email verification error:", error);
      res.status(500).json({ message: "Failed to verify email" });
    }
  });

  // Resend verification email endpoint with rate limiting
  const resendAttempts = new Map<string, { count: number; resetAt: number }>();

  app.post('/api/auth/resend-verification', isAuthenticated, async (req: any, res) => {
    try {
      // Get userId from normalized session structure
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.emailVerified) {
        return res.status(400).json({ message: "Email already verified" });
      }

      // Rate limiting: 3 attempts per hour
      const now = Date.now();
      const userAttempts = resendAttempts.get(userId);

      if (userAttempts && userAttempts.resetAt > now) {
        if (userAttempts.count >= 3) {
          return res.status(429).json({ 
            message: "Too many requests. Please try again in 1 hour.",
            retryAfter: Math.ceil((userAttempts.resetAt - now) / 1000 / 60) // minutes
          });
        }
        userAttempts.count++;
      } else {
        resendAttempts.set(userId, {
          count: 1,
          resetAt: now + 60 * 60 * 1000 // 1 hour
        });
      }

      // Generate new code
      const verificationCode = generateVerificationCode();
      const expiryDate = new Date();
      expiryDate.setMinutes(expiryDate.getMinutes() + 15);

      await storage.createVerificationCode(userId, verificationCode, expiryDate);
      await sendVerificationEmail({
        to: user.email!,
        code: verificationCode,
        firstName: user.firstName || undefined,
      });

      console.log(`[Email] Resent verification code to ${user.email}`);
      res.json({ message: "Verification email sent successfully" });
    } catch (error) {
      console.error("Resend verification error:", error);
      res.status(500).json({ message: "Failed to resend verification email" });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      // Validate request body with Zod schema
      const validationResult = loginSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: validationResult.error.errors
        });
      }

      const { email, password } = validationResult.data;

      const user = await storage.getUserByEmail(email);
      if (!user || !user.passwordHash) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      const isValidPassword = await bcrypt.compare(password, user.passwordHash);
      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Create session using passport with normalized user object
      const userSession = {
        authType: 'password',
        userId: user.id,
      };
      
      (req as any).login(userSession, (err: any) => {
        if (err) {
          console.error("Session creation error:", err);
          return res.status(500).json({ message: "Failed to create session" });
        }
        
        const safeUser: SafeUser = {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          profileImageUrl: user.profileImageUrl,
          gmailConnected: user.gmailConnected,
          gmailEmail: user.gmailEmail,
          lastSync: user.lastSync,
          preferredCurrency: user.preferredCurrency,
          emailSyncDays: user.emailSyncDays,
          organizationName: user.organizationName,
          countryCode: user.countryCode,
          accountHolderName: user.accountHolderName,
          onboardingStatus: user.onboardingStatus,
          privacyConsentGiven: user.privacyConsentGiven,
          emailVerified: user.emailVerified,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        };
        
        res.json(safeUser);
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Failed to log in" });
    }
  });

  app.post('/api/auth/logout', isAuthenticated, (req, res) => {
    req.logout((err) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ message: "Failed to log out" });
      }
      req.session.destroy((destroyErr) => {
        if (destroyErr) {
          console.error("Session destroy error:", destroyErr);
          return res.status(500).json({ message: "Failed to destroy session" });
        }
        res.json({ message: "Logged out successfully" });
      });
    });
  });

  // Google OAuth Authentication (for user login/signup)
  app.get('/api/auth/google-login', (req, res, next) => {
    // Check if Google OAuth is configured before attempting authentication
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(503).json({ 
        message: "Google sign-in is not available. Please use email/password or another login method.",
        code: "GOOGLE_AUTH_NOT_CONFIGURED"
      });
    }
    
    passport.authenticate('google-auth', {
      scope: ['openid', 'profile', 'email'],
    })(req, res, next);
  });

  app.get('/api/auth/google-login/callback', 
    passport.authenticate('google-auth', { failureRedirect: '/login?error=google_auth_failed' }),
    async (req: any, res) => {
      try {
        // User is now authenticated via Google
        const userId = getUserId(req);
        
        if (!userId) {
          return res.redirect('/login?error=no_user_id');
        }

        const user = await storage.getUser(userId);
        if (!user) {
          return res.redirect('/login?error=user_not_found');
        }

        // Check if user needs email verification
        if (!user.emailVerified) {
          return res.redirect('/verify-email');
        }

        // Check if user needs onboarding
        if (user.onboardingStatus === 'pending') {
          return res.redirect('/onboarding/org-setup');
        } else if (user.onboardingStatus === 'org_complete') {
          return res.redirect('/onboarding/connect');
        }

        // User is fully onboarded, redirect to dashboard
        res.redirect('/dashboard');
      } catch (error) {
        console.error("Google auth callback error:", error);
        res.redirect('/login?error=callback_failed');
      }
    }
  );

  // Microsoft OAuth Authentication (for user login/signup)
  app.get('/api/auth/microsoft-login', async (req, res) => {
    try {
      const microsoftAuthService = new MicrosoftAuthService();
      
      // Generate state for CSRF protection
      const state = randomBytes(32).toString('hex');
      oauthStates.set(state, { 
        timestamp: Date.now(),
      });
      
      const authUrl = await microsoftAuthService.getAuthUrl(state);
      res.redirect(authUrl);
    } catch (error) {
      console.error("Microsoft auth initiation error:", error);
      res.redirect('/login?error=microsoft_auth_init_failed');
    }
  });

  app.get('/api/auth/microsoft-login/callback', async (req: any, res) => {
    try {
      const { code, state } = req.query;

      if (!code) {
        return res.redirect('/login?error=no_auth_code');
      }

      // Verify OAuth state for CSRF protection
      if (!state || typeof state !== 'string' || !oauthStates.has(state)) {
        console.error('Invalid or missing OAuth state parameter');
        return res.redirect('/login?error=invalid_state');
      }

      oauthStates.delete(state); // Remove used state to prevent replay

      const microsoftAuthService = new MicrosoftAuthService();
      const { user } = await microsoftAuthService.handleCallback(code as string, storage);

      // Create session using passport with normalized user object
      const userSession = {
        authType: 'microsoft_oauth',
        userId: user.id,
        claims: { sub: user.id, email: user.email }
      };
      
      (req as any).login(userSession, async (err: any) => {
        if (err) {
          console.error("Session creation error:", err);
          return res.redirect('/login?error=session_failed');
        }

        // Check if user needs email verification
        if (!user.emailVerified) {
          return res.redirect('/verify-email');
        }

        // Check if user needs onboarding
        if (user.onboardingStatus === 'pending') {
          return res.redirect('/onboarding/org-setup');
        } else if (user.onboardingStatus === 'org_complete') {
          return res.redirect('/onboarding/connect');
        }

        // User is fully onboarded, redirect to dashboard
        res.redirect('/dashboard');
      });
    } catch (error) {
      console.error("Microsoft auth callback error:", error);
      res.redirect('/login?error=callback_failed');
    }
  });

  // Onboarding routes
  app.post('/api/onboarding/org-setup', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      
      const orgSetupSchema = z.object({
        organizationName: z.string().min(1, "Organization name is required"),
        countryCode: z.string().min(1, "Country is required"),
        accountHolderName: z.string().min(1, "Account holder name is required"),
        preferredCurrency: z.string().optional(),
      });

      const validationResult = orgSetupSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid organization data",
          errors: validationResult.error.errors 
        });
      }

      const { organizationName, countryCode, accountHolderName, preferredCurrency } = validationResult.data;

      // Update user with organization data and mark org setup as complete
      await storage.updateUser(userId, {
        organizationName,
        countryCode,
        accountHolderName,
        preferredCurrency: preferredCurrency || "USD",
        onboardingStatus: 'org_complete',
        updatedAt: new Date(),
      });

      console.log('[Event: org_setup_completed]', { userId, organizationName, countryCode });

      res.json({ 
        success: true,
        message: "Organization setup completed" 
      });
    } catch (error) {
      console.error("Error saving organization data:", error);
      res.status(500).json({ message: "Failed to save organization data" });
    }
  });

  app.post('/api/onboarding/privacy-consent', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      
      const privacyConsentSchema = z.object({
        privacyConsentGiven: z.boolean(),
        emailSyncDays: z.number().int().min(30).max(180),
      });

      const validationResult = privacyConsentSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid privacy consent data",
          errors: validationResult.error.errors 
        });
      }

      const { privacyConsentGiven, emailSyncDays } = validationResult.data;

      // SECURITY: Only allow setting privacyConsentGiven to true, never false
      // Once consent is given, it cannot be revoked via this endpoint
      if (privacyConsentGiven) {
        await storage.updateUser(userId, {
          privacyConsentGiven: true,
          emailSyncDays,
          updatedAt: new Date(),
        });

        console.log('[Event: privacy_consent_given]', { userId, emailSyncDays });
      }

      res.json({ 
        success: true,
        message: "Privacy consent saved" 
      });
    } catch (error) {
      console.error("Error saving privacy consent:", error);
      res.status(500).json({ message: "Failed to save privacy consent" });
    }
  });

  app.post('/api/onboarding/skip', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      
      // Mark onboarding as complete even without connecting accounts
      // Keep privacyConsentGiven as false since user opted out
      await storage.updateUser(userId, {
        onboardingStatus: 'complete',
        updatedAt: new Date(),
      });

      console.log('[Event: account_connection_skipped]', { userId });

      res.json({ 
        success: true,
        message: "Onboarding skipped, you can connect accounts later" 
      });
    } catch (error) {
      console.error("Error skipping onboarding:", error);
      res.status(500).json({ message: "Failed to skip onboarding" });
    }
  });

  app.post('/api/onboarding/connect', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      
      const connectSchema = z.object({
        provider: z.enum(['gmail', 'outlook']),
        emailSyncDays: z.number().int().min(30).max(180),
        privacyConsentGiven: z.boolean(),
      });

      const validationResult = connectSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid connect request",
          errors: validationResult.error.errors 
        });
      }

      const { provider, emailSyncDays, privacyConsentGiven } = validationResult.data;

      // Save privacy consent and backfill window to user record
      if (privacyConsentGiven) {
        await storage.updateUser(userId, {
          privacyConsentGiven: true,
          emailSyncDays,
          updatedAt: new Date(),
        });
        console.log('[Event: privacy_consent_given]', { userId, emailSyncDays });
      }

      // Generate cryptographically random state for CSRF protection
      // Store metadata with the state so callbacks can hydrate it
      const state = randomBytes(32).toString('hex');
      oauthStates.set(state, { 
        timestamp: Date.now(),
        userId,
        provider,
        emailSyncDays,
        privacyConsentGiven,
      });

      // Generate OAuth URL based on provider
      let authUrl: string;
      if (provider === 'gmail') {
        const gmailService = new GmailService();
        authUrl = gmailService.getAuthUrl(state);
      } else {
        const outlookService = new OutlookService();
        authUrl = outlookService.getAuthUrl(state);
      }

      console.log(`Generated ${provider} auth URL with state containing metadata`);
      
      res.json({ authUrl });
    } catch (error) {
      console.error("Error generating OAuth URL:", error);
      res.status(500).json({ message: "Failed to generate OAuth URL" });
    }
  });

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      // Get userId from normalized session structure
      const userId = getUserId(req);
      
      // For non-OIDC auth types, dbUser is already attached by middleware
      const user = req.user.authType === 'replit_oidc' ? await storage.getUser(userId) : req.user.dbUser;
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Return only safe user data, excluding sensitive tokens
      const safeUser: SafeUser = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
        gmailConnected: user.gmailConnected,
        gmailEmail: user.gmailEmail,
        lastSync: user.lastSync,
        preferredCurrency: user.preferredCurrency,
        emailSyncDays: user.emailSyncDays,
        organizationName: user.organizationName,
        countryCode: user.countryCode,
        accountHolderName: user.accountHolderName,
        onboardingStatus: user.onboardingStatus,
        privacyConsentGiven: user.privacyConsentGiven,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      };
      
      res.json(safeUser);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Gmail OAuth routes (legacy endpoint for reconnect flow)
  app.get("/api/auth/google", isAuthenticated, async (req: any, res) => {
    try {
      console.log("Google Client ID available:", !!process.env.GOOGLE_CLIENT_ID);
      console.log("Google Client Secret available:", !!process.env.GOOGLE_CLIENT_SECRET);
      console.log("Repl Slug:", process.env.REPL_SLUG);
      console.log("Repl Owner:", process.env.REPL_OWNER);
      
      const userId = getUserId(req);
      
      // Generate cryptographically random state for CSRF protection
      const state = randomBytes(32).toString('hex');
      oauthStates.set(state, { 
        timestamp: Date.now(),
        userId,
        provider: 'gmail',
        // No emailSyncDays or privacyConsentGiven for reconnect flow
      });
      
      const gmailService = new GmailService();
      const authUrl = gmailService.getAuthUrl(state);
      console.log("Generated auth URL with state:", authUrl);
      
      // Redirect to Google OAuth
      res.redirect(authUrl);
    } catch (error) {
      console.error("Auth URL generation error:", error);
      res.status(500).json({ message: "Failed to generate auth URL" });
    }
  });

  app.get("/api/auth/google/callback", isAuthenticated, async (req: any, res) => {
    try {
      const { code, state } = req.query;
      
      if (!code) {
        const redirectUrl = `/auth/callback?provider=gmail&error=${encodeURIComponent('Missing authorization code')}`;
        return res.redirect(redirectUrl);
      }

      // Verify OAuth state for CSRF protection and extract metadata
      if (!state || typeof state !== 'string' || !oauthStates.has(state)) {
        console.error('Invalid or missing OAuth state parameter');
        const redirectUrl = `/auth/callback?provider=gmail&error=${encodeURIComponent('Invalid or expired authentication request')}`;
        return res.redirect(redirectUrl);
      }

      // Extract metadata from state
      const stateData = oauthStates.get(state);
      oauthStates.delete(state); // Remove used state to prevent replay

      const gmailService = new GmailService();
      const tokens = await gmailService.getTokens(code as string);
      
      // Get userId from state metadata first, fall back to session
      const userId = stateData?.userId ?? (req.user ? getUserId(req) : undefined);
      if (!userId) {
        throw new Error("User not authenticated and no userId in state");
      }
      
      const user = await storage.getUser(userId);
      if (!user) {
        throw new Error("User not found");
      }

      if (!tokens.access_token) {
        throw new Error("No access token received from Google");
      }

      const userInfo = await gmailService.getUserInfo(tokens.access_token);
      const gmailEmail = userInfo.email;

      if (!gmailEmail) {
        throw new Error("Could not retrieve Gmail email address");
      }

      const existingAccount = await storage.getGmailAccountByEmail(userId, gmailEmail);
      
      if (existingAccount) {
        const updateData: any = {
          accessToken: tokens.access_token,
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          lastSync: new Date(),
          syncStatus: 'idle',
          syncError: null,
        };
        
        if (tokens.refresh_token) {
          updateData.refreshToken = tokens.refresh_token;
        }
        
        await storage.updateGmailAccount(existingAccount.id, updateData);
        console.log("Gmail account updated successfully:", gmailEmail);
      } else {
        if (!tokens.refresh_token) {
          throw new Error("No refresh token received for new account - please try reconnecting");
        }
        
        const newAccount = await storage.createGmailAccount({
          userId,
          gmailEmail,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          lastSync: new Date(),
          syncStatus: 'idle',
        });
        console.log("Gmail account created successfully:", newAccount.gmailEmail);
        console.log('[Event: email_connected]', { userId, provider: 'gmail', email: gmailEmail });
      }

      // Mark onboarding as complete if this is first account during onboarding
      const updateData: any = {
        gmailConnected: true,
        updatedAt: new Date(),
      };
      
      const wasOnboarding = user.onboardingStatus === 'pending' || user.onboardingStatus === 'org_complete';
      if (wasOnboarding) {
        updateData.onboardingStatus = 'complete';
        console.log('[Event: onboarding_completed]', { userId, provider: 'gmail' });
      }

      await storage.updateUser(userId, updateData);

      console.log("Gmail connected successfully for user:", user.id);

      // Trigger background sync after first account connection during onboarding
      let syncTriggered = false;
      if (wasOnboarding && user.privacyConsentGiven) {
        // Fire and forget - sync runs in background
        triggerEmailSync(storage, {
          userId,
          emailSyncDays: stateData?.emailSyncDays || 90,
          provider: 'gmail',
          triggerSource: 'onboarding'
        }).catch(error => {
          console.error('Failed to trigger background sync:', error);
        });
        syncTriggered = true;
      }

      // Redirect to frontend auth callback with syncing flag if sync was triggered
      const redirectUrl = syncTriggered 
        ? `/auth/callback?provider=gmail&success=true&syncing=true`
        : `/auth/callback?provider=gmail&success=true`;
      res.redirect(redirectUrl);
    } catch (error) {
      console.error("Gmail OAuth callback error:", error);
      const redirectUrl = `/auth/callback?provider=gmail&error=${encodeURIComponent(error instanceof Error ? error.message : 'Unknown error')}`;
      res.redirect(redirectUrl);
    }
  });

  // Gmail connection management endpoints - disconnect ALL accounts
  app.post("/api/auth/google/disconnect", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const accounts = await storage.getGmailAccounts(userId);
      
      for (const account of accounts) {
        await storage.deleteGmailAccount(account.id);
      }

      await storage.updateUser(user.id, {
        gmailConnected: false,
        updatedAt: new Date()
      });

      console.log(`Gmail disconnected successfully for user ${user.id} - removed ${accounts.length} account(s)`);
      res.json({ message: "All Gmail accounts disconnected successfully", gmailConnected: false, accountsRemoved: accounts.length });
    } catch (error) {
      console.error("Gmail disconnect error:", error);
      res.status(500).json({ message: "Failed to disconnect Gmail" });
    }
  });

  // Update user settings
  app.post("/api/settings/update", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Validate request body
      const validationResult = updateSettingsSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid settings data",
          errors: validationResult.error.errors 
        });
      }

      const settings = validationResult.data;
      
      // Update user settings
      const updatedUser = await storage.updateUser(userId, {
        ...(settings.emailSyncDays !== undefined && { emailSyncDays: settings.emailSyncDays }),
        ...(settings.preferredCurrency && { preferredCurrency: settings.preferredCurrency }),
        updatedAt: new Date()
      });

      if (!updatedUser) {
        return res.status(500).json({ message: "Failed to update settings" });
      }

      console.log("Settings updated successfully for user:", userId);
      res.json({ 
        message: "Settings updated successfully",
        settings: {
          emailSyncDays: updatedUser.emailSyncDays,
          preferredCurrency: updatedUser.preferredCurrency
        }
      });
    } catch (error) {
      console.error("Settings update error:", error);
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  app.post("/api/auth/google/connect", isAuthenticated, async (req: any, res) => {
    try {
      console.log("Gmail reconnection initiated");
      console.log("Google Client ID available:", !!process.env.GOOGLE_CLIENT_ID);
      console.log("Google Client Secret available:", !!process.env.GOOGLE_CLIENT_SECRET);
      
      const userId = getUserId(req);
      
      // Generate cryptographically random state for CSRF protection
      const state = randomBytes(32).toString('hex');
      oauthStates.set(state, { 
        timestamp: Date.now(),
        userId,
        provider: 'gmail',
      });
      
      const gmailService = new GmailService();
      const authUrl = gmailService.getAuthUrl(state);
      console.log("Generated reconnection auth URL with state:", authUrl);
      res.json({ authUrl });
    } catch (error) {
      console.error("Gmail reconnection URL generation error:", error);
      res.status(500).json({ message: "Failed to generate reconnection auth URL" });
    }
  });

  // Gmail Account Management Routes
  app.get("/api/gmail/accounts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const accounts = await storage.getGmailAccounts(userId);
      
      const safeAccounts = accounts.map(account => ({
        id: account.id,
        userId: account.userId,
        gmailEmail: account.gmailEmail,
        lastSync: account.lastSync,
        syncStatus: account.syncStatus,
        syncError: account.syncError,
        createdAt: account.createdAt,
      }));

      res.json(safeAccounts);
    } catch (error) {
      console.error("Error fetching Gmail accounts:", error);
      res.status(500).json({ message: "Failed to fetch Gmail accounts" });
    }
  });

  app.get("/api/gmail/accounts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const accountId = req.params.id;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const account = await storage.getGmailAccount(accountId);
      
      if (!account) {
        return res.status(404).json({ message: "Gmail account not found" });
      }

      if (account.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized to access this account" });
      }

      const safeAccount = {
        id: account.id,
        userId: account.userId,
        gmailEmail: account.gmailEmail,
        lastSync: account.lastSync,
        syncStatus: account.syncStatus,
        syncError: account.syncError,
        createdAt: account.createdAt,
      };

      res.json(safeAccount);
    } catch (error) {
      console.error("Error fetching Gmail account:", error);
      res.status(500).json({ message: "Failed to fetch Gmail account" });
    }
  });

  app.delete("/api/gmail/accounts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const accountId = req.params.id;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const account = await storage.getGmailAccount(accountId);
      
      if (!account) {
        return res.status(404).json({ message: "Gmail account not found" });
      }

      if (account.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized to delete this account" });
      }

      const deleted = await storage.deleteGmailAccount(accountId);
      
      if (!deleted) {
        return res.status(500).json({ message: "Failed to delete Gmail account" });
      }

      res.json({ message: "Gmail account disconnected successfully" });
    } catch (error) {
      console.error("Error deleting Gmail account:", error);
      res.status(500).json({ message: "Failed to disconnect Gmail account" });
    }
  });

  // Outlook OAuth Routes (legacy endpoint for reconnect flow)
  app.get("/api/auth/outlook/connect", isAuthenticated, async (req: any, res) => {
    try {
      console.log("Outlook connection initiated");
      console.log("Microsoft Client ID available:", !!process.env.MICROSOFT_CLIENT_ID);
      console.log("Microsoft Client Secret available:", !!process.env.MICROSOFT_CLIENT_SECRET);
      
      const userId = getUserId(req);
      
      const state = randomBytes(32).toString('hex');
      oauthStates.set(state, { 
        timestamp: Date.now(),
        userId,
        provider: 'outlook',
        // No emailSyncDays or privacyConsentGiven for reconnect flow
      });
      
      const outlookService = new OutlookService();
      const authUrl = outlookService.getAuthUrl(state);
      console.log("Generated Outlook auth URL with state:", authUrl);
      
      // Redirect to Microsoft OAuth
      res.redirect(authUrl);
    } catch (error) {
      console.error("Outlook connection URL generation error:", error);
      res.status(500).json({ message: "Failed to generate Outlook auth URL" });
    }
  });

  app.get("/api/auth/outlook/callback", isAuthenticated, async (req: any, res) => {
    try {
      const { code, state, error: oauthError } = req.query;

      if (oauthError) {
        console.error("Outlook OAuth error:", oauthError);
        return res.redirect(`/auth/callback?provider=outlook&error=${encodeURIComponent(oauthError as string)}`);
      }

      if (!code || typeof code !== 'string') {
        console.error("No authorization code received from Outlook");
        return res.redirect('/auth/callback?provider=outlook&error=no_code');
      }

      // Verify OAuth state for CSRF protection and extract metadata
      if (!state || typeof state !== 'string' || !oauthStates.has(state)) {
        console.error("Invalid or missing state parameter");
        return res.redirect('/auth/callback?provider=outlook&error=invalid_state');
      }

      // Extract metadata from state
      const stateData = oauthStates.get(state);
      oauthStates.delete(state); // Remove used state to prevent replay

      const outlookService = new OutlookService();
      const tokens = await outlookService.exchangeToken(code);

      const outlookEmail = await outlookService.getUserEmail(tokens.access_token);

      // Get userId from state metadata first, fall back to session
      const userId = stateData?.userId ?? (req.user ? getUserId(req) : undefined);
      if (!userId) {
        throw new Error("User not authenticated and no userId in state");
      }
      
      const user = await storage.getUser(userId);
      if (!user) {
        throw new Error("User not found");
      }

      const existingAccount = await storage.getOutlookAccountByEmail(userId, outlookEmail);

      if (existingAccount) {
        const updateData: any = {
          accessToken: tokens.access_token,
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          lastSync: new Date(),
          syncStatus: 'idle',
          syncError: null,
        };
        
        if (tokens.refresh_token) {
          updateData.refreshToken = tokens.refresh_token;
        }
        
        await storage.updateOutlookAccount(existingAccount.id, updateData);
        console.log("Outlook account updated successfully:", outlookEmail);
      } else {
        if (!tokens.refresh_token) {
          throw new Error("No refresh token received for new Outlook account");
        }
        
        const newAccount = await storage.createOutlookAccount({
          userId,
          outlookEmail,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          lastSync: new Date(),
          syncStatus: 'idle',
        });
        console.log("Outlook account created successfully:", newAccount.outlookEmail);
        console.log('[Event: email_connected]', { userId, provider: 'outlook', email: outlookEmail });
      }

      // Mark onboarding as complete if this is first account during onboarding
      const wasOnboarding = user.onboardingStatus === 'pending' || user.onboardingStatus === 'org_complete';
      if (wasOnboarding) {
        await storage.updateUser(userId, {
          onboardingStatus: 'complete',
          updatedAt: new Date(),
        });
        console.log('[Event: onboarding_completed]', { userId, provider: 'outlook' });
        
        // Note: Background sync is currently Gmail-only due to email schema constraints
        // Outlook email ingestion deferred until schema migration completes (see replit.md)
        // When schema is ready, trigger sync here with provider: 'outlook'
        console.log('[Sync] Outlook sync deferred - email schema migration required');
      }

      console.log("Outlook connected successfully for user:", userId);

      const redirectUrl = `/auth/callback?provider=outlook&success=true`;
      res.redirect(redirectUrl);
    } catch (error) {
      console.error("Outlook OAuth callback error:", error);
      const redirectUrl = `/auth/callback?provider=outlook&error=${encodeURIComponent(error instanceof Error ? error.message : 'Unknown error')}`;
      res.redirect(redirectUrl);
    }
  });

  // Outlook Account Management Routes
  app.get("/api/outlook/accounts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const accounts = await storage.getOutlookAccounts(userId);
      
      const safeAccounts = accounts.map(account => ({
        id: account.id,
        userId: account.userId,
        outlookEmail: account.outlookEmail,
        lastSync: account.lastSync,
        syncStatus: account.syncStatus,
        syncError: account.syncError,
        createdAt: account.createdAt,
      }));

      res.json(safeAccounts);
    } catch (error) {
      console.error("Error fetching Outlook accounts:", error);
      res.status(500).json({ message: "Failed to fetch Outlook accounts" });
    }
  });

  app.get("/api/outlook/accounts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const accountId = req.params.id;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const account = await storage.getOutlookAccount(accountId);
      
      if (!account) {
        return res.status(404).json({ message: "Outlook account not found" });
      }

      if (account.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized to access this account" });
      }

      const safeAccount = {
        id: account.id,
        userId: account.userId,
        outlookEmail: account.outlookEmail,
        lastSync: account.lastSync,
        syncStatus: account.syncStatus,
        syncError: account.syncError,
        createdAt: account.createdAt,
      };

      res.json(safeAccount);
    } catch (error) {
      console.error("Error fetching Outlook account:", error);
      res.status(500).json({ message: "Failed to fetch Outlook account" });
    }
  });

  app.delete("/api/outlook/accounts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const accountId = req.params.id;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const account = await storage.getOutlookAccount(accountId);
      
      if (!account) {
        return res.status(404).json({ message: "Outlook account not found" });
      }

      if (account.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized to delete this account" });
      }

      const deleted = await storage.deleteOutlookAccount(accountId);
      
      if (!deleted) {
        return res.status(500).json({ message: "Failed to delete Outlook account" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting Outlook account:", error);
      res.status(500).json({ message: "Failed to disconnect Outlook account" });
    }
  });

  // Sync emails and detect subscriptions
  app.post("/api/sync-emails", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const user = await storage.getUser(userId);
      if (!user || !user.gmailConnected || !user.gmailAccessToken) {
        return res.status(400).json({ message: "Gmail not connected" });
      }

      const gmailService = new GmailService();
      
      // Check if access token is expired and refresh if needed
      let accessToken = user.gmailAccessToken;
      const now = new Date();
      const tokenExpiry = user.gmailTokenExpiry ? new Date(user.gmailTokenExpiry) : null;
      
      if (tokenExpiry && now >= tokenExpiry) {
        console.log('⚠️ Access token expired, refreshing...');
        try {
          const newTokens = await gmailService.refreshAccessToken(user.gmailRefreshToken!);
          accessToken = newTokens.access_token!;
          
          // Update user with new tokens
          await storage.updateUser(userId, {
            gmailAccessToken: accessToken,
            gmailTokenExpiry: newTokens.expiry_date ? new Date(newTokens.expiry_date) : null,
          });
          
          console.log('✅ Access token refreshed successfully');
        } catch (error) {
          console.error('❌ Failed to refresh access token:', error);
          return res.status(401).json({ 
            message: "Gmail authentication expired. Please reconnect your Gmail account.",
            error: "token_refresh_failed"
          });
        }
      }
      
      // Create token refresh callback to update storage
      const onTokenRefresh = async (tokens: any) => {
        try {
          const updateData: any = {
            gmailAccessToken: tokens.access_token
          };
          if (tokens.refresh_token) {
            updateData.gmailRefreshToken = tokens.refresh_token;
          }
          if (tokens.expiry_date) {
            updateData.gmailTokenExpiry = new Date(tokens.expiry_date);
          }
          await storage.updateUser(user.id, updateData);
          console.log('Updated access token in storage for user:', user.id);
        } catch (error) {
          console.error('Failed to update access token in storage:', error);
        }
      };
      
      // Fetch emails from Gmail
      const gmailMessages = await gmailService.getEmails(
        accessToken,
        user.gmailRefreshToken || '',
        onTokenRefresh,
        user.emailSyncDays || 30
      );

      let newEmails = 0;
      let processedEmails = 0;

      // Parse and store emails
      for (const gmailMessage of gmailMessages) {
        if (!gmailMessage.id) continue;

        // Check if email already exists
        const existingEmail = await storage.getEmailByGmailId(gmailMessage.id);
        if (existingEmail) continue;

        const parsedEmail = emailParser.parseEmail(gmailMessage);
        
        const emailData = {
          userId: user.id,
          gmailId: gmailMessage.id,
          subject: parsedEmail.subject,
          fromEmail: parsedEmail.fromEmail,
          fromName: parsedEmail.fromName || null,
          receivedAt: parsedEmail.receivedAt,
          content: parsedEmail.content,
          isTransaction: parsedEmail.isTransaction,
          extractedAmount: parsedEmail.extractedAmount ? parsedEmail.extractedAmount.toString() : null,
          extractedCurrency: parsedEmail.extractedCurrency || null,
          merchantName: parsedEmail.merchantName || null,
          subscriptionId: null,
          processed: false
        };

        await storage.createEmail(emailData);
        newEmails++;
      }

      // LEGACY AUTO-CREATION DISABLED: Use enhanced detection instead
      // Redirect users to enhanced sync endpoint for proper suggestion workflow
      return res.status(410).json({ 
        message: "Legacy sync disabled. Use enhanced sync endpoint for suggestion-based workflow.",
        redirectToEnhanced: true 
      });
    } catch (error) {
      console.error("Sync emails error:", error);
      res.status(500).json({ message: "Failed to sync emails" });
    }
  });

  // Get user's subscriptions
  app.get("/api/subscriptions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const subscriptions = await storage.getSubscriptions(userId);
      res.json(subscriptions);
    } catch (error) {
      console.error("Get subscriptions error:", error);
      res.status(500).json({ message: "Failed to fetch subscriptions" });
    }
  });

  // Create a new subscription manually
  app.post("/api/subscriptions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const subscriptionData = insertSubscriptionSchema.parse({
        ...req.body,
        userId,
      });

      const subscription = await storage.createSubscription(subscriptionData);
      res.status(201).json(subscription);
    } catch (error) {
      console.error("Create subscription error:", error);
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid subscription data", details: (error as any).issues });
      }
      res.status(500).json({ message: "Failed to create subscription" });
    }
  });

  // Update an existing subscription
  app.patch("/api/subscriptions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Verify the subscription belongs to the user
      const existingSubscription = await storage.getSubscription(id);
      if (!existingSubscription) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      if (existingSubscription.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized to modify this subscription" });
      }

      const updates = updateSubscriptionSchema.parse(req.body);
      const updatedSubscription = await storage.updateSubscription(id, updates);
      
      if (!updatedSubscription) {
        return res.status(404).json({ message: "Subscription not found" });
      }

      res.json(updatedSubscription);
    } catch (error) {
      console.error("Update subscription error:", error);
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid subscription data", details: (error as any).issues });
      }
      res.status(500).json({ message: "Failed to update subscription" });
    }
  });

  // Delete a subscription (including related invoices)
  app.delete("/api/subscriptions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Verify the subscription belongs to the user
      const existingSubscription = await storage.getSubscription(id);
      if (!existingSubscription) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      if (existingSubscription.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized to delete this subscription" });
      }

      // Delete the subscription (also deletes related invoices)
      const deleted = await storage.deleteSubscription(id);
      
      if (!deleted) {
        return res.status(404).json({ message: "Subscription not found" });
      }

      res.json({ message: "Subscription and related invoices deleted successfully" });
    } catch (error) {
      console.error("Delete subscription error:", error);
      res.status(500).json({ message: "Failed to delete subscription" });
    }
  });

  // Get subscription detail
  app.get("/api/subscriptions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const subscription = await storage.getSubscription(id);
      if (!subscription) {
        return res.status(404).json({ message: "Subscription not found" });
      }

      if (subscription.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized to view this subscription" });
      }

      res.json(subscription);
    } catch (error) {
      console.error("Get subscription error:", error);
      res.status(500).json({ message: "Failed to fetch subscription" });
    }
  });

  // Object Storage Routes - Referenced from blueprint:javascript_object_storage
  // Endpoint for serving private invoice files with ACL check
  app.get("/objects/:objectPath(*)", isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req);
    const objectStorageService = new ObjectStorageService();
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      const canAccess = await objectStorageService.canAccessObjectEntity({
        objectFile,
        userId: userId,
        requestedPermission: ObjectPermission.READ,
      });
      if (!canAccess) {
        return res.sendStatus(401);
      }
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error checking object access:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      return res.sendStatus(500);
    }
  });

  // Endpoint for getting upload URL for invoice files
  app.post("/api/objects/upload", isAuthenticated, async (req: any, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  // Invoice Routes
  // Get all invoices for a subscription
  app.get("/api/subscriptions/:id/invoices", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Verify the subscription belongs to the user
      const subscription = await storage.getSubscription(id);
      if (!subscription) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      if (subscription.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized to view invoices" });
      }

      const invoices = await storage.getInvoices(id);
      res.json(invoices);
    } catch (error) {
      console.error("Get invoices error:", error);
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  // Create invoice record after file upload
  app.post("/api/subscriptions/:id/invoices", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Verify the subscription belongs to the user
      const subscription = await storage.getSubscription(id);
      if (!subscription) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      if (subscription.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized to add invoices" });
      }

      const objectStorageService = new ObjectStorageService();
      const normalizedPath = await objectStorageService.trySetObjectEntityAclPolicy(
        req.body.fileUrl,
        {
          owner: userId,
          visibility: "private",
        }
      );

      const invoiceData = insertInvoiceSchema.parse({
        subscriptionId: id,
        userId,
        fileName: req.body.fileName,
        fileType: req.body.fileType,
        fileSize: req.body.fileSize,
        fileUrl: normalizedPath,
        source: req.body.source || 'manual',
      });

      const invoice = await storage.createInvoice(invoiceData);
      res.status(201).json(invoice);
    } catch (error) {
      console.error("Create invoice error:", error);
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid invoice data", details: (error as any).issues });
      }
      res.status(500).json({ message: "Failed to create invoice" });
    }
  });

  // Delete invoice
  app.delete("/api/invoices/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Verify the invoice belongs to the user
      const invoice = await storage.getInvoice(id);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      if (invoice.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized to delete this invoice" });
      }

      await storage.deleteInvoice(id);
      res.json({ success: true, message: "Invoice deleted successfully" });
    } catch (error) {
      console.error("Delete invoice error:", error);
      res.status(500).json({ message: "Failed to delete invoice" });
    }
  });

  // Get user settings (currency preference)
  app.get("/api/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({
        preferredCurrency: user.preferredCurrency || "INR"
      });
    } catch (error) {
      console.error("Get settings error:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  // Update user settings (currency preference)
  app.patch("/api/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const settingsData = updateSettingsSchema.parse(req.body);
      
      await storage.updateUser(userId, {
        preferredCurrency: settingsData.preferredCurrency,
        updatedAt: new Date()
      });

      res.json({
        success: true,
        message: "Settings updated successfully",
        preferredCurrency: settingsData.preferredCurrency
      });
    } catch (error) {
      console.error("Update settings error:", error);
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid settings data", details: (error as any).issues });
      }
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  // Clear all data for fresh start
  app.delete("/api/clear-data", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      console.log(`🧹 Clearing all data for user: ${userId}`);
      
      // Clear all emails - fetch with very large limit to get ALL emails
      const emails = await storage.getEmails(userId, 999999);
      for (const email of emails) {
        await storage.deleteEmail(email.id);
      }
      
      // Clear all subscriptions
      const subscriptions = await storage.getSubscriptions(userId);
      for (const subscription of subscriptions) {
        await storage.deleteSubscription(subscription.id);
      }
      
      // Clear all suggestions
      const suggestionResult = await storage.clearSuggestions(userId);
      
      // Reset user's last sync
      await storage.updateUser(userId, { lastSync: null });
      
      console.log(`✅ Cleared ${emails.length} emails, ${subscriptions.length} subscriptions, and ${suggestionResult.cleared} suggestions`);
      
      res.json({
        success: true,
        message: "All data cleared successfully",
        clearedEmails: emails.length,
        clearedSubscriptions: subscriptions.length,
        clearedSuggestions: suggestionResult.cleared
      });
    } catch (error) {
      console.error("Clear data error:", error);
      res.status(500).json({ message: "Failed to clear data" });
    }
  });

  // Helper function for calculating string similarity
  function calculateSimilarity(str1: string, str2: string): number {
    const normalize = (s: string) => s.toLowerCase().replace(/[^\w]/g, '');
    const s1 = normalize(str1);
    const s2 = normalize(str2);
    
    if (s1 === s2) return 1;
    
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    
    if (longer.length === 0) return 1;
    
    const editDistance = levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  function levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + indicator // substitution
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  // Cleanup duplicates endpoint
  app.post("/api/cleanup-duplicates", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }
      
      // Get all subscriptions for the user
      const subscriptions = await storage.getSubscriptions(userId);
      console.log(`🔍 Found ${subscriptions.length} subscriptions for duplicate cleanup analysis`);
      
      const duplicateGroups: Record<string, typeof subscriptions> = {};
      const toRemove: string[] = [];
      
      // Group subscriptions that are duplicates using same logic as deduplication
      for (const subscription of subscriptions) {
        let foundGroup = false;
        
        for (const [groupKey, group] of Object.entries(duplicateGroups)) {
          const representative = group[0];
          
          // Use same deduplication logic as createSubscription
          const vendorSimilarity = calculateSimilarity(
            subscription.serviceName.toLowerCase().trim(),
            representative.serviceName.toLowerCase().trim()
          );
          
          const amountDifference = Math.abs(parseFloat(subscription.amount) - parseFloat(representative.amount));
          const amountSimilarity = amountDifference <= (parseFloat(representative.amount) * 0.05); // 5% threshold
          
          const frequencyMatch = subscription.frequency === representative.frequency;
          
          if (vendorSimilarity >= 0.80 && amountSimilarity && frequencyMatch) {
            group.push(subscription);
            foundGroup = true;
            break;
          }
        }
        
        if (!foundGroup) {
          duplicateGroups[subscription.id] = [subscription];
        }
      }
      
      // Identify duplicates to remove (keep the first one in each group)
      let duplicatesFound = 0;
      for (const group of Object.values(duplicateGroups)) {
        if (group.length > 1) {
          duplicatesFound += group.length - 1;
          // Keep the first one, mark others for removal
          for (let i = 1; i < group.length; i++) {
            toRemove.push(group[i].id);
          }
          console.log(`📋 Found duplicate group for ${group[0].serviceName}: ${group.length} subscriptions (keeping 1, removing ${group.length - 1})`);
        }
      }
      
      // Remove the duplicates
      let removedCount = 0;
      for (const subscriptionId of toRemove) {
        await storage.deleteSubscription(subscriptionId);
        removedCount++;
      }
      
      console.log(`✅ Cleanup complete: Removed ${removedCount} duplicate subscriptions from ${Object.keys(duplicateGroups).length} groups`);
      
      res.json({
        success: true,
        duplicatesFound,
        duplicatesRemoved: removedCount,
        groupsProcessed: Object.keys(duplicateGroups).length,
        message: `Successfully removed ${removedCount} duplicate subscriptions`
      });
    } catch (error) {
      console.error("Cleanup duplicates error:", error);
      res.status(500).json({ message: "Failed to cleanup duplicates" });
    }
  });

  // Get subscription stats
  app.get("/api/stats", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Get user's preferred currency
      const user = await storage.getUser(userId);
      const preferredCurrency = user?.preferredCurrency || 'INR';

      const stats = await storage.getSubscriptionStats(userId, preferredCurrency);
      res.json(stats);
    } catch (error) {
      console.error("Get stats error:", error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Get recent emails with pagination
  app.get("/api/emails", isAuthenticated, async (req: any, res) => {
    try {
      const { page, pageSize, limit } = req.query;
      const userId = getUserId(req);
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Support new pagination or legacy limit
      if (page && pageSize) {
        const pageNum = parseInt(page as string) || 1;
        const pageSizeNum = parseInt(pageSize as string) || 50;
        const result = await storage.getEmailsPaginated(userId, { page: pageNum, pageSize: pageSizeNum });
        res.json(result);
      } else {
        // Legacy support - return ALL emails for proper pagination
        const limitNum = limit ? parseInt(limit as string) : undefined;
        const emails = await storage.getEmails(userId, limitNum);
        res.json(emails);
      }
    } catch (error) {
      console.error("Get emails error:", error);
      res.status(500).json({ message: "Failed to fetch emails" });
    }
  });

  // Subscription Suggestions API
  app.get("/api/suggestions", isAuthenticated, async (req: any, res) => {
    try {
      const { page, pageSize, minConfidence } = req.query;
      const userId = getUserId(req);
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }
      
      const pageNum = parseInt(page as string) || 1;
      const pageSizeNum = parseInt(pageSize as string) || 20;
      
      const result = await storage.getSuggestions(userId, { 
        page: pageNum, 
        pageSize: pageSizeNum, 
        minConfidence: minConfidence as string 
      });
      res.json(result);
    } catch (error) {
      console.error("Error fetching suggestions:", error);
      res.status(500).json({ message: "Failed to fetch suggestions" });
    }
  });

  app.post("/api/suggestions/approve", isAuthenticated, async (req: any, res) => {
    try {
      // Validate request body with Zod
      const validation = approveSuggestionsSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid request format",
          errors: validation.error.issues 
        });
      }
      
      const { suggestionIds } = validation.data;
      const userId = getUserId(req);
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Get user's Gmail access token for invoice extraction
      const user = await storage.getUser(userId);
      const gmailAccessToken = user?.gmailAccessToken || undefined;
      
      console.log(`🔑 Gmail access token available: ${!!gmailAccessToken}, User ID: ${userId}`);
      
      const result = await storage.approveSuggestions(suggestionIds, userId, gmailAccessToken);
      res.json({
        success: true,
        message: `Approved ${result.approved} suggestions`,
        subscriptions: result.subscriptions,
        approved: result.approved
      });
    } catch (error) {
      console.error("Error approving suggestions:", error);
      res.status(500).json({ message: "Failed to approve suggestions" });
    }
  });

  app.post("/api/suggestions/reject", isAuthenticated, async (req: any, res) => {
    try {
      // Validate request body with Zod
      const validation = rejectSuggestionsSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid request format",
          errors: validation.error.issues 
        });
      }
      
      const { suggestionIds } = validation.data;
      const userId = getUserId(req);
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }
      
      const result = await storage.rejectSuggestions(suggestionIds, userId);
      res.json({
        success: true,
        message: `Rejected ${result.rejected} suggestions`,
        rejected: result.rejected
      });
    } catch (error) {
      console.error("Error rejecting suggestions:", error);
      res.status(500).json({ message: "Failed to reject suggestions" });
    }
  });

  app.delete("/api/suggestions/clear", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }
      
      const result = await storage.clearSuggestions(userId);
      res.json({
        success: true,
        message: `Cleared ${result.cleared} suggestions`,
        cleared: result.cleared
      });
    } catch (error) {
      console.error("Error clearing suggestions:", error);
      res.status(500).json({ message: "Failed to clear suggestions" });
    }
  });

  // Create a test user for demo purposes
  app.post("/api/users", async (req, res) => {
    try {
      console.log("POST /api/users - Request body:", req.body);
      const userData = insertUserSchema.parse(req.body);
      const user = await storage.createUser(userData);
      res.json(user);
    } catch (error) {
      console.error("Create user error:", error);
      console.error("Request body received:", req.body);
      if (error instanceof Error && error.name === 'ZodError') {
        console.error("Validation error details:", (error as any).issues);
      }
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  // Get user info - Restricted to authenticated users only
  app.get("/api/users/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const user = await storage.getUser(id);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Return sanitized user data without sensitive tokens
      const safeUser: SafeUser = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
        gmailConnected: user.gmailConnected,
        gmailEmail: user.gmailEmail,
        lastSync: user.lastSync,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      };

      res.json(safeUser);
    } catch (error) {
      console.error("Get user error:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Enhanced subscription detection endpoint 
  app.post("/api/sync-enhanced", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const user = await storage.getUser(userId);
      if (!user || !user.gmailConnected) {
        return res.status(400).json({ message: "Gmail not connected for this user" });
      }

      console.log(`🚀 Starting enhanced subscription detection for user: ${userId}`);

      // STEP 1: Fetch emails from Gmail first
      const gmailService = new GmailService();
      
      // Create token refresh callback
      const onTokenRefresh = async (tokens: any) => {
        try {
          const updateData: any = {
            gmailAccessToken: tokens.access_token
          };
          if (tokens.refresh_token) {
            updateData.gmailRefreshToken = tokens.refresh_token;
          }
          if (tokens.expiry_date) {
            updateData.gmailTokenExpiry = new Date(tokens.expiry_date);
          }
          await storage.updateUser(user.id, updateData);
          console.log('Updated access token in storage for user:', user.id);
        } catch (error) {
          console.error('Failed to update access token in storage:', error);
        }
      };
      
      // Fetch emails from Gmail with enhanced search
      console.log('📧 Fetching emails from Gmail...');
      const gmailMessages = await gmailService.getEmails(
        user.gmailAccessToken!,
        user.gmailRefreshToken || '',
        onTokenRefresh,
        user.emailSyncDays || 30
      );
      
      console.log(`📬 Gmail fetch complete: ${gmailMessages.length} emails retrieved`);

      // STEP 2: Parse and store new emails
      let newEmailsStored = 0;
      for (const gmailMessage of gmailMessages) {
        if (!gmailMessage.id) continue;

        // Check if email already exists
        const existingEmail = await storage.getEmailByGmailId(gmailMessage.id);
        if (existingEmail) continue;

        const parsedEmail = emailParser.parseEmail(gmailMessage);
        
        const emailData = {
          userId: user.id,
          gmailId: gmailMessage.id,
          subject: parsedEmail.subject,
          fromEmail: parsedEmail.fromEmail,
          fromName: parsedEmail.fromName || null,
          receivedAt: parsedEmail.receivedAt,
          content: parsedEmail.content,
          isTransaction: parsedEmail.isTransaction,
          extractedAmount: parsedEmail.extractedAmount ? parsedEmail.extractedAmount.toString() : null,
          extractedCurrency: parsedEmail.extractedCurrency || null,
          merchantName: parsedEmail.merchantName || null,
          subscriptionId: null,
          processed: false
        };

        await storage.createEmail(emailData);
        newEmailsStored++;
      }
      
      console.log(`💾 Stored ${newEmailsStored} new emails in database`);

      // STEP 3: Get all user emails for analysis (including newly stored ones)
      const { emails: allEmails, total } = await storage.getEmailsPaginated(userId, { page: 1, pageSize: 999999 });
      
      if (allEmails.length === 0) {
        return res.json({
          success: true,
          message: "No emails found for analysis after Gmail sync",
          suggestionsGenerated: 0,
          redirectToSuggestions: false
        });
      }

      // Import and use enhanced subscription detector
      const { enhancedSubscriptionDetector } = await import("./services/enhancedSubscriptionDetector");
      const detectionResult = await enhancedSubscriptionDetector.detectSubscriptionSuggestions(allEmails, userId);

      console.log(`✅ Enhanced detection complete: ${detectionResult.suggestions.length} suggestions generated`);

      res.json({
        success: true,
        message: `Generated ${detectionResult.suggestions.length} subscription suggestions`,
        suggestionsGenerated: detectionResult.suggestions.length,
        highConfidenceSuggestions: detectionResult.highConfidenceCount,
        processedEmails: detectionResult.totalAnalyzed,
        redirectToSuggestions: detectionResult.suggestions.length > 0
      });

    } catch (error) {
      console.error("Enhanced sync error:", error);
      res.status(500).json({ 
        message: "Failed to run enhanced subscription detection",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  const httpServer = createServer(app);
  
  // Setup Server-Sent Events endpoint for real-time progress updates
  app.get('/api/sync-progress/:userId', isAuthenticated, (req: any, res) => {
    const { userId } = req.params;
    const authenticatedUserId = getUserId(req);
    
    // Verify user can only access their own progress stream
    if (userId !== authenticatedUserId) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });
    
    // Add connection to user's SSE connections
    if (!sseConnections.has(userId)) {
      sseConnections.set(userId, new Set());
    }
    sseConnections.get(userId)!.add(res);
    
    console.log(`SSE connection established for user: ${userId}`);
    
    // Send initial connection event
    res.write(`data: ${JSON.stringify({
      type: 'connected',
      timestamp: new Date().toISOString(),
      message: 'Connected for real-time sync updates'
    })}\n\n`);
    
    // Send periodic heartbeat to keep connection alive (every 30 seconds)
    const heartbeatInterval = setInterval(() => {
      if (res.writableEnded || res.destroyed) {
        clearInterval(heartbeatInterval);
        return;
      }
      
      try {
        res.write(`data: ${JSON.stringify({
          type: 'heartbeat',
          timestamp: new Date().toISOString()
        })}\n\n`);
      } catch (error) {
        console.error('Failed to send heartbeat:', error);
        clearInterval(heartbeatInterval);
      }
    }, 30000);
    
    // Handle client disconnect
    req.on('close', () => {
      clearInterval(heartbeatInterval);
      const connections = sseConnections.get(userId);
      if (connections) {
        connections.delete(res);
        if (connections.size === 0) {
          sseConnections.delete(userId);
        }
      }
      console.log(`SSE connection closed for user: ${userId}`);
    });
  });
  
  // Register Gemini LLM routes with progress notification support
  registerGeminiRoutes(app);

  return httpServer;
}
