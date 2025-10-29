import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { GmailService } from "./services/gmail";
import { emailParser } from "./services/emailParser";
import { EnhancedEmailParser } from "./services/enhancedEmailParser";
import { subscriptionDetector } from "./services/subscriptionDetector";
import { GeminiSubscriptionDetector } from "./services/geminiSubscriptionDetector";
import { insertEmailSchema, insertUserSchema, updateSettingsSchema, type SafeUser } from "@shared/schema";
import { randomBytes } from "crypto";
import { z } from "zod";
import { registerGeminiRoutes } from "./routes/geminiSync";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { generateServiceKey } from "./utils/serviceKey";

// Request validation schemas
const approveSuggestionsSchema = z.object({
  suggestionIds: z.array(z.string().uuid()).nonempty()
});

const rejectSuggestionsSchema = z.object({
  suggestionIds: z.array(z.string().uuid()).nonempty()
});

// Simple in-memory store for OAuth states (in production, use Redis or database)
const oauthStates = new Map<string, { timestamp: number }>();

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
      if (!res.headersSent && !res.destroyed) {
        res.write(`data: ${eventData}\n\n`);
      }
    });
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup Replit Auth
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      
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
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      };
      
      res.json(safeUser);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Gmail OAuth routes (separate from user auth)
  app.get("/api/auth/google", isAuthenticated, async (req: any, res) => {
    try {
      console.log("Google Client ID available:", !!process.env.GOOGLE_CLIENT_ID);
      console.log("Google Client Secret available:", !!process.env.GOOGLE_CLIENT_SECRET);
      console.log("Repl Slug:", process.env.REPL_SLUG);
      console.log("Repl Owner:", process.env.REPL_OWNER);
      
      // Generate cryptographically random state for CSRF protection
      const state = randomBytes(32).toString('hex');
      oauthStates.set(state, { timestamp: Date.now() });
      
      const gmailService = new GmailService();
      const authUrl = gmailService.getAuthUrl(state);
      console.log("Generated auth URL with state:", authUrl);
      res.json({ authUrl });
    } catch (error) {
      console.error("Auth URL generation error:", error);
      res.status(500).json({ message: "Failed to generate auth URL" });
    }
  });

  app.get("/api/auth/google/callback", isAuthenticated, async (req: any, res) => {
    try {
      const { code, state } = req.query;
      
      if (!code) {
        const redirectUrl = `/?gmailConnected=false&error=${encodeURIComponent('Missing authorization code')}`;
        return res.redirect(redirectUrl);
      }

      // Verify OAuth state for CSRF protection
      if (!state || typeof state !== 'string' || !oauthStates.has(state)) {
        console.error('Invalid or missing OAuth state parameter');
        const redirectUrl = `/?gmailConnected=false&error=${encodeURIComponent('Invalid or expired authentication request')}`;
        return res.redirect(redirectUrl);
      }

      // Remove used state
      oauthStates.delete(state);

      const gmailService = new GmailService();
      const tokens = await gmailService.getTokens(code as string);
      
      // Get the current authenticated user
      const userId = req.user?.claims?.sub;
      if (!userId) {
        throw new Error("User not authenticated");
      }
      
      const user = await storage.getUser(userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Update user with Gmail tokens and expiry
      const updateData: any = {
        gmailAccessToken: tokens.access_token || null,
        gmailTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        gmailConnected: true,
        gmailEmail: tokens.scope?.includes('email') ? user.email : null,
        lastSync: new Date(),
        updatedAt: new Date()
      };
      
      // Only update refresh token if Google provides a new one
      if (tokens.refresh_token) {
        updateData.gmailRefreshToken = tokens.refresh_token;
      }
      
      const updatedUser = await storage.updateUser(user.id, updateData);

      if (!updatedUser) {
        throw new Error("Failed to update user with Gmail tokens");
      }

      console.log("Gmail connected successfully for user:", user.id);

      // Redirect back to dashboard with success flag
      const redirectUrl = `/?gmailConnected=true&userId=${encodeURIComponent(user.id)}`;
      res.redirect(redirectUrl);
    } catch (error) {
      console.error("OAuth callback error:", error);
      const redirectUrl = `/?gmailConnected=false&error=${encodeURIComponent(error instanceof Error ? error.message : 'Unknown error')}`;
      res.redirect(redirectUrl);
    }
  });

  // Gmail connection management endpoints
  app.post("/api/auth/google/disconnect", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Clear all Gmail-related data
      const updatedUser = await storage.updateUser(user.id, {
        gmailAccessToken: null,
        gmailRefreshToken: null,
        gmailTokenExpiry: null,
        gmailConnected: false,
        gmailEmail: null,
        updatedAt: new Date()
      });

      if (!updatedUser) {
        return res.status(500).json({ message: "Failed to disconnect Gmail" });
      }

      console.log("Gmail disconnected successfully for user:", user.id);
      res.json({ message: "Gmail disconnected successfully", gmailConnected: false });
    } catch (error) {
      console.error("Gmail disconnect error:", error);
      res.status(500).json({ message: "Failed to disconnect Gmail" });
    }
  });

  // Update user settings
  app.post("/api/settings/update", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
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
      
      // Generate cryptographically random state for CSRF protection
      const state = randomBytes(32).toString('hex');
      oauthStates.set(state, { timestamp: Date.now() });
      
      const gmailService = new GmailService();
      const authUrl = gmailService.getAuthUrl(state);
      console.log("Generated reconnection auth URL with state:", authUrl);
      res.json({ authUrl });
    } catch (error) {
      console.error("Gmail reconnection URL generation error:", error);
      res.status(500).json({ message: "Failed to generate reconnection auth URL" });
    }
  });

  // Sync emails and detect subscriptions
  app.post("/api/sync-emails", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
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
      const onTokenRefresh = async (newAccessToken: string) => {
        try {
          await storage.updateUser(user.id, {
            gmailAccessToken: newAccessToken
          });
          console.log('Updated access token in storage for user:', user.id);
        } catch (error) {
          console.error('Failed to update access token in storage:', error);
        }
      };
      
      // Fetch emails from Gmail
      const gmailMessages = await gmailService.getEmails(
        accessToken,
        user.gmailRefreshToken || '',
        200, // Fetch up to 200 emails
        onTokenRefresh
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
      const userId = req.user.claims.sub;
      
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

  // Get user settings (currency preference)
  app.get("/api/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
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
      const userId = req.user.claims.sub;
      
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
      const userId = req.user.claims.sub;
      
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
      const userId = req.user.claims.sub;
      
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
      const userId = req.user.claims.sub;
      
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
      const userId = req.user.claims.sub;
      
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
      const userId = req.user.claims.sub;
      
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
      const userId = req.user.claims.sub;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }
      
      const result = await storage.approveSuggestions(suggestionIds, userId);
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
      const userId = req.user.claims.sub;
      
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
      const userId = req.user.claims.sub;
      
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
      const userId = req.user.claims.sub;
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
      const onTokenRefresh = async (newAccessToken: string) => {
        try {
          await storage.updateUser(user.id, {
            gmailAccessToken: newAccessToken
          });
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
        500, // Fetch up to 500 emails for analysis
        onTokenRefresh
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
    const authenticatedUserId = req.user?.claims?.sub;
    
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
    
    // Handle client disconnect
    req.on('close', () => {
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
  
  // Make progress update function globally available
  (globalThis as any).sendProgressUpdate = sendProgressUpdate;
  
  // Register Gemini LLM routes with progress notification support
  registerGeminiRoutes(app);

  return httpServer;
}
