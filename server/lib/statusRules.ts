/**
 * Subscription status: Active, Needs review or Inactive.
 *
 * Everything here is pure -- no database, no clock of its own -- so every rule
 * can be exercised by server/lib/statusRules.test.ts. The recorder
 * (server/services/subscriptionStatus.ts) gathers the inputs and stores the
 * answer; it makes no decisions of its own.
 *
 * The rules come from the approved PRD. In short:
 *
 * - A subscription is only ever flagged Needs review when we have seen it
 *   being paid (at least one counted payment), the grace period since the
 *   last payment has passed, the inbox is connected and has been synced after
 *   the grace date, the person has not said "still active", and it is not
 *   paused. Anything we are unsure about stays Active: a false "Needs review"
 *   costs trust, a missed one costs nothing that the next receipt won't fix.
 * - Failed payments and refunds are not payments.
 * - A cancellation makes it Inactive once access has ended; until then it is
 *   Active with the date access ends.
 * - A payment dated after it went Inactive brings it back.
 *
 * All dates are handled as whole days in UTC.
 */

export const PAYMENT_KINDS = ["receipt", "invoice", "card_alert", "failed", "refund", "pause"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const PAYMENT_SOURCES = ["sync", "approval", "history"] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

export type LifecycleStatus = "active" | "needs_review" | "inactive";
export type InactiveSource = "email" | "user";

export type LifecycleReason =
  | "no_payments"
  | "paid_recently"
  | "payment_failed"
  | "paid_after_inactive"
  | "paused"
  | "cancelled_access_until"
  | "cancelled"
  | "refunded_and_cancelled"
  | "marked_inactive"
  | "kept_active"
  | "inbox_disconnected"
  | "not_synced_recently"
  | "no_recent_payment";

/** The reason codes in plain words, for the admin console and later screens. */
export const REASON_TEXT: Record<LifecycleReason, string> = {
  no_payments: "No payment seen yet, so never flagged",
  paid_recently: "Paid recently",
  payment_failed: "A payment failed since the last one that went through",
  paid_after_inactive: "Paid again after it had stopped",
  paused: "Paused",
  cancelled_access_until: "Cancelled, but paid up until the end date",
  cancelled: "Cancelled",
  refunded_and_cancelled: "Cancelled and refunded",
  marked_inactive: "Marked inactive by the user",
  kept_active: "User said it is still active",
  inbox_disconnected: "Overdue, but the inbox is not connected",
  not_synced_recently: "Overdue, but the inbox has not been synced since it was due",
  no_recent_payment: "No payment seen since it was due",
};

type DayLike = Date | string | null | undefined;

export interface LifecyclePayment {
  paidAt: DayLike;
  /** null means the email did not show an amount; it still counts. */
  amount: number | string | null;
  currency: string | null;
  kind: PaymentKind | string;
  pausedUntil?: DayLike;
}

export interface LifecycleInput {
  frequency: string | null | undefined;
  payments: LifecyclePayment[];
  cancellation: { cancelledAt: DayLike; endsOn: DayLike } | null;
  overrides: {
    markedInactiveAt: DayLike;
    stillActiveTaps: number | null | undefined;
    stillActiveUntil: DayLike;
  };
  inboxConnected: boolean;
  inboxSyncedThrough: DayLike;
}

export interface LifecycleResult {
  status: LifecycleStatus;
  reason: LifecycleReason;
  lastPaymentAt: string | null;
  expectedNextAt: string | null;
  endsOn: string | null;
  inactiveSince: string | null;
  inactiveSource: InactiveSource | null;
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** A date or 'YYYY-MM-DD' as UTC midnight of that day, or null. */
export function toDay(value: DayLike): Date | null {
  if (value === null || value === undefined || value === "") return null;
  let d: Date;
  if (value instanceof Date) {
    d = value;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    d = new Date(value + "T00:00:00Z");
  } else {
    d = new Date(value);
  }
  if (isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** 'YYYY-MM-DD', the shape the date columns store. */
export function dayString(value: DayLike): string | null {
  const d = toDay(value);
  return d ? d.toISOString().slice(0, 10) : null;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** Adds months, landing on the last day of a shorter month rather than spilling over. */
function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay)));
}

function normaliseFrequency(frequency: string | null | undefined): "weekly" | "monthly" | "quarterly" | "yearly" {
  switch ((frequency || "").toLowerCase()) {
    case "weekly":
      return "weekly";
    case "quarterly":
      return "quarterly";
    case "yearly":
    case "annual":
    case "annually":
      return "yearly";
    default:
      // Unknown frequencies are treated as monthly, as billingDate.ts does.
      return "monthly";
  }
}

/** One or more billing periods on from a day. */
export function addPeriods(d: Date, frequency: string | null | undefined, n = 1): Date {
  switch (normaliseFrequency(frequency)) {
    case "weekly":
      return addDays(d, 7 * n);
    case "quarterly":
      return addMonths(d, 3 * n);
    case "yearly":
      return addMonths(d, 12 * n);
    default:
      return addMonths(d, n);
  }
}

/**
 * The last day a subscription can go without a payment before it may be
 * flagged: weekly 14 days, monthly 2 months, quarterly 6 months, yearly 14
 * months, all from the last payment.
 */
export function graceEnd(lastPayment: Date, frequency: string | null | undefined): Date {
  switch (normaliseFrequency(frequency)) {
    case "weekly":
      return addDays(lastPayment, 14);
    case "quarterly":
      return addMonths(lastPayment, 6);
    case "yearly":
      return addMonths(lastPayment, 14);
    default:
      return addMonths(lastPayment, 2);
  }
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

const COUNTED_KINDS = new Set(["receipt", "invoice", "card_alert"]);
/** When two records are one charge, the merchant's receipt is the one kept. */
const KIND_PREFERENCE: Record<string, number> = { receipt: 0, invoice: 1, card_alert: 2 };

function amountOf(p: LifecyclePayment): number | null {
  if (p.amount === null || p.amount === undefined || p.amount === "") return null;
  const n = Number(p.amount);
  return isFinite(n) ? n : null;
}

function sameCurrency(a: string | null, b: string | null): boolean {
  // A record with no currency is not evidence of a different one.
  if (!a || !b) return true;
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

export interface CountedPayment {
  day: Date;
  amount: number | null;
  currency: string | null;
  kind: string;
}

/**
 * The payments that count, oldest first: receipts, invoices and card alerts,
 * never failed payments, refunds or pauses, and never a zero charge (a free
 * trial's "receipt" is not a payment).
 *
 * One charge, one payment: two records of the same amount (within one unit of
 * currency) within three days are the same charge -- a receipt and the card
 * alert for it, or the same receipt arriving in two inboxes -- and count once,
 * keeping the receipt over the invoice over the card alert. Records without an
 * amount are never merged, since there is nothing to say they match.
 */
export function countedPayments(payments: LifecyclePayment[]): CountedPayment[] {
  const candidates: CountedPayment[] = [];
  for (const p of payments) {
    if (!COUNTED_KINDS.has(String(p.kind))) continue;
    const day = toDay(p.paidAt);
    if (!day) continue;
    const amount = amountOf(p);
    if (amount !== null && amount <= 0) continue;
    candidates.push({ day, amount, currency: p.currency ?? null, kind: String(p.kind) });
  }

  candidates.sort(
    (a, b) =>
      (KIND_PREFERENCE[a.kind] ?? 9) - (KIND_PREFERENCE[b.kind] ?? 9) || a.day.getTime() - b.day.getTime(),
  );

  const kept: CountedPayment[] = [];
  for (const c of candidates) {
    const duplicate =
      c.amount !== null &&
      kept.some(
        (k) =>
          k.amount !== null &&
          Math.abs(k.amount - c.amount!) <= 1 &&
          sameCurrency(k.currency, c.currency) &&
          Math.abs(k.day.getTime() - c.day.getTime()) <= 3 * DAY_MS,
      );
    if (!duplicate) kept.push(c);
  }
  return kept.sort((a, b) => a.day.getTime() - b.day.getTime());
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

export function computeLifecycle(input: LifecycleInput, now: Date): LifecycleResult {
  const today = toDay(now)!;
  const counted = countedPayments(input.payments);
  const last = counted.length ? counted[counted.length - 1] : null;
  const lastDay = last?.day ?? null;

  const base = {
    lastPaymentAt: dayString(lastDay),
    expectedNextAt: lastDay ? dayString(addPeriods(lastDay, input.frequency, 1)) : null,
    endsOn: null as string | null,
    inactiveSince: null as string | null,
    inactiveSource: null as InactiveSource | null,
  };
  const result = (status: LifecycleStatus, reason: LifecycleReason, extra: Partial<LifecycleResult> = {}): LifecycleResult => ({
    status,
    reason,
    ...base,
    ...extra,
  });

  /** Set when it had stopped and a later payment shows it started again. */
  let resumed = false;

  // --- 1. The person said it has stopped ---------------------------------
  const markedDay = toDay(input.overrides.markedInactiveAt);
  if (markedDay) {
    if (lastDay && lastDay.getTime() > markedDay.getTime()) {
      resumed = true;
    } else {
      return result("inactive", "marked_inactive", {
        inactiveSince: dayString(markedDay),
        inactiveSource: "user",
      });
    }
  }

  // --- 2. An email said it was cancelled ---------------------------------
  const cancelledDay = toDay(input.cancellation?.cancelledAt);
  const endsDay = toDay(input.cancellation?.endsOn);
  if (!resumed && (cancelledDay || endsDay)) {
    const stoppedDay = (cancelledDay ?? endsDay)!;
    if (lastDay && lastDay.getTime() > stoppedDay.getTime()) {
      // Paid after cancelling: re-subscribed. The cancellation no longer applies.
      resumed = true;
    } else {
      if (fullyRefunded(input.payments, last)) {
        const refundDay = latestRefundDay(input.payments);
        return result("inactive", "refunded_and_cancelled", {
          endsOn: dayString(endsDay),
          inactiveSince: dayString(cancelledDay ?? refundDay ?? today),
          inactiveSource: "email",
        });
      }
      if (endsDay && endsDay.getTime() > today.getTime()) {
        return result("active", "cancelled_access_until", { endsOn: dayString(endsDay) });
      }
      return result("inactive", "cancelled", {
        endsOn: dayString(endsDay),
        inactiveSince: dayString(endsDay ?? cancelledDay),
        inactiveSource: "email",
      });
    }
  }

  // --- 3. Never seen a payment: nothing to measure from, never flagged ---
  if (!lastDay) return result("active", "no_payments");

  // --- 4. Paused past today ----------------------------------------------
  const pausedPastToday = input.payments.some((p) => {
    if (p.kind !== "pause") return false;
    const until = toDay(p.pausedUntil);
    return Boolean(until && until.getTime() > today.getTime());
  });
  if (pausedPastToday) return result("active", "paused");

  // --- 5. Inside the grace period ------------------------------------------
  const grace = graceEnd(lastDay, input.frequency);
  if (today.getTime() <= grace.getTime()) {
    if (resumed) return result("active", "paid_after_inactive");
    const failedSince = input.payments.some((p) => {
      const d = toDay(p.paidAt);
      return p.kind === "failed" && d !== null && d.getTime() > lastDay.getTime();
    });
    return result("active", failedSince ? "payment_failed" : "paid_recently");
  }

  // --- 6. Overdue, but can we trust that we would have seen a payment? ----
  if (!input.inboxConnected) return result("active", "inbox_disconnected");
  const synced = toDay(input.inboxSyncedThrough);
  if (!synced || synced.getTime() <= grace.getTime()) return result("active", "not_synced_recently");

  // --- 7. The person told us it is still active ---------------------------
  const taps = input.overrides.stillActiveTaps ?? 0;
  if (taps >= 2) return result("active", "kept_active");
  const holdUntil = toDay(input.overrides.stillActiveUntil);
  if (holdUntil && holdUntil.getTime() >= today.getTime()) return result("active", "kept_active");

  return result("needs_review", "no_recent_payment");
}

/** A refund at least as large as the last payment, on or after it. */
function fullyRefunded(payments: LifecyclePayment[], last: CountedPayment | null): boolean {
  if (!last || last.amount === null) return false;
  return payments.some((p) => {
    if (p.kind !== "refund") return false;
    const d = toDay(p.paidAt);
    const amount = amountOf(p);
    return (
      d !== null &&
      d.getTime() >= last.day.getTime() &&
      amount !== null &&
      amount >= last.amount! - 1 &&
      sameCurrency(p.currency, last.currency)
    );
  });
}

function latestRefundDay(payments: LifecyclePayment[]): Date | null {
  let latest: Date | null = null;
  for (const p of payments) {
    if (p.kind !== "refund") continue;
    const d = toDay(p.paidAt);
    if (d && (!latest || d.getTime() > latest.getTime())) latest = d;
  }
  return latest;
}

/**
 * How long a "Still active" tap holds: until two periods after the next
 * expected payment. The next expected payment is rolled forward to today or
 * later first -- a tap is only offered once it is overdue, so the one computed
 * from the last payment is already in the past, and holding from there would
 * give almost no time at all.
 */
export function stillActiveUntil(
  frequency: string | null | undefined,
  lastPaymentAt: DayLike,
  now: Date,
): string {
  const today = toDay(now)!;
  const last = toDay(lastPaymentAt);
  let next = last ? addPeriods(last, frequency, 1) : today;
  for (let i = 0; next.getTime() < today.getTime() && i < 2000; i++) {
    next = addPeriods(next, frequency, 1);
  }
  return dayString(addPeriods(next, frequency, 2))!;
}

// ---------------------------------------------------------------------------
// Reading a payment from an email
// ---------------------------------------------------------------------------

/*
 * Two sets of word rules. A subject line is short and says what the email is
 * about, so it is read generously. A body is read strictly, in the past tense:
 * receipts routinely carry footers such as "see our refund policy" or "pause
 * your subscription any time", and reading those as a refund or a pause would
 * stop a real payment from counting.
 */
interface KindRules { failed: RegExp; refund: RegExp; pause: RegExp }

const SUBJECT_RULES: KindRules = {
  failed: /\b(payment|charge|transaction|renewal)\s+(has\s+)?(failed|declined|unsuccessful|was\s+declined|did\s+not\s+go\s+through)|\b(card|payment)\s+(was\s+)?declined|could\s*n[o']?t\s+(process|charge)|could\s+not\s+(process|charge)|unable\s+to\s+(process|charge)|update\s+your\s+payment\s+(method|details|information)|payment\s+issue|past\s+due/i,
  refund: /\brefund(ed|s)?\b/i,
  pause: /\bpaused\b|\bpause\s+(confirmed|confirmation)\b/i,
};

const BODY_RULES: KindRules = {
  failed: /\b(payment|charge|renewal)\s+(has\s+)?(failed|was\s+declined|was\s+unsuccessful)|could\s*n[o']?t\s+(process|charge)|could\s+not\s+(process|charge)|unable\s+to\s+(process|charge)\s+your/i,
  refund: /\brefund\s+(has\s+been|was|is\s+being)\s+(issued|processed|initiated|approved)|we('ve|\s+have)\s+(issued\s+(you\s+)?a\s+refund|refunded)|(has|have)\s+been\s+refunded|was\s+refunded/i,
  pause: /\b(has\s+been|is\s+now|was)\s+paused|\bpaused\s+(until|till|through)|we('ve|\s+have)\s+paused/i,
};

const CARD_ALERT = /\b(spent\s+(on|at|using)|debited|transaction\s+alert|txn)\b/i;
const RECEIPT = /\b(receipt|payment\s+(received|confirmation|successful|confirmed|complete)|thank\s+you\s+for\s+your\s+(payment|purchase|order)|thanks\s+for\s+your\s+(payment|purchase|order)|you('ve|\s+have)\s+(been\s+)?(paid|charged)|has\s+been\s+(charged|renewed|paid)|was\s+(charged|renewed|paid)|successfully\s+(renewed|paid|charged)|order\s+confirmation|we('ve|\s+have)\s+charged|amount\s+paid|paid\s+on)\b/i;
const INVOICE = /\b(invoice|bill\s+(is\s+)?(ready|generated|available)|your\s+bill|statement)\b/i;
const REMINDER = /\b(will\s+be\s+(charged|billed|renewed|debited)|will\s+(auto[-\s]?)?renew|renews\s+(on|in|soon)|upcoming\s+(payment|charge|renewal|bill)|renewal\s+reminder|reminder|trial\s+(ends|ending|expires|is\s+ending)|expir(es|ing)\s+(soon|on|in)|is\s+about\s+to)\b/i;
const CANCELLED = /\b(cancel(l)?ed|cancel(l)?ation|has\s+ended|will\s+end|subscription\s+ended)\b/i;

const PAUSED_UNTIL = /\bpaused?\b[^.]{0,60}?\b(?:until|till|through)\s+([A-Z][a-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\.?,?\s+\d{4}|\d{4}-\d{2}-\d{2})/i;

function classifyText(text: string, rules: KindRules): PaymentKind | "skip" | null {
  if (rules.failed.test(text)) return "failed";
  if (rules.refund.test(text)) return "refund";
  if (rules.pause.test(text)) return "pause";
  if (CARD_ALERT.test(text)) return "card_alert";
  if (RECEIPT.test(text)) return "receipt";
  if (INVOICE.test(text)) return "invoice";
  if (REMINDER.test(text)) return "skip";
  if (CANCELLED.test(text)) return "skip";
  return null;
}

/** A loosely written date ("October 5, 2026", "5 Oct 2026", "2026-10-05") as 'YYYY-MM-DD'. */
export function parseLooseDay(text: string | null | undefined, now: Date = new Date()): string | null {
  if (!text) return null;
  const cleaned = String(text).replace(/(\d)(st|nd|rd|th)\b/gi, "$1").replace(/\./g, "");
  const iso = /^\s*(\d{4}-\d{2}-\d{2})/.exec(cleaned);
  const d = iso ? toDay(iso[1]) : toDay(new Date(cleaned + (/(UTC|GMT|Z)$/i.test(cleaned) ? "" : " UTC")));
  if (!d) return null;
  // Out of any plausible range: treat as unreadable rather than store it.
  const min = Date.UTC(2000, 0, 1);
  const max = Date.UTC(now.getUTCFullYear() + 10, now.getUTCMonth(), now.getUTCDate());
  if (d.getTime() < min || d.getTime() > max) return null;
  return dayString(d);
}

/**
 * What kind of payment an email records, from its subject and the start of
 * its body, or null when it records none (a renewal reminder, a cancellation
 * notice, a newsletter). Simple word rules only; no model is asked.
 *
 * The subject is read first and on its own, because a receipt's body often
 * mentions the next renewal ("your plan renews on 5 Nov") and would otherwise
 * read as a reminder. The body is only consulted when the subject says
 * nothing either way. An email the rules cannot place counts as a receipt
 * when it shows an amount -- it was linked to the subscription as evidence of
 * a charge in the first place.
 */
export function classifyPaymentEmail(email: {
  subject?: string | null;
  content?: string | null;
  amount?: number | string | null;
}, now: Date = new Date()): { kind: PaymentKind; pausedUntil: string | null } | null {
  const subject = email.subject ?? "";
  const snippet = (email.content ?? "").slice(0, 600);

  let verdict = classifyText(subject, SUBJECT_RULES);
  if (verdict === null) verdict = classifyText(snippet, BODY_RULES);
  if (verdict === "skip") return null;

  if (verdict === null) {
    const amount = email.amount === null || email.amount === undefined || email.amount === "" ? null : Number(email.amount);
    if (amount === null || !isFinite(amount) || amount <= 0) return null;
    verdict = "receipt";
  }

  let pausedUntil: string | null = null;
  if (verdict === "pause") {
    const m = PAUSED_UNTIL.exec(subject + "\n" + snippet);
    pausedUntil = m ? parseLooseDay(m[1], now) : null;
  }
  return { kind: verdict, pausedUntil };
}
