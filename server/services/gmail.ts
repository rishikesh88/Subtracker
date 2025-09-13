import { google } from 'googleapis';

export class GmailService {
  private oauth2Client;

  constructor() {
    // Get the current Replit domain for redirect URI following official docs
    let replitDomain = 'http://localhost:5000';
    
    // Use REPLIT_DEV_DOMAIN as recommended by Replit docs for development
    if (process.env.REPLIT_DEV_DOMAIN) {
      replitDomain = `https://${process.env.REPLIT_DEV_DOMAIN}`;
    }
    // Fallback to REPLIT_DOMAINS if available
    else if (process.env.REPLIT_DOMAINS) {
      const domains = process.env.REPLIT_DOMAINS.split(',');
      replitDomain = `https://${domains[0]}`;
    }
    
    const finalRedirectUri = process.env.GOOGLE_REDIRECT_URI || `${replitDomain}/api/auth/google/callback`;
    
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      finalRedirectUri
    );
  }

  getAuthUrl(state?: string): string {
    const scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
      state: state
    });
  }

  async getTokens(code: string) {
    const { tokens } = await this.oauth2Client.getToken(code);
    return tokens;
  }

  async refreshAccessToken(refreshToken: string) {
    this.oauth2Client.setCredentials({
      refresh_token: refreshToken
    });
    
    const { credentials } = await this.oauth2Client.refreshAccessToken();
    return credentials;
  }

  async getEmails(accessToken: string, refreshToken: string, maxResults: number = 2000, onTokenRefresh?: (newAccessToken: string) => Promise<void>) {
    this.oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    // Set up token refresh callback
    if (onTokenRefresh) {
      this.oauth2Client.on('tokens', (tokens) => {
        if (tokens.access_token && tokens.access_token !== accessToken) {
          console.log('Token refreshed, updating storage...');
          onTokenRefresh(tokens.access_token);
        }
      });
    }

    const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
    
    // Calculate date 90 days ago (changed from 6 months for LLM processing efficiency)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const query = `after:${Math.floor(ninetyDaysAgo.getTime() / 1000)}`;
    
    console.log(`Gmail API: Fetching ALL emails (read + unread) from past 90 days`);
    console.log(`Query: ${query} (from ${ninetyDaysAgo.toDateString()} onwards)`);

    try {
      // Get all message IDs with pagination
      const allMessageIds = await this.getAllMessageIds(gmail, query, maxResults);
      console.log(`✅ Gmail API: Found ${allMessageIds.length} total emails in the past 90 days (includes ALL emails - read and unread)`);

      if (allMessageIds.length === 0) {
        return [];
      }

      // Get full message details with controlled concurrency
      const messages = await this.fetchMessagesInBatches(gmail, allMessageIds);
      
      console.log(`✅ Gmail API: Successfully processed ${messages.length} emails with full content`);
      console.log(`📧 Email Types: ALL emails fetched (no read/unread filtering applied)`);
      return messages;
    } catch (error) {
      console.error('Error fetching emails:', error);
      throw new Error('Failed to fetch emails from Gmail');
    }
  }

  private async getAllMessageIds(gmail: any, query: string, maxResults: number): Promise<string[]> {
    const allIds: string[] = [];
    let nextPageToken: string | undefined;
    let totalFetched = 0;

    do {
      const listResponse = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: Math.min(500, maxResults - totalFetched),
        pageToken: nextPageToken
      });

      if (listResponse.data.messages) {
        const ids = listResponse.data.messages.map((msg: any) => msg.id);
        allIds.push(...ids);
        totalFetched += ids.length;
      }

      nextPageToken = listResponse.data.nextPageToken;
      
      // Stop if we've reached our limit
      if (totalFetched >= maxResults) {
        break;
      }
    } while (nextPageToken);

    return allIds;
  }

  private async fetchMessagesInBatches(gmail: any, messageIds: string[]): Promise<any[]> {
    const messages: any[] = [];
    const batchSize = 20; // Controlled concurrency to avoid rate limits
    
    console.log(`📥 Fetching ${messageIds.length} email details in batches of ${batchSize} (rate-limited)`);

    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      
      try {
        const batchMessages = await Promise.all(
          batch.map(async (messageId: string) => {
            try {
              const messageResponse = await gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'full'
              });
              return messageResponse.data;
            } catch (error) {
              console.error(`Error fetching message ${messageId}:`, error);
              return null;
            }
          })
        );

        // Filter out failed requests
        const validMessages = batchMessages.filter(msg => msg !== null);
        messages.push(...validMessages);

        // Progress logging
        if ((i + batchSize) % 100 === 0 || i + batchSize >= messageIds.length) {
          console.log(`Processed ${Math.min(i + batchSize, messageIds.length)}/${messageIds.length} messages`);
        }

        // Small delay to be respectful to Gmail API
        if (i + batchSize < messageIds.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`Error fetching batch starting at ${i}:`, error);
        // Continue with next batch even if this one fails
      }
    }

    return messages;
  }

  async getUserInfo(accessToken: string) {
    this.oauth2Client.setCredentials({
      access_token: accessToken
    });

    const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
    const response = await oauth2.userinfo.get();
    return response.data;
  }
}

export const gmailService = new GmailService();
