import { Client } from '@microsoft/microsoft-graph-client';
import { 
  EmailProviderAdapter, 
  OAuthTokens, 
  NormalizedEmailMetadata, 
  NormalizedFullEmail 
} from '../interfaces/emailProviderAdapter';
import { APP_BASE_URL } from '../config';

export class OutlookService implements EmailProviderAdapter {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private authority: string = 'https://login.microsoftonline.com/common';
  private scopes: string[] = [
    'https://graph.microsoft.com/Mail.Read',
    'https://graph.microsoft.com/User.Read',
    'offline_access'
  ];

  constructor() {
    this.clientId = process.env.MICROSOFT_CLIENT_ID || '';
    this.clientSecret = process.env.MICROSOFT_CLIENT_SECRET || '';
    this.redirectUri =
      process.env.MICROSOFT_REDIRECT_URI || `${APP_BASE_URL}/api/auth/outlook/callback`;
  }

  getAuthUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      response_mode: 'query',
      scope: this.scopes.join(' '),
      ...(state && { state })
    });

    return `${this.authority}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  async exchangeToken(code: string): Promise<OAuthTokens> {
    const tokenEndpoint = `${this.authority}/oauth2/v2.0/token`;
    
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code'
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry_date: Date.now() + (data.expires_in * 1000),
      token_type: data.token_type,
      scope: data.scope
    };
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    const tokenEndpoint = `${this.authority}/oauth2/v2.0/token`;
    
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: this.scopes.join(' ')
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expiry_date: Date.now() + (data.expires_in * 1000),
      token_type: data.token_type,
      scope: data.scope
    };
  }

  private createClient(accessToken: string): Client {
    return Client.initWithMiddleware({
      authProvider: {
        getAccessToken: async () => accessToken
      }
    });
  }

  async fetchEmailMetadata(
    accessToken: string,
    refreshToken: string,
    onTokenRefresh: (tokens: OAuthTokens) => Promise<void>,
    days: number = 90
  ): Promise<NormalizedEmailMetadata[]> {
    const emailSyncDays = Math.min(Math.max(days, 1), 180);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - emailSyncDays);
    const startDateISO = startDate.toISOString();

    let client = this.createClient(accessToken);
    let currentAccessToken = accessToken;

    try {
      const response = await client
        .api('/me/messages')
        .select('id,subject,from,receivedDateTime,bodyPreview,hasAttachments')
        .filter(`receivedDateTime ge ${startDateISO}`)
        .top(1000)
        .orderby('receivedDateTime DESC')
        .get();

      const messages = response.value || [];

      return messages.map((msg: any) => this.normalizeEmailMetadata(msg));
    } catch (error: any) {
      if (error.statusCode === 401) {
        const newTokens = await this.refreshToken(refreshToken);
        await onTokenRefresh(newTokens);
        
        client = this.createClient(newTokens.access_token);
        currentAccessToken = newTokens.access_token;

        const response = await client
          .api('/me/messages')
          .select('id,subject,from,receivedDateTime,bodyPreview,hasAttachments')
          .filter(`receivedDateTime ge ${startDateISO}`)
          .top(1000)
          .orderby('receivedDateTime DESC')
          .get();

        const messages = response.value || [];
        return messages.map((msg: any) => this.normalizeEmailMetadata(msg));
      }
      throw error;
    }
  }

  async fetchFullEmail(
    accessToken: string,
    refreshToken: string,
    messageId: string,
    onTokenRefresh: (tokens: OAuthTokens) => Promise<void>
  ): Promise<NormalizedFullEmail> {
    let client = this.createClient(accessToken);

    try {
      const message = await client
        .api(`/me/messages/${messageId}`)
        .select('id,subject,from,receivedDateTime,bodyPreview,hasAttachments,body,attachments')
        .get();

      return this.normalizeFullEmail(message);
    } catch (error: any) {
      if (error.statusCode === 401) {
        const newTokens = await this.refreshToken(refreshToken);
        await onTokenRefresh(newTokens);
        
        client = this.createClient(newTokens.access_token);

        const message = await client
          .api(`/me/messages/${messageId}`)
          .select('id,subject,from,receivedDateTime,bodyPreview,hasAttachments,body,attachments')
          .get();

        return this.normalizeFullEmail(message);
      }
      throw error;
    }
  }

  private normalizeEmailMetadata(msg: any): NormalizedEmailMetadata {
    const fromEmail = msg.from?.emailAddress?.address || '';
    const fromName = msg.from?.emailAddress?.name || '';
    const receivedAt = new Date(msg.receivedDateTime);

    return {
      id: msg.id,
      subject: msg.subject || '',
      from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
      fromEmail,
      fromName,
      snippet: msg.bodyPreview || '',
      receivedAt,
      internalDate: receivedAt.getTime(),
      hasAttachments: msg.hasAttachments || false
    };
  }

  private normalizeFullEmail(msg: any): NormalizedFullEmail {
    const metadata = this.normalizeEmailMetadata(msg);
    
    const bodyContent = msg.body?.content || '';
    const bodyType = msg.body?.contentType || 'text';

    const attachments = (msg.attachments || []).map((att: any) => ({
      filename: att.name || 'attachment',
      mimeType: att.contentType || 'application/octet-stream',
      size: att.size || 0,
      attachmentId: att.id
    }));

    return {
      ...metadata,
      body: bodyType === 'html' ? this.stripHtml(bodyContent) : bodyContent,
      bodyHtml: bodyType === 'html' ? bodyContent : undefined,
      attachments: attachments.length > 0 ? attachments : undefined
    };
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async getUserEmail(accessToken: string): Promise<string> {
    const client = this.createClient(accessToken);
    
    try {
      const user = await client
        .api('/me')
        .select('mail,userPrincipalName')
        .get();
      
      return user.mail || user.userPrincipalName || '';
    } catch (error) {
      console.error('Failed to fetch Outlook user email:', error);
      throw new Error('Failed to retrieve user email from Outlook');
    }
  }
}
