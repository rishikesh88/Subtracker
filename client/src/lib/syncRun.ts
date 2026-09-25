/**
 * What the sync window shows, worked out from the server's progress events.
 *
 * Kept apart from the component so the rules can be tested on their own:
 * events arrive per mailbox, out of order across mailboxes, and a browser
 * that reconnects mid-sync is sent only the latest one. Every count is
 * therefore taken from the newest event of each mailbox and added up, and
 * a step never goes back once it is done.
 */

export interface ProgressEvent {
  type?: string;
  stage?: string;
  progress?: number;
  message?: string;
  details?: Record<string, unknown> | null;
}

interface MailboxFacts {
  step: number;
  totalEmails?: number;
  emailsProcessed?: number;
  candidateEmails?: number;
  keptEmails?: number;
  emailsChecked?: number;
  emailsToCheck?: number;
  foundSoFar?: number;
  foundNames?: string[];
}

export interface SyncRun {
  phase: "running" | "done" | "failed";
  /** 0-100, never going backwards within a run. */
  progress: number;
  /** How many mailboxes this run reads, once the server has said. */
  mailboxCount: number | null;
  mailboxes: Record<string, MailboxFacts>;
  /** Mailboxes the server has reported finished. */
  mailboxesDone: number;
  errorMessage: string | null;
  /** From the finishing event: what this run added, and any mailbox it lost. */
  suggestionsGenerated: number | null;
  failedMailboxes: number;
  finalMessage: string | null;
}

export const STEP_COUNT = 4;

/** Which checklist step a server stage belongs to. */
const STAGE_STEP: Record<string, number> = {
  metadata: 0,
  prefilter: 1,
  fetch_full: 2,
  analysis: 2,
};

export function newRun(): SyncRun {
  return { phase: "running", progress: 0, mailboxCount: null, mailboxes: {}, mailboxesDone: 0, errorMessage: null, suggestionsGenerated: null, failedMailboxes: 0, finalMessage: null };
}

/** Finished without the final event, which a dropped connection can lose. */
export function finishQuietly(run: SyncRun): SyncRun {
  return run.phase === "running" ? { ...run, phase: "done", progress: 100 } : run;
}

export function isFinalEvent(event: ProgressEvent): boolean {
  return event.stage === "sync_complete" || event.stage === "error";
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function applyEvent(run: SyncRun, event: ProgressEvent): SyncRun {
  if (event.type && event.type !== "progress") return run;
  if (run.phase !== "running") return run;

  const details = event.details ?? {};
  const next: SyncRun = {
    ...run,
    progress: Math.max(run.progress, Math.min(100, num(event.progress) ?? 0)),
    mailboxes: { ...run.mailboxes },
  };

  if (event.stage === "error") {
    return { ...next, phase: "failed", errorMessage: event.message || "The sync stopped before it finished." };
  }
  if (event.stage === "sync_complete") {
    return {
      ...next,
      phase: "done",
      progress: 100,
      suggestionsGenerated: num(details.suggestionsGenerated) ?? null,
      failedMailboxes: num(details.failed) ?? 0,
      finalMessage: event.message || null,
    };
  }
  if (event.stage === "multi_account_sync_start") {
    return { ...next, mailboxCount: num(details.totalAccounts) ?? next.mailboxCount };
  }
  if (event.stage === "accounts_syncing") {
    return {
      ...next,
      mailboxCount: num(details.total) ?? next.mailboxCount,
      mailboxesDone: Math.max(next.mailboxesDone, num(details.completed) ?? 0),
    };
  }

  const step = event.stage ? STAGE_STEP[event.stage] : undefined;
  const account = typeof details.account === "string" ? details.account : "";
  if (step === undefined) return next;

  const before = next.mailboxes[account] ?? { step: 0 };
  const facts: MailboxFacts = { ...before, step: Math.max(before.step, step) };
  for (const key of ["totalEmails", "emailsProcessed", "candidateEmails", "keptEmails", "emailsChecked", "emailsToCheck", "foundSoFar"] as const) {
    const value = num(details[key]);
    if (value !== undefined) facts[key] = value;
  }
  if (Array.isArray(details.foundNames)) facts.foundNames = details.foundNames.filter((n): n is string => typeof n === "string");

  // Every email read: what is left is putting the list together.
  if (facts.step === 2 && facts.emailsToCheck !== undefined && facts.emailsChecked !== undefined && facts.emailsChecked >= facts.emailsToCheck) {
    facts.step = 3;
  }
  next.mailboxes[account] = facts;
  return next;
}

export interface RunTotals {
  totalEmails?: number;
  emailsProcessed?: number;
  candidateEmails?: number;
  keptEmails?: number;
  emailsChecked?: number;
  emailsToCheck?: number;
  foundSoFar: number;
  foundNames: string[];
}

function sum(all: MailboxFacts[], key: keyof Omit<MailboxFacts, "foundNames" | "step">): number | undefined {
  const values = all.map((m) => m[key]).filter((v): v is number => v !== undefined);
  return values.length ? values.reduce((a, b) => a + b, 0) : undefined;
}

export function totals(run: SyncRun): RunTotals {
  const all = Object.values(run.mailboxes);
  return {
    totalEmails: sum(all, "totalEmails"),
    emailsProcessed: sum(all, "emailsProcessed"),
    candidateEmails: sum(all, "candidateEmails"),
    keptEmails: sum(all, "keptEmails"),
    emailsChecked: sum(all, "emailsChecked"),
    emailsToCheck: sum(all, "emailsToCheck"),
    foundSoFar: sum(all, "foundSoFar") ?? 0,
    foundNames: all.flatMap((m) => m.foundNames ?? []).slice(0, 4),
  };
}

/** The step in progress: the slowest mailbox's, since the list waits for all of them. */
export function currentStep(run: SyncRun): number {
  if (run.phase === "done") return STEP_COUNT;
  const all = Object.values(run.mailboxes);
  if (all.length === 0) return 0;
  const count = run.mailboxCount ?? all.length;
  if (run.mailboxesDone >= count) return 3;
  // A mailbox that has not reported yet has not started.
  const slowest = all.length < count ? 0 : Math.min(...all.map((m) => m.step));
  return slowest;
}

export interface Step {
  title: string;
  detail: string;
  state: "done" | "active" | "waiting";
  /** For the step that reads receipts: how far through it is. */
  fraction?: number;
}

const n = (value: number) => value.toLocaleString("en-US");
const plural = (count: number, one: string, many: string) => `${n(count)} ${count === 1 ? one : many}`;

export function steps(run: SyncRun, context: { syncDays: number; currency: string }): Step[] {
  const at = currentStep(run);
  const t = totals(run);
  const state = (index: number): Step["state"] => (index < at ? "done" : index === at ? "active" : "waiting");

  const read: Step = {
    title: "Reading your inbox",
    state: state(0),
    detail:
      state(0) === "done" && t.totalEmails !== undefined
        ? `${plural(t.totalEmails, "email", "emails")} from the last ${context.syncDays} days`
        : t.totalEmails !== undefined && t.emailsProcessed !== undefined
          ? `Scanned ${n(t.emailsProcessed)} of ${n(t.totalEmails)} emails`
          : `Looking through the last ${context.syncDays} days`,
  };

  const pick: Step = {
    title: "Picking out billing emails",
    state: state(1),
    detail:
      state(1) === "done" && t.keptEmails !== undefined
        ? `${n(t.keptEmails)} look like receipts, invoices or renewals`
        : state(1) === "active" && t.candidateEmails !== undefined
          ? `Checking ${plural(t.candidateEmails, "possible billing email", "possible billing emails")}`
          : "Receipts, invoices and renewals",
  };

  const receipts: Step = {
    title: "Reading receipts",
    state: state(2),
    detail:
      state(2) === "done"
        ? t.emailsToCheck
          ? `Read ${plural(t.emailsToCheck, "billing email", "billing emails")}`
          : "No billing emails to read"
        : state(2) === "active" && t.emailsToCheck !== undefined
          ? `Checked ${n(t.emailsChecked ?? 0)} of ${n(t.emailsToCheck)}`
          : state(2) === "active"
            ? "Opening the billing emails"
            : "Working out what you pay for",
    fraction:
      state(2) === "active" && t.emailsToCheck ? Math.min(1, (t.emailsChecked ?? 0) / t.emailsToCheck) : undefined,
  };

  const build: Step = {
    title: "Building your list",
    state: state(3),
    detail: `Duplicates merged, amounts in ${context.currency}`,
  };

  return [read, pick, receipts, build];
}

/** The one line the small popup has room for. */
export function shortStatus(run: SyncRun): string {
  const at = currentStep(run);
  const t = totals(run);
  if (at === 0) return t.totalEmails !== undefined && t.emailsProcessed !== undefined
    ? `Reading your inbox · ${n(t.emailsProcessed)} of ${n(t.totalEmails)}`
    : "Reading your inbox";
  if (at === 1) return "Picking out billing emails";
  if (at === 2) return t.emailsToCheck !== undefined
    ? `Reading receipts · ${n(t.emailsChecked ?? 0)} of ${n(t.emailsToCheck)}`
    : "Reading receipts";
  return "Building your list";
}
