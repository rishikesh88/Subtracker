import { google } from 'googleapis';
import { PDFParse } from 'pdf-parse';
import { ObjectStorageService } from '../objectStorage';
import { randomUUID } from 'crypto';
import { OAuthTokens } from '../interfaces/emailProviderAdapter';

export class GmailService {
  private oauth2Client;
  private objectStorage: ObjectStorageService;

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
    
    this.objectStorage = new ObjectStorageService();
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

  async getEmails(accessToken: string, refreshToken: string, onTokenRefresh?: (tokens: OAuthTokens) => Promise<void>, days: number = 90) {
    this.oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    // Set up token refresh callback
    if (onTokenRefresh) {
      this.oauth2Client.on('tokens', (tokens) => {
        if (tokens.access_token && tokens.access_token !== accessToken) {
          console.log('Token refreshed, updating storage...');
          onTokenRefresh({
            access_token: tokens.access_token!,
            refresh_token: tokens.refresh_token ?? undefined,
            expiry_date: tokens.expiry_date ?? undefined,
            token_type: tokens.token_type ?? undefined,
            scope: tokens.scope ?? undefined
          });
        }
      });
    }

    const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
    
    // Validate and constrain days parameter (1-180 days)
    const emailSyncDays = Math.min(Math.max(days, 1), 180);
    
    // Fetch ALL emails from the time period - let AI do the filtering
    const query = `newer_than:${emailSyncDays}d`;
    
    console.log(`🔍 Gmail API: Fetching ALL emails from past ${emailSyncDays} days (no email cap)`);
    console.log(`📧 Query: ${query}`);
    console.log(`🔑 Access Token Present: ${!!accessToken}`);
    console.log(`🔄 Refresh Token Present: ${!!refreshToken}`);

    try {
      // Fetch ALL emails - no keyword filtering, AI will handle detection
      console.log(`📬 Fetching all emails from the time period...`);
      const allMessageIds = await this.getAllMessageIds(gmail, query);
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

  private async getAllMessageIds(gmail: any, query: string): Promise<string[]> {
    const allIds: string[] = [];
    let nextPageToken: string | undefined;
    let totalFetched = 0;

    console.log(`📞 Making Gmail API call with query: "${query}"`);
    
    do {
      try {
        const listResponse = await gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: 500, // Gmail API max per page
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
        
      } catch (error) {
        console.error(`❌ Gmail API Error for query "${query}":`, error);
        throw error;
      }
    } while (nextPageToken);

    console.log(`✅ Final result: ${allIds.length} message IDs collected (no cap - date range only)`);
    return allIds;
  }

  /**
   * Fetch lightweight email metadata (subject, sender, snippet only)
   * Much faster than full fetch - for Phase 1 screening
   */
  async getEmailMetadata(accessToken: string, refreshToken: string, onTokenRefresh?: (tokens: OAuthTokens) => Promise<void>, days: number = 90) {
    this.oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    if (onTokenRefresh) {
      this.oauth2Client.on('tokens', (tokens) => {
        if (tokens.access_token && tokens.access_token !== accessToken) {
          onTokenRefresh({
            access_token: tokens.access_token!,
            refresh_token: tokens.refresh_token ?? undefined,
            expiry_date: tokens.expiry_date ?? undefined,
            token_type: tokens.token_type ?? undefined,
            scope: tokens.scope ?? undefined
          });
        }
      });
    }

    const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
    const emailSyncDays = Math.min(Math.max(days, 1), 180);
    const query = `newer_than:${emailSyncDays}d`;
    
    console.log(`🔍 Phase 1: Fetching lightweight email metadata from past ${emailSyncDays} days (no email cap)`);

    try {
      const allMessageIds = await this.getAllMessageIds(gmail, query);
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
    const batchSize = 50; // Aggressive concurrent batch size for maximum throughput
    const delayBetweenBatches = 12000; // 12 seconds = ~4 req/sec average (50 requests / 12 sec)
    
    console.log(`📥 Fetching metadata for ${messageIds.length} emails in batches of ${batchSize} (aggressive batching ~4 req/sec)`);

    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      
      try {
        // Use Promise.allSettled for better error resilience
        const batchResults = await Promise.allSettled(
          batch.map(async (messageId: string) => {
            return await this.fetchMetadataWithRetry(gmail, messageId);
          })
        );

        // Extract successful results
        const validMetadata = batchResults
          .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled' && result.value !== null)
          .map(result => result.value);
        
        metadata.push(...validMetadata);

        // Progress logging every batch
        console.log(`📊 Metadata progress: ${Math.min(i + batchSize, messageIds.length)}/${messageIds.length} (${Math.round((i + batchSize) / messageIds.length * 100)}%)`);

        
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
    const batchSize = 50; // Aggressive concurrent batch size for maximum throughput
    const delayBetweenBatches = 12000; // 12 seconds = ~4 req/sec average (50 requests / 12 sec)
    
    console.log(`📥 Fetching ${messageIds.length} email details in batches of ${batchSize} (aggressive batching ~4 req/sec)`);

    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      
      try {
        // Use Promise.allSettled for better error resilience
        const batchResults = await Promise.allSettled(
          batch.map(async (messageId: string) => {
            return await this.fetchMessageWithRetry(gmail, messageId, 3);
          })
        );

        // Extract successful results
        const validMessages = batchResults
          .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled' && result.value !== null)
          .map(result => result.value);
        
        messages.push(...validMessages);

        // Progress logging every batch
        console.log(`📊 Full message progress: ${Math.min(i + batchSize, messageIds.length)}/${messageIds.length} (${Math.round((i + batchSize) / messageIds.length * 100)}%)`);


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
   * Now also uploads attachments to object storage for later use
   */
  async processAttachments(gmail: any, messageId: string, message: any, userId: string): Promise<{
    hasAttachments: boolean;
    attachments: Array<{
      messageId: string;
      attachmentId: string;
      filename: string;
      mimeType: string;
      size: number;
      extractedText?: string;
      base64Data?: string;
      objectStoragePath?: string;
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
          const attachmentId = part.body.attachmentId;

          // Only process PDFs and images, and limit size to 5MB
          const isPDF = mimeType.includes('pdf');
          const isImage = mimeType.includes('image');
          
          if ((isPDF || isImage) && size < 5 * 1024 * 1024) {
            try {
              // Download the attachment
              const attachment = await gmail.users.messages.attachments.get({
                userId: 'me',
                messageId: messageId,
                id: attachmentId
              });

              const data = Buffer.from(attachment.data.data, 'base64');

              // Upload to object storage for later use (during approval)
              let objectStoragePath: string | undefined;
              try {
                const privateObjectDir = this.objectStorage.getPrivateObjectDir();
                const objectId = randomUUID();
                const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
                const fullPath = `${privateObjectDir}/invoices/${objectId}/${sanitizedFilename}`;

                objectStoragePath = await this.objectStorage.uploadBufferWithAcl(
                  fullPath,
                  data,
                  mimeType,
                  {
                    owner: userId,
                    visibility: 'private'
                  }
                );
                console.log(`📎 Uploaded attachment during sync: ${sanitizedFilename} → ${objectStoragePath}`);
              } catch (uploadError) {
                console.error(`⚠️  Failed to upload attachment ${filename} to object storage:`, uploadError);
                // Continue processing even if upload fails (non-fatal)
              }

              if (isPDF) {
                // Extract text from PDF for AI analysis
                const extractedText = await this.extractPDFText(data);
                attachments.push({
                  messageId,
                  attachmentId,
                  filename,
                  mimeType,
                  size,
                  extractedText,
                  objectStoragePath
                });
              } else if (isImage) {
                // Store base64 for Gemini Vision API processing
                attachments.push({
                  messageId,
                  attachmentId,
                  filename,
                  mimeType,
                  size,
                  base64Data: attachment.data.data,
                  objectStoragePath
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
