/**
 * History search: once per approved subscription, a narrow look back through
 * the person's mailboxes for that subscription's billing emails from the last
 * twelve months, so its status has a payment history to work from.
 *
 * Only for users with the `subscription_status` switch on; every entry point
 * checks it, and for anyone else nothing here reads or writes anything.
 * Nothing it finds is shown in the app beyond what approval already shows
 * (the emails are linked to the subscription and its invoices filed); the
 * payments and status are seen only in the admin console for now.
 *
 * How it runs:
 * - One worker per user, in this process, taking that user's queued
 *   subscriptions one after another. A second queue call while it runs only
 *   asks it to look again when it finishes.
 * - Never alongside that user's sync: it waits, checking every 30 seconds,
 *   and stops mid-subscription (without counting the attempt) if a sync
 *   starts. The sync never waits for it.
 * - A failed attempt is tried again three times, twenty minutes apart, then
 *   the row reads 'failed' with a reason in plain words. Nothing thrown here
 *   leaves the worker.
 * - At boot, queued rows and rows left 'running' by a previous process (for
 *   more than 15 minutes) are picked up again.
 *
 * No model is asked anything: emails are read with the same word rules and
 * amount extraction the rest of the app uses. The decisions live in
 * server/lib/historySearchRules.ts.
 */

import { storage, type PaymentSourceEmail } from "../storage";
import { GmailService } from "./gmail";
import { OutlookService } from "./outlook";
import { EmailParser } from "./emailParser";
import { storeInvoiceAttachment } from "../lib/invoiceAttachment";
import { mapWithConcurrency } from "../lib/concurrency";
import { withRetry } from "../lib/retryTransient";
import { attachmentTextOf, classifyPaymentEmail, dayString } from "../lib/statusRules";
import {
  statusEnabledFor,
  paymentsFromEmails,
  applyCancellation,
  recomputeForUser,
} from "./subscriptionStatus";
import {
  HISTORY_DAYS,
  MAX_MESSAGES_PER_SUBSCRIPTION,
  RETRY_DELAY_MS,
  STALE_RUNNING_MS,
  SYNC_POLL_MS,
  NOTE_BANK_ALERTS_ONLY,
  afterAttempt,
  assignByPrice,
  buildNameClues,
  buildOutlookFilter,
  buildOutlookNameFilter,
  buildOutlookNameSearch,
  withinWindow,
  datedCancellation,
  decideSearch,
  describeFailure,
  domainOf,
  dueAt,
  gmailQueriesFor,
  isDue,
  isStaleRunning,
  keepEmail,
  matchesKeywords,
  registrableDomain,
  searchCoverage,
  searchSince,
  siblingsOf,
  selectNewMessageIds,
  shouldStopEarly,
  worthSaving,
  type CompanySub,
  type NameClues,
  type SenderPlan,
} from "../lib/historySearchRules";
import {
  bankAlertEvidence,
  buildBankAlertGmailQuery,
  evidenceFingerprint,
  fingerprintSecret,
  isBankOrCardSender,
  type BankAlertEvidence,
} from "../lib/bankAlert";
import { isCreditCardBill } from "../lib/statusRules";
import type { Subscription, Email, InsertPayment } from "@shared/schema";

const LOG = "[History]";
/** How long a worker waits for a running sync before giving up for now. */
const MAX_SYNC_WAIT_MS = 3 * 60 * 60 * 1000;
/** Ids listed from one query before the already-stored ones are dropped. */
const LIST_LIMIT = 200;
/** Outlook's filter names exact addresses; more than this and Graph refuses it. */
const MAX_OUTLOOK_ADDRESSES = 10;
/** Attachments downloaded and stored at once; a few at a time keeps clear of Gmail and storage rate limits. */
const ATTACHMENT_CONCURRENCY = 3;

// ---------------------------------------------------------------------------
// Worker bookkeeping (in memory, this process only)
// ---------------------------------------------------------------------------

const workers = new Map<string, Promise<void>>();
const again = new Set<string>();
const wakeTimers = new Map<string, { at: number; timer: NodeJS.Timeout }>();
/** Subscriptions a worker in this process is searching right now. */
const activeSubscriptions = new Set<string>();

/** A sync started for this user mid-search: stop, and do not count the attempt. */
class SyncStarted extends Error {}
/** A failure whose message is already plain words. */
class PlainFailure extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function kick(userId: string): void {
  const wake = wakeTimers.get(userId);
  if (wake) {
    clearTimeout(wake.timer);
    wakeTimers.delete(userId);
  }
  if (workers.has(userId)) {
    again.add(userId);
    return;
  }
  const run = runWorker(userId).catch((error) => {
    // Most likely the database was briefly unreachable; the queue is still
    // there, so look again later rather than waiting for the next boot.
    console.error(`${LOG} Worker stopped unexpectedly (non-fatal): ${describeFailure(error)}`);
    scheduleWake(userId, RETRY_DELAY_MS);
  });
  workers.set(userId, run);
  void run.finally(() => {
    workers.delete(userId);
    if (again.delete(userId)) kick(userId);
  });
}

/** Wake this user's worker later; an earlier wake already set is kept. */
function scheduleWake(userId: string, delayMs: number): void {
  const at = Date.now() + Math.max(delayMs, 1000);
  const existing = wakeTimers.get(userId);
  if (existing && existing.at <= at) return;
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    wakeTimers.delete(userId);
    kick(userId);
  }, at - Date.now());
  timer.unref?.();
  wakeTimers.set(userId, { at, timer });
}

async function isSyncRunning(userId: string): Promise<boolean> {
  try {
    return Boolean(await storage.getRunningSyncJob(userId));
  } catch (error) {
    // Unsure means wait: overlapping a sync is the one thing not to do.
    console.error(`${LOG} Could not check for a running sync; waiting:`, describeFailure(error));
    return true;
  }
}

/** True once no sync is running; false if one is still running after the longest wait. */
async function waitWhileSyncRunning(userId: string): Promise<boolean> {
  const giveUpAt = Date.now() + MAX_SYNC_WAIT_MS;
  let logged = false;
  while (await isSyncRunning(userId)) {
    if (Date.now() >= giveUpAt) return false;
    if (!logged) {
      console.log(`${LOG} A sync is running for this user; waiting for it to finish`);
      logged = true;
    }
    await sleep(SYNC_POLL_MS);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Queue a history search for some of this user's subscriptions and start
 * their worker. Does nothing for a user without the switch. Without `force`
 * only subscriptions never searched (or whose search failed) are queued; with
 * it, done ones are searched again too. Never throws; returns how many were
 * queued.
 */
export async function queueHistorySearch(
  userId: string,
  subscriptionIds: string[],
  options: { force?: boolean } = {},
): Promise<number> {
  try {
    if (subscriptionIds.length === 0 || !(await statusEnabledFor(userId))) return 0;
    const marked = await storage.markHistoryPending(userId, Array.from(new Set(subscriptionIds)), options.force ?? false);
    if (marked.length > 0) {
      console.log(`${LOG} Queued ${marked.length} subscription(s)`);
      kick(userId);
    }
    return marked.length;
  } catch (error) {
    console.error(`${LOG} Could not queue a history search (non-fatal):`, describeFailure(error));
    return 0;
  }
}

/** Every subscription of this user not already searched (or, with force, all of them). */
export async function queueAllForUser(userId: string, options: { force?: boolean } = {}): Promise<number> {
  try {
    const subs = await storage.getSubscriptions(userId);
    return queueHistorySearch(userId, subs.map((s) => s.id), options);
  } catch (error) {
    console.error(`${LOG} Could not queue a history search (non-fatal):`, describeFailure(error));
    return 0;
  }
}

/**
 * At boot: pick up queued searches and ones a previous process left
 * 'running'. Rows still inside the 15-minute window are looked at again once
 * it has passed. Never throws.
 */
export async function resumeHistorySearches(now = new Date()): Promise<void> {
  try {
    const rows = await storage.getUnfinishedHistorySearches();
    const users = new Set<string>();
    let recentRunning = false;
    for (const row of rows) {
      if (row.historyStatus === "running") {
        if (activeSubscriptions.has(row.id)) continue;
        if (!isStaleRunning(row, now)) {
          recentRunning = true;
          continue;
        }
        await storage.updateHistoryFields(row.id, row.userId, { historyStatus: "pending" });
      }
      users.add(row.userId);
    }
    let resumed = 0;
    for (const userId of Array.from(users)) {
      if (!(await statusEnabledFor(userId))) continue;
      kick(userId);
      resumed++;
    }
    if (resumed > 0) console.log(`${LOG} Resumed history searches for ${resumed} user(s)`);
    if (recentRunning) {
      const timer = setTimeout(() => void resumeHistorySearches(), STALE_RUNNING_MS);
      timer.unref?.();
    }
  } catch (error) {
    console.error(`${LOG} Could not resume history searches (non-fatal):`, describeFailure(error));
  }
}

// ---------------------------------------------------------------------------
// The worker
// ---------------------------------------------------------------------------

async function runWorker(userId: string): Promise<void> {
  // Bounded so a bug can never spin forever; each pass takes one subscription.
  for (let pass = 0; pass < 1000; pass++) {
    if (!(await statusEnabledFor(userId))) {
      console.log(`${LOG} Switch is off for this user; leaving their queue alone`);
      return;
    }
    if (!(await waitWhileSyncRunning(userId))) {
      console.log(`${LOG} Sync still running after a long wait; trying again later`);
      scheduleWake(userId, RETRY_DELAY_MS);
      return;
    }

    const now = new Date();
    const subs = await storage.getSubscriptions(userId);
    const pending = subs.filter((s) => s.historyStatus === "pending");
    const due = pending
      .filter((s) => isDue(s, now))
      .sort((a, b) => new Date(a.detectedAt ?? 0).getTime() - new Date(b.detectedAt ?? 0).getTime());

    if (due.length === 0) {
      if (pending.length > 0) {
        const nextAt = Math.min(...pending.map((s) => dueAt(s)));
        scheduleWake(userId, nextAt - now.getTime());
      }
      return;
    }
    await searchOne(userId, due[0]);
  }
}

/** One attempt at one subscription. Never throws. */
async function searchOne(userId: string, sub: Subscription): Promise<void> {
  const attempts = (sub.historyAttempts ?? 0) + 1;
  const now = new Date();
  activeSubscriptions.add(sub.id);
  try {
    await storage.updateHistoryFields(sub.id, userId, {
      historyStatus: "running",
      historyAttempts: attempts,
      historyStartedAt: now,
    });

    const outcome = await searchSubscription(userId, sub, now);
    await storage.updateHistoryFields(sub.id, userId, {
      historyStatus: "done",
      historySearchedSince: outcome.searchedSince,
      historyError: outcome.note,
      historyFinishedAt: new Date(),
      historyRead: outcome.read,
      historySaved: outcome.saved,
      historySkipped: outcome.skipped,
      historyPartial: outcome.partial,
    });
    if (outcome.searchedSince) {
      try {
        await recomputeForUser(userId, new Date(), [sub.id]);
      } catch (error) {
        console.error(`${LOG} Recompute after a history search failed (non-fatal):`, describeFailure(error));
      }
    }
  } catch (error) {
    try {
      if (error instanceof SyncStarted) {
        console.log(`${LOG} A sync started; pausing "${sub.serviceName}" until it finishes`);
        await storage.updateHistoryFields(sub.id, userId, {
          historyStatus: "pending",
          historyAttempts: attempts - 1,
          historyStartedAt: null,
        });
        return;
      }
      const reason = error instanceof PlainFailure ? error.message : describeFailure(error);
      const next = afterAttempt(attempts, { ok: false, error: reason });
      console.warn(`${LOG} "${sub.serviceName}" attempt ${attempts} failed: ${reason} -> ${next.status}`);
      await storage.updateHistoryFields(sub.id, userId, {
        historyStatus: next.status,
        historyError: next.error,
        historyFinishedAt: next.status === "failed" ? new Date() : null,
      });
      if (next.status === "pending") scheduleWake(userId, RETRY_DELAY_MS);
    } catch (bookkeeping) {
      console.error(`${LOG} Could not record the outcome of a search (non-fatal):`, describeFailure(bookkeeping));
    }
  } finally {
    activeSubscriptions.delete(sub.id);
  }
}

// ---------------------------------------------------------------------------
// Searching one subscription
// ---------------------------------------------------------------------------

interface Tally {
  listed: number;
  fetched: number;
  notKept: number;
  notPayment: number;
  saved: number;
  duplicate: number;
  /** Payment emails of a company with several subscriptions where no subscription's price fits. */
  skipped: number;
  /** ... and ones that fit a different subscription of the same company. */
  otherSubscription: number;
}

interface Outcome {
  searchedSince: string | null;
  note: string | null;
  read: number | null;
  saved: number | null;
  skipped: number;
  partial: boolean;
}

const NOT_SEARCHED = { read: null, saved: null, skipped: 0, partial: false };

/** The subscription as the company-matching rules see it. */
function asCompanySub(sub: Subscription, senders: string[]): CompanySub {
  return {
    id: sub.id,
    serviceName: sub.serviceName,
    merchantName: sub.merchantName,
    merchantEmail: sub.merchantEmail,
    amount: sub.amount,
    currency: sub.currency,
    senders,
  };
}

async function searchSubscription(
  userId: string,
  sub: Subscription,
  now: Date,
): Promise<Outcome> {
  const [linked, remembered] = await Promise.all([
    storage.getLinkedSenders(userId, sub.id),
    storage.getRememberedNames(userId, sub.id),
  ]);
  const clues = buildNameClues({ merchantName: sub.merchantName, serviceName: sub.serviceName, remembered });
  const decision = decideSearch({
    serviceName: sub.serviceName,
    linkedFromEmails: linked,
    merchantEmail: sub.merchantEmail,
    clues,
    currency: sub.currency,
  });
  if (!decision.search) {
    console.log(`${LOG} "${sub.serviceName}": not searched (${decision.note})`);
    return { searchedSince: null, note: decision.note, ...NOT_SEARCHED };
  }
  const plan = decision.plan;
  const since = searchSince(now);

  // Other subscriptions of the same company: an email is assigned to the one
  // whose price fits, the same whichever of them is searched first.
  const [allSubs, sendersBySub] = await Promise.all([storage.getSubscriptions(userId), storage.getLinkedSendersBySubscription(userId)]);
  const mine = asCompanySub(sub, linked);
  const siblings = siblingsOf(mine, allSubs.map((s) => asCompanySub(s, sendersBySub.get(s.id) ?? [])));
  const group = siblings.length > 0 ? [mine, ...siblings] : [];

  const [gmailAccounts, outlookAccounts, stored] = await Promise.all([
    storage.getGmailAccounts(userId),
    storage.getOutlookAccounts(userId),
    storage.getSyncedGmailIds(userId),
  ]);
  const ownId = sub.providerAccountId ?? sub.gmailAccountId;
  const mailboxes = [
    ...gmailAccounts.map((account) => ({ kind: "gmail" as const, account })),
    ...outlookAccounts.map((account) => ({ kind: "outlook" as const, account })),
  ]
    .filter((m) => m.account.syncStatus !== "error")
    // The mailbox it was found in first.
    .sort((a, b) => Number(b.account.id === ownId) - Number(a.account.id === ownId));

  if (mailboxes.length === 0) {
    throw new PlainFailure(
      gmailAccounts.length + outlookAccounts.length === 0
        ? "no mailbox is connected"
        : "the mailbox needs to be reconnected",
    );
  }

  const checkSync = async () => {
    if (await isSyncRunning(userId)) throw new SyncStarted();
  };
  const tally: Tally = { listed: 0, fetched: 0, notKept: 0, notPayment: 0, saved: 0, duplicate: 0, skipped: 0, otherSubscription: 0 };
  const saved: Email[] = [];
  let budget = MAX_MESSAGES_PER_SUBSCRIPTION;
  const reach = { truncated: false, oldest: null as Date | null, stoppedEarly: null as number | null };
  const ctx: SearchContext = { userId, sub, plan, clues, group, since, stored, tally, saved, reach, checkSync };

  try {
    for (const mailbox of mailboxes) {
      // Out of budget with a mailbox still to read: the window is not covered.
      if (budget <= 0) {
        reach.truncated = true;
        break;
      }
      await checkSync();
      budget -= mailbox.kind === "gmail"
        ? await searchGmail(ctx, mailbox.account, budget)
        : await searchOutlook(ctx, mailbox.account, budget);
    }
  } finally {
    // Whatever was saved is recorded, even when a later mailbox failed: a
    // retry skips these emails as already stored, so it is now or never.
    await recordFinds(userId, sub, saved, now);
    console.log(
      `${LOG} "${sub.serviceName}": ${tally.listed} listed, ${tally.fetched} read, ` +
      `${tally.notKept} not about it, ${tally.notPayment} not a payment by the rules (skipped), ${tally.saved} saved` +
      (tally.duplicate ? `, ${tally.duplicate} already stored` : "") +
      (tally.skipped ? `, ${tally.skipped} skipped (no matching price)` : "") +
      (tally.otherSubscription ? `, ${tally.otherSubscription} for another subscription of the company` : ""),
    );
  }

  // A subscription with no receipts or invoices of its own: bank alerts are
  // read for the date, amount and currency of each charge, and discarded.
  try {
    const own = new Set((await storage.getPaymentsForSubscription(sub.id, userId)).map((p) => p.kind));
    if (!own.has("receipt") && !own.has("invoice")) {
      const evidence = await readBankAlertEvidence(ctx, mailboxes);
      if (evidence.recorded > 0) console.log(`${LOG} "${sub.serviceName}": ${evidence.recorded} bank alert(s) recorded (read and discarded, ${evidence.read} read)`);
    }
  } catch (error) {
    if (error instanceof SyncStarted) throw error;
    console.error(`${LOG} Bank alert evidence failed (non-fatal):`, describeFailure(error));
  }

  const coverage = searchCoverage({ since, truncated: reach.truncated, oldestRead: reach.oldest, stoppedEarly: reach.stoppedEarly });
  let note = coverage.note;
  if (!note) {
    try {
      // Everything found came from bank card alerts, none from the company.
      const kinds = new Set((await storage.getPaymentsForSubscription(sub.id, userId)).map((p) => p.kind));
      if (kinds.has("card_alert") && !kinds.has("receipt") && !kinds.has("invoice")) note = NOTE_BANK_ALERTS_ONLY;
    } catch (error) {
      console.error(`${LOG} Could not check where the payments came from (non-fatal):`, describeFailure(error));
    }
  }
  return {
    searchedSince: coverage.searchedSince,
    note,
    read: tally.fetched,
    saved: tally.saved,
    skipped: tally.skipped,
    partial: coverage.partial,
  };
}

/** A fetched message's date counts toward how far back the search got. */
function noteReached(ctx: SearchContext, receivedAt: Date | null | undefined): void {
  if (!receivedAt || isNaN(receivedAt.getTime())) return;
  if (!ctx.reach.oldest || receivedAt < ctx.reach.oldest) ctx.reach.oldest = receivedAt;
}

/**
 * For a company with several subscriptions: is this email this subscription's
 * (by price)? 'other' means it fits a sibling, whose own search will take it;
 * 'none' means no subscription of the company fits, and it is counted as skipped.
 */
function belongsHere(ctx: SearchContext, amount: number | null | undefined, currency: string | null | undefined): "here" | "other" | "none" {
  if (ctx.group.length === 0) return "here";
  const id = assignByPrice({ amount, currency }, ctx.group);
  if (id === null) return "none";
  return id === ctx.sub.id ? "here" : "other";
}

interface SearchContext {
  userId: string;
  sub: Subscription;
  plan: SenderPlan;
  clues: NameClues;
  /** This subscription and the other subscriptions of its company; empty when it is the only one. */
  group: CompanySub[];
  since: Date;
  stored: Set<string>;
  tally: Tally;
  saved: Email[];
  /** Set when messages were left unread for want of budget, with the oldest date actually read. */
  reach: { truncated: boolean; oldest: Date | null; stoppedEarly: number | null };
  checkSync: () => Promise<void>;
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as any;
  return e?.code === "23505" || /duplicate key|unique constraint/i.test(String(e?.message ?? ""));
}

/** Saves one found email, linked to the subscription. A copy the sync saved meanwhile is left alone. */
async function saveFound(ctx: SearchContext, row: Parameters<typeof storage.createEmail>[0]): Promise<void> {
  await ctx.checkSync();
  try {
    const email = await storage.createEmail(row);
    ctx.saved.push(email);
    ctx.tally.saved++;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    ctx.tally.duplicate++;
  }
  ctx.stored.add(row.gmailId);
}

/** Returns how many messages it read. */
async function searchGmail(ctx: SearchContext, account: any, budget: number): Promise<number> {
  const gmailService = new GmailService();
  const parser = new EmailParser();

  let accessToken: string = account.accessToken;
  const expiry = account.tokenExpiry ? new Date(account.tokenExpiry) : null;
  if (expiry && new Date() >= expiry) {
    const tokens = await gmailService.refreshAccessToken(account.refreshToken);
    if (!tokens.access_token) throw new PlainFailure("the mailbox needs to be reconnected");
    accessToken = tokens.access_token;
    await storage.updateGmailAccount(account.id, {
      accessToken,
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    });
  }

  const names = [...ctx.clues.search, ...ctx.clues.bodyOnly];
  const byName = Boolean(ctx.plan.byName);
  let read = 0;
  let stopped = false;
  for (const query of gmailQueriesFor(ctx.plan, names)) {
    if (budget - read <= 0) {
      ctx.reach.truncated = true;
      break;
    }
    const listed = await gmailService.searchMessageIds(accessToken, account.refreshToken, query, LIST_LIMIT);
    ctx.tally.listed += listed.length;
    const fresh = selectNewMessageIds(listed, ctx.stored, Number.MAX_SAFE_INTEGER);
    const ids = fresh.slice(0, budget - read);
    // Messages left unread, or a listing cut off at its limit: the window is not covered.
    if (fresh.length > ids.length || listed.length >= LIST_LIMIT) ctx.reach.truncated = true;
    if (ids.length === 0) continue;
    read += ids.length;
    // Counted as seen now, so a second query or mailbox never reads them again.
    for (const id of ids) ctx.stored.add(id);

    const messages = await gmailService.getEmailsByIds(accessToken, account.refreshToken, ids);
    ctx.tally.fetched += messages.length;
    const gmail = gmailService.getGmailClient(accessToken, account.refreshToken);

    // First decide, cheaply and in order, which messages are kept; then fetch
    // their attachments a few at a time; then save in the original order, so
    // what is stored is exactly what one-by-one would have stored.
    const toSave: { msg: any; parsed: ReturnType<typeof parser.parseEmail>; receivedAt: Date }[] = [];
    let notKeptInARow = 0;
    for (const msg of messages) {
      if (!msg?.id) continue;
      const parsed = parser.parseEmail(msg);
      const receivedAt = isNaN(parsed.receivedAt.getTime())
        ? new Date(Number(msg.internalDate) || Date.now())
        : parsed.receivedAt;
      noteReached(ctx, receivedAt);
      const verdict = keepEmail(
        { fromEmail: parsed.fromEmail, fromName: parsed.fromName, subject: parsed.subject, text: parsed.content, currency: parsed.extractedCurrency },
        ctx.plan,
        names,
      );
      if (!verdict.keep) {
        ctx.tally.notKept++;
        // A name search that keeps nothing for a long run gives up (marked Partial).
        notKeptInARow++;
        if (shouldStopEarly(byName, notKeptInARow)) {
          ctx.reach.stoppedEarly = notKeptInARow;
          stopped = true;
          break;
        }
        continue;
      }
      notKeptInARow = 0;
      // A PDF is kept whatever the words say: every invoice file is stored.
      // (Not in a search by name, where the words must say it: a found file is
      // downloaded and stored, and nothing but the name links it to the person.)
      const hasPdf = hasPdfPart(msg.payload);
      if (
        !(hasPdf && !byName) &&
        !worthSaving({ subject: parsed.subject, text: parsed.content, amount: parsed.extractedAmount ?? null }, new Date(), { requireWording: byName })
      ) {
        ctx.tally.notPayment++;
        continue;
      }
      // A company with several subscriptions: the one whose price fits takes it.
      const here = belongsHere(ctx, parsed.extractedAmount, parsed.extractedCurrency);
      if (here !== "here") {
        if (here === "none") ctx.tally.skipped++;
        else ctx.tally.otherSubscription++;
        continue;
      }
      toSave.push({ msg, parsed, receivedAt });
    }

    const downloads = await mapWithConcurrency(toSave, ATTACHMENT_CONCURRENCY, async ({ msg }) => {
      await ctx.checkSync();
      if (!msg.payload?.parts) return null;
      const result = await withRetry(
        () => gmailService.processAttachments(gmail, msg.id, msg, ctx.userId),
        { label: `${LOG} attachments` },
      );
      return result.attachments.length > 0 ? JSON.stringify(result) : null;
    });

    for (let i = 0; i < toSave.length; i++) {
      const { msg, parsed, receivedAt } = toSave[i];
      const download = downloads[i];
      // A failure surfaces at its own place, after the ones before it are saved.
      if (!download.ok) throw download.error;
      const attachmentData = download.value;

      await saveFound(ctx, {
        userId: ctx.userId,
        gmailAccountId: account.id,
        gmailId: msg.id,
        subject: parsed.subject,
        fromEmail: parsed.fromEmail,
        fromName: parsed.fromName || null,
        receivedAt,
        content: parsed.content,
        attachmentData,
        isTransaction: parsed.isTransaction,
        extractedAmount: parsed.extractedAmount?.toString() || null,
        extractedCurrency: parsed.extractedCurrency || null,
        merchantName: parsed.merchantName || null,
        subscriptionId: ctx.sub.id,
        processed: true,
      });
    }
    if (stopped) break;
  }
  return read;
}

function hasPdfPart(part: any): boolean {
  if (!part) return false;
  if (part.filename && part.body?.attachmentId && (/pdf/i.test(part.mimeType ?? "") || /\.pdf$/i.test(part.filename))) return true;
  return Array.isArray(part.parts) && part.parts.some(hasPdfPart);
}

/** The app's non-AI reader wants a Gmail-shaped message; an Outlook one is dressed as one. */
function asGmailShaped(email: { subject: string; from: string; receivedAt: Date; body: string }) {
  return {
    payload: {
      headers: [
        { name: "Subject", value: email.subject },
        { name: "From", value: email.from },
        { name: "Date", value: email.receivedAt.toUTCString() },
      ],
      mimeType: "text/plain",
      body: { data: Buffer.from(email.body || "", "utf-8").toString("base64") },
    },
  };
}

/** Returns how many messages it read. */
async function searchOutlook(ctx: SearchContext, account: any, budget: number): Promise<number> {
  const byName = Boolean(ctx.plan.byName);
  const names = [...ctx.clues.search, ...ctx.clues.bodyOnly];
  const addresses = ctx.plan.addresses
    .filter((a) => {
      const d = registrableDomain(domainOf(a));
      return ctx.plan.owned.includes(d) || ctx.plan.shared.includes(d);
    })
    .slice(0, MAX_OUTLOOK_ADDRESSES);
  const filter = ctx.plan.byName
    ? buildOutlookNameFilter(ctx.plan.byName.clues, ctx.since)
    : addresses.length > 0 ? buildOutlookFilter(addresses, ctx.since) : null;
  if (!filter) return 0;

  const outlookService = new OutlookService();
  const parser = new EmailParser();
  let refreshToken: string = account.refreshToken;
  const onTokenRefresh = async (tokens: any) => {
    const update: any = { accessToken: tokens.access_token };
    if (tokens.refresh_token) {
      update.refreshToken = tokens.refresh_token;
      refreshToken = tokens.refresh_token;
    }
    if (tokens.expiry_date) update.tokenExpiry = new Date(tokens.expiry_date);
    await storage.updateOutlookAccount(account.id, update);
  };

  let accessToken: string = account.accessToken;
  const expiry = account.tokenExpiry ? new Date(account.tokenExpiry) : null;
  if (expiry && new Date() >= expiry) {
    const tokens = await outlookService.refreshToken(refreshToken);
    accessToken = tokens.access_token;
    await onTokenRefresh(tokens);
  }

  let found: Awaited<ReturnType<typeof outlookService.searchMessages>>;
  try {
    // By name: full text first (subject, body, sender), so a receipt that
    // names the company only in its body is found. If Graph refuses that
    // query, or it lists nothing, the old subject-only filter runs instead.
    const search = byName ? buildOutlookNameSearch(ctx.plan.byName!.clues) : null;
    found = { messages: [], accessToken };
    if (search) {
      try {
        const full = await outlookService.searchMessages(accessToken, refreshToken, filter, budget, onTokenRefresh, search);
        found = { accessToken: full.accessToken, messages: full.messages.filter((m) => withinWindow(m.internalDate, ctx.since)) };
      } catch (searchError) {
        console.warn(`${LOG} Outlook full-text name search failed, using subject search: ${describeFailure(searchError)}`);
      }
      accessToken = found.accessToken;
    }
    if (found.messages.length === 0) {
      found = await outlookService.searchMessages(accessToken, refreshToken, filter, budget, onTokenRefresh);
    }
  } catch (error) {
    // A search by name is a best effort: Graph may refuse a filter on a
    // field it cannot match, and that must not fail the whole search.
    if (!byName) throw error;
    console.warn(`${LOG} Outlook name search failed (non-fatal): ${describeFailure(error)}`);
    return 0;
  }
  accessToken = found.accessToken;
  ctx.tally.listed += found.messages.length;

  const candidates = found.messages
    .filter((m) => matchesKeywords(m.subject, m.snippet))
    .sort((a, b) => b.internalDate - a.internalDate)
    .map((m) => m.id);
  const fresh = selectNewMessageIds(candidates, ctx.stored, Number.MAX_SAFE_INTEGER);
  const ids = fresh.slice(0, budget);
  // Left unread for want of budget, or a listing cut off at its limit (five pages' worth per message of budget).
  if (fresh.length > ids.length || found.messages.length >= budget * 5) ctx.reach.truncated = true;
  for (const id of ids) ctx.stored.add(id);

  for (const id of ids) {
    const email = await outlookService.fetchFullEmail(accessToken, refreshToken, id, async (tokens) => {
      accessToken = tokens.access_token;
      await onTokenRefresh(tokens);
    });
    ctx.tally.fetched++;
    noteReached(ctx, email.receivedAt);
    const parsed = parser.parseEmail(asGmailShaped(email));
    const verdict = keepEmail(
      { fromEmail: email.fromEmail, fromName: email.fromName, subject: email.subject, text: email.body, currency: parsed.extractedCurrency },
      ctx.plan,
      names,
    );
    if (!verdict.keep) {
      ctx.tally.notKept++;
      continue;
    }
    const hasPdf = (email.attachments ?? []).some((a) => /pdf/i.test(a.mimeType) || /\.pdf$/i.test(a.filename));
    if (
      !(hasPdf && !byName) &&
      !worthSaving({ subject: email.subject, text: email.body, amount: parsed.extractedAmount ?? null }, new Date(), { requireWording: byName })
    ) {
      ctx.tally.notPayment++;
      continue;
    }
    const here = belongsHere(ctx, parsed.extractedAmount, parsed.extractedCurrency);
    if (here !== "here") {
      if (here === "none") ctx.tally.skipped++;
      else ctx.tally.otherSubscription++;
      continue;
    }
    await ctx.checkSync();

    const storedAttachments = email.attachments
      ? (await mapWithConcurrency(email.attachments, ATTACHMENT_CONCURRENCY, async (attachment) => {
          const { contentBase64, ...rest } = attachment;
          if (!contentBase64) return rest;
          const objectStoragePath = await withRetry(
            () => storeInvoiceAttachment({
              buffer: Buffer.from(contentBase64, "base64"),
              filename: rest.filename,
              mimeType: rest.mimeType,
              userId: ctx.userId,
            }),
            { label: `${LOG} attachment storage` },
          );
          return { ...rest, objectStoragePath };
        })).map((r) => {
          if (!r.ok) throw r.error;
          return r.value;
        })
      : undefined;

    await saveFound(ctx, {
      userId: ctx.userId,
      emailProvider: "outlook",
      providerAccountId: account.id,
      gmailId: email.id, // the column holds Outlook message ids too
      subject: email.subject,
      fromEmail: email.fromEmail,
      fromName: email.fromName || null,
      receivedAt: email.receivedAt,
      content: email.body,
      attachmentData: storedAttachments ? JSON.stringify({ attachments: storedAttachments }) : null,
      isTransaction: parsed.isTransaction,
      extractedAmount: parsed.extractedAmount?.toString() || null,
      extractedCurrency: parsed.extractedCurrency || null,
      merchantName: parsed.merchantName || null,
      subscriptionId: ctx.sub.id,
      processed: true,
    });
  }
  return ids.length;
}

// ---------------------------------------------------------------------------
// Bank alerts: read and discarded
// ---------------------------------------------------------------------------

/** Messages read per mailbox for bank alerts. */
const EVIDENCE_PER_MAILBOX = 60;

/**
 * For a subscription with no receipts or invoices of its own, finds the bank
 * and card alerts that name it and keeps only what they prove: that a charge
 * of this amount happened on this date.
 *
 * Verloq never stores credit card information, so the message is read in
 * memory and dropped. What is written is one payment row of kind 'card_alert'
 * with no email, no subject and no text, and a keyed one-way fingerprint of the
 * provider and message id so the same alert is not counted twice. A message
 * is used only if it is not a credit card bill, comes from a bank or card
 * issuer, names the subscription (by a company name, never a plan name) and
 * is in the subscription's currency.
 */
export async function readBankAlertEvidence(
  ctx: SearchContext,
  mailboxes: { kind: "gmail" | "outlook"; account: any }[],
): Promise<{ read: number; recorded: number }> {
  const secret = fingerprintSecret();
  const names = ctx.clues.search;
  if (!secret || names.length === 0) return { read: 0, recorded: 0 };

  const known = await storage.getEvidenceFingerprints(ctx.userId, ctx.sub.id);
  const rows: InsertPayment[] = [];
  let read = 0;
  let recorded = 0;

  const take = (provider: string, messageId: string, found: BankAlertEvidence, fingerprint: string) => {
    // A company with several subscriptions: the one whose price fits takes it.
    if (belongsHere(ctx, Number(found.amount), found.currency) !== "here") return;
    known.add(fingerprint);
    rows.push({
      userId: ctx.userId,
      subscriptionId: ctx.sub.id,
      emailId: null,
      paidAt: found.paidAt,
      amount: found.amount,
      currency: found.currency,
      kind: "card_alert",
      documentType: "other",
      paidStatus: "paid",
      source: "history",
      evidenceFingerprint: fingerprint,
    });
  };

  const subscription = { currency: ctx.sub.currency, names };
  try {
    for (const mailbox of mailboxes) {
      await ctx.checkSync();
      try {
        read += mailbox.kind === "gmail"
          ? await alertsFromGmail(ctx, mailbox.account, secret, known, subscription, take)
          : await alertsFromOutlook(ctx, mailbox.account, secret, known, subscription, take);
      } catch (error) {
        if (error instanceof SyncStarted) throw error;
        // Best effort, like a search by name.
        console.warn(`${LOG} Bank alert search failed for one mailbox (non-fatal): ${describeFailure(error)}`);
      }
    }
  } finally {
    // Whatever was found is recorded, even if a later mailbox failed or a sync started.
    recorded = await storage.insertFingerprintedPayments(rows);
  }
  return { read, recorded };
}

type TakeAlert = (provider: string, messageId: string, found: BankAlertEvidence, fingerprint: string) => void;

async function alertsFromGmail(
  ctx: SearchContext,
  account: any,
  secret: string,
  known: Set<string>,
  subscription: { currency: string | null | undefined; names: string[] },
  take: TakeAlert,
): Promise<number> {
  const query = buildBankAlertGmailQuery(subscription.names, HISTORY_DAYS);
  if (!query) return 0;
  const gmailService = new GmailService();
  const parser = new EmailParser();

  let accessToken: string = account.accessToken;
  const expiry = account.tokenExpiry ? new Date(account.tokenExpiry) : null;
  if (expiry && new Date() >= expiry) {
    const tokens = await gmailService.refreshAccessToken(account.refreshToken);
    if (!tokens.access_token) throw new PlainFailure("the mailbox needs to be reconnected");
    accessToken = tokens.access_token;
    await storage.updateGmailAccount(account.id, {
      accessToken,
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    });
  }

  const listed = await gmailService.searchMessageIds(accessToken, account.refreshToken, query, LIST_LIMIT);
  // Alerts already recorded are not read again.
  const ids = listed.filter((id) => !known.has(evidenceFingerprint(secret, "gmail", id))).slice(0, EVIDENCE_PER_MAILBOX);
  let read = 0;
  for (let i = 0; i < ids.length; i += 10) {
    await ctx.checkSync();
    let messages: any[] | null = await gmailService.getEmailsByIds(accessToken, account.refreshToken, ids.slice(i, i + 10));
    read += messages.length;
    for (const msg of messages) {
      if (!msg?.id) continue;
      const parsed = parser.parseEmail(msg);
      const date = isNaN(parsed.receivedAt.getTime()) ? new Date(Number(msg.internalDate) || NaN) : parsed.receivedAt;
      const found = bankAlertEvidence(
        { from: parsed.fromEmail, subject: parsed.subject, body: parsed.content, date },
        subscription,
      );
      if (found) take("gmail", msg.id, found, evidenceFingerprint(secret, "gmail", msg.id));
    }
    // Nothing of the messages is kept.
    messages = null;
  }
  return read;
}

async function alertsFromOutlook(
  ctx: SearchContext,
  account: any,
  secret: string,
  known: Set<string>,
  subscription: { currency: string | null | undefined; names: string[] },
  take: TakeAlert,
): Promise<number> {
  // Graph can only filter on the subject here; the sender is checked on what comes back.
  const filter = buildOutlookNameFilter(subscription.names, ctx.since);
  if (!filter) return 0;
  const outlookService = new OutlookService();
  let refreshToken: string = account.refreshToken;
  const onTokenRefresh = async (tokens: any) => {
    const update: any = { accessToken: tokens.access_token };
    if (tokens.refresh_token) {
      update.refreshToken = tokens.refresh_token;
      refreshToken = tokens.refresh_token;
    }
    if (tokens.expiry_date) update.tokenExpiry = new Date(tokens.expiry_date);
    await storage.updateOutlookAccount(account.id, update);
  };
  let accessToken: string = account.accessToken;
  const expiry = account.tokenExpiry ? new Date(account.tokenExpiry) : null;
  if (expiry && new Date() >= expiry) {
    const tokens = await outlookService.refreshToken(refreshToken);
    accessToken = tokens.access_token;
    await onTokenRefresh(tokens);
  }

  const found = await outlookService.searchMessages(accessToken, refreshToken, filter, EVIDENCE_PER_MAILBOX, onTokenRefresh);
  accessToken = found.accessToken;
  const ids = found.messages
    // From a bank or card issuer, and not a bill or statement: decided from the listing, before anything is fetched.
    .filter((m) => isBankOrCardSender(m.fromEmail) && !isCreditCardBill({ subject: m.subject, content: m.snippet }))
    .sort((a, b) => b.internalDate - a.internalDate)
    .map((m) => m.id)
    .filter((id) => !known.has(evidenceFingerprint(secret, "outlook", id)))
    .slice(0, EVIDENCE_PER_MAILBOX);
  let read = 0;
  for (const id of ids) {
    await ctx.checkSync();
    let email: Awaited<ReturnType<typeof outlookService.fetchFullEmail>> | null = await outlookService.fetchFullEmail(
      accessToken,
      refreshToken,
      id,
      async (tokens) => {
        accessToken = tokens.access_token;
        await onTokenRefresh(tokens);
      },
    );
    read++;
    const evidence = bankAlertEvidence(
      { from: email.fromEmail, subject: email.subject, body: email.body, date: email.receivedAt },
      subscription,
    );
    if (evidence) take("outlook", id, evidence, evidenceFingerprint(secret, "outlook", id));
    email = null;
  }
  return read;
}

/**
 * Payments, dated cancellations and invoices from the emails a search saved.
 * Each step is on its own: one failing does not stop the others.
 */
async function recordFinds(userId: string, sub: Subscription, saved: Email[], now: Date): Promise<void> {
  if (saved.length === 0) return;

  try {
    const sources: PaymentSourceEmail[] = saved.map((e) => ({
      id: e.id,
      subject: e.subject,
      content: e.content ? e.content.slice(0, 1500) : null,
      receivedAt: e.receivedAt,
      extractedAmount: e.extractedAmount,
      extractedCurrency: e.extractedCurrency,
      // The PDFs' words help read a payment whose subject and body are unclear.
      attachmentText: attachmentTextOf(e.attachmentData),
    }));
    const rows = paymentsFromEmails(userId, { id: sub.id, currency: sub.currency }, sources, "history", now);
    const recorded = await storage.insertPayments(rows);
    console.log(`${LOG} "${sub.serviceName}": ${recorded} payment(s) recorded`);
  } catch (error) {
    console.error(`${LOG} Could not record payments (non-fatal):`, describeFailure(error));
  }

  try {
    let current: { cancelledAt: string | null; endsOn: string | null } = {
      cancelledAt: sub.cancelledAt,
      endsOn: sub.endsOn,
    };
    const oldestFirst = [...saved].sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
    for (const email of oldestFirst) {
      // Only emails the rules do not read as a payment: a receipt's small
      // print ("if you cancel, it will not renew and ends on ...") is not a
      // cancellation.
      if (classifyPaymentEmail({ subject: email.subject, content: email.content, amount: email.extractedAmount, attachmentText: attachmentTextOf(email.attachmentData) }, now)) continue;
      const found = datedCancellation({ subject: email.subject, text: email.content }, now);
      if (!found) continue;
      await applyCancellation(userId, sub.id, current, found.cancelledOn, found.accessEndsOn);
      const incoming = found.cancelledOn ?? found.accessEndsOn!;
      const existing = current.cancelledAt ?? current.endsOn;
      if (!existing || incoming >= existing) current = { cancelledAt: found.cancelledOn, endsOn: found.accessEndsOn };
    }
  } catch (error) {
    console.error(`${LOG} Could not record a cancellation (non-fatal):`, describeFailure(error));
  }

  try {
    const made = await storage.fileInvoicesForEmails(userId, sub, saved.map((e) => e.id));
    if (made.created > 0) console.log(`${LOG} "${sub.serviceName}": ${made.created} invoice(s) filed`);
  } catch (error) {
    console.error(`${LOG} Could not file invoices (non-fatal):`, describeFailure(error));
  }
}

/** For tests and the admin console: is a worker running for this user in this process? */
export function isWorkerRunning(userId: string): boolean {
  return workers.has(userId);
}
