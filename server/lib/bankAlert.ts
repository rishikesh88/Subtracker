/**
 * Bank and card mail: never stored.
 *
 * Verloq must never store credit card information. A bank's transaction alert,
 * a card statement or a card bill carries card details and balances, so the
 * sync keeps all of it out: such a message is dropped from the candidate list
 * before it is pre-filtered, fetched in full, saved or sent to a model.
 *
 * Payment processors (Stripe, PayPal, Paddle, Razorpay ...) are not banks: a
 * Stripe receipt "Your receipt from Railway Corporation" is the merchant's
 * receipt and stays.
 *
 * For a subscription with no receipts of its own, an alert is still useful as
 * proof that a charge happened. That is read and discarded (see
 * bankAlertEvidence below and historySearch.readBankAlertEvidence): only the
 * date, amount and currency are kept, never the message, and the message is
 * remembered only as a keyed one-way fingerprint so it is not counted twice.
 *
 * Everything here is pure, so it is tested by server/lib/bankAlert.test.ts.
 */

import { createHmac } from "crypto";
import { CARD_ALERT, dayString, isCreditCardBill } from "./statusRules";
import { domainPart, isBankOrCardDomain, isProcessorDomain } from "./evidence";
import { namesSubscription, nameSearchTerm } from "./historySearchRules";
import { currencyBesideAmount } from "./currencyCheck";
import { EmailParser } from "../services/emailParser";

/** A bank or card issuer's address (and not a payment processor). */
export function isBankOrCardSender(address: string | null | undefined): boolean {
  const domain = domainPart(address);
  return isBankOrCardDomain(domain) && !isProcessorDomain(domain);
}

/** A payment processor or billing platform, whose receipts carry the merchant's name. */
export function isProcessorSender(address: string | null | undefined): boolean {
  return isProcessorDomain(domainPart(address));
}

/** "card ending 1234", "card no. XX1234", "card ****1234": wording of a card notice. */
const CARD_ENDING = /\bcards?\s+(?:ending|ends)\b|\bcards?\s+(?:no\.?|number)?\s*(?:x{2,}|\*{2,}|•{2,})\s*\d{3,4}\b/i;
/** A merchant receipt that merely says how it was paid. */
const RECEIPT_WORDS = /\b(receipt|invoice|order|subscription|renewal)\b/i;
/** A reminder that the card will be debited later is the merchant's notice, not an alert. */
const FUTURE_DEBIT = /\bwill\s+be\s+(?:debited|charged)\b/i;

/**
 * Whether a subject and the snippet or start of the body read like a bank or
 * card alert, a credit card bill or a statement: the transaction alert words
 * the status rules use, a credit card bill or statement, or "card ending ...".
 * A receipt that only says it was paid by a card ending in 4242 is not one.
 */
export function looksLikeBankAlertOrStatement(subject: string | null | undefined, snippet: string | null | undefined): boolean {
  const text = `${subject ?? ""}\n${snippet ?? ""}`;
  if (isCreditCardBill({ subject, content: snippet })) return true;
  if (CARD_ALERT.test(text) && !FUTURE_DEBIT.test(text)) return true;
  if (CARD_ENDING.test(text) && !RECEIPT_WORDS.test(text)) return true;
  return false;
}

/**
 * Should the sync drop this message before reading it? A bank or card issuer
 * is dropped (unless it is also a processor); other senders only when the
 * subject and snippet read like an alert or a credit card bill.
 */
export function shouldDropFromSync(
  sender: string | null | undefined,
  subject: string | null | undefined,
  snippet: string | null | undefined,
): boolean {
  if (isProcessorSender(sender)) return false;
  if (isBankOrCardSender(sender)) return true;
  return looksLikeBankAlertOrStatement(subject, snippet);
}

/** Splits a list into what the sync may read and what it must not, by a sender/subject/snippet picker. */
export function splitBankMail<T>(
  items: T[],
  pick: (item: T) => { sender: string | null | undefined; subject: string | null | undefined; snippet: string | null | undefined },
): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const item of items) {
    const { sender, subject, snippet } = pick(item);
    (shouldDropFromSync(sender, subject, snippet) ? dropped : kept).push(item);
  }
  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// Read-and-discard evidence
// ---------------------------------------------------------------------------

/**
 * The secret that keys fingerprints: EVIDENCE_FINGERPRINT_SECRET, else one
 * derived from the session secret. Null when neither is set, in which case no
 * evidence is recorded (there is nothing safe to key it with).
 */
export function fingerprintSecret(env: Record<string, string | undefined> = process.env): string | null {
  const own = env.EVIDENCE_FINGERPRINT_SECRET;
  if (own) return own;
  const session = env.SESSION_SECRET;
  if (session) return createHmac("sha256", session).update("verloq:evidence-fingerprint:v1").digest("hex");
  return null;
}

/** Hex HMAC-SHA256(secret, provider + ':' + messageId): one-way, so the message cannot be found from it without the secret. */
export function evidenceFingerprint(secret: string, provider: string, messageId: string): string {
  return createHmac("sha256", secret).update(`${provider}:${messageId}`).digest("hex");
}

/** Words that make a bank message an alert about a charge. */
const CHARGE_WORDS = new RegExp(`${CARD_ALERT.source}|\\b(spent|charged|purchase[sd]?|transaction)\\b`, "i");

const parser = new EmailParser();

/**
 * Gmail query for bank alerts about a company: its name (shortest distinctive
 * word of each name, as the history search uses) with charge wording, over
 * the window. Null when no name is distinctive enough to search for.
 */
export function buildBankAlertGmailQuery(names: string[], days: number): string | null {
  const term = nameSearchTerm(names);
  if (!term) return null;
  return `${term} newer_than:${days}d (spent OR debited OR "transaction alert" OR charged)`;
}

export interface BankAlertEvidence {
  /** 'YYYY-MM-DD', from the message's date header. */
  paidAt: string;
  /** Two decimals. */
  amount: string;
  currency: string;
}

/**
 * Reads one found message as evidence of a charge, keeping only a date, an
 * amount and a currency; null when it must be dropped. The caller discards the
 * message after calling this, and nothing returned contains any of its text.
 *
 * Dropped: a credit card bill or statement; a sender that is not a bank or
 * card issuer; a message that does not name the subscription (under any of
 * its names) or does not talk about a charge; one with no amount; one whose
 * currency is not the subscription's; one with no usable date.
 */
export function bankAlertEvidence(
  message: { from: string | null | undefined; subject: string | null | undefined; body: string | null | undefined; date: string | Date | null | undefined },
  subscription: { currency: string | null | undefined; names: (string | null | undefined)[] },
): BankAlertEvidence | null {
  const subject = message.subject ?? "";
  const body = message.body ?? "";
  if (isCreditCardBill({ subject, content: body })) return null;
  if (!isBankOrCardSender(message.from)) return null;
  if (!namesSubscription({ subject, text: body }, subscription.names)) return null;
  const text = `${subject}\n${body.slice(0, 3000)}`;
  if (!CHARGE_WORDS.test(text) || FUTURE_DEBIT.test(text)) return null;

  const found = parser.readAmount(text);
  if (!found) return null;
  const currency = currencyBesideAmount(text, found.amount);
  const wanted = (subscription.currency ?? "").trim().toUpperCase();
  if (!currency || !wanted || currency.toUpperCase() !== wanted) return null;

  const date = message.date instanceof Date ? message.date : new Date(String(message.date ?? ""));
  const paidAt = isNaN(date.getTime()) ? null : dayString(date);
  if (!paidAt) return null;
  return { paidAt, amount: found.amount.toFixed(2), currency: wanted };
}

// ---------------------------------------------------------------------------
// One-time clean-up of stored bank and card emails (admin only)
// ---------------------------------------------------------------------------

export interface StoredEmailRow {
  id: string;
  /** The provider's message id (the column is called gmail_id for Outlook ids too). */
  gmailId: string;
  emailProvider: string | null;
  fromEmail: string | null;
  subject: string | null;
  /** The start of the body is enough to read it. */
  content: string | null;
}

export interface StoredPaymentRow {
  userId: string;
  subscriptionId: string;
  emailId: string | null;
  paidAt: string | Date;
  amount: string | number | null;
  currency: string | null;
  kind: string;
}

/** Which stored emails are bank or card mail: the same test the sync applies (a processor's is never one). */
export function selectBankEmails(rows: StoredEmailRow[]): StoredEmailRow[] {
  return rows.filter((r) => shouldDropFromSync(r.fromEmail, r.subject, (r.content ?? "").slice(0, 1500)));
}

/** A payment row to insert in place of a card alert's email: date, amount, currency and a fingerprint only. */
export interface FingerprintedPayment {
  userId: string;
  subscriptionId: string;
  emailId: null;
  paidAt: string;
  amount: string;
  currency: string | null;
  kind: "card_alert";
  documentType: "other";
  paidStatus: "paid";
  source: "history";
  evidenceFingerprint: string;
}

/**
 * What the clean-up does with a set of stored emails and the payments read
 * from them: which emails go, and the fingerprinted payments that replace a
 * card alert's payment (kind card_alert with an amount) so the payment history
 * survives. Every payment pointing at a selected email is deleted afterwards
 * (the replacements are separate rows); one fingerprint is never made twice.
 */
export function planBankCleanup(
  emails: StoredEmailRow[],
  paymentsOfThem: StoredPaymentRow[],
  secret: string,
): { emailIds: string[]; messageIds: string[]; replacements: FingerprintedPayment[] } {
  const selected = selectBankEmails(emails);
  const byId = new Map(selected.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const replacements: FingerprintedPayment[] = [];
  for (const p of paymentsOfThem) {
    const email = p.emailId ? byId.get(p.emailId) : undefined;
    if (!email || p.kind !== "card_alert") continue;
    if (p.amount === null || p.amount === undefined || p.amount === "" || !isFinite(Number(p.amount))) continue;
    const paidAt = dayString(p.paidAt as any);
    if (!paidAt) continue;
    const fingerprint = evidenceFingerprint(secret, email.emailProvider === "outlook" ? "outlook" : "gmail", email.gmailId);
    const key = `${p.subscriptionId}:${fingerprint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    replacements.push({
      userId: p.userId,
      subscriptionId: p.subscriptionId,
      emailId: null,
      paidAt,
      amount: Number(p.amount).toFixed(2),
      currency: p.currency,
      kind: "card_alert",
      documentType: "other",
      paidStatus: "paid",
      source: "history",
      evidenceFingerprint: fingerprint,
    });
  }
  return { emailIds: selected.map((e) => e.id), messageIds: selected.map((e) => e.gmailId), replacements };
}

/** The stored-file paths named in an email's attachment data (object storage paths only). */
export function storedFilePaths(attachmentData: string | null | undefined): string[] {
  if (!attachmentData) return [];
  try {
    const list = JSON.parse(attachmentData)?.attachments;
    if (!Array.isArray(list)) return [];
    return list.map((a: any) => a?.objectStoragePath).filter((p: unknown): p is string => typeof p === "string" && p.length > 0);
  } catch {
    return [];
  }
}
