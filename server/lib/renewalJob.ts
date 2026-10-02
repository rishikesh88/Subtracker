/**
 * The daily renewal job, with all input and output injected so it runs offline
 * in tests (npm run test:renewal). server/services/renewalChecks.ts supplies
 * the real database, mailbox search and email.
 *
 * Per person, in order: (A) refresh status, no email read; (B) the narrow
 * checks that are due; (C) the reconnect reminder, if a mailbox is flagged.
 * People are handled one after another with small pauses, and nothing a
 * person's turn throws leaves this function.
 */

import {
  mailboxKey,
  planUserChecks,
  shouldSendReconnectEmail,
  stateAfter,
  type CheckCandidate,
  type CheckOutcome,
  type CheckState,
  type MailboxRef,
} from "./renewalChecks";

const LOG = "[Renewal]";

export interface CheckResult {
  kind: "found" | "miss" | "deferred" | "unavailable";
  /** Mailboxes whose access turned out to be expired during this check. */
  reconnect: MailboxRef[];
}

export interface FlaggedMailbox extends MailboxRef {
  address: string;
}

export interface ReminderIo {
  /** The person's mailboxes currently flagged needs_reconnect. */
  flaggedMailboxes(userId: string): Promise<FlaggedMailbox[]>;
  lastSentAt(userId: string): Promise<Date | null>;
  /** Builds and sends; true only if it went out. Never throws. */
  send(userId: string, mailboxes: FlaggedMailbox[], now: Date): Promise<boolean | "nothing_to_say">;
  markSent(userId: string, now: Date): Promise<void>;
}

export interface JobDeps {
  now(): Date;
  sleep(ms: number): Promise<void>;
  /** Atomically claim today's run; false when it already ran (or is running). */
  claim(today: string, now: Date): Promise<boolean>;
  finish(stats: RunStats): Promise<void>;
  listUserIds(): Promise<string[]>;
  statusEnabled(userId: string): Promise<boolean>;
  refreshStatus(userId: string, now: Date): Promise<void>;
  loadChecks(userId: string): Promise<{ candidates: CheckCandidate[]; states: CheckState[]; flagged: Set<string> }>;
  /** True while something else (a history search) is working on this person. */
  userBusy(userId: string): boolean;
  runCheck(userId: string, candidate: CheckCandidate, since: Date, now: Date): Promise<CheckResult>;
  saveState(userId: string, state: CheckState): Promise<void>;
  markReconnect(userId: string, mailbox: MailboxRef): Promise<void>;
  reminder: ReminderIo;
}

export interface RunStats {
  users: number;
  checked: number;
  found: number;
  failures: number;
  reconnectMarked: number;
  emailsSent: number;
}

export interface JobOptions {
  today: string;
  limitPerUser: number;
  userPauseMs?: number;
  checkPauseMs?: number;
}

const emptyStats = (): RunStats => ({ users: 0, checked: 0, found: 0, failures: 0, reconnectMarked: 0, emailsSent: 0 });

function describe(error: unknown): string {
  const e = error as any;
  return String(e?.message ?? error).slice(0, 300);
}

/** Returns the run's stats, or null when today's run was already taken. Never throws. */
export async function runRenewalJob(deps: JobDeps, options: JobOptions): Promise<RunStats | null> {
  const stats = emptyStats();
  const userPause = options.userPauseMs ?? 500;
  const checkPause = options.checkPauseMs ?? 1000;
  try {
    const now = deps.now();
    if (!(await deps.claim(options.today, now))) {
      console.log(`${LOG} Today's run (${options.today}) was already taken; nothing to do`);
      return null;
    }
    console.log(`${LOG} Daily run ${options.today} starting`);

    let userIds: string[] = [];
    try {
      userIds = await deps.listUserIds();
    } catch (error) {
      console.error(`${LOG} Could not list people: ${describe(error)}`);
    }

    for (const userId of userIds) {
      try {
        if (!(await deps.statusEnabled(userId))) continue;
        stats.users++;
        await processUser(deps, userId, options, stats, checkPause);
      } catch (error) {
        stats.failures++;
        console.error(`${LOG} A person's turn failed (others go on): ${describe(error)}`);
      }
      await safeSleep(deps, userPause);
    }

    try {
      await deps.finish(stats);
    } catch (error) {
      console.error(`${LOG} Could not record the run's result: ${describe(error)}`);
    }
    console.log(
      `${LOG} Daily run done: ${stats.users} people, ${stats.checked} checked, ${stats.found} payment(s) found, ` +
      `${stats.failures} failure(s), ${stats.reconnectMarked} mailbox(es) flagged, ${stats.emailsSent} email(s)`,
    );
    return stats;
  } catch (error) {
    console.error(`${LOG} The daily run failed: ${describe(error)}`);
    return stats;
  }
}

async function safeSleep(deps: JobDeps, ms: number): Promise<void> {
  try {
    if (ms > 0) await deps.sleep(ms);
  } catch {
    /* a pause never fails a run */
  }
}

async function processUser(deps: JobDeps, userId: string, options: JobOptions, stats: RunStats, checkPause: number): Promise<void> {
  const now = deps.now();

  // A. Status, so "Needs review" appears on time. No email is read.
  try {
    await deps.refreshStatus(userId, now);
  } catch (error) {
    stats.failures++;
    console.error(`${LOG} Status refresh failed for one person: ${describe(error)}`);
  }

  // B. The narrow checks that are due.
  try {
    await runChecks(deps, userId, options, stats, checkPause);
  } catch (error) {
    stats.failures++;
    console.error(`${LOG} Checks failed for one person: ${describe(error)}`);
  }

  // C. The reminder, for a mailbox that is still not reconnected.
  try {
    if (await remindIfNeeded(userId, deps.reminder, deps.now())) stats.emailsSent++;
  } catch (error) {
    console.error(`${LOG} Reconnect reminder failed for one person: ${describe(error)}`);
  }
}

async function runChecks(deps: JobDeps, userId: string, options: JobOptions, stats: RunStats, checkPause: number): Promise<void> {
  if (deps.userBusy(userId)) {
    console.log(`${LOG} A history search is running for one person; their checks wait for tomorrow`);
    return;
  }
  const loaded = await deps.loadChecks(userId);
  const flagged = new Set(loaded.flagged);
  const plan = planUserChecks(loaded.candidates, loaded.states, flagged, options.today, options.limitPerUser);
  if (plan.overLimit > 0) console.log(`${LOG} ${plan.overLimit} check(s) over the daily limit wait for tomorrow`);
  const statesById = new Map(loaded.states.map((s) => [s.subscriptionId, s]));

  for (const check of plan.checks) {
    const mailbox = check.candidate.mailbox;
    // Flagged earlier in this same turn.
    if (mailbox && flagged.has(mailboxKey(mailbox))) continue;

    let outcome: CheckOutcome;
    try {
      const result = await deps.runCheck(userId, check.candidate, check.since, deps.now());
      for (const m of result.reconnect) {
        if (flagged.has(mailboxKey(m))) continue;
        flagged.add(mailboxKey(m));
        try {
          await deps.markReconnect(userId, m);
          stats.reconnectMarked++;
          console.log(`${LOG} A ${m.provider} mailbox needs reconnecting; checks for it stop until it is reconnected`);
        } catch (error) {
          console.error(`${LOG} Could not flag a mailbox: ${describe(error)}`);
        }
      }
      if (result.kind === "deferred") {
        console.log(`${LOG} A sync is running for one person; their remaining checks wait for tomorrow`);
        return;
      }
      // Could not search at all: not an attempt, nothing stored.
      if (result.kind === "unavailable") continue;
      outcome = { kind: result.kind };
      stats.checked++;
      if (result.kind === "found") stats.found++;
    } catch (error) {
      outcome = { kind: "error" };
      stats.failures++;
      console.error(`${LOG} A check failed (will be tried again): ${describe(error)}`);
    }

    try {
      const next = stateAfter(statesById.get(check.candidate.id) ?? null, check.candidate, check.renewalOn, outcome, options.today);
      statesById.set(check.candidate.id, next);
      await deps.saveState(userId, next);
    } catch (error) {
      console.error(`${LOG} Could not save a check's state: ${describe(error)}`);
    }
    await safeSleep(deps, checkPause);
  }
}

/**
 * Sends the reconnect email if any of the person's mailboxes is flagged and
 * none was sent in the last 7 days. True when one went out.
 */
export async function remindIfNeeded(userId: string, io: ReminderIo, now: Date): Promise<boolean> {
  const mailboxes = await io.flaggedMailboxes(userId);
  if (mailboxes.length === 0) return false;
  if (!shouldSendReconnectEmail(await io.lastSentAt(userId), now)) return false;
  const sent = await io.send(userId, mailboxes, now);
  if (sent !== true) return false;
  await io.markSent(userId, now);
  return true;
}
