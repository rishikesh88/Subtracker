import { ConfidentialClientApplication, type AuthorizationCodeRequest, type Configuration } from "@azure/msal-node";
import type { IStorage } from "../storage";
import { APP_BASE_URL } from "../config";

export class MicrosoftAuthService {
  private msalClient: ConfidentialClientApplication;
  private redirectUri: string;

  constructor() {
    const clientId = process.env.MICROSOFT_AUTH_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_AUTH_CLIENT_SECRET;
    const tenantId = process.env.MICROSOFT_AUTH_TENANT_ID || "common";

    if (!clientId || !clientSecret) {
      throw new Error("Microsoft Auth credentials not configured");
    }

    this.redirectUri = `${APP_BASE_URL}/api/auth/microsoft-login/callback`;

    const msalConfig: Configuration = {
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        clientSecret,
      },
      system: {
        loggerOptions: {
          loggerCallback(loglevel: any, message: string, containsPii: boolean) {
            if (!containsPii) {
              console.log(message);
            }
          },
          piiLoggingEnabled: false,
          logLevel: 3, // Verbose
        },
      },
    };

    this.msalClient = new ConfidentialClientApplication(msalConfig);
    console.log("Microsoft Auth service initialized");
  }

  // Generate authorization URL for user login
  async getAuthUrl(state: string): Promise<string> {
    const authCodeUrlParameters = {
      scopes: ["openid", "profile", "email", "User.Read"],
      redirectUri: this.redirectUri,
      state,
    };

    try {
      const authUrl = await this.msalClient.getAuthCodeUrl(authCodeUrlParameters);
      return authUrl;
    } catch (error) {
      console.error("Error generating Microsoft auth URL:", error);
      throw error;
    }
  }

  // Exchange authorization code for tokens and user info
  async handleCallback(code: string, storage: IStorage) {
    const tokenRequest: AuthorizationCodeRequest = {
      code,
      scopes: ["openid", "profile", "email", "User.Read"],
      redirectUri: this.redirectUri,
    };

    try {
      // Acquire token using authorization code
      const response = await this.msalClient.acquireTokenByCode(tokenRequest);
      
      if (!response || !response.account) {
        throw new Error("Failed to acquire token or account info");
      }

      // Extract user information
      const email = response.account.username; // This is the email for Microsoft accounts
      const firstName = response.account.name?.split(" ")[0] || null;
      const lastName = response.account.name?.split(" ").slice(1).join(" ") || null;

      if (!email) {
        throw new Error("No email found in Microsoft account");
      }

      // Check if user exists by email
      let user = await storage.getUserByEmail(email);

      if (!user) {
        // Create new user account
        user = await storage.createUserWithPassword({
          email,
          firstName,
          lastName,
          profileImageUrl: null,
          passwordHash: null, // No password for OAuth users
        });
        
        console.log('[Event: user_signup_microsoft]', { userId: user.id, email });
      } else {
        console.log('[Event: user_login_microsoft]', { userId: user.id, email });
      }

      return { user, accessToken: response.accessToken };
    } catch (error) {
      console.error("Microsoft Auth callback error:", error);
      throw error;
    }
  }
}
