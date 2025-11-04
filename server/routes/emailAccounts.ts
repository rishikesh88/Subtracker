import type { Express } from "express";
import { storage } from "../storage";
import { GmailService } from "../services/gmail";
import { outlookService } from "../services/outlook";
import { z } from "zod";
import { randomBytes } from "crypto";
import { isAuthenticated } from "../replitAuth";
import { safeEmailAccountSchema } from "@shared/schema";

// Simple in-memory store for OAuth states
const oauthStates = new Map<string, { timestamp: number; userId: string; provider: string }>();

// Clean up old states (older than 10 minutes)
const cleanupOldStates = () => {
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  for (const [state, data] of Array.from(oauthStates.entries())) {
    if (data.timestamp < tenMinutesAgo) {
      oauthStates.delete(state);
    }
  }
};

setInterval(cleanupOldStates, 5 * 60 * 1000);

const updateAccountNameSchema = z.object({
  accountName: z.string().min(1).max(100)
});

export function registerEmailAccountRoutes(app: Express) {
  // Get all email accounts for the current user
  app.get("/api/email-accounts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const accounts = await storage.getEmailAccounts(userId);
      
      // Return only safe data (excluding tokens)
      const safeAccounts = accounts.map(account => ({
        id: account.id,
        userId: account.userId,
        provider: account.provider,
        email: account.email,
        accountName: account.accountName,
        isActive: account.isActive,
        lastSync: account.lastSync,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt
      }));
      
      res.json(safeAccounts);
    } catch (error) {
      console.error("Error fetching email accounts:", error);
      res.status(500).json({ message: "Failed to fetch email accounts" });
    }
  });

  // Connect Gmail account - initiate OAuth flow
  app.post("/api/email-accounts/connect/gmail", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      // Generate state for CSRF protection
      const state = randomBytes(32).toString('hex');
      oauthStates.set(state, { 
        timestamp: Date.now(), 
        userId,
        provider: 'gmail'
      });
      
      const gmailService = new GmailService();
      const authUrl = gmailService.getAuthUrl(state);
      
      res.json({ authUrl, state });
    } catch (error) {
      console.error("Error initiating Gmail OAuth:", error);
      res.status(500).json({ message: "Failed to initiate Gmail connection" });
    }
  });

  // Gmail OAuth callback - complete connection
  app.get("/api/email-accounts/callback/gmail", async (req: any, res) => {
    try {
      const { code, state } = req.query;
      
      if (!code || !state || typeof state !== 'string') {
        return res.redirect(`/?error=${encodeURIComponent('Missing authorization parameters')}`);
      }

      // Verify state
      const stateData = oauthStates.get(state);
      if (!stateData || stateData.provider !== 'gmail') {
        return res.redirect(`/?error=${encodeURIComponent('Invalid or expired authentication request')}`);
      }

      oauthStates.delete(state);

      const gmailService = new GmailService();
      const tokens = await gmailService.getTokens(code as string);
      
      // Get user's Gmail email
      const gmailClient = gmailService.getGmailClient(tokens.access_token!, tokens.refresh_token!);
      const profile = await gmailClient.users.getProfile({ userId: 'me' });
      const gmailEmail = profile.data.emailAddress || '';

      // Check if this account already exists
      const existingAccount = await storage.getEmailAccountByEmail(stateData.userId, gmailEmail, 'gmail');
      
      if (existingAccount) {
        // Update existing account tokens
        await storage.updateEmailAccount(existingAccount.id, {
          accessToken: tokens.access_token || null,
          refreshToken: tokens.refresh_token || existingAccount.refreshToken,
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          isActive: true,
          updatedAt: new Date()
        });
      } else {
        // Create new email account
        await storage.createEmailAccount({
          userId: stateData.userId,
          provider: 'gmail',
          email: gmailEmail,
          accountName: gmailEmail,
          accessToken: tokens.access_token || null,
          refreshToken: tokens.refresh_token || null,
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          isActive: true
        });
      }

      res.redirect('/accounts?gmailConnected=true');
    } catch (error) {
      console.error("Gmail OAuth callback error:", error);
      res.redirect(`/accounts?error=${encodeURIComponent('Failed to connect Gmail account')}`);
    }
  });

  // Connect Outlook account
  app.post("/api/email-accounts/connect/outlook", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      // Get Outlook user email from Replit connector
      const outlookEmail = await outlookService.getUserEmail();
      
      // Check if this account already exists
      const existingAccount = await storage.getEmailAccountByEmail(userId, outlookEmail, 'outlook');
      
      if (existingAccount) {
        // Reactivate if disabled
        if (!existingAccount.isActive) {
          await storage.updateEmailAccount(existingAccount.id, {
            isActive: true,
            updatedAt: new Date()
          });
        }
        return res.json({ 
          success: true, 
          message: "Outlook account already connected",
          account: {
            id: existingAccount.id,
            email: existingAccount.email,
            provider: existingAccount.provider
          }
        });
      }
      
      // Create new email account (Replit connector manages tokens)
      const newAccount = await storage.createEmailAccount({
        userId,
        provider: 'outlook',
        email: outlookEmail,
        accountName: outlookEmail,
        isActive: true
      });

      res.json({ 
        success: true, 
        message: "Outlook account connected successfully",
        account: {
          id: newAccount.id,
          email: newAccount.email,
          provider: newAccount.provider
        }
      });
    } catch (error) {
      console.error("Error connecting Outlook account:", error);
      res.status(500).json({ message: "Failed to connect Outlook account" });
    }
  });

  // Update account name
  app.patch("/api/email-accounts/:id/name", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { id } = req.params;
      
      const validation = updateAccountNameSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid account name" });
      }

      const account = await storage.getEmailAccount(id);
      if (!account || account.userId !== userId) {
        return res.status(404).json({ message: "Email account not found" });
      }

      const updated = await storage.updateEmailAccount(id, {
        accountName: validation.data.accountName,
        updatedAt: new Date()
      });

      res.json({
        id: updated!.id,
        accountName: updated!.accountName,
        email: updated!.email,
        provider: updated!.provider
      });
    } catch (error) {
      console.error("Error updating account name:", error);
      res.status(500).json({ message: "Failed to update account name" });
    }
  });

  // Disconnect/deactivate email account
  app.post("/api/email-accounts/:id/disconnect", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { id } = req.params;

      const account = await storage.getEmailAccount(id);
      if (!account || account.userId !== userId) {
        return res.status(404).json({ message: "Email account not found" });
      }

      await storage.updateEmailAccount(id, {
        isActive: false,
        updatedAt: new Date()
      });

      res.json({ success: true, message: "Email account disconnected" });
    } catch (error) {
      console.error("Error disconnecting email account:", error);
      res.status(500).json({ message: "Failed to disconnect email account" });
    }
  });

  // Delete email account
  app.delete("/api/email-accounts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { id } = req.params;

      const account = await storage.getEmailAccount(id);
      if (!account || account.userId !== userId) {
        return res.status(404).json({ message: "Email account not found" });
      }

      await storage.deleteEmailAccount(id);

      res.json({ success: true, message: "Email account deleted" });
    } catch (error) {
      console.error("Error deleting email account:", error);
      res.status(500).json({ message: "Failed to delete email account" });
    }
  });
}
