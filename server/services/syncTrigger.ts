/**
 * Lightweight Sync Trigger
 * Production-ready function to trigger email sync without HTTP requests
 */

import type { IStorage } from '../storage';
import { getSyncRunner } from './syncRunner';

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


  console.log(`[Event: sync_triggered] userId=${userId}, provider=${provider}, source=${triggerSource}, days=${emailSyncDays}`);

  try {
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

    /*
     * Run the same sync the "Sync now" button runs.
     *
     * This used to call a second implementation living in this file, which
     * handled Gmail with an older parser and printed "Outlook sync deferred"
     * instead of doing anything -- so connecting an Outlook mailbox during
     * onboarding left the dashboard empty, and a new Gmail user's first
     * results came from a different engine than every later sync.
     */
    const runSync = getSyncRunner();

    setImmediate(async () => {
      try {
        if (runSync) {
          await runSync(userId);
        } else {
          // Only reachable if the routes were never registered, which would
          // mean the server is not serving requests either.
          console.error('[Sync] No sync runner registered; nothing will be synced.');
          return;
        }

        // Written here, not before the run. `lastSync` previously advanced as
        // soon as a sync started, which made a crash indistinguishable from a
        // success -- the field claimed the mailbox was up to date when nothing
        // had been processed.
        await storage.updateUser(userId, { lastSync: new Date() });
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

/*
 * The second sync implementation that used to live here -- roughly two
 * hundred lines driving an older parser, with an Outlook branch that logged
 * "Outlook sync implementation pending" and returned -- has been removed.
 *
 * It was the cause of the bug this file now avoids: onboarding ran it while
 * the Sync now button ran the Gemini pipeline, so the two disagreed about
 * what a sync even was, and Outlook worked in one and not the other. Keeping
 * a spare engine around only invites something to call the wrong one.
 */

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
