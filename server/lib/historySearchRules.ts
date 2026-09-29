/**
 * History search: the rules, with no database, no mailbox and no clock of
 * their own, so every one can be checked by historySearchRules.test.ts.
 *
 * The worker (server/services/historySearch.ts) gathers the inputs, talks to
 * Gmail and Outlook and stores what it finds; the decisions are made here:
 *
 * - which sending domains to search for a subscription, and which of them are
 *   shared by many products (Apple, Google, Amazon, PayPal), where an email
 *   only counts when it names the subscription;
 * - the Gmail query and the Outlook filter;
 * - which messages are new, and the per-subscription cap;
 * - a cancellation date, but only one the email states outright;
 * - what happens after an attempt: done, try again later, or failed.
 *
 * No model is asked anything, anywhere in this search.
 */

import { isIntermediary } from "./evidence";
import { classifyPaymentEmail, parseLooseDay } from "./statusRules";

/** How far back the search reaches. */
export const HISTORY_DAYS = 365;
/** At most this many new messages are read for one subscription, across all mailboxes. */
export const MAX_MESSAGES_PER_SUBSCRIPTION = 60;
/** A failed attempt is tried again this many times before the row reads 'failed'. */
export const MAX_RETRIES = 3;
/** The wait between one failed attempt starting and the next one. */
export const RETRY_DELAY_MS = 20 * 60 * 1000;
/** A row left 'running' this long by a previous process is picked up again. */
export const STALE_RUNNING_MS = 15 * 60 * 1000;
/** While the person's sync is running the worker checks back this often. */
export const SYNC_POLL_MS = 30 * 1000;

export const HISTORY_KEYWORDS = [
  "receipt", "invoice", "payment", "renewal", "charged", "billing", "subscription", "cancel", "cancelled",
] as const;

const KEYWORD_RE = /\b(receipt|invoice|payment|renewal|renew(ed|s)?|charged|billing|bill|subscription|cancel(l)?(ed|ation)?)\b/i;

export const NOTE_ADDED_BY_HAND = "added by hand";
export const NOTE_NO_SENDER = "no sender to search";
export const NOTE_NAME_TOO_GENERIC = "only a shared sender and the name is too short to match";

// ---------------------------------------------------------------------------
// Senders
// ---------------------------------------------------------------------------

/** The part after the @, lowercased; '' when there is none. */
export function domainOf(address: string | null | undefined): string {
  const a = (address ?? "").trim().toLowerCase();
  const at = a.lastIndexOf("@");
  if (at < 0) return "";
  return a.slice(at + 1).replace(/[>\s].*$/, "");
}

const SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "ac", "edu"]);

/**
 * The domain a brand registered: "mailer.netflix.com" -> "netflix.com",
 * "email.amazon.co.uk" -> "amazon.co.uk". Gmail's from: matches subdomains
 * of what it is given, so this is what the query names.
 */
export function registrableDomain(domain: string): string {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const take = tld.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/**
 * Senders that bill for many different products, so a receipt from them is
 * only about this subscription when it says so.
 */
export function isSharedSender(domain: string): boolean {
  const d = domain.toLowerCase();
  if (/(^|\.)(apple|itunes|google)\.com$/.test(d)) return true;
  if (/(^|\.)amazon\.[a-z.]+$/.test(d)) return true;
  if (/(^|\.)paypal\.[a-z.]+$/.test(d)) return true;
  return false;
}

export interface SenderPlan {
  /** Brand domains, searched as they are. */
  owned: string[];
  /** Shared domains, searched but kept only when the email names the subscription. */
  shared: string[];
  /** Exact addresses seen, for Outlook, whose filter cannot match a domain. */
  addresses: string[];
}

/**
 * The domains to search for one subscription, from the senders of the emails
 * already linked to it (and its merchant address). Banks, card issuers,
 * payment processors and mail relays are dropped -- they carry every
 * company's charges, so searching them would pull in the person's whole
 * card history -- except PayPal, which is a shared sender in its own right.
 * Most-seen first.
 */
export function planSenders(fromEmails: (string | null | undefined)[]): SenderPlan {
  const counts = new Map<string, number>();
  const addresses: string[] = [];
  for (const raw of fromEmails) {
    const domain = domainOf(raw);
    if (!domain) continue;
    const address = (raw ?? "").trim().toLowerCase();
    if (isIntermediary(address) && !isSharedSender(domain)) continue;
    const base = registrableDomain(domain);
    counts.set(base, (counts.get(base) ?? 0) + 1);
    if (!addresses.includes(address)) addresses.push(address);
  }
  const ordered = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([d]) => d);
  return {
    owned: ordered.filter((d) => !isSharedSender(d)),
    shared: ordered.filter((d) => isSharedSender(d)),
    addresses,
  };
}

// ---------------------------------------------------------------------------
// Naming the subscription (for shared senders)
// ---------------------------------------------------------------------------

/** Words that, alone, name a shared sender rather than one of its products. */
const SHARED_BRAND_WORDS = new Set(["apple", "itunes", "google", "amazon", "paypal"]);

function normaliseText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * What an email must contain to be about this subscription: its whole name
 * (without anything in brackets), and its first word when that word is
 * distinctive on its own ("iCloud+", "YouTube") rather than the shared
 * sender's own name ("Apple", "Google").
 */
export function nameNeedles(serviceName: string | null | undefined): string[] {
  const base = normaliseText(String(serviceName ?? "").replace(/\([^)]*\)/g, " "));
  if (!base) return [];
  const out: string[] = [];
  // "Apple" alone names the sender, not one of its products.
  if (alnumLength(base) >= 4 && !SHARED_BRAND_WORDS.has(base.replace(/\+/g, ""))) out.push(base);
  const first = base.split(" ")[0];
  if (first !== base && alnumLength(first) >= 4 && !SHARED_BRAND_WORDS.has(first.replace(/\+/g, ""))) {
    out.push(first);
  }
  return out;
}

function alnumLength(s: string): number {
  return s.replace(/[^a-z0-9]/g, "").length;
}

/** Too short or too generic to tell one Apple (or Google...) receipt from another. */
export function nameTooGeneric(serviceName: string | null | undefined): boolean {
  return nameNeedles(serviceName).length === 0;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does this email's subject or text name the subscription? */
export function namesSubscription(
  email: { subject?: string | null; text?: string | null },
  serviceName: string | null | undefined,
): boolean {
  const needles = nameNeedles(serviceName);
  if (needles.length === 0) return false;
  const haystack = " " + normaliseText(`${email.subject ?? ""} ${email.text ?? ""}`) + " ";
  return needles.some((needle) => {
    // Whole words: "icloud+" must not match inside "icloud+x"; a needle
    // ending in '+' must not be matched by the bare word either.
    const re = new RegExp(`(^|[^a-z0-9+])${escapeRe(needle)}(?=[^a-z0-9+]|$)`);
    return re.test(haystack);
  });
}

/** The words Gmail is given to narrow a shared sender to this subscription. */
export function nameSearchTerm(serviceName: string | null | undefined): string | null {
  const needles = nameNeedles(serviceName);
  if (needles.length === 0) return null;
  // The shortest distinctive needle, with '+' dropped: Gmail ignores it anyway.
  const pick = needles[needles.length - 1].replace(/\+/g, "").trim();
  return pick ? `"${pick}"` : null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** `from:(a.com OR b.com) newer_than:365d (receipt OR invoice OR ...)`, plus a name for shared senders. */
export function buildGmailQuery(domains: string[], nameTerm: string | null = null, days = HISTORY_DAYS): string {
  const from = `from:(${domains.join(" OR ")})`;
  const keywords = `(${HISTORY_KEYWORDS.join(" OR ")})`;
  return [from, nameTerm, `newer_than:${days}d`, keywords].filter(Boolean).join(" ");
}

/** The Gmail queries for a plan: brand domains as they are, shared ones narrowed by name. */
export function gmailQueriesFor(plan: SenderPlan, serviceName: string, days = HISTORY_DAYS): string[] {
  const queries: string[] = [];
  if (plan.owned.length > 0) queries.push(buildGmailQuery(plan.owned, null, days));
  const term = nameSearchTerm(serviceName);
  if (plan.shared.length > 0 && term) queries.push(buildGmailQuery(plan.shared, term, days));
  return queries;
}

/** The earliest moment the search covers. */
export function searchSince(now: Date, days = HISTORY_DAYS): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Graph $filter: received in the window, from one of the exact addresses.
 * Graph cannot filter on a sender's domain, so the addresses already seen
 * are what it is given; keywords are matched afterwards (matchesKeywords).
 */
export function buildOutlookFilter(addresses: string[], since: Date): string {
  const from = addresses
    .map((a) => `from/emailAddress/address eq '${a.replace(/'/g, "''")}'`)
    .join(" or ");
  return `receivedDateTime ge ${since.toISOString()} and (${from})`;
}

export function matchesKeywords(subject: string | null | undefined, text: string | null | undefined): boolean {
  return KEYWORD_RE.test(`${subject ?? ""} ${text ?? ""}`);
}

/**
 * Which listed messages to read: not already stored for this person, no
 * repeats, and no more than the cap left for this subscription.
 */
export function selectNewMessageIds(
  listed: string[],
  alreadyStored: ReadonlySet<string>,
  remaining: number,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of listed) {
    if (out.length >= Math.max(0, remaining)) break;
    if (!id || seen.has(id) || alreadyStored.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Keeping an email
// ---------------------------------------------------------------------------

/**
 * Whether a fetched email belongs to this subscription: it is from one of the
 * domains searched, talks about billing, and -- for a shared sender -- names
 * the subscription.
 */
export function keepEmail(
  email: { fromEmail: string | null | undefined; subject: string | null | undefined; text: string | null | undefined },
  plan: SenderPlan,
  serviceName: string,
): { keep: true } | { keep: false; why: "other_sender" | "no_keyword" | "not_named" } {
  const domain = registrableDomain(domainOf(email.fromEmail));
  const owned = plan.owned.includes(domain);
  const shared = plan.shared.includes(domain);
  if (!owned && !shared) return { keep: false, why: "other_sender" };
  if (!matchesKeywords(email.subject, email.text)) return { keep: false, why: "no_keyword" };
  if (shared && !namesSubscription({ subject: email.subject, text: email.text }, serviceName)) {
    return { keep: false, why: "not_named" };
  }
  return { keep: true };
}

// ---------------------------------------------------------------------------
// Whether to search at all
// ---------------------------------------------------------------------------

export type SearchDecision =
  | { search: true; plan: SenderPlan }
  | { search: false; note: string };

/**
 * A subscription with nothing linked to it and no merchant address was added
 * by hand: there is no sender to search. One whose only senders are shared
 * needs a name distinctive enough to pick its receipts out.
 */
export function decideSearch(input: {
  serviceName: string;
  linkedFromEmails: (string | null | undefined)[];
  merchantEmail: string | null | undefined;
}): SearchDecision {
  const hasLinked = input.linkedFromEmails.some((a) => domainOf(a));
  if (!hasLinked && !domainOf(input.merchantEmail)) return { search: false, note: NOTE_ADDED_BY_HAND };
  const plan = planSenders([...input.linkedFromEmails, input.merchantEmail]);
  if (plan.owned.length === 0 && plan.shared.length === 0) return { search: false, note: NOTE_NO_SENDER };
  if (plan.owned.length === 0 && nameTooGeneric(input.serviceName)) {
    return { search: false, note: NOTE_NAME_TOO_GENERIC };
  }
  return { search: true, plan };
}

// ---------------------------------------------------------------------------
// Cancellations, only when dated
// ---------------------------------------------------------------------------

const CANCEL_WORDING =
  /\b(has\s+been\s+cancel(l)?ed|was\s+cancel(l)?ed|you('ve|\s+have)\s+cancel(l)?ed|cancel(l)?ation\s+(is\s+)?confirm(ed|ation)|will\s+not\s+renew|won['’]?t\s+renew|subscription\s+(has\s+)?ended)\b/i;

const DATE = "([A-Z][a-z]+\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}(?:st|nd|rd|th)?\\s+[A-Z][a-z]+\\.?,?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2})";
const ACCESS_UNTIL = new RegExp(
  `\\b(?:access|available|active|benefits|membership|subscription)\\b[^.]{0,60}?\\b(?:until|till|through|ends?\\s+on|expires?\\s+on|will\\s+end\\s+on)\\s+${DATE}`,
  "i",
);
const ENDS_ON = new RegExp(`\\b(?:will\\s+end|ends|expires|will\\s+expire)\\s+on\\s+${DATE}`, "i");
const CANCELLED_ON = new RegExp(`\\bcancel(?:l)?ed\\s+on\\s+${DATE}`, "i");

/**
 * The dates in a cancellation email, only when it both says it was cancelled
 * (or will not renew) and states a date. An undated notice gives nothing: a
 * guess at when access ends is worse than not knowing.
 */
export function datedCancellation(
  email: { subject?: string | null; text?: string | null },
  now: Date,
): { cancelledOn: string | null; accessEndsOn: string | null } | null {
  const text = `${email.subject ?? ""}\n${(email.text ?? "").slice(0, 2000)}`;
  if (!CANCEL_WORDING.test(text)) return null;
  const cancelledOn = parseLooseDay(CANCELLED_ON.exec(text)?.[1] ?? null, now);
  const accessEndsOn = parseLooseDay((ACCESS_UNTIL.exec(text) ?? ENDS_ON.exec(text))?.[1] ?? null, now);
  if (!cancelledOn && !accessEndsOn) return null;
  return { cancelledOn, accessEndsOn };
}

/**
 * Whether a found email is worth keeping: the word rules read it as a
 * payment (or, unplaced, it shows an amount), or it is a dated cancellation.
 * Anything else -- a newsletter, a reminder, an undated notice -- is skipped
 * and only counted.
 */
export function worthSaving(
  email: { subject?: string | null; text?: string | null; amount?: number | string | null },
  now: Date,
): "payment" | "cancellation" | null {
  if (classifyPaymentEmail({ subject: email.subject, content: email.text, amount: email.amount }, now)) return "payment";
  if (datedCancellation(email, now)) return "cancellation";
  return null;
}

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

export type HistoryStatus = "pending" | "running" | "done" | "failed";

/**
 * Where a row goes after an attempt. `attempts` already counts the attempt
 * that just ended. A failure is tried again MAX_RETRIES times, then stays failed.
 */
export function afterAttempt(
  attempts: number,
  outcome: { ok: true } | { ok: false; error: string },
): { status: HistoryStatus; error: string | null } {
  if (outcome.ok) return { status: "done", error: null };
  if (attempts <= MAX_RETRIES) return { status: "pending", error: outcome.error };
  return { status: "failed", error: outcome.error };
}

/** Whether a pending row may be picked up now (a retry waits RETRY_DELAY_MS after the last attempt started). */
export function isDue(
  row: { historyStatus: string | null; historyAttempts: number | null; historyStartedAt: Date | string | null },
  now: Date,
): boolean {
  if (row.historyStatus !== "pending") return false;
  return dueAt(row) <= now.getTime();
}

/** When a pending row becomes due, in ms. */
export function dueAt(row: { historyAttempts: number | null; historyStartedAt: Date | string | null }): number {
  if (!row.historyAttempts || !row.historyStartedAt) return 0;
  const started = new Date(row.historyStartedAt).getTime();
  return isNaN(started) ? 0 : started + RETRY_DELAY_MS;
}

/** A 'running' row from a process that is gone. */
export function isStaleRunning(
  row: { historyStatus: string | null; historyStartedAt: Date | string | null },
  now: Date,
): boolean {
  if (row.historyStatus !== "running") return false;
  if (!row.historyStartedAt) return true;
  const started = new Date(row.historyStartedAt).getTime();
  return isNaN(started) || now.getTime() - started >= STALE_RUNNING_MS;
}

/** A failure in plain words, never the raw error (which may quote a request). */
export function describeFailure(error: unknown): string {
  const e = error as any;
  const code = e?.code ?? e?.status ?? e?.statusCode ?? e?.response?.status;
  const message = String(e?.message ?? e ?? "").toLowerCase();
  const reason = String(e?.errors?.[0]?.reason ?? e?.response?.data?.error ?? "").toLowerCase();
  if (
    code === 401 || reason.includes("invalid_grant") || message.includes("invalid_grant") ||
    message.includes("token refresh failed") || message.includes("reconnect") || message.includes("unauthorized")
  ) {
    return "the mailbox needs to be reconnected";
  }
  if (
    code === 429 || reason.includes("ratelimit") || reason.includes("quota") ||
    message.includes("rate limit") || message.includes("quota")
  ) {
    return "the mail provider's limit was reached";
  }
  if (
    ["ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN"].includes(String(e?.code)) ||
    message.includes("network") || message.includes("fetch failed") || message.includes("timeout") ||
    message.includes("socket")
  ) {
    return "the mail provider could not be reached";
  }
  return "something went wrong while searching";
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The admin console's "History" cell. */
export function historyLabel(row: {
  historyStatus: string | null;
  historySearchedSince: string | Date | null;
  historyError: string | null;
}): string {
  switch (row.historyStatus) {
    case "pending":
    case "running":
      return "Searching…";
    case "failed":
      return `Couldn't search: ${row.historyError || "unknown reason"}`;
    case "done": {
      if (!row.historySearchedSince) return `Not searched: ${row.historyError || "nothing to search"}`;
      const m = /^(\d{4})-(\d{2})/.exec(
        row.historySearchedSince instanceof Date ? row.historySearchedSince.toISOString() : String(row.historySearchedSince),
      );
      return m ? `Since ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "Searched";
    }
    default:
      return "Not searched yet";
  }
}
