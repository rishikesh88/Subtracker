/**
 * Which emails a detected subscription is shown with, and whose logo it wears.
 *
 * Both decisions used to be made loosely, and both went visibly wrong after
 * the detector started naming its own evidence:
 *
 *  - Evidence was taken as given. A Netflix film recommendation was shown as
 *    proof of a Netflix subscription, because nothing checked that an email
 *    reads like a bill before calling it evidence.
 *  - When the detector named no emails, the fallback searched for the whole
 *    service name, which "Google One 100 GB" and "Railway Hobby Plan" appear
 *    in no subject line as, so both came back with nothing.
 *  - The merchant was simply the sender of the newest evidence email, which
 *    for Claude Pro was the card issuer's transaction alert.
 */
import { brandTokens } from "./brandTokens";
import { looksLikeBill } from "./billingEmail";

export interface EvidenceEmail {
  gmailId: string;
  subject?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
  receivedAt?: Date | string | null;
  extractedAmount?: string | number | null;
}

export interface EvidenceSuggestion {
  serviceName: string;
  merchantName?: string | null;
  amount: number | string;
  /** Message ids the detector itself named. */
  evidenceEmailIds?: string[];
}

export interface EvidencePick {
  emails: EvidenceEmail[];
  /** How many the detector named, for the sync log. */
  named: number;
  /** How many the fallback search found, when it ran. */
  found: number;
  /** How the kept ones were arrived at. */
  source: "detector" | "fallback" | "none";
}

const FALLBACK_LIMIT = 5;

/** Reads like a bill for this subscription, by the same test invoices use. */
function isBill(email: EvidenceEmail, suggestion: EvidenceSuggestion): boolean {
  return looksLikeBill(
    { subject: email.subject, extractedAmount: email.extractedAmount ?? null },
    { serviceName: suggestion.serviceName, amount: suggestion.amount },
  ).isBill;
}

function amountMatches(email: EvidenceEmail, suggestion: EvidenceSuggestion): boolean {
  const a = Number(email.extractedAmount);
  const b = Number(suggestion.amount);
  return Number.isFinite(a) && Number.isFinite(b) && b > 0 && Math.abs(a - b) < 1;
}

function newestFirst(a: EvidenceEmail, b: EvidenceEmail): number {
  return new Date(b.receivedAt ?? 0).getTime() - new Date(a.receivedAt ?? 0).getTime();
}

/**
 * The emails to show as a suggestion's evidence.
 *
 * The detector's own list comes first, but only the emails in it that read
 * like a bill. When nothing survives that, the brand is searched for in the
 * subject, the sending address and the sender's name -- skipping emails the
 * detector gave to another subscription, which is what keeps Apple One and
 * iCloud+ apart -- with emails carrying the subscription's own amount first.
 *
 * An empty result is an honest answer, and the caller shows it as one.
 */
export function pickEvidence(
  suggestion: EvidenceSuggestion,
  emails: EvidenceEmail[],
  claimedByOthers: ReadonlySet<string> = new Set(),
): EvidencePick {
  const byId = new Map(emails.map((e) => [e.gmailId, e]));
  const namedIds = suggestion.evidenceEmailIds ?? [];

  const fromDetector = namedIds
    .map((id) => byId.get(id))
    .filter((e): e is EvidenceEmail => Boolean(e))
    .filter((e) => isBill(e, suggestion));

  if (fromDetector.length > 0) {
    return { emails: fromDetector.sort(newestFirst), named: namedIds.length, found: 0, source: "detector" };
  }

  const tokens = brandTokens(suggestion.merchantName ?? null, suggestion.serviceName);
  if (tokens.length === 0) return { emails: [], named: namedIds.length, found: 0, source: "none" };

  const matches = emails.filter((e) => {
    if (claimedByOthers.has(e.gmailId)) return false;
    const haystack = [e.subject, e.fromEmail, e.fromName].join(" ").toLowerCase().replace(/[^a-z0-9 ]/g, " ");
    return tokens.some((token) => haystack.includes(token));
  });

  const kept = matches
    .filter((e) => isBill(e, suggestion))
    .sort((a, b) => Number(amountMatches(b, suggestion)) - Number(amountMatches(a, suggestion)) || newestFirst(a, b))
    .slice(0, FALLBACK_LIMIT);

  return {
    emails: kept,
    named: namedIds.length,
    found: matches.length,
    source: kept.length > 0 ? "fallback" : "none",
  };
}

/** Payment processors and billing platforms: their receipts carry the merchant's name, so their mail stays useful. */
export const PROCESSORS = [
  "stripe.com", "paypal.com", "razorpay.com", "payu.in", "billdesk.com", "ccavenue.com",
  "braintreepayments.com", "paddle.com", "chargebee.com", "recurly.com", "fastspring.com",
  "2checkout.com", "squareup.com", "gocardless.com", "adyen.com", "instamojo.com",
  "cashfree.com", "phonepe.com", "paytm.com",
];

/**
 * Banks and card issuers whose domain does not say "bank" (anything with
 * "bank" in its domain is caught by BANK_DOMAIN_WORD). Their mail is card
 * alerts, statements and bills: never read or stored by the sync.
 */
export const BANK_AND_CARD = [
  "americanexpress.com", "aexp.com", "amex.com", "americanexpress.co.in", "amexnetwork.com", "sbicard.com",
  "scapia.cards", "citi.com", "onecard.co", "kotak.com", "hsbc.com", "hsbc.co.in", "chase.com", "capitalone.com",
  "discover.com", "barclays.com", "barclaycard.com", "icicicards.com", "uni.cards", "jupiter.money", "fi.money",
  "sliceit.com", "slice.bank", "indusind.com", "sbi.co.in", "pnbindia.in", "wellsfargo.com", "synchrony.com",
  "revolut.com", "monzo.com", "n26.com", "sofi.com", "ally.com", "navyfederal.org", "td.com", "rbc.com",
  "natwest.com", "santander.com", "standardchartered.com", "sc.com", "dbs.com", "ocbc.com", "hdfc.com",
];

/** Mail relays: they carry other companies' mail, never a brand of their own. */
const MAIL_RELAYS = ["sendgrid.net", "mailgun.org", "amazonses.com", "mandrillapp.com", "postmarkapp.com"];

/** Any bank: federalbank.co.in, hdfcbank.net, icicibank.com, axisbank.com ... */
const BANK_DOMAIN_WORD = /(^|\.)[a-z0-9-]*bank[a-z0-9-]*\./;

export function domainPart(address: string | null | undefined): string {
  return (address ?? "").toLowerCase().trim().split("@").pop()?.replace(/[>\s].*$/, "") ?? "";
}

function inList(domain: string, list: string[]): boolean {
  return list.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** A bank or card issuer's domain. A processor is not one, even though it also carries other companies' charges. */
export function isBankOrCardDomain(domain: string): boolean {
  return Boolean(domain) && (BANK_DOMAIN_WORD.test(domain) || inList(domain, BANK_AND_CARD));
}

export function isProcessorDomain(domain: string): boolean {
  return Boolean(domain) && inList(domain, PROCESSORS);
}

/** Senders that carry other companies' charges: banks, card issuers, processors, relays. Never the merchant's brand. */
export function isIntermediary(address: string | null | undefined): boolean {
  const domain = domainPart(address);
  if (!domain) return false;
  return isBankOrCardDomain(domain) || isProcessorDomain(domain) || inList(domain, MAIL_RELAYS);
}

/**
 * The address that speaks for the merchant, out of a subscription's evidence.
 *
 * A sender whose domain carries the brand wins outright. Failing that, the
 * most frequent sender that is not a bank, card issuer or payment processor.
 * Failing that, nothing -- a letter tile is better than a bank's logo.
 */
export function merchantSender(
  senders: (string | null | undefined)[],
  names: { merchantName?: string | null; serviceName?: string | null },
): string | null {
  const addresses = senders.map((s) => (s ?? "").trim().toLowerCase()).filter(Boolean);
  if (addresses.length === 0) return null;

  const tokens = brandTokens(names.merchantName ?? null, names.serviceName ?? null);
  const branded = addresses.find((address) => {
    const domain = (address.split("@").pop() ?? "").replace(/[^a-z0-9]/g, "");
    return tokens.some((token) => domain.includes(token));
  });
  if (branded) return branded;

  const counts = new Map<string, number>();
  for (const address of addresses) {
    if (isIntermediary(address)) continue;
    counts.set(address, (counts.get(address) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [address, count] of Array.from(counts.entries())) {
    if (count > bestCount) {
      best = address;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Reads a detector evidence reference however it was written.
 *
 * The prompt asks for "E3", but a model will now and then answer "[E3]",
 * "e3", "E03" or plain "3". Only "E3" was accepted before, and anything else
 * was silently dropped -- the likely reason two subscriptions came back with
 * no evidence at all. Returns the 1-based position, or null.
 */
export function parseEvidenceRef(ref: unknown): number | null {
  const match = String(ref ?? "").trim().match(/^\[?\s*E?\s*0*(\d+)\s*\]?$/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}
