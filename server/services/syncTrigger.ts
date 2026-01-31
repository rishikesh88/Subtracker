/**
 * Lightweight Sync Trigger
 * Production-ready function to trigger email sync without HTTP requests
 */

import type { IStorage } from '../storage';

interface TriggerSyncOptions {
  userId: string;
  emailSyncDays?: number;
  provider: 'gmail' | 'outlook';
  triggerSource: string;
}

/**
 * Trigger email sync for a user after OAuth connection
 * This is a lightweight trigger that initiates the sync process asynchronously
 * @param storage Storage interface
 * @param options Sync trigger options
 */
export async function triggerEmailSync(
  storage: IStorage,
  options: TriggerSyncOptions
): Promise<void> {
  const { userId, emailSyncDays = 90, provider, triggerSource } = options;

  // Validate provider - only Gmail supported until schema migration completes
  if (provider !== 'gmail') {
    console.warn(`[Sync] Provider '${provider}' not supported - email schema migration required. Gmail-only for now.`);
    return;
  }

  console.log(`[Event: sync_triggered] userId=${userId}, provider=${provider}, source=${triggerSource}, days=${emailSyncDays}`);

  try {
    // Update user's last sync timestamp to indicate sync is starting
    await storage.updateUser(userId, {
      lastSync: new Date(),
    });

    // Send initial SSE progress update
    sendProgressUpdate(userId, {
      stage: 'syncing',
      progress: 0,
      message: `Starting ${provider} sync...`,
      details: {
        totalAccounts: 1,
        completed: 0,
        emailsProcessed: 0,
        candidateEmails: 0
      }
    });

    // Trigger the actual sync asynchronously (non-blocking)
    // This runs in the background without blocking the OAuth callback
    setImmediate(async () => {
      try {
        await executeSync(storage, userId, emailSyncDays);
      } catch (error) {
        console.error(`[Sync] Background sync error for user ${userId}:`, error);
        
        sendProgressUpdate(userId, {
          stage: 'error',
          progress: 0,
          message: error instanceof Error ? error.message : 'Unknown sync error'
        });
      }
    });

    console.log(`[Sync] Background sync initiated for user ${userId}`);
  } catch (error) {
    console.error('[Sync] Failed to trigger sync:', error);
    throw error;
  }
}

/**
 * Execute the actual sync process
 * This runs asynchronously in the background
 */
async function executeSync(
  storage: IStorage,
  userId: string,
  emailSyncDays: number
): Promise<void> {
  console.log(`[Sync] Executing background sync for user ${userId}`);

  const user = await storage.getUser(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Import services only when needed
  const { GmailService } = await import('./gmail');
  const { OutlookService } = await import('./outlook');
  const { emailParser } = await import('./emailParser');

  let totalEmailsProcessed = 0;

  // Sync Gmail accounts
  const gmailAccounts = await storage.getGmailAccounts(userId);
  if (gmailAccounts.length > 0) {
    console.log(`[Sync] Processing ${gmailAccounts.length} Gmail account(s)`);
    const gmailService = new GmailService();

    for (const account of gmailAccounts) {
      try {
        const onTokenRefresh = async (tokens: any) => {
          const updateData: any = { accessToken: tokens.access_token };
          if (tokens.refresh_token) updateData.refreshToken = tokens.refresh_token;
          if (tokens.expiry_date) updateData.tokenExpiry = new Date(tokens.expiry_date);
          await storage.updateGmailAccount(account.id, updateData);
        };

        // Emit progress before fetching
        sendProgressUpdate(userId, {
          stage: 'fetching',
          progress: 20,
          message: `Fetching emails from ${account.gmailEmail}...`,
          details: {
            emailsProcessed: totalEmailsProcessed
          }
        });

        const messages = await gmailService.getEmails(
          account.accessToken,
          account.refreshToken || '',
          onTokenRefresh,
          emailSyncDays
        );

        console.log(`[Sync] Fetched ${messages.length} emails from Gmail`);

        // Emit progress after fetch
        sendProgressUpdate(userId, {
          stage: 'processing',
          progress: 40,
          message: `Processing ${messages.length} emails...`,
          details: {
            total: messages.length,
            emailsProcessed: totalEmailsProcessed
          }
        });

        // Dynamic update interval based on batch size for real-time feedback
        // Very small batches: every email
        // Small batches: every 5 emails  
        // Medium batches: every 20 emails
        // Large batches: every 50 emails
        const updateInterval = messages.length < 10 ? 1 : messages.length < 50 ? 5 : messages.length < 200 ? 20 : 50;
        
        let processedCount = 0;
        for (const gmailMessage of messages) {
          if (!gmailMessage.id) continue;

          const existingEmail = await storage.getEmailByGmailId(gmailMessage.id);
          if (existingEmail) {
            processedCount++;
            continue;
          }

          const parsedEmail = emailParser.parseEmail(gmailMessage);

          await storage.createEmail({
            userId,
            gmailId: gmailMessage.id,
            subject: parsedEmail.subject,
            fromEmail: parsedEmail.fromEmail,
            fromName: parsedEmail.fromName || null,
            receivedAt: parsedEmail.receivedAt,
            content: parsedEmail.content,
            isTransaction: parsedEmail.isTransaction,
            extractedAmount: parsedEmail.extractedAmount ? parsedEmail.extractedAmount.toString() : null,
            extractedCurrency: parsedEmail.extractedCurrency || null,
            merchantName: parsedEmail.merchantName || null,
            subscriptionId: null,
            processed: false
          });

          totalEmailsProcessed++;
          processedCount++;

          // Emit progress at dynamic intervals
          if (processedCount % updateInterval === 0) {
            const percentComplete = Math.min(40 + Math.floor((processedCount / messages.length) * 39), 79);
            sendProgressUpdate(userId, {
              stage: 'processing',
              progress: percentComplete,
              message: `Processed ${processedCount}/${messages.length} emails...`,
              details: {
                completed: processedCount,
                total: messages.length,
                emailsProcessed: totalEmailsProcessed
              }
            });
          }
        }

        // Always emit final progress after processing all messages
        sendProgressUpdate(userId, {
          stage: 'processing',
          progress: 79,
          message: `Processed ${processedCount}/${messages.length} emails`,
          details: {
            completed: processedCount,
            total: messages.length,
            emailsProcessed: totalEmailsProcessed
          }
        });

        console.log(`[Sync] Processed ${messages.length} emails from Gmail account ${account.gmailEmail}`);
      } catch (error) {
        console.error(`[Sync] Error syncing Gmail account ${account.id}:`, error);
      }
    }
  }

  // Sync Outlook accounts (similar logic)
  const outlookAccounts = await storage.getOutlookAccounts(userId);
  if (outlookAccounts.length > 0) {
    console.log(`[Sync] Processing ${outlookAccounts.length} Outlook account(s)`);
    // Outlook sync logic would go here
    // For now, we'll log and skip to avoid complexity
    console.log('[Sync] Outlook sync implementation pending');
  }

  sendProgressUpdate(userId, {
    stage: 'analyzing',
    progress: 80,
    message: 'Running subscription detection...',
    details: {
      emailsProcessed: totalEmailsProcessed
    }
  });

  // Run subscription detection if we have emails
  if (totalEmailsProcessed > 0) {
    try {
      const { emails: allEmails } = await storage.getEmailsPaginated(userId, { page: 1, pageSize: 999999 });

      const { enhancedSubscriptionDetector } = await import('./enhancedSubscriptionDetector');
      
      // Progressive loading: pass SSE callback so suggestions appear in real-time
      const detectionResult = await enhancedSubscriptionDetector.detectSubscriptionSuggestions(
        allEmails, 
        userId,
        (progressData) => {
          // Forward progress updates via SSE for real-time UI updates
          sendProgressUpdate(userId, progressData);
        }
      );

      console.log(`[Sync] Generated ${detectionResult.suggestions.length} subscription suggestions`);

      sendProgressUpdate(userId, {
        stage: 'suggestions_ready',
        progress: 100,
        message: 'Sync complete!',
        details: {
          emailsProcessed: totalEmailsProcessed,
          suggestionsGenerated: detectionResult.suggestions.length
        }
      });
    } catch (error) {
      console.error('[Sync] Subscription detection error:', error);
      
      sendProgressUpdate(userId, {
        stage: 'completed',
        progress: 100,
        message: 'Sync complete (detection partial)',
        details: {
          emailsProcessed: totalEmailsProcessed,
          suggestionsGenerated: 0
        }
      });
    }
  } else {
    sendProgressUpdate(userId, {
      stage: 'completed',
      progress: 100,
      message: 'No new emails found',
      details: {
        emailsProcessed: 0,
        suggestionsGenerated: 0
      }
    });
  }

  console.log(`[Event: sync_completed] userId=${userId}, emailsProcessed=${totalEmailsProcessed}`);
}

/**
 * Send progress update via SSE
 */
function sendProgressUpdate(userId: string, data: any) {
  try {
    const sendProgressUpdateFn = (globalThis as any).sendProgressUpdate;
    if (sendProgressUpdateFn) {
      sendProgressUpdateFn(userId, data);
    }
  } catch (error) {
    console.error('[Sync] Failed to send progress update:', error);
  }
}
