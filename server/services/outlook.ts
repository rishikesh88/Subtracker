import { Client } from '@microsoft/microsoft-graph-client';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=outlook',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Outlook not connected');
  }
  return accessToken;
}

async function getUncachableOutlookClient() {
  const accessToken = await getAccessToken();

  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => accessToken
    }
  });
}

export class OutlookService {
  async getEmails(days: number = 90) {
    const client = await getUncachableOutlookClient();
    
    const emailSyncDays = Math.min(Math.max(days, 1), 180);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - emailSyncDays);
    
    console.log(`🔍 Outlook API: Fetching ALL emails from past ${emailSyncDays} days`);
    console.log(`📅 From date: ${fromDate.toISOString()}`);

    try {
      const messages: any[] = [];
      let nextLink = `/me/messages?$filter=receivedDateTime ge ${fromDate.toISOString()}&$top=100&$select=id,subject,receivedDateTime,from,hasAttachments,bodyPreview,body`;
      
      while (nextLink) {
        const response = await client.api(nextLink).get();
        
        if (response.value && response.value.length > 0) {
          messages.push(...response.value);
          console.log(`📧 Fetched ${response.value.length} messages (total: ${messages.length})`);
        }
        
        nextLink = response['@odata.nextLink'] || null;
      }
      
      console.log(`✅ Outlook API: Successfully fetched ${messages.length} emails`);
      
      return messages.map((msg: any) => ({
        id: msg.id,
        subject: msg.subject || '',
        from: {
          email: msg.from?.emailAddress?.address || '',
          name: msg.from?.emailAddress?.name || ''
        },
        receivedAt: new Date(msg.receivedDateTime),
        content: msg.body?.content || msg.bodyPreview || '',
        hasAttachments: msg.hasAttachments || false
      }));
    } catch (error) {
      console.error('Error fetching Outlook emails:', error);
      throw new Error('Failed to fetch emails from Outlook');
    }
  }

  async getEmailMetadata(days: number = 90) {
    const client = await getUncachableOutlookClient();
    
    const emailSyncDays = Math.min(Math.max(days, 1), 180);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - emailSyncDays);
    
    console.log(`🔍 Outlook API: Fetching email metadata from past ${emailSyncDays} days`);

    try {
      const messages: any[] = [];
      let nextLink = `/me/messages?$filter=receivedDateTime ge ${fromDate.toISOString()}&$top=100&$select=id,subject,receivedDateTime,from,hasAttachments,bodyPreview`;
      
      while (nextLink) {
        const response = await client.api(nextLink).get();
        
        if (response.value && response.value.length > 0) {
          messages.push(...response.value);
        }
        
        nextLink = response['@odata.nextLink'] || null;
      }
      
      console.log(`✅ Outlook API: Fetched metadata for ${messages.length} emails`);
      
      return messages.map((msg: any) => ({
        id: msg.id,
        subject: msg.subject || '',
        from: {
          email: msg.from?.emailAddress?.address || '',
          name: msg.from?.emailAddress?.name || ''
        },
        receivedAt: new Date(msg.receivedDateTime),
        snippet: msg.bodyPreview || ''
      }));
    } catch (error) {
      console.error('Error fetching Outlook email metadata:', error);
      throw new Error('Failed to fetch email metadata from Outlook');
    }
  }

  async getEmailsById(messageIds: string[]) {
    const client = await getUncachableOutlookClient();
    
    console.log(`📧 Outlook API: Fetching ${messageIds.length} emails by ID`);

    try {
      const messages = await Promise.all(
        messageIds.map(async (id) => {
          try {
            const msg = await client
              .api(`/me/messages/${id}`)
              .select('id,subject,receivedDateTime,from,hasAttachments,body,bodyPreview')
              .get();
            
            return {
              id: msg.id,
              subject: msg.subject || '',
              from: {
                email: msg.from?.emailAddress?.address || '',
                name: msg.from?.emailAddress?.name || ''
              },
              receivedAt: new Date(msg.receivedDateTime),
              content: msg.body?.content || msg.bodyPreview || '',
              hasAttachments: msg.hasAttachments || false
            };
          } catch (error) {
            console.error(`Failed to fetch Outlook message ${id}:`, error);
            return null;
          }
        })
      );
      
      const validMessages = messages.filter(msg => msg !== null);
      console.log(`✅ Successfully fetched ${validMessages.length}/${messageIds.length} Outlook emails`);
      
      return validMessages;
    } catch (error) {
      console.error('Error fetching Outlook emails by ID:', error);
      throw new Error('Failed to fetch emails from Outlook');
    }
  }

  async getUserEmail() {
    const client = await getUncachableOutlookClient();
    
    try {
      const user = await client.api('/me').select('mail,userPrincipalName').get();
      return user.mail || user.userPrincipalName;
    } catch (error) {
      console.error('Error fetching Outlook user email:', error);
      throw new Error('Failed to fetch user email from Outlook');
    }
  }
}

export const outlookService = new OutlookService();
