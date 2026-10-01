/**
 * Renewal-based background checks: the decisions, with no database, no
 * network and no clock of their own, so every rule here is tested offline
 * (npm run test:renewal).
 *
 * Only for people with the `subscription_status` switch on; the job that uses
 * these (server/services/renewalChecks.ts) checks the switch itself.
 *
 * What a check is: once a subscription's expected renewal has passed by a few
 * days with no payment recorded, look for that one payment in the person's
 * mailbox, with a short window instead of twelve months. Not found: look
 * again a week later, and a week after that (weekly subscriptions: once more,
 * four days later), then stop and leave it to the normal status rules.
 */

import { addPeriods, dayString, graceEnd, normaliseFrequency, toDay } from "./statusRules";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A renewal is checked once it is this many days past. */
export const DUE_AFTER_DAYS: Record<"weekly" | "monthly" | "quarterly" | "yearly", number> = {
  weekly: 2,
  monthly: 3,
  quarterly: 3,
  yearly: 3,
};

/** Days after the FIRST attempt of a renewal at which it is tried again. */
export const RETRY_OFFSETS: Record<"weekly" | "monthly" | "quarterly" | "yearly", number[]> = {
  weekly: [4],
  monthly: [7, 14],
  quarterly: [7, 14],
  yearly: [7, 14],
};

/** After this many errored attempts at one renewal, it is left alone. */
export const MAX_ERRORS_PER_CYCLE = 3;

/** The window starts this many days before the last payment... */
export const SINCE_BEFORE_LAST_PAYMENT_DAYS = 3;
/** ... or this many days before the renewal date when there is no payment. */
export const SINCE_BEFORE_RENEWAL_DAYS = 7;

/** One reminder email per person per this many days. */
export const REMINDER_EVERY_DAYS = 7;

/** A run that started and never finished is taken over after this long. */
export const STALE_RUN_MS = 3 * 60 * 60 * 1000;

export const DEFAULT_CHECKS_PER_USER_PER_DAY = 10;

/** Checks per person per day: RENEWAL_CHECKS_PER_USER_PER_DAY, a whole number from 1 to 100, default 10. */
export function checksPerUserPerDay(env: Record<string, string | undefined> = process.env): number {
  const n = Number((env.RENEWAL_CHECKS_PER_USER_PER_DAY ?? "").trim());
  if (!Number.isInteger(n) || n < 1) return DEFAULT_CHECKS_PER_USER_PER_DAY;
  return Math.min(n, 100);
}

/** RENEWAL_CHECKS_ENABLED: on unless set to 0, false, off or no. */
export function renewalChecksEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.RENEWAL_CHECKS_ENABLED ?? "").trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(v);
}

// ---------------------------------------------------------------------------
// Mailboxes
// ---------------------------------------------------------------------------

export type Provider = "gmail" | "outlook";
export interface MailboxRef {
  provider: Provider;
  id: string;
}

export function mailboxKey(m: MailboxRef): string {
  return `${m.provider}:${m.id}`;
}

/** Thrown inside a search when named mailboxes need reconnecting. */
export class ReconnectNeeded extends Error {
  constructor(public readonly mailboxes: MailboxRef[]) {
    super("the mailbox needs to be reconnected");
  }
}

/**
 * A search failure that means "this mailbox's access has expired": the
 * app's own plain-words failure, a refused token refresh (invalid_grant), or a
 * 401. Anything else (a timeout, a 500, a rate limit) is not.
 */
export function isReconnectError(error: unknown): boolean {
  if (error instanceof ReconnectNeeded) return true;
  const e = error as any;
  if (!e) return false;
  const message = String(e.message ?? error);
  if (/needs to be reconnected/i.test(message)) return true;
  if (/invalid_grant/i.test(message)) return true;
  // Microsoft: the refresh token expired, was revoked, or the password changed.
  if (/AADSTS(70000|70008|700082|50173|50076|65001)/i.test(message)) return true;
  if (/Token refresh failed: (400|401)\b/i.test(message)) return true;
  const status = e.status ?? e.code ?? e.response?.status;
  if (status === 401 || status === "401") return true;
  if (e.response?.data?.error === "invalid_grant") return true;
  return false;
}

// ---------------------------------------------------------------------------
// Which subscriptions are due
// ---------------------------------------------------------------------------

type DayInput = string | Date | null | undefined;

export interface CheckCandidate {
  id: string;
  frequency: string;
  /** subscriptions.status: active, cancelled, expiring_soon. */
  status: string | null;
  lifecycleStatus: string | null;
  cancelledAt: DayInput;
  endsOn: DayInput;
  expectedNextPaymentAt: DayInput;
  /** The renewal date the rest of the app uses, for one with no payment yet. */
  nextBillingDate: DayInput;
  lastPaymentAt: DayInput;
  /** The mailbox it was found in; null for a manual subscription or a mailbox that no longer exists. */
  mailbox: MailboxRef | null;
}

export interface CheckState {
  subscriptionId: string;
  /** The renewal date this state is about; a different one is a new cycle. */
  cycleRenewalOn: string | null;
  /** Attempts that searched, in this cycle. */
  attempts: number;
  firstAttemptOn: string | null;
  lastCheckedOn: string | null;
  /** Null once retries are used up (or errors gave up). */
  nextCheckOn: string | null;
  errorCount: number;
}

export type SkipReason =
  | "inactive"
  | "no_mailbox"
  | "mailbox_needs_reconnect"
  | "no_renewal_date"
  | "not_yet"
  | "past_grace"
  | "already_checked_today"
  | "waiting_retry"
  | "retries_done";

export function isStopped(c: CheckCandidate): boolean {
  if (c.lifecycleStatus === "inactive") return true;
  if (["cancelled", "canceled", "ended", "inactive", "expired"].includes((c.status ?? "").toLowerCase())) return true;
  // Cancelled, or access ends on a date: it will not renew.
  return Boolean(toDay(c.cancelledAt) || toDay(c.endsOn));
}

/** The renewal date as 'YYYY-MM-DD': expected next payment, else the stored renewal date. */
export function renewalDay(c: CheckCandidate): string | null {
  return dayString(c.expectedNextPaymentAt) ?? dayString(c.nextBillingDate);
}

/** Start of the short search window. */
export function windowSince(c: CheckCandidate): Date | null {
  const last = toDay(c.lastPaymentAt);
  if (last) return new Date(last.getTime() - SINCE_BEFORE_LAST_PAYMENT_DAYS * DAY_MS);
  const renewal = toDay(renewalDay(c));
  return renewal ? new Date(renewal.getTime() - SINCE_BEFORE_RENEWAL_DAYS * DAY_MS) : null;
}

/** Whole days from `since` to `now`, rounded up, at least 1: the `newer_than:Nd` of a Gmail query. */
export function windowDays(since: Date, now: Date): number {
  return Math.max(1, Math.ceil((now.getTime() - since.getTime()) / DAY_MS));
}

export type Decision =
  | { due: true; renewalOn: string; since: Date; attemptNo: number }
  | { due: false; reason: SkipReason };

export function decideCheck(
  c: CheckCandidate,
  state: CheckState | null,
  today: string,
  flagged: ReadonlySet<string>,
): Decision {
  if (isStopped(c)) return { due: false, reason: "inactive" };
  if (!c.mailbox) return { due: false, reason: "no_mailbox" };
  if (flagged.has(mailboxKey(c.mailbox))) return { due: false, reason: "mailbox_needs_reconnect" };
  const renewalOn = renewalDay(c);
  const since = windowSince(c);
  if (!renewalOn || !since) return { due: false, reason: "no_renewal_date" };

  const renewal = toDay(renewalOn)!;
  const todayDay = toDay(today)!;
  // Once the grace period has run out the normal status rules decide.
  const lastEquivalent = addPeriods(renewal, c.frequency, -1);
  if (todayDay.getTime() > graceEnd(lastEquivalent, c.frequency).getTime()) return { due: false, reason: "past_grace" };

  if (state !== null && state.cycleRenewalOn === renewalOn) {
    if (state.lastCheckedOn === today) return { due: false, reason: "already_checked_today" };
    if (state.nextCheckOn === null) return { due: false, reason: "retries_done" };
    if (state.nextCheckOn > today) return { due: false, reason: "waiting_retry" };
    return { due: true, renewalOn, since, attemptNo: state.attempts + 1 };
  }

  const waitDays = DUE_AFTER_DAYS[normaliseFrequency(c.frequency)];
  if (todayDay.getTime() < renewal.getTime() + waitDays * DAY_MS) return { due: false, reason: "not_yet" };
  return { due: true, renewalOn, since, attemptNo: 1 };
}

export interface PlannedCheck {
  candidate: CheckCandidate;
  renewalOn: string;
  since: Date;
  attemptNo: number;
}

export interface UserPlan {
  checks: PlannedCheck[];
  /** Checks already made today (all runs), counted against the limit. */
  doneToday: number;
  /** Due, but over the day's limit. */
  overLimit: number;
  skipped: Partial<Record<SkipReason, number>>;
}

/** The checks to make for one person today: due ones, oldest renewal first, up to what is left of the day's limit. */
export function planUserChecks(
  candidates: CheckCandidate[],
  states: CheckState[],
  flagged: ReadonlySet<string>,
  today: string,
  limit: number = DEFAULT_CHECKS_PER_USER_PER_DAY,
): UserPlan {
  const byId = new Map(states.map((s) => [s.subscriptionId, s]));
  const due: PlannedCheck[] = [];
  const skipped: Partial<Record<SkipReason, number>> = {};
  for (const candidate of candidates) {
    const decision = decideCheck(candidate, byId.get(candidate.id) ?? null, today, flagged);
    if (decision.due) due.push({ candidate, renewalOn: decision.renewalOn, since: decision.since, attemptNo: decision.attemptNo });
    else skipped[decision.reason] = (skipped[decision.reason] ?? 0) + 1;
  }
  due.sort((a, b) => a.renewalOn.localeCompare(b.renewalOn) || a.candidate.id.localeCompare(b.candidate.id));
  const doneToday = states.filter((s) => s.lastCheckedOn === today).length;
  const room = Math.max(0, limit - doneToday);
  return { checks: due.slice(0, room), doneToday, overLimit: Math.max(0, due.length - room), skipped };
}

// ---------------------------------------------------------------------------
// Retry schedule
// ---------------------------------------------------------------------------

function addDaysTo(day: string, n: number): string {
  return dayString(new Date(toDay(day)!.getTime() + n * DAY_MS))!;
}

/** The day of the next try after `attempts` unsuccessful attempts, or null when there are no more. */
export function nextRetryDay(frequency: string, attempts: number, firstAttemptOn: string): string | null {
  const offsets = RETRY_OFFSETS[normaliseFrequency(frequency)];
  return attempts >= 1 && attempts - 1 < offsets.length ? addDaysTo(firstAttemptOn, offsets[attempts - 1]) : null;
}

export type CheckOutcome = { kind: "found" } | { kind: "miss" } | { kind: "error" };

/** The state to store after an attempt made on `today`. */
export function stateAfter(
  prev: CheckState | null,
  c: CheckCandidate,
  renewalOn: string,
  outcome: CheckOutcome,
  today: string,
): CheckState {
  const fresh = !prev || prev.cycleRenewalOn !== renewalOn;
  const base = fresh
    ? { attempts: 0, firstAttemptOn: null as string | null, errorCount: 0 }
    : { attempts: prev!.attempts, firstAttemptOn: prev!.firstAttemptOn, errorCount: prev!.errorCount };
  const common = { subscriptionId: c.id, cycleRenewalOn: renewalOn, lastCheckedOn: today };

  if (outcome.kind === "error") {
    const errorCount = base.errorCount + 1;
    return {
      ...common,
      attempts: base.attempts,
      firstAttemptOn: base.firstAttemptOn,
      errorCount,
      // Tomorrow, unless it keeps failing.
      nextCheckOn: errorCount >= MAX_ERRORS_PER_CYCLE ? null : addDaysTo(today, 1),
    };
  }
  const attempts = base.attempts + 1;
  const firstAttemptOn = base.firstAttemptOn ?? today;
  return {
    ...common,
    attempts,
    firstAttemptOn,
    errorCount: base.errorCount,
    nextCheckOn: outcome.kind === "found" ? null : nextRetryDay(c.frequency, attempts, firstAttemptOn),
  };
}

// ---------------------------------------------------------------------------
// No double run
// ---------------------------------------------------------------------------

export interface RunRow {
  lastRunDay: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/**
 * May a run for `today` start? Once per day: not if today already has a run,
 * unless that run started long ago and never finished (the process died), so
 * a restart mid-run finishes the day's work. Per-subscription state makes the
 * resumed run skip what was already checked today. The database applies the
 * same rule in one atomic statement (storage.claimRenewalRun).
 */
export function decideClaim(row: RunRow | null, today: string, now: Date): boolean {
  if (!row || !row.lastRunDay || row.lastRunDay < today) return true;
  if (row.lastRunDay > today) return false;
  return !row.finishedAt && row.startedAt !== null && now.getTime() - row.startedAt.getTime() >= STALE_RUN_MS;
}

// ---------------------------------------------------------------------------
// Reminder email rate limit
// ---------------------------------------------------------------------------

/** At most one reconnect email per person per 7 days. */
export function shouldSendReconnectEmail(lastSentAt: Date | null, now: Date): boolean {
  if (!lastSentAt || isNaN(lastSentAt.getTime())) return true;
  return now.getTime() - lastSentAt.getTime() >= REMINDER_EVERY_DAYS * DAY_MS;
}
