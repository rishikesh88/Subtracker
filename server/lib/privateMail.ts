/**
 * Private mail: never read past the subject line.
 *
 * Some mail in a personal inbox is nobody's business but its owner's:
 * insurance, health and medical, loans, and investments (SIPs, mutual funds,
 * shares, brokers). None of it is a software subscription, so the sync keeps
 * all of it out, the same way bank and card mail is kept out (bankAlert.ts):
 *
 *  - Gmail is not even asked for it (gmailPrivateExclusions, added to the
 *    sync's search);
 *  - anything that still arrives is dropped by its sender, name, subject or
 *    preview before it is pre-filtered, fetched in full, stored or sent to a
 *    model (splitPrivateMail);
 *  - a suggestion that still looks private is dropped before it is saved, and
 *    a tracked subscription that looks private is never searched
 *    (privateSubscriptionKind).
 *
 * Verloq's own mail (sync summaries, sign-in codes) is dropped the same way:
 * it is not a subscription.
 *
 * The rules lean towards dropping. A software receipt that is wrongly dropped
 * can be added by hand; private mail that is wrongly read cannot be unread.
 * Words that also mean something ordinary in a software receipt are avoided
 * on their own ("premium" is Spotify Premium; "policy" is a privacy policy;
 * "SIP" is also SIP trunking), and short brand names are matched only as a
 * whole part of the sender's domain, never inside other words.
 *
 * Everything here is pure, so it is tested by server/lib/privateMail.test.ts.
 */

import { isServiceWorkSubscription, serviceInvoiceKind } from "./serviceInvoice";

export type PrivateKind = "own" | "insurance" | "health" | "loans" | "investments";
/** In the clean-up only: invoices for people's work (see serviceInvoice.ts). */
export type CleanupKind = PrivateKind | "services";

export interface MailFacts {
  sender?: string | null;
  fromName?: string | null;
  subject?: string | null;
  snippet?: string | null;
}

/** Verloq's own sending domain. */
const OWN_DOMAINS = ["verloq.co"];

/**
 * Sender domains, matched as a whole part of the domain ("lic" matches
 * licindia's "lic.in" but never "public.com"). Long names (6+ letters) are
 * also looked for inside a sender's display name with spaces removed.
 */
const DOMAIN_NAMES: Record<Exclude<PrivateKind, "own">, string[]> = {
  insurance: [
    "lic", "licindia", "hdfcergo", "hdfclife", "icicilombard", "iciciprulife", "bajajallianz", "starhealth",
    "nivabupa", "maxlifeinsurance", "sbilife", "tataaig", "tataaia", "careinsurance", "acko", "godigit",
    "policybazaar", "geico", "statefarm", "allstate", "aetna", "cigna", "uhc", "humana", "bcbs", "metlife",
    "lemonade", "aviva", "bupa", "axa", "allianz", "zurich", "libertymutual", "nationwide", "prudential",
    "progressive", "kotaklife", "adityabirlacapital", "royalsundaram", "futuregenerali", "manipalcigna",
  ],
  health: [
    "practo", "apollohospitals", "apollo247", "pharmeasy", "netmeds", "1mg", "tata1mg", "medplus", "medplusmart",
    "thyrocare", "lalpathlabs", "metropolisindia", "healthians", "redcliffelabs", "cvs", "walgreens",
    "onemedical", "zocdoc", "teladoc", "mychart", "labcorp", "questdiagnostics", "fortishealthcare",
    "maxhealthcare", "manipalhospitals", "narayanahealth",
  ],
  loans: [
    "bajajfinserv", "homecredit", "kreditbee", "moneyview", "navi", "fibe", "earlysalary", "lendingkart",
    "tatacapital", "credila", "hdfccredila", "salliemae", "navient", "sofi", "rocketmortgage", "upstart",
    "lendingclub", "mortgage", "avanse", "piramalfinance", "muthootfinance", "manappuram",
  ],
  investments: [
    "zerodha", "groww", "kuvera", "upstox", "angelone", "angelbroking", "paytmmoney", "icicidirect", "hdfcsec",
    "kotaksecurities", "camsonline", "kfintech", "karvy", "nsdl", "cdsl", "mfcentral", "mfuonline", "amfiindia",
    "smallcase", "indmoney", "etmoney", "scripbox", "vanguard", "fidelity", "schwab", "robinhood", "etrade",
    "wealthfront", "betterment", "coinbase", "binance", "wazirx", "coindcx", "sbimf", "hdfcfund",
    "icicipruamc", "axismf", "nipponindiamf", "miraeassetmf", "dspim", "ppfas", "motilaloswal", "sharekhan",
  ],
};

/** Inside any part of the sender's domain: these never name a software company. */
const DOMAIN_PARTS: Record<Exclude<PrivateKind, "own">, string[]> = {
  insurance: ["insurance", "insure", "assurance", "mediclaim"],
  health: ["hospital", "clinic", "pathlab", "pharmacy", "diagnostic"],
  loans: ["loan", "lending", "mortgage"],
  investments: ["mutualfund", "securities", "broking", "demat"],
};

/** Subject, preview and display name. Case-insensitive unless noted. */
const WORDS: Record<Exclude<PrivateKind, "own">, RegExp[]> = {
  insurance: [
    /\b(insurance|insurer|reinsurance|mediclaim|policyholder|sum\s+assured|life\s+cover|health\s+cover|no[-\s]claim\s+bonus)\b/i,
    /(?<![-\w])term\s+(plan|insurance)\b/i, // not "long-term plan"
    /\bpolicy\s*(no\.?|number|#)\s*[:\-]?\s*\w*\d/i,
    /\b(policy\s+renewal|renew(al\s+of)?\s+your\s+policy|your\s+policy\s+(is\s+)?(due|lapsed|renewed|expir))/i,
    /\bpremium\s+(due|reminder|receipt|paid|payment)\b.{0,40}\bpolicy\b/i,
  ],
  health: [
    /\b(hospital|clinic|pharmacy|prescriptions?|patient|discharge\s+summary|dental|physiotherapy)\b/i,
    /\b(lab|blood|medical|pathology|radiology)\s+(reports?|results?|bills?|records?)\b/i,
    /\bdiagnostics?\s+(report|centre|center|lab)\b/i,
    /\b(doctor|doctor's|physician)\s+(appointment|consultation|visit)\b/i,
    /\bhealth\s+check-?\s?up\b/i,
  ],
  loans: [
    /\b(loans?|mortgage|overdraft|repayment\s+schedule|foreclosure|loan\s+account|credit\s+line)\b/i,
    /\bEMIs?\b/, // case-sensitive: "Emi" is also a name
  ],
  investments: [
    /\b(mutual\s+funds?|systematic\s+investment|folio\s*(no\.?|number)|units?\s+allot+ed|demat|contract\s+note|capital\s+gains?|portfolio\s+statement|trade\s+confirmation|brokerage\s+statement|holding\s+statement|dividend\s+(credit|credited|paid|payout))\b/i,
    /\bSIPs?\b.{0,30}\b(instal+ments?|registration|registered|debit|debited|amount|confirmation|transaction|mandate|fund|folio|units?)\b/i,
    /\b(instal+ments?|registration|debit|confirmation)\b.{0,30}\bSIPs?\b/i,
    /\bNAV\b/, // case-sensitive
  ],
};

/** Brand names that are also ordinary words or places; trusted only in a sender's domain. */
const AMBIGUOUS_WORDS = new Set(["zurich", "nationwide", "progressive", "fidelity", "lemonade", "navi", "upstart", "betterment", "mortgage", "cvs", "axa"]);

const KINDS: Exclude<PrivateKind, "own">[] = ["insurance", "health", "loans", "investments"];

export function domainOf(address: string | null | undefined): string {
  const a = (address ?? "").trim().toLowerCase();
  const m = a.match(/<([^>]+)>/);
  const email = m ? m[1] : a;
  const at = email.lastIndexOf("@");
  return (at >= 0 ? email.slice(at + 1) : email).replace(/[>\s]/g, "");
}

function domainKind(address: string | null | undefined): PrivateKind | null {
  const domain = domainOf(address);
  if (!domain) return null;
  if (OWN_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return "own";
  const labels = domain.split(".").filter(Boolean);
  for (const kind of KINDS) {
    if (labels.some((l) => DOMAIN_NAMES[kind].includes(l))) return kind;
    if (labels.some((l) => DOMAIN_PARTS[kind].some((p) => l.includes(p)))) return kind;
  }
  return null;
}

function nameKind(name: string | null | undefined): PrivateKind | null {
  const squashed = (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!squashed) return null;
  if (squashed === "verloq") return "own";
  for (const kind of KINDS) {
    if (DOMAIN_NAMES[kind].some((n) => n.length >= 6 && !AMBIGUOUS_WORDS.has(n) && squashed.includes(n))) return kind;
    if (DOMAIN_PARTS[kind].some((p) => squashed.includes(p))) return kind;
  }
  return null;
}

function wordKind(...texts: (string | null | undefined)[]): PrivateKind | null {
  const text = texts.filter(Boolean).join(" \n ").slice(0, 3000);
  if (!text) return null;
  for (const kind of KINDS) {
    if (WORDS[kind].some((re) => re.test(text))) return kind;
  }
  return null;
}

/** Why this email is private, or null if it is not. */
export function privateKind(m: MailFacts): PrivateKind | null {
  return domainKind(m.sender) ?? nameKind(m.fromName) ?? wordKind(m.fromName, m.subject, m.snippet);
}

/** Splits a list into the mail the sync may look at and the private mail it must not. */
export function splitPrivateMail<T>(
  items: T[],
  facts: (item: T) => MailFacts,
): { kept: T[]; dropped: T[]; byKind: Partial<Record<PrivateKind, number>> } {
  const kept: T[] = [];
  const dropped: T[] = [];
  const byKind: Partial<Record<PrivateKind, number>> = {};
  for (const item of items) {
    const kind = privateKind(facts(item));
    if (kind) {
      dropped.push(item);
      byKind[kind] = (byKind[kind] ?? 0) + 1;
    } else kept.push(item);
  }
  return { kept, dropped, byKind };
}

/**
 * A subscription (or a suggestion for one) that is really insurance, health,
 * a loan, an investment, or Verloq itself.
 */
export function privateSubscriptionKind(s: {
  serviceName?: string | null;
  merchantName?: string | null;
  category?: string | null;
  merchantEmail?: string | null;
}): PrivateKind | null {
  return (
    domainKind(s.merchantEmail) ??
    wholeWordKind(s.serviceName) ??
    wholeWordKind(s.merchantName) ??
    nameKind(s.serviceName) ??
    nameKind(s.merchantName) ??
    wordKind(s.serviceName, s.merchantName) ??
    categoryKind(s.category)
  );
}

/** A brand name as a whole word of a subscription's name ("Groww SIP", "LIC"). */
function wholeWordKind(name: string | null | undefined): PrivateKind | null {
  const words = (name ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !AMBIGUOUS_WORDS.has(w));
  if (words.includes("verloq")) return "own";
  for (const kind of KINDS) {
    if (words.some((w) => DOMAIN_NAMES[kind].includes(w))) return kind;
  }
  return null;
}

function categoryKind(category: string | null | undefined): PrivateKind | null {
  const c = (category ?? "").toLowerCase();
  if (!c) return null;
  if (/insurance/.test(c)) return "insurance";
  if (/\b(health\s*care|medical|pharmacy|hospital)\b/.test(c)) return "health";
  if (/\b(loans?|mortgage|lending)\b/.test(c)) return "loans";
  if (/\b(investments?|mutual\s+funds?|brokerage|stocks?|trading)\b/.test(c)) return "investments";
  return null;
}

/**
 * Added to the sync's Gmail search so this mail is never fetched at all.
 * Subject words only: a search of the whole message would also drop software
 * receipts that mention insurance in a footer.
 */
export function gmailPrivateExclusions(): string {
  const subjects = [
    "insurance", "mediclaim", "\"policy number\"", "\"mutual fund\"", "\"mutual funds\"", "SIP", "NAV",
    "folio", "demat", "\"contract note\"", "loan", "EMI", "mortgage", "hospital", "pharmacy",
    "\"lab report\"", "prescription",
  ];
  return `-from:(${OWN_DOMAINS.join(" OR ")}) -subject:(${subjects.join(" OR ")})`;
}

export interface PrivateCleanupInput {
  subscriptions: { id: string; serviceName: string; merchantName?: string | null; category?: string | null; merchantEmail?: string | null }[];
  suggestions: { id: string; serviceName: string; merchantName?: string | null; category?: string | null }[];
  emails: { id: string; gmailId: string; fromEmail: string | null; fromName?: string | null; subject: string | null; content: string | null; subscriptionId?: string | null }[];
}

export interface PrivateCleanupPlan {
  subscriptionIds: string[];
  suggestionIds: string[];
  /** Stored email rows to delete. */
  emailIds: string[];
  /** Their provider message ids (for clearing suggestions that cite them). */
  messageIds: string[];
  byKind: Partial<Record<CleanupKind, number>>;
}

/**
 * What a person's stored data holds that the sync would no longer keep:
 * private subscriptions and suggestions, private emails, and every email filed
 * under a private subscription. Counts only; nothing is read out.
 */
export function planPrivateCleanup(input: PrivateCleanupInput): PrivateCleanupPlan {
  const byKind: Partial<Record<CleanupKind, number>> = {};
  const note = (k: CleanupKind) => { byKind[k] = (byKind[k] ?? 0) + 1; };
  const subscriptionIds: string[] = [];
  for (const s of input.subscriptions) {
    const kind: CleanupKind | null = privateSubscriptionKind(s) ?? (isServiceWorkSubscription(s) ? "services" : null);
    if (kind) { subscriptionIds.push(s.id); note(kind); }
  }
  const suggestionIds: string[] = [];
  for (const s of input.suggestions) {
    const kind: CleanupKind | null = privateSubscriptionKind(s) ?? (isServiceWorkSubscription(s) ? "services" : null);
    if (kind) { suggestionIds.push(s.id); note(kind); }
  }
  const privateSubs = new Set(subscriptionIds);
  const emailIds: string[] = [];
  const messageIds: string[] = [];
  for (const e of input.emails) {
    const kind: CleanupKind | null =
      privateKind({ sender: e.fromEmail, fromName: e.fromName, subject: e.subject, snippet: (e.content ?? "").slice(0, 1500) }) ??
      (serviceInvoiceKind({ sender: e.fromEmail, fromName: e.fromName, subject: e.subject, text: e.content }) ? "services" : null);
    const underPrivate = e.subscriptionId ? privateSubs.has(e.subscriptionId) : false;
    if (kind || underPrivate) {
      emailIds.push(e.id);
      messageIds.push(e.gmailId);
      if (kind) note(kind);
    }
  }
  return { subscriptionIds, suggestionIds, emailIds, messageIds, byKind };
}
