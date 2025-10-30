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

  getGmailClient(accessToken: string, refreshToken: string) {
    this.oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });
    return google.gmail({ version: 'v1', auth: this.oauth2Client });
  }

  async getEmails(accessToken: string, refreshToken: string, maxResults: number = 2000, onTokenRefresh?: (newAccessToken: string) => Promise<void>, days: number = 90) {
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
    
    // Validate and constrain days parameter (1-180 days)
    const emailSyncDays = Math.min(Math.max(days, 1), 180);
    
    // Fetch ALL emails from the time period - let AI do the filtering
    const query = `newer_than:${emailSyncDays}d`;
    
    console.log(`🔍 Gmail API: Fetching ALL emails from past ${emailSyncDays} days`);
    console.log(`📧 Query: ${query}`);
    console.log(`📊 Max results: ${maxResults}`);
    console.log(`🔑 Access Token Present: ${!!accessToken}`);
    console.log(`🔄 Refresh Token Present: ${!!refreshToken}`);

    try {
      // Fetch ALL emails - no keyword filtering, AI will handle detection
      console.log(`📬 Fetching all emails from the time period...`);
      const allMessageIds = await this.getAllMessageIds(gmail, query, maxResults);
      console.log(`✅ Total emails found: ${allMessageIds.length}`);

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

  /**
   * Fetch lightweight email metadata (subject, sender, snippet only)
   * Much faster than full fetch - for Phase 1 screening
   */
  async getEmailMetadata(accessToken: string, refreshToken: string, maxResults: number = 5000, onTokenRefresh?: (newAccessToken: string) => Promise<void>, days: number = 90) {
    this.oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    if (onTokenRefresh) {
      this.oauth2Client.on('tokens', (tokens) => {
        if (tokens.access_token && tokens.access_token !== accessToken) {
          onTokenRefresh(tokens.access_token);
        }
      });
    }

    const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
    const emailSyncDays = Math.min(Math.max(days, 1), 180);
    const query = `newer_than:${emailSyncDays}d`;
    
    console.log(`🔍 Phase 1: Fetching lightweight email metadata (${maxResults} max)`);

    try {
      const allMessageIds = await this.getAllMessageIds(gmail, query, maxResults);
      console.log(`✅ Found ${allMessageIds.length} email IDs`);

      if (allMessageIds.length === 0) {
        return [];
      }

      // Fetch metadata only (much faster)
      const metadata = await this.fetchMetadataInBatches(gmail, allMessageIds);
      console.log(`✅ Retrieved metadata for ${metadata.length} emails`);
      return metadata;
    } catch (error) {
      console.error('Error fetching email metadata:', error);
      throw new Error('Failed to fetch email metadata from Gmail');
    }
  }

  /**
   * Fetch full email details for specific message IDs
   * Used in Phase 2 for deep processing of candidates only
   */
  async getEmailsByIds(accessToken: string, refreshToken: string, messageIds: string[]): Promise<any[]> {
    this.oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
    console.log(`📥 Phase 2: Fetching full content for ${messageIds.length} candidate emails`);
    
    const messages = await this.fetchMessagesInBatches(gmail, messageIds);
    console.log(`✅ Retrieved full content for ${messages.length} emails`);
    return messages;
  }

  private async fetchMetadataInBatches(gmail: any, messageIds: string[]): Promise<any[]> {
    const metadata: any[] = [];
    const batchSize = 8; // Optimized batch size for better throughput
    const delayBetweenBatches = 2000; // 2 seconds between batches = 4 req/sec average
    
    console.log(`📥 Fetching metadata for ${messageIds.length} emails in batches of ${batchSize} (rate-limited to ~240 queries/min)`);

    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      
      try {
        const batchMetadata = await Promise.all(
          batch.map(async (messageId: string) => {
            return await this.fetchMetadataWithRetry(gmail, messageId);
          })
        );

        const validMetadata = batchMetadata.filter(msg => msg !== null);
        metadata.push(...validMetadata);

        if ((i + batchSize) % 100 === 0 || i + batchSize >= messageIds.length) {
          console.log(`Fetched metadata: ${Math.min(i + batchSize, messageIds.length)}/${messageIds.length}`);
        }
        
        // Rate limit delay between batches
        if (i + batchSize < messageIds.length) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
        }
      } catch (error) {
        console.error(`Error fetching metadata batch:`, error);
      }
    }

    return metadata;
  }

  /**
   * Fetch metadata for a single message with retry logic
   */
  private async fetchMetadataWithRetry(gmail: any, messageId: string, maxRetries: number = 3): Promise<any> {
    let lastError: any = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const messageResponse = await gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date']
        });
        return messageResponse.data;
      } catch (error: any) {
        lastError = error;
        
        // Detect rate limit errors: 403, 429, or Google-specific error reasons
        const errorReason = error?.errors?.[0]?.reason || '';
        const isRateLimitError = 
          error?.code === 403 || 
          error?.status === 403 || 
          error?.code === 429 || 
          error?.status === 429 ||
          errorReason === 'userRateLimitExceeded' ||
          errorReason === 'rateLimitExceeded' ||
          error?.message?.toLowerCase().includes('rate limit') ||
          error?.message?.toLowerCase().includes('quota exceeded');
        
        if (isRateLimitError && attempt < maxRetries - 1) {
          const delayMs = 2000 * Math.pow(2, attempt); // 2s, 4s, 8s
          console.warn(`⏳ Rate limit hit for metadata ${messageId.substring(0, 10)}..., retrying in ${delayMs / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        } else if (!isRateLimitError) {
          console.error(`Error fetching metadata ${messageId}:`, error?.message || error);
          return null;
        }
      }
    }
    
    console.error(`Failed to fetch metadata ${messageId} after ${maxRetries} attempts`);
    return null;
  }

  private async fetchMessagesInBatches(gmail: any, messageIds: string[]): Promise<any[]> {
    const messages: any[] = [];
    const batchSize = 8; // Optimized batch size for better throughput
    const delayBetweenBatches = 2000; // 2 seconds between batches = 4 req/sec average
    
    console.log(`📥 Fetching ${messageIds.length} email details in batches of ${batchSize} (rate-limited to ~240 queries/min)`);

    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      
      try {
        const batchMessages = await Promise.all(
          batch.map(async (messageId: string) => {
            return await this.fetchMessageWithRetry(gmail, messageId, 3);
          })
        );

        // Filter out failed requests
        const validMessages = batchMessages.filter(msg => msg !== null);
        messages.push(...validMessages);

        // Progress logging
        if ((i + batchSize) % 25 === 0 || i + batchSize >= messageIds.length) {
          console.log(`Processed ${Math.min(i + batchSize, messageIds.length)}/${messageIds.length} messages`);
        }

        // Rate limit: 2 second delay between batches to stay within Gmail API limits
        if (i + batchSize < messageIds.length) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
        }
      } catch (error) {
        console.error(`Error fetching batch starting at ${i}:`, error);
        // Continue with next batch even if this one fails
      }
    }

    return messages;
  }

  /**
   * Fetch a single message with exponential backoff retry for rate limit errors
   */
  private async fetchMessageWithRetry(gmail: any, messageId: string, maxRetries: number = 3): Promise<any> {
    let lastError: any = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const messageResponse = await gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'full'
        });
        return messageResponse.data;
      } catch (error: any) {
        lastError = error;
        
        // Detect rate limit errors: 403, 429, or Google-specific error reasons
        const errorReason = error?.errors?.[0]?.reason || '';
        const isRateLimitError = 
          error?.code === 403 || 
          error?.status === 403 || 
          error?.code === 429 || 
          error?.status === 429 ||
          errorReason === 'userRateLimitExceeded' ||
          errorReason === 'rateLimitExceeded' ||
          error?.message?.toLowerCase().includes('rate limit') ||
          error?.message?.toLowerCase().includes('quota exceeded');
        
        if (isRateLimitError && attempt < maxRetries - 1) {
          // Exponential backoff: 3s, 6s, 12s
          const delayMs = 3000 * Math.pow(2, attempt);
          console.warn(`⏳ Rate limit hit for message ${messageId.substring(0, 10)}..., retrying in ${delayMs / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        } else if (!isRateLimitError) {
          // For non-rate-limit errors, don't retry
          console.error(`Error fetching message ${messageId}:`, error?.message || error);
          return null;
        }
      }
    }
    
    // All retries exhausted
    console.error(`Failed to fetch message ${messageId} after ${maxRetries} attempts:`, lastError?.message || lastError);
    return null;
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
