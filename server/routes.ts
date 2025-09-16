import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { GmailService } from "./services/gmail";
import { emailParser } from "./services/emailParser";
import { EnhancedEmailParser } from "./services/enhancedEmailParser";
import { subscriptionDetector } from "./services/subscriptionDetector";
import { GeminiSubscriptionDetector } from "./services/geminiSubscriptionDetector";
import { insertUserSchema, insertEmailSchema } from "@shared/schema";
import { randomBytes } from "crypto";
import { registerGeminiRoutes } from "./routes/geminiSync";

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

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth routes
  app.get("/api/auth/google", async (req, res) => {
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

  app.get("/api/auth/google/callback", async (req, res) => {
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
      
      // Create or get the demo user
      let user = await storage.getUserByUsername("demo@example.com");
      if (!user) {
        user = await storage.createUser({
          username: "demo@example.com",
          password: "demo123"
        });
      }

      if (!user) {
        throw new Error("Failed to create or get user");
      }

      // Update user with Gmail tokens (preserve existing refresh token if new one not provided)
      const updateData: any = {
        gmailAccessToken: tokens.access_token || null,
        gmailConnected: true,
        lastSync: new Date()
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

  // Sync emails and detect subscriptions
  app.post("/api/sync-emails", async (req, res) => {
    try {
      const { userId } = req.body;
      
      if (!userId) {
        return res.status(400).json({ message: "Missing userId" });
      }

      const user = await storage.getUser(userId);
      if (!user || !user.gmailConnected || !user.gmailAccessToken) {
        return res.status(400).json({ message: "Gmail not connected" });
      }

      const gmailService = new GmailService();
      
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
        user.gmailAccessToken,
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

      // Detect subscriptions from unprocessed emails
      const detectedSubscriptions = await subscriptionDetector.detectSubscriptions(userId);
      processedEmails = detectedSubscriptions.length;

      // Update user's last sync time
      await storage.updateUser(userId, { lastSync: new Date() });

      res.json({
        success: true,
        newEmails,
        processedEmails,
        detectedSubscriptions: detectedSubscriptions.length
      });
    } catch (error) {
      console.error("Sync emails error:", error);
      res.status(500).json({ message: "Failed to sync emails" });
    }
  });

  // Get user's subscriptions
  app.get("/api/subscriptions", async (req, res) => {
    try {
      const { userId } = req.query;
      
      if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ message: "Missing or invalid userId" });
      }

      const subscriptions = await storage.getSubscriptions(userId);
      res.json(subscriptions);
    } catch (error) {
      console.error("Get subscriptions error:", error);
      res.status(500).json({ message: "Failed to fetch subscriptions" });
    }
  });

  // Clear all data for fresh start
  app.delete("/api/clear-data/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      
      if (!userId) {
        return res.status(400).json({ message: "Missing userId" });
      }

      console.log(`🧹 Clearing all data for user: ${userId}`);
      
      // Clear all emails
      const emails = await storage.getEmails(userId);
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

  // Get subscription stats
  app.get("/api/stats", async (req, res) => {
    try {
      const { userId } = req.query;
      
      if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ message: "Missing or invalid userId" });
      }

      const stats = await storage.getSubscriptionStats(userId);
      res.json(stats);
    } catch (error) {
      console.error("Get stats error:", error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Get recent emails with pagination
  app.get("/api/emails", async (req, res) => {
    try {
      const { userId, page, pageSize, limit } = req.query;
      
      if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ message: "Missing or invalid userId" });
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
  app.get("/api/suggestions", async (req, res) => {
    try {
      const { userId, page, pageSize, minConfidence } = req.query;
      
      if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ message: "Missing or invalid userId" });
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

  app.post("/api/suggestions/approve", async (req, res) => {
    try {
      const { userId, suggestionIds } = req.body;
      
      if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ message: "Missing or invalid userId" });
      }
      
      if (!Array.isArray(suggestionIds) || suggestionIds.length === 0) {
        return res.status(400).json({ message: "Invalid suggestion IDs" });
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

  app.post("/api/suggestions/reject", async (req, res) => {
    try {
      const { suggestionIds } = req.body;
      
      if (!Array.isArray(suggestionIds) || suggestionIds.length === 0) {
        return res.status(400).json({ message: "Invalid suggestion IDs" });
      }
      
      const result = await storage.rejectSuggestions(suggestionIds);
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

  app.delete("/api/suggestions/clear/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      
      if (!userId) {
        return res.status(400).json({ message: "Missing userId" });
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

  // Get user info
  app.get("/api/users/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const user = await storage.getUser(id);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Return sanitized user data without sensitive tokens
      const safeUser = {
        id: user.id,
        username: user.username,
        gmailConnected: user.gmailConnected,
        lastSync: user.lastSync,
      };

      res.json(safeUser);
    } catch (error) {
      console.error("Get user error:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Enhanced subscription detection endpoint 
  app.post("/api/sync-enhanced", async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ message: "Missing userId" });
      }

      const user = await storage.getUser(userId);
      if (!user || !user.gmailConnected) {
        return res.status(400).json({ message: "Gmail not connected for this user" });
      }

      console.log(`🚀 Starting enhanced subscription detection for user: ${userId}`);

      // Get all user emails for analysis
      const { emails: allEmails, total } = await storage.getEmailsPaginated(userId, { page: 1, pageSize: 999999 });
      
      if (allEmails.length === 0) {
        return res.json({
          success: true,
          message: "No emails found for analysis",
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

  // Register Gemini LLM routes BEFORE the HTTP server creation
  registerGeminiRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}
