import { google } from 'googleapis';
import { PDFParse } from 'pdf-parse';

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
    
    // Fetch emails from past 90 days
    const baseQuery = 'newer_than:90d';
    
    // Subscription-targeted query to catch more subscription emails  
    const subscriptionQuery = 'newer_than:90d (receipt OR invoice OR subscription OR renewal OR billed OR payment OR statement OR plan OR membership OR trial OR bank OR card OR charged OR billing)';
    
    console.log(`🔍 Gmail API: Enhanced email fetching with subscription detection`);
    console.log(`📧 Base Query: ${baseQuery}`);
    console.log(`🎯 Subscription Query: ${subscriptionQuery}`);
    console.log(`🔑 Access Token Present: ${!!accessToken}`);
    console.log(`🔄 Refresh Token Present: ${!!refreshToken}`);

    try {
      // First: Get general emails (casting wider net)
      console.log(`📬 Fetching general emails...`);
      const generalIds = await this.getAllMessageIds(gmail, baseQuery, Math.floor(maxResults * 0.7));
      console.log(`✅ General emails found: ${generalIds.length}`);
      
      // Second: Get subscription-targeted emails
      console.log(`🎯 Fetching subscription-targeted emails...`);
      const subscriptionIds = await this.getAllMessageIds(gmail, subscriptionQuery, Math.floor(maxResults * 0.3));
      console.log(`✅ Subscription-targeted emails found: ${subscriptionIds.length}`);
      
      // Combine and deduplicate
      const allMessageIds = Array.from(new Set([...generalIds, ...subscriptionIds]));
      console.log(`📊 Total unique emails after deduplication: ${allMessageIds.length}`);

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

    console.log(`📞 Making Gmail API call with query: "${query}"`);
    
    do {
      try {
        const listResponse = await gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: Math.min(500, maxResults - totalFetched),
          pageToken: nextPageToken,
          includeSpamTrash: false  // Exclude spam and trash for cleaner results
        });
        
        console.log(`📊 Gmail API Response: ${listResponse.data.messages?.length || 0} messages in this page`);

        if (listResponse.data.messages) {
          const ids = listResponse.data.messages.map((msg: any) => msg.id);
          allIds.push(...ids);
          totalFetched += ids.length;
          console.log(`📈 Total fetched so far: ${totalFetched}`);
        } else {
          console.log(`ℹ️ No messages in this response`);
        }

        nextPageToken = listResponse.data.nextPageToken;
        console.log(`🔄 Next page token: ${nextPageToken ? 'Present' : 'None'}`);
        
        // Stop if we've reached our limit
        if (totalFetched >= maxResults) {
          console.log(`🛑 Reached maxResults limit of ${maxResults}`);
          break;
        }
      } catch (error) {
        console.error(`❌ Gmail API Error for query "${query}":`, error);
        throw error;
      }
    } while (nextPageToken);

    console.log(`✅ Final result: ${allIds.length} message IDs collected`);
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

  /**
   * Download and process attachments from a Gmail message
   * Supports PDFs and images
   */
  async processAttachments(gmail: any, messageId: string, message: any): Promise<{
    hasAttachments: boolean;
    attachments: Array<{
      filename: string;
      mimeType: string;
      size: number;
      extractedText?: string;
      base64Data?: string;
    }>;
  }> {
    const attachments: any[] = [];
    let hasAttachments = false;

    try {
      // Look for attachments in message parts
      const parts = message.payload?.parts || [];
      
      for (const part of parts) {
        // Check if this part is an attachment
        if (part.filename && part.body?.attachmentId) {
          hasAttachments = true;
          const filename = part.filename;
          const mimeType = part.mimeType || '';
          const size = part.body.size || 0;

          // Only process PDFs and images, and limit size to 5MB
          const isPDF = mimeType.includes('pdf');
          const isImage = mimeType.includes('image');
          
          if ((isPDF || isImage) && size < 5 * 1024 * 1024) {
            try {
              // Download the attachment
              const attachment = await gmail.users.messages.attachments.get({
                userId: 'me',
                messageId: messageId,
                id: part.body.attachmentId
              });

              const data = Buffer.from(attachment.data.data, 'base64');

              if (isPDF) {
                // Extract text from PDF
                const extractedText = await this.extractPDFText(data);
                attachments.push({
                  filename,
                  mimeType,
                  size,
                  extractedText
                });
              } else if (isImage) {
                // Store base64 for Gemini Vision API processing
                attachments.push({
                  filename,
                  mimeType,
                  size,
                  base64Data: attachment.data.data
                });
              }
            } catch (attachmentError) {
              console.error(`Error processing attachment ${filename}:`, attachmentError);
              // Continue with other attachments even if one fails
            }
          }
        }
      }
    } catch (error) {
      console.error('Error processing attachments:', error);
    }

    return { hasAttachments, attachments };
  }

  /**
   * Extract text from PDF buffer
   */
  private async extractPDFText(buffer: Buffer): Promise<string> {
    try {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      await parser.destroy();
      return result.text || '';
    } catch (error) {
      console.error('Error extracting PDF text:', error);
      return '';
    }
  }
}

export const gmailService = new GmailService();
