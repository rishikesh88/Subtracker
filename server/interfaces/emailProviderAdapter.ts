/**
 * OAuth token response structure
 * Standardized across Gmail and Outlook providers
 */
export interface OAuthTokens {
  access_token: string;
  refresh_token?: string; // Optional as refresh may not always be included
  expiry_date?: number; // Unix timestamp in milliseconds
  token_type?: string;
  scope?: string;
}

/**
 * EmailProviderAdapter Interface
 * 
 * Defines the contract for email provider services (Gmail, Outlook, etc.)
 * Ensures consistent implementation across different providers
 */
export interface EmailProviderAdapter {
  /**
   * Generate OAuth authorization URL for user to grant access
   * @param state Optional state parameter for OAuth flow
   * @returns Authorization URL to redirect user to
   */
  getAuthUrl(state?: string): string;

  /**
   * Exchange authorization code for access/refresh tokens
   * @param code Authorization code from OAuth callback
   * @returns Token object containing access_token, refresh_token, expiry_date
   */
  exchangeToken(code: string): Promise<OAuthTokens>;

  /**
   * Refresh expired access token using refresh token
   * @param refreshToken The refresh token to use
   * @returns New token object with refreshed access_token and updated expiry
   */
  refreshToken(refreshToken: string): Promise<OAuthTokens>;

  /**
   * Fetch email metadata (lightweight) for initial screening
   * Used in Phase 1 of the two-phase processing pipeline
   * @param accessToken Valid access token
   * @param refreshToken Refresh token for token renewal
   * @param onTokenRefresh Callback to update full token bundle in storage (handles token rotation)
   * @param days Number of days to fetch emails from
   * @returns Array of normalized email metadata with basic fields
   */
  fetchEmailMetadata(
    accessToken: string,
    refreshToken: string,
    onTokenRefresh: (tokens: OAuthTokens) => Promise<void>,
    days: number
  ): Promise<NormalizedEmailMetadata[]>;

  /**
   * Fetch full email content for deep analysis
   * Used in Phase 2 after AI pre-filtering
   * @param accessToken Valid access token
   * @param refreshToken Refresh token for token renewal
   * @param messageId The message ID to fetch
   * @param onTokenRefresh Callback to update full token bundle in storage (handles token rotation)
   * @returns Full normalized email content with body, attachments, etc.
   */
  fetchFullEmail(
    accessToken: string,
    refreshToken: string,
    messageId: string,
    onTokenRefresh: (tokens: OAuthTokens) => Promise<void>
  ): Promise<NormalizedFullEmail>;
}

/**
 * Normalized email metadata structure
 * Both Gmail and Outlook services should return emails in this format
 */
export interface NormalizedEmailMetadata {
  id: string;
  subject: string;
  from: string;
  fromEmail: string;
  fromName: string;
  snippet: string;
  receivedAt: Date;
  internalDate: number;
  hasAttachments: boolean;
}

/**
 * Normalized full email structure
 * Both Gmail and Outlook services should return full emails in this format
 */
export interface NormalizedFullEmail extends NormalizedEmailMetadata {
  body: string;
  bodyHtml?: string;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    size: number;
    attachmentId: string;
  }>;
}
