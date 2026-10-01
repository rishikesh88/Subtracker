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
import { brandTokens } from "./brandTokens";
import { classifyPaymentEmail, isCreditCardBill, parseLooseDay } from "./statusRules";

/** How far back the search reaches. */
export const HISTORY_DAYS = 365;
/** At most this many new messages are read for one subscription, across all mailboxes. */
export const MAX_MESSAGES_PER_SUBSCRIPTION = 150;
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
export const NOTE_BANK_ALERTS_ONLY = "Found through bank alerts only";

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
  /**
   * Set when there is no sender to search and the company is looked for by
   * name instead (see decideSearch). `clues` are the names to search for;
   * `bodyClues` (plan names such as "Hobby plan") only help recognise an email
   * that was found through the others. `currency` is the subscription's: an
   * email in another currency is not this subscription's.
   */
  byName?: { clues: string[]; bodyClues: string[]; currency: string };
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

type Clues = string | null | undefined | (string | null | undefined)[];

/** The needles for one name or a list of names, without repeats. */
function needlesFor(clues: Clues): string[] {
  const list = Array.isArray(clues) ? clues : [clues];
  const out: string[] = [];
  for (const clue of list) {
    for (const needle of nameNeedles(clue)) if (!out.includes(needle)) out.push(needle);
  }
  return out;
}

/** Does this email's subject or text name the subscription (under any of its names)? */
export function namesSubscription(
  email: { subject?: string | null; text?: string | null },
  clues: Clues,
): boolean {
  const needles = needlesFor(clues);
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
export function nameSearchTerm(clues: Clues): string | null {
  const list = Array.isArray(clues) ? clues : [clues];
  const picks: string[] = [];
  for (const clue of list) {
    const needles = nameNeedles(clue);
    if (needles.length === 0) continue;
    // The shortest distinctive needle, with '+' dropped: Gmail ignores it anyway.
    const pick = needles[needles.length - 1].replace(/\+/g, "").trim();
    if (pick && !picks.includes(pick)) picks.push(pick);
  }
  if (picks.length === 0) return null;
  return picks.length === 1 ? `"${picks[0]}"` : `(${picks.map((p) => `"${p}"`).join(" OR ")})`;
}

// ---------------------------------------------------------------------------
// Name clues
// ---------------------------------------------------------------------------

/** Words that make a name a plan rather than a company ("Hobby plan", "Pro", "Premium annual"). */
const PLAN_WORDS = new Set([
  "plan", "tier", "hobby", "free", "pro", "plus", "premium", "basic", "standard", "starter", "team", "teams",
  "business", "individual", "family", "student", "personal", "monthly", "yearly", "annual", "weekly",
  "subscription", "membership", "max", "lite", "ultra", "essentials", "unlimited", "enterprise", "the", "a", "and",
]);

/** A name made only of plan words: it says which plan, not which company. */
export function isPlanName(name: string | null | undefined): boolean {
  const words = normaliseText(String(name ?? "").replace(/\([^)]*\)/g, " ")).split(" ").filter(Boolean);
  return words.length > 0 && words.every((w) => PLAN_WORDS.has(w));
}

export interface NameClues {
  /** Names to search for, in order, never too generic and never a plan name. */
  search: string[];
  /** Plan names: they may help recognise an email body, never start a search. */
  bodyOnly: string[];
}

/**
 * The names a subscription has gone by, in the order they are tried: the
 * merchant name the detector read, the name it was approved under, its name
 * now, then the names it has had since (oldest first). Repeats (ignoring case)
 * are dropped. A name too generic to tell one company from another is dropped
 * (nameTooGeneric); a plan name goes to `bodyOnly`.
 */
export function buildNameClues(input: {
  merchantName: string | null | undefined;
  serviceName: string | null | undefined;
  remembered: { name: string; origin: string }[];
}): NameClues {
  const ordered: (string | null | undefined)[] = [
    input.merchantName,
    ...input.remembered.filter((r) => r.origin === "approval").map((r) => r.name),
    input.serviceName,
    ...input.remembered.filter((r) => r.origin !== "approval").map((r) => r.name),
  ];
  const seen = new Set<string>();
  const out: NameClues = { search: [], bodyOnly: [] };
  for (const raw of ordered) {
    const name = (raw ?? "").trim();
    const key = normaliseText(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (isPlanName(name)) {
      out.bodyOnly.push(name);
    } else if (!nameTooGeneric(name)) {
      out.search.push(name);
    }
  }
  return out;
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
export function gmailQueriesFor(plan: SenderPlan, serviceName: Clues, days = HISTORY_DAYS): string[] {
  const queries: string[] = [];
  if (plan.byName) {
    // The company's own mail first: it is what is kept, and bank alerts that
    // only mention the name must not crowd it out of the listing. The broader
    // query (name anywhere) follows; what the first read is not read again.
    const own = buildNameOwnSenderGmailQuery(plan.byName.clues, days);
    const query = buildNameGmailQuery(plan.byName.clues, days);
    return [own, query].filter((q): q is string => Boolean(q));
  }
  if (plan.owned.length > 0) queries.push(buildGmailQuery(plan.owned, null, days));
  const term = nameSearchTerm(serviceName);
  if (plan.shared.length > 0 && term) queries.push(buildGmailQuery(plan.shared, term, days));
  return queries;
}

/**
 * `("railway" OR from:railway) newer_than:365d (receipt OR ...)`: a search by
 * company name, for a subscription with no sender to search. Gmail matches a
 * quoted word in the subject, the body and the sender's name; `from:` adds the
 * address. Which of what comes back is kept is decided by keepEmailByName.
 */
export function buildNameGmailQuery(clues: string[], days = HISTORY_DAYS): string | null {
  const terms: string[] = [];
  for (const clue of clues) {
    const needles = nameNeedles(clue);
    if (needles.length === 0) continue;
    const pick = needles[needles.length - 1].replace(/\+/g, "").trim();
    if (!pick) continue;
    const term = pick.includes(" ") ? `"${pick}"` : `("${pick}" OR from:${pick})`;
    if (!terms.includes(term)) terms.push(term);
  }
  if (terms.length === 0) return null;
  const keywords = `(${HISTORY_KEYWORDS.join(" OR ")})`;
  return [`(${terms.join(" OR ")})`, `newer_than:${days}d`, keywords].filter(Boolean).join(" ");
}

/**
 * `(from:netflix) newer_than:365d (receipt OR ...)`: the company's own mail,
 * matched on the sender's name or address ("info@account.netflix.com").
 */
export function buildNameOwnSenderGmailQuery(clues: string[], days = HISTORY_DAYS): string | null {
  const terms: string[] = [];
  for (const clue of clues) {
    const needles = nameNeedles(clue);
    if (needles.length === 0) continue;
    const pick = needles[needles.length - 1].replace(/\+/g, "").trim();
    if (!pick) continue;
    const term = pick.includes(" ") ? `from:"${pick}"` : `from:${pick}`;
    if (!terms.includes(term)) terms.push(term);
  }
  if (terms.length === 0) return null;
  const keywords = `(${HISTORY_KEYWORDS.join(" OR ")})`;
  return [`(${terms.join(" OR ")})`, `newer_than:${days}d`, keywords].join(" ");
}

/** Graph $filter for a name search: subject only, since Graph cannot match a sender's name or domain. */
export function buildOutlookNameFilter(clues: string[], since: Date): string | null {
  const parts: string[] = [];
  for (const clue of clues) {
    const needles = nameNeedles(clue);
    if (needles.length === 0) continue;
    const pick = needles[needles.length - 1].replace(/\+/g, "").replace(/'/g, "''").trim();
    if (pick) parts.push(`contains(subject,'${pick}')`);
  }
  if (parts.length === 0) return null;
  return `receivedDateTime ge ${since.toISOString()} and (${Array.from(new Set(parts)).join(" or ")})`;
}

/**
 * Graph $search value (KQL, full text over subject, body and sender) for a
 * name search, so a receipt that names the company only in its body is found.
 * Graph cannot combine $search with $filter, so the date window is applied by
 * the caller (see withinWindow). Terms are reduced to letters, digits and
 * spaces: nothing that could change the query's meaning (quotes, colons,
 * parentheses, operators) survives. Words of one name are ANDed, names ORed.
 * The whole expression is wrapped in double quotes, as Graph requires.
 */
export function buildOutlookNameSearch(clues: string[]): string | null {
  const terms: string[] = [];
  for (const clue of clues) {
    const needles = nameNeedles(clue);
    if (needles.length === 0) continue;
    const words = needles[needles.length - 1]
      .replace(/[\u0000-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u00bf\u00d7\u00f7]/g, " ")
      .split(/\s+/)
      .filter((w) => w && !/^(and|or|not)$/i.test(w));
    if (words.length === 0) continue;
    const term = words.length === 1 ? words[0] : `(${words.join(" AND ")})`;
    if (!terms.includes(term)) terms.push(term);
  }
  if (terms.length === 0) return null;
  return `"${terms.join(" OR ")}"`;
}

/** $search cannot be combined with a date $filter, so a listed message is checked against the window here. */
export function withinWindow(receivedAtMs: number, since: Date): boolean {
  return Number.isFinite(receivedAtMs) && receivedAtMs >= since.getTime();
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
 * the subscription (under any name it has had). A search by name has its own
 * rules; see keepEmailByName.
 */
export function keepEmail(
  email: {
    fromEmail: string | null | undefined;
    fromName?: string | null;
    subject: string | null | undefined;
    text: string | null | undefined;
    currency?: string | null;
  },
  plan: SenderPlan,
  serviceName: Clues,
): { keep: true } | { keep: false; why: "other_sender" | "no_keyword" | "not_named" | "wrong_currency" | "credit_card" } {
  // Credit card bills are never read or stored: not the email, its PDFs or a payment.
  if (isCreditCardBill({ subject: email.subject, content: email.text })) return { keep: false, why: "credit_card" };
  if (plan.byName) return keepEmailByName(email, plan.byName);
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

/** Payment processors whose receipts carry the merchant's name rather than their own. */
const PROCESSOR_SENDERS = ["stripe.com", "paddle.com", "chargebee.com", "recurly.com", "fastspring.com", "2checkout.com", "gocardless.com"];

export function isProcessorSender(address: string | null | undefined): boolean {
  const domain = domainOf(address);
  return PROCESSOR_SENDERS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

const compact = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Whether an email found by company name is this subscription's:
 *
 * - it talks about billing;
 * - banks, card issuers and mail relays are never a source of company
 *   identity, however the name appears in their mail (a card alert "spent at
 *   Netflix" says nothing about who sends Netflix's mail);
 * - the sender's display name or address contains one of the names, or -- for
 *   a payment processor such as Stripe, which sends under its own address --
 *   the display name, subject or body names the company ("Receipt from
 *   Railway Corporation"); a plan name in the body helps there too;
 * - and the email's currency is the subscription's. This is what keeps a
 *   same-named company in another country (Indian Railways) out.
 */
export function keepEmailByName(
  email: {
    fromEmail: string | null | undefined;
    fromName?: string | null;
    subject: string | null | undefined;
    text: string | null | undefined;
    currency?: string | null;
  },
  byName: { clues: string[]; bodyClues: string[]; currency: string },
): { keep: true } | { keep: false; why: "other_sender" | "no_keyword" | "not_named" | "wrong_currency" | "credit_card" } {
  if (isCreditCardBill({ subject: email.subject, content: email.text })) return { keep: false, why: "credit_card" };
  if (!matchesKeywords(email.subject, email.text)) return { keep: false, why: "no_keyword" };
  const processor = isProcessorSender(email.fromEmail);
  if (isIntermediary(email.fromEmail) && !processor) return { keep: false, why: "other_sender" };

  const needles = needlesFor(byName.clues);
  const display = ` ${normaliseText(email.fromName ?? "")} `;
  const address = compact(email.fromEmail);
  const fromSender = needles.some((needle) => {
    const re = new RegExp(`(^|[^a-z0-9+])${escapeRe(needle)}(?=[^a-z0-9+]|$)`);
    const c = compact(needle);
    return re.test(display) || (c.length >= 5 && address.includes(c));
  });
  if (!fromSender) {
    if (!processor) return { keep: false, why: "other_sender" };
    const named = namesSubscription(
      { subject: email.subject, text: `${email.fromName ?? ""} ${email.text ?? ""}` },
      [...byName.clues, ...byName.bodyClues],
    );
    if (!named) return { keep: false, why: "not_named" };
  }

  const currency = (email.currency ?? "").trim().toUpperCase();
  // The company's own notice with no amount in it ("Your payment was
  // unsuccessful") has no currency to compare; its own sender is proof enough.
  if (!currency && fromSender && !processor) return { keep: true };
  if (!currency || currency !== byName.currency.trim().toUpperCase()) return { keep: false, why: "wrong_currency" };
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
 * by hand: there is nothing to search from. One whose only senders are shared
 * needs a name distinctive enough to pick its receipts out.
 *
 * One with emails linked to it but no sender to search (all of them bank
 * alerts, say) is searched by company name instead, when it has at least one
 * name that is not too generic or a plan name: see keepEmailByName for what is
 * kept from that.
 */
export function decideSearch(input: {
  serviceName: string;
  linkedFromEmails: (string | null | undefined)[];
  merchantEmail: string | null | undefined;
  /** Every name it has had; defaults to the current one alone. */
  clues?: NameClues;
  currency?: string;
}): SearchDecision {
  const clues = input.clues ?? buildNameClues({ merchantName: null, serviceName: input.serviceName, remembered: [] });
  const hasLinked = input.linkedFromEmails.some((a) => domainOf(a));
  if (!hasLinked && !domainOf(input.merchantEmail)) return { search: false, note: NOTE_ADDED_BY_HAND };
  const plan = planSenders([...input.linkedFromEmails, input.merchantEmail]);
  if (plan.owned.length === 0 && plan.shared.length === 0) {
    if (clues.search.length === 0) return { search: false, note: NOTE_NO_SENDER };
    return {
      search: true,
      plan: {
        owned: [],
        shared: [],
        addresses: [],
        byName: { clues: clues.search, bodyClues: clues.bodyOnly, currency: input.currency ?? "INR" },
      },
    };
  }
  if (plan.owned.length === 0 && clues.search.length === 0 && nameTooGeneric(input.serviceName)) {
    return { search: false, note: NOTE_NAME_TOO_GENERIC };
  }
  return { search: true, plan };
}

// ---------------------------------------------------------------------------
// Companies with several subscriptions
// ---------------------------------------------------------------------------

export interface CompanySub {
  id: string;
  serviceName: string;
  merchantName: string | null;
  merchantEmail: string | null;
  amount: string | number;
  currency: string;
  /** The senders of the emails linked to it. */
  senders: string[];
}

/**
 * What names a company: the registrable domains of its senders (banks, card
 * issuers, processors and the shared Apple/Google/Amazon/PayPal senders do
 * not name one) and the brand word at the head of its name.
 */
export function companyKeys(sub: CompanySub): string[] {
  const keys = new Set<string>();
  for (const address of [...sub.senders, sub.merchantEmail]) {
    const domain = domainOf(address);
    if (!domain || isIntermediary(address) || isSharedSender(domain)) continue;
    keys.add(`domain:${registrableDomain(domain)}`);
  }
  for (const token of brandTokens(sub.merchantName, sub.serviceName).slice(0, 1)) {
    if (!SHARED_BRAND_WORDS.has(token)) keys.add(`name:${token}`);
  }
  return Array.from(keys);
}

/** The other subscriptions of the same company, in a fixed order (by id). */
export function siblingsOf(sub: CompanySub, all: CompanySub[]): CompanySub[] {
  const mine = new Set(companyKeys(sub));
  return all
    .filter((other) => other.id !== sub.id && companyKeys(other).some((k) => mine.has(k)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Whether an amount is this subscription's price: same currency, within one unit or 5%. */
export function priceFits(
  email: { amount: number | string | null | undefined; currency?: string | null },
  sub: { amount: string | number; currency: string },
): boolean {
  const amount = email.amount === null || email.amount === undefined || email.amount === "" ? NaN : Number(email.amount);
  const price = Number(sub.amount);
  if (!isFinite(amount) || !isFinite(price) || amount <= 0) return false;
  const currency = (email.currency ?? "").trim().toUpperCase();
  if (currency && currency !== sub.currency.trim().toUpperCase()) return false;
  return Math.abs(amount - price) <= Math.max(1, price * 0.05);
}

/**
 * Which subscription of a company an email is about, by its price: the one
 * whose price is nearest among those it fits (ties to the lower id), or null
 * when none fits. It looks only at the email and the group, so the answer is
 * the same whichever subscription is being searched.
 */
export function assignByPrice(
  email: { amount: number | string | null | undefined; currency?: string | null },
  group: { id: string; amount: string | number; currency: string }[],
): string | null {
  const amount = Number(email.amount);
  const fits = group
    .filter((sub) => priceFits(email, sub))
    .sort((a, b) => Math.abs(Number(a.amount) - amount) - Math.abs(Number(b.amount) - amount) || a.id.localeCompare(b.id));
  return fits.length > 0 ? fits[0].id : null;
}

// ---------------------------------------------------------------------------
// How far back the search really got
// ---------------------------------------------------------------------------

/** A search by company name stops after this many emails in a row that were not about the subscription. */
export const EARLY_STOP_AFTER = 60;

/**
 * Whether a search by name should stop reading: it has read `notKeptInARow`
 * emails since the last one it kept, and that is at least the limit. Only for
 * a search by name; one by linked senders always reads on.
 */
export function shouldStopEarly(byName: boolean, notKeptInARow: number): boolean {
  return byName && notKeptInARow >= EARLY_STOP_AFTER;
}

/**
 * Where a finished search really reached. When the message budget ran out
 * before the window was covered (`truncated`), the search only got back as far
 * as the oldest email it read, and says so rather than claiming twelve months.
 */
export function searchCoverage(input: {
  since: Date;
  truncated: boolean;
  oldestRead: Date | null;
  max?: number;
  /** A search by name gave up early: this many emails in a row were not about the subscription. */
  stoppedEarly?: number | null;
}): { searchedSince: string; partial: boolean; note: string | null } {
  const windowStart = dayStringOf(input.since);
  if (input.stoppedEarly && input.oldestRead && !isNaN(input.oldestRead.getTime())) {
    const reached = dayStringOf(input.oldestRead);
    const searchedSince = reached < windowStart ? windowStart : reached;
    return {
      searchedSince,
      partial: true,
      note: `Partial: stopped after ${input.stoppedEarly} emails in a row that were not about it, back to ${monthYear(searchedSince)}`,
    };
  }
  if (!input.truncated || !input.oldestRead || isNaN(input.oldestRead.getTime())) {
    return { searchedSince: windowStart, partial: false, note: null };
  }
  const reached = dayStringOf(input.oldestRead);
  // Never claim more than the window, even if an odd date came back.
  const searchedSince = reached < windowStart ? windowStart : reached;
  return {
    searchedSince,
    partial: true,
    note: `Partial: read newest ${input.max ?? MAX_MESSAGES_PER_SUBSCRIPTION} emails, back to ${monthYear(searchedSince)}`,
  };
}

function dayStringOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthYear(day: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(day);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : day;
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
  email: { subject?: string | null; text?: string | null; amount?: number | string | null; attachmentText?: string | null },
  now: Date,
  options: { requireWording?: boolean } = {},
): "payment" | "cancellation" | null {
  if (isCreditCardBill({ subject: email.subject, content: email.text })) return null;
  if (
    classifyPaymentEmail(
      { subject: email.subject, content: email.text, amount: email.amount, attachmentText: email.attachmentText },
      now,
      options,
    )
  ) {
    return "payment";
  }
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

export interface HistoryRow {
  historyStatus: string | null;
  historySearchedSince: string | Date | null;
  historyError: string | null;
  historyPartial?: boolean | null;
  historyRead?: number | null;
  historySaved?: number | null;
  historySkipped?: number | null;
}

/** The admin console's "History" cell: the headline. */
export function historyLabel(row: HistoryRow): string {
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
      const since = m ? `Since ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "Searched";
      return row.historyPartial ? `Partial, ${since.toLowerCase()}` : since;
    }
    default:
      return "Not searched yet";
  }
}

/**
 * The smaller lines under the headline: what was read, saved and left out,
 * and any note. `billsNoReceipt` comes from the payments, not the search.
 */
export function historyDetails(row: HistoryRow, billsNoReceipt = 0): string[] {
  if (row.historyStatus !== "done" || !row.historySearchedSince) return [];
  const lines: string[] = [];
  const counts: string[] = [];
  if (row.historyRead !== null && row.historyRead !== undefined) counts.push(`${row.historyRead} read`);
  if (row.historySaved !== null && row.historySaved !== undefined) counts.push(`${row.historySaved} saved`);
  if (billsNoReceipt > 0) counts.push(`${billsNoReceipt} ${billsNoReceipt === 1 ? "bill" : "bills"} with no receipt`);
  if (counts.length) lines.push(counts.join(" · "));
  if ((row.historySkipped ?? 0) > 0) lines.push(`${row.historySkipped} skipped (no matching price)`);
  if (row.historyError) lines.push(row.historyError);
  return lines;
}
