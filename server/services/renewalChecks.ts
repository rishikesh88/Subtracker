/**
 * The daily renewal job's real input and output: the database, the mailbox
 * search, the reconnect email and the timers. The decisions are in
 * server/lib/renewalChecks.ts and the job's flow is in server/lib/renewalJob.ts
 * (both tested offline); this file only connects them.
 *
 * Only for people with the `subscription_status` switch on. The whole job can
 * be turned off with RENEWAL_CHECKS_ENABLED=false (Railway variable).
 *
 * Once a day (UTC), shortly after the process starts and then on an hourly
 * tick, the job tries to take the day's run in one atomic database statement
 * (storage.claimRenewalRun); only one caller per day succeeds, so a restart or
 * a second instance cannot repeat the day.
 */

import { storage } from "../storage";
import { recomputeForUser, statusEnabledFor } from "./subscriptionStatus";
import { isWorkerRunning, searchSubscriptionWindow, SyncStarted } from "./historySearch";
import { sendReconnectEmail } from "./reconnectEmail";
import { APP_BASE_URL } from "../config";
import { dayString } from "../lib/statusRules";
import {
  STALE_RUN_MS,
  checksPerUserPerDay,
  isStopped,
  mailboxKey,
  renewalChecksEnabled,
  type CheckCandidate,
  type MailboxRef,
} from "../lib/renewalChecks";
import { runRenewalJob, type FlaggedMailbox, type JobDeps, type RunStats } from "../lib/renewalJob";
import type { GmailAccount, OutlookAccount, Subscription } from "@shared/schema";

const LOG = "[Renewal]";
/** The first run attempt after startup. */
const STARTUP_DELAY_MS = 2 * 60 * 1000;
/** How often a run is attempted; the database lets one succeed per day. */
const TICK_MS = 60 * 60 * 1000;

let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Which of the person's mailboxes a subscription belongs to; null if manual or the mailbox is gone. */
function mailboxOf(sub: Subscription, gmail: Map<string, GmailAccount>, outlook: Map<string, OutlookAccount>): MailboxRef | null {
  const id = sub.providerAccountId ?? sub.gmailAccountId;
  if (!id) return null;
  if (sub.emailProvider === "outlook") return outlook.has(id) ? { provider: "outlook", id } : null;
  if (gmail.has(id)) return { provider: "gmail", id };
  if (outlook.has(id)) return { provider: "outlook", id };
  return null;
}

function toCandidate(sub: Subscription, mailbox: MailboxRef | null): CheckCandidate {
  return {
    id: sub.id,
    frequency: sub.frequency,
    status: sub.status,
    lifecycleStatus: sub.lifecycleStatus,
    cancelledAt: sub.cancelledAt,
    endsOn: sub.endsOn,
    expectedNextPaymentAt: sub.expectedNextPaymentAt,
    nextBillingDate: sub.nextBillingDate,
    lastPaymentAt: sub.lastPaymentAt,
    mailbox,
  };
}

async function mailboxMaps(userId: string) {
  const [gmailAccounts, outlookAccounts] = await Promise.all([storage.getGmailAccounts(userId), storage.getOutlookAccounts(userId)]);
  return {
    gmail: new Map(gmailAccounts.map((a) => [a.id, a])),
    outlook: new Map(outlookAccounts.map((a) => [a.id, a])),
  };
}

const deps: JobDeps = {
  now: () => new Date(),
  sleep,
  claim: (today) => storage.claimRenewalRun(today, STALE_RUN_MS),
  finish: (stats) => storage.finishRenewalRun(stats),
  listUserIds: () => storage.getUserIdsWithSubscriptions(),
  statusEnabled: statusEnabledFor,
  // Part A: no email is read.
  refreshStatus: (userId, now) => recomputeForUser(userId, now),
  userBusy: isWorkerRunning,

  async loadChecks(userId) {
    const [subs, maps, states, flags] = await Promise.all([
      storage.getSubscriptions(userId),
      mailboxMaps(userId),
      storage.getRenewalCheckStates(userId),
      storage.getReconnectFlags(userId),
    ]);
    return {
      candidates: subs.map((s) => toCandidate(s, mailboxOf(s, maps.gmail, maps.outlook))),
      states,
      flagged: new Set(flags.map((f) => `${f.provider}:${f.accountId}`)),
    };
  },

  async runCheck(userId, candidate, since, now) {
    const sub = await storage.getSubscription(candidate.id);
    if (!sub || sub.userId !== userId) return { kind: "unavailable", reconnect: [] };
    const before = dayString(sub.lastPaymentAt);
    const flags = await storage.getReconnectFlags(userId);
    const excluded = new Set(flags.map((f) => `${f.provider}:${f.accountId}`));

    let result;
    try {
      result = await searchSubscriptionWindow(userId, sub, since, now, excluded);
    } catch (error) {
      if (error instanceof SyncStarted) return { kind: "deferred", reconnect: [] };
      throw error;
    }
    if (!result.mailboxSearched && result.reconnect.length > 0) return { kind: "unavailable", reconnect: result.reconnect };

    // Status and the next expected date, from whatever was recorded.
    await recomputeForUser(userId, now, [sub.id]);
    const after = await storage.getSubscription(sub.id);
    const afterDay = dayString(after?.lastPaymentAt);
    const advanced = Boolean(afterDay && (!before || afterDay > before));
    return { kind: advanced ? "found" : "miss", reconnect: result.reconnect };
  },

  saveState: (userId, state) => storage.saveRenewalCheckState(userId, state),
  markReconnect: (userId, mailbox) => storage.flagMailboxNeedsReconnect(userId, mailbox.id, mailbox.provider),

  reminder: {
    async flaggedMailboxes(userId): Promise<FlaggedMailbox[]> {
      const [flags, maps] = await Promise.all([storage.getReconnectFlags(userId), mailboxMaps(userId)]);
      const out: FlaggedMailbox[] = [];
      for (const f of flags) {
        const account = f.provider === "outlook" ? maps.outlook.get(f.accountId) : maps.gmail.get(f.accountId);
        if (!account) {
          // The mailbox was removed: nothing to reconnect.
          await storage.clearMailboxNeedsReconnect(f.accountId, f.provider);
          continue;
        }
        const address = f.provider === "outlook" ? (account as OutlookAccount).outlookEmail : (account as GmailAccount).gmailEmail;
        out.push({ provider: f.provider as MailboxRef["provider"], id: f.accountId, address });
      }
      return out;
    },
    lastSentAt: (userId) => storage.getReconnectEmailLastSent(userId),
    async send(userId, mailboxes) {
      const user = await storage.getUser(userId);
      if (!user?.email) return false;
      const maps = await mailboxMaps(userId);
      const keys = new Set(mailboxes.map(mailboxKey));
      // Only worth an email when something is tracked on those mailboxes. The
      // email itself names no subscription.
      const affected = (await storage.getSubscriptions(userId))
        .filter((s) => {
          const m = mailboxOf(s, maps.gmail, maps.outlook);
          return m !== null && keys.has(mailboxKey(m)) && !isStopped(toCandidate(s, m));
        })
        ;
      if (affected.length === 0) return "nothing_to_say";
      return sendReconnectEmail({
        to: user.email,
        mailboxes: mailboxes.map((m) => m.address),
        appUrl: APP_BASE_URL,
      });
    },
    markSent: (userId) => storage.markReconnectEmailSent(userId),
  },
};

/** One attempt at today's run. A no-op when today's run is taken or one is already running in this process. Never throws. */
export async function runDailyRenewalJob(): Promise<RunStats | null> {
  if (!renewalChecksEnabled()) return null;
  if (running) return null;
  running = true;
  try {
    return await runRenewalJob(deps, { today: dayString(new Date())!, limitPerUser: checksPerUserPerDay() });
  } catch (error) {
    console.error(`${LOG} Run failed (non-fatal):`, error);
    return null;
  } finally {
    running = false;
  }
}

/**
 * Starts the timers: a first attempt shortly after startup, then one every
 * hour. Each attempt is cheap when the day is already taken. Does nothing when
 * RENEWAL_CHECKS_ENABLED is off.
 */
export function startRenewalScheduler(): void {
  if (!renewalChecksEnabled()) {
    console.log(`${LOG} Disabled (RENEWAL_CHECKS_ENABLED is off)`);
    return;
  }
  setTimeout(() => void runDailyRenewalJob(), STARTUP_DELAY_MS).unref?.();
  setInterval(() => void runDailyRenewalJob(), TICK_MS).unref?.();
  console.log(`${LOG} Scheduled: first attempt in ${STARTUP_DELAY_MS / 1000}s, then hourly (one run per day)`);
}
