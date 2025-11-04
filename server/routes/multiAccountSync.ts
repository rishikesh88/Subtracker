import type { Express } from "express";
import { storage } from "../storage";
import { isAuthenticated } from "../replitAuth";

export function registerMultiAccountSyncRoutes(app: Express) {
  // Get progress notification function from parent scope
  const sendProgressUpdate = (globalThis as any).sendProgressUpdate || (() => {});

  // Sync specific email account
  app.post("/api/sync-account/:accountId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      const { accountId } = req.params;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const account = await storage.getEmailAccount(accountId);
      
      if (!account || account.userId !== userId) {
        return res.status(404).json({ message: "Email account not found" });
      }

      if (!account.isActive) {
        return res.status(400).json({ message: "Email account is inactive" });
      }

      const user = await storage.getUser(userId);
      const emailSyncDays = user?.emailSyncDays || 90;

      sendProgressUpdate(userId, {
        stage: 'starting',
        progress: 0,
        message: `Starting sync for ${account.email}...`,
        details: { provider: account.provider, email: account.email }
      });

      // TODO: Implement account-specific sync logic
      // For now, return placeholder response
      
      res.json({
        success: true,
        message: `Sync initiated for ${account.email}`,
        accountId: account.id,
        provider: account.provider
      });
    } catch (error) {
      console.error("Account sync error:", error);
      res.status(500).json({ 
        message: "Failed to sync account",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Sync all active email accounts
  app.post("/api/sync-all-accounts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const accounts = await storage.getActiveEmailAccounts(userId);
      
      if (accounts.length === 0) {
        return res.status(400).json({ message: "No active email accounts found" });
      }

      const user = await storage.getUser(userId);
      const emailSyncDays = user?.emailSyncDays || 90;

      sendProgressUpdate(userId, {
        stage: 'starting',
        progress: 0,
        message: `Syncing ${accounts.length} email accounts...`,
        details: { accountCount: accounts.length }
      });

      // TODO: Implement multi-account sync logic
      // For now, return placeholder response

      res.json({
        success: true,
        message: `Sync initiated for ${accounts.length} accounts`,
        accounts: accounts.map(a => ({
          id: a.id,
          email: a.email,
          provider: a.provider
        }))
      });
    } catch (error) {
      console.error("Multi-account sync error:", error);
      res.status(500).json({ 
        message: "Failed to sync accounts",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}
