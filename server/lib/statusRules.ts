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
 * - Failed payments and refunds are not payments. Neither is a bill (an
 *   invoice that is not shown as paid), a pending or "please confirm" notice.
 *   Only receipts and card alerts count; a bill counts only through the
 *   receipt that pairs with it.
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
  /** For a bill (kind 'invoice'), the day the email arrived. */
  paidAt: DayLike;
  /** A bill's due date, when the email states one. */
  dueOn?: DayLike;
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
  /** The newest bill that no receipt has paired with yet (open or not), for "Last bill". */
  lastBillAt: string | null;
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

/**
 * Only a receipt or a bank's card alert is a payment. An invoice is a bill:
 * it says what is owed, not that it was paid. (An invoice whose own text says
 * it was paid is read as a receipt before it gets here; see classifyPaymentEmail.)
 */
const COUNTED_KINDS = new Set(["receipt", "card_alert"]);
/** When two records are one charge, the merchant's receipt is the one kept. */
const KIND_PREFERENCE: Record<string, number> = { receipt: 0, card_alert: 1 };

/** How far a foreign-currency receipt and a card alert may be apart and still be one charge. */
const CROSS_CURRENCY_DAYS = 3;
/** How far a derived exchange rate may be from a pair's own ratio. */
const RATE_TOLERANCE = 0.12;
/** A receipt can arrive this long before a bill's date ... */
const BILL_RECEIPT_BEFORE_DAYS = 3;
/** ... and this long after the bill's date (or its due date, when stated). */
const BILL_RECEIPT_AFTER_DAYS = 20;

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

function currencyOf(c: string | null): string | null {
  const v = (c ?? "").trim().toUpperCase();
  return v || null;
}

export interface CountedPayment {
  day: Date;
  amount: number | null;
  currency: string | null;
  kind: string;
  /** Position of the record in the list given (only so a screen can say which record this is). */
  ref?: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface Merged {
  kept: CountedPayment[];
  /** card-alert amount per unit of receipt amount, keyed "RECEIPTCUR>ALERTCUR", from the pairs merged. */
  rates: Map<string, number>;
  /** Every record that could count, before merging (each has its `ref`). */
  candidates: CountedPayment[];
  /** A receipt with no amount that is not counted, and the payment with an amount that covers it. */
  covered: Map<CountedPayment, CountedPayment>;
}

/**
 * The charges that count, before they are sorted for use.
 *
 * Same currency: two records of the same amount (within one unit) within
 * three days are one charge, keeping the receipt over the card alert.
 *
 * Different currencies: a receipt in a foreign currency and the card alert
 * for it (in the card's currency) are one charge when they are within three
 * days of each other and unambiguous -- the receipt has exactly one alert
 * candidate and the alert exactly one receipt. No exchange rates are
 * available here, so the amounts cannot be compared directly. Instead, when a
 * subscription has several such pairs, each pair's ratio (alert amount per
 * receipt amount) must be within 12% of the middle ratio of all the pairs
 * of the same two currencies (counting its own); a lone pair has nothing to be
 * compared with and is merged on date and uniqueness alone. Records without an amount or a
 * currency are never merged this way.
 *
 * Two receipts in different currencies are paired the same way (a bank's or
 * wallet's receipt for the merchant's); the one in the subscription's
 * currency is kept, else the later one.
 *
 * One narrow exception: a receipt with no amount (typically a welcome email
 * that says "your payment method has been charged") is not a payment of its
 * own when the same subscription has a counted receipt or card alert with an
 * amount within three days of it. It stays recorded; it is only not counted.
 * A receipt with no amount and no such neighbour counts as before.
 */
function mergeCharges(payments: LifecyclePayment[], preferCurrency: string | null = null): Merged {
  const candidates: CountedPayment[] = [];
  payments.forEach((p, ref) => {
    if (!COUNTED_KINDS.has(String(p.kind))) return;
    const day = toDay(p.paidAt);
    if (!day) return;
    const amount = amountOf(p);
    if (amount !== null && amount <= 0) return;
    candidates.push({ day, amount, currency: p.currency ?? null, kind: String(p.kind), ref });
  });
  const all = [...candidates];

  candidates.sort(
    (a, b) =>
      (KIND_PREFERENCE[a.kind] ?? 9) - (KIND_PREFERENCE[b.kind] ?? 9) || a.day.getTime() - b.day.getTime(),
  );

  let kept: CountedPayment[] = [];
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

  // Foreign-currency receipt + card alert.
  const receipts = kept.filter((k) => k.kind === "receipt" && k.amount !== null && currencyOf(k.currency));
  const alerts = kept.filter((k) => k.kind === "card_alert" && k.amount !== null && currencyOf(k.currency));
  const near = new Map<CountedPayment, CountedPayment[]>();
  const alertNear = new Map<CountedPayment, CountedPayment[]>();
  for (const r of receipts) {
    for (const a of alerts) {
      if (currencyOf(r.currency) === currencyOf(a.currency)) continue;
      if (Math.abs(r.day.getTime() - a.day.getTime()) > CROSS_CURRENCY_DAYS * DAY_MS) continue;
      near.set(r, [...(near.get(r) ?? []), a]);
      alertNear.set(a, [...(alertNear.get(a) ?? []), r]);
    }
  }
  const pairs: { receipt: CountedPayment; alert: CountedPayment; key: string; ratio: number }[] = [];
  for (const [r, list] of Array.from(near.entries())) {
    if (list.length !== 1) continue;
    const a = list[0];
    if ((alertNear.get(a) ?? []).length !== 1) continue;
    pairs.push({ receipt: r, alert: a, key: `${currencyOf(r.currency)}>${currencyOf(a.currency)}`, ratio: a.amount! / r.amount! });
  }
  const dropped = new Set<CountedPayment>();
  const rates = new Map<string, number>();
  const accepted: typeof pairs = [];
  for (const pair of pairs) {
    const middle = median(pairs.filter((o) => o.key === pair.key).map((o) => o.ratio));
    if (Math.abs(pair.ratio / middle - 1) > RATE_TOLERANCE) continue;
    dropped.add(pair.alert);
    accepted.push(pair);
  }
  for (const key of Array.from(new Set(accepted.map((p) => p.key)))) {
    rates.set(key, median(accepted.filter((p) => p.key === key).map((p) => p.ratio)));
  }
  kept = kept.filter((k) => !dropped.has(k));

  // Two receipts in different currencies (the merchant's, and a bank's or
  // wallet's own receipt for the same charge). Same tests as above: within
  // three days, each the other's only candidate, and the pair's ratio within
  // 12% of the middle ratio of the pairs of the same two currencies.
  const rcpts = kept.filter((k) => k.kind === "receipt" && k.amount !== null && currencyOf(k.currency));
  const rNear = new Map<CountedPayment, CountedPayment[]>();
  for (const r of rcpts) {
    for (const o of rcpts) {
      if (r === o || currencyOf(r.currency) === currencyOf(o.currency)) continue;
      if (Math.abs(r.day.getTime() - o.day.getTime()) > CROSS_CURRENCY_DAYS * DAY_MS) continue;
      rNear.set(r, [...(rNear.get(r) ?? []), o]);
    }
  }
  const rPairs: { a: CountedPayment; b: CountedPayment; key: string; ratio: number }[] = [];
  for (const [r, list] of Array.from(rNear.entries())) {
    if (list.length !== 1) continue;
    const o = list[0];
    if ((rNear.get(o) ?? []).length !== 1) continue;
    // Each pair once, oriented by currency code so the ratio does not depend on order.
    if (currencyOf(r.currency)! > currencyOf(o.currency)!) continue;
    rPairs.push({ a: r, b: o, key: `${currencyOf(r.currency)}|${currencyOf(o.currency)}`, ratio: o.amount! / r.amount! });
  }
  const prefer = currencyOf(preferCurrency);
  const rDropped = new Set<CountedPayment>();
  for (const pair of rPairs) {
    const middle = median(rPairs.filter((o) => o.key === pair.key).map((o) => o.ratio));
    if (Math.abs(pair.ratio / middle - 1) > RATE_TOLERANCE) continue;
    const { a, b } = pair;
    let keep: CountedPayment;
    if (prefer && (currencyOf(a.currency) === prefer) !== (currencyOf(b.currency) === prefer)) {
      keep = currencyOf(a.currency) === prefer ? a : b;
    } else if (a.day.getTime() !== b.day.getTime()) {
      keep = a.day.getTime() > b.day.getTime() ? a : b;
    } else {
      keep = (a.ref ?? 0) > (b.ref ?? 0) ? a : b;
    }
    rDropped.add(keep === a ? b : a);
  }
  kept = kept.filter((k) => !rDropped.has(k));

  // A receipt with no amount next to a counted payment with an amount.
  const covered = new Map<CountedPayment, CountedPayment>();
  const withAmount = kept.filter((k) => k.amount !== null);
  for (const k of kept) {
    if (k.kind !== "receipt" || k.amount !== null) continue;
    let cover: CountedPayment | null = null;
    for (const o of withAmount) {
      const gap = Math.abs(o.day.getTime() - k.day.getTime());
      if (gap > 3 * DAY_MS) continue;
      if (!cover || gap < Math.abs(cover.day.getTime() - k.day.getTime())) cover = o;
    }
    if (cover) covered.set(k, cover);
  }
  kept = kept.filter((k) => !covered.has(k));
  return { kept, rates, candidates: all, covered };
}

/**
 * The payments that count, oldest first: receipts and card alerts, never
 * invoices (bills), failed payments, refunds or pauses, and never a zero
 * charge (a free trial's "receipt" is not a payment).
 *
 * One charge, one payment: see mergeCharges for when two records are one
 * charge. Records without an amount are never merged, since there is nothing
 * to say they match; the one exception is a receipt with no amount that sits
 * within three days of a counted payment with an amount (see mergeCharges).
 */
export function countedPayments(payments: LifecyclePayment[], preferCurrency: string | null = null): CountedPayment[] {
  return mergeCharges(payments, preferCurrency).kept.sort((a, b) => a.day.getTime() - b.day.getTime());
}

export interface BillRecord {
  day: Date;
  dueOn: Date | null;
  amount: number | null;
  currency: string | null;
  /** Position of the record in the list given. */
  ref?: number;
}

export interface BillReconciliation {
  /** Bills a receipt or card alert paid: they show once, as that payment. */
  paired: number;
  /** Old bills nothing paired with: "Bill, receipt not found". Not payments. */
  noReceipt: BillRecord[];
  /** Recent bills still inside the window a receipt may yet arrive in. */
  open: BillRecord[];
  /** Positions (in the list given) of the bills a payment paid. */
  pairedRefs: number[];
}

/** Plain words for the list of payments (and what a later screen shows). */
export const BILL_NO_RECEIPT_LABEL = "Bill, receipt not found";

/**
 * Pairs bills with the payments that paid them. A receipt (or card alert)
 * belongs to a bill when the amount is the same (within one unit, same
 * currency; across currencies only when an exchange rate was derived from this
 * subscription's own receipt/alert pairs, within 12%) and it is dated from 3
 * days before the bill to 20 days after the later of the bill's date and its
 * due date. Each payment pairs with one bill, the nearest in time first. A
 * bill with no amount cannot be matched.
 */
export function reconcileBills(payments: LifecyclePayment[], now: Date, preferCurrency: string | null = null): BillReconciliation {
  const today = toDay(now)!;
  const { kept, rates } = mergeCharges(payments, preferCurrency);
  const bills: BillRecord[] = [];
  payments.forEach((p, ref) => {
    if (p.kind !== "invoice") return;
    const day = toDay(p.paidAt);
    if (!day) return;
    bills.push({ day, dueOn: toDay(p.dueOn), amount: amountOf(p), currency: p.currency ?? null, ref });
  });
  bills.sort((a, b) => a.day.getTime() - b.day.getTime());

  const amountsFit = (bill: BillRecord, pay: CountedPayment): boolean => {
    if (bill.amount === null || pay.amount === null) return false;
    const bc = currencyOf(bill.currency), pc = currencyOf(pay.currency);
    if (!bc || !pc || bc === pc) return Math.abs(bill.amount - pay.amount) <= 1;
    const forward = rates.get(`${bc}>${pc}`);
    const backward = rates.get(`${pc}>${bc}`);
    const expected = forward !== undefined ? bill.amount * forward : backward !== undefined ? bill.amount / backward : null;
    return expected !== null && Math.abs(pay.amount - expected) <= pay.amount * RATE_TOLERANCE;
  };

  const used = new Set<CountedPayment>();
  const result: BillReconciliation = { paired: 0, noReceipt: [], open: [], pairedRefs: [] };
  for (const bill of bills) {
    const anchor = bill.dueOn && bill.dueOn.getTime() > bill.day.getTime() ? bill.dueOn : bill.day;
    const from = bill.day.getTime() - BILL_RECEIPT_BEFORE_DAYS * DAY_MS;
    const to = anchor.getTime() + BILL_RECEIPT_AFTER_DAYS * DAY_MS;
    let best: CountedPayment | null = null;
    for (const pay of kept) {
      if (used.has(pay) || pay.day.getTime() < from || pay.day.getTime() > to || !amountsFit(bill, pay)) continue;
      const gap = Math.abs(pay.day.getTime() - bill.day.getTime());
      const bestGap = best ? Math.abs(best.day.getTime() - bill.day.getTime()) : Infinity;
      // The receipt is preferred over a card alert when equally near.
      if (gap < bestGap || (gap === bestGap && best && pay.kind === "receipt" && best.kind !== "receipt")) best = pay;
    }
    if (best) {
      used.add(best);
      result.paired++;
      if (bill.ref !== undefined) result.pairedRefs.push(bill.ref);
    } else if (to < today.getTime()) {
      result.noReceipt.push(bill);
    } else {
      result.open.push(bill);
    }
  }
  return result;
}

export interface PaymentExplanation {
  counted: boolean;
  /** Plain words for why the record does or does not count. */
  note: string;
}

const EXPLAIN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function explainDay(d: Date): string {
  return `${d.getUTCDate()} ${EXPLAIN_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * For each record given (same order), whether it counts as a payment and why
 * not when it does not. Uses the same merging and bill pairing as the counts,
 * so a screen listing the records never disagrees with them. Read only.
 */
export function explainPayments(payments: LifecyclePayment[], now: Date, preferCurrency: string | null = null): PaymentExplanation[] {
  const merged = mergeCharges(payments, preferCurrency);
  const bills = reconcileBills(payments, now, preferCurrency);
  const keptRefs = new Set(merged.kept.map((k) => k.ref));
  const candidateRefs = new Set(merged.candidates.map((c) => c.ref));
  const coveredBy = new Map<number, CountedPayment>();
  Array.from(merged.covered.entries()).forEach(([k, c]) => { if (k.ref !== undefined) coveredBy.set(k.ref, c); });
  const noReceiptRefs = new Set(bills.noReceipt.map((b) => b.ref));
  const pairedRefs = new Set(bills.pairedRefs);
  return payments.map((p, i): PaymentExplanation => {
    const kind = String(p.kind);
    if (kind === "invoice") {
      if (pairedRefs.has(i)) return { counted: false, note: "Bill, paired with a receipt (shows as that payment)" };
      if (noReceiptRefs.has(i)) return { counted: false, note: BILL_NO_RECEIPT_LABEL };
      return { counted: false, note: "Bill, receipt may still come" };
    }
    if (!COUNTED_KINDS.has(kind)) return { counted: false, note: `Not counted: ${kind.replace("_", " ")}` };
    if (!candidateRefs.has(i)) return { counted: false, note: "Not counted: zero amount or no date" };
    if (keptRefs.has(i)) return { counted: true, note: "Counts as a payment" };
    const cover = coveredBy.get(i);
    if (cover) return { counted: false, note: `Not counted: no amount, covered by ${explainDay(cover.day)} payment` };
    return { counted: false, note: "Not counted: same charge as another record" };
  });
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
    lastBillAt: lastBillDay(input.payments, now),
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

/** The newest bill nothing has paid yet, as a day. */
function lastBillDay(payments: LifecyclePayment[], now: Date): string | null {
  const open = reconcileBills(payments, now);
  const all = [...open.noReceipt, ...open.open];
  if (all.length === 0) return null;
  return dayString(new Date(Math.max(...all.map((b) => b.day.getTime()))));
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
  failed: /\b(payment|charge|transaction|renewal)\s+(of\s+\S+\s+)?(has\s+)?(failed|declined|unsuccessful|was\s+declined|did\s+not\s+go\s+through)|\b(card|payment)\s+(was\s+)?declined|could\s*n[o']?t\s+(process|charge)|could\s+not\s+(process|charge)|unable\s+to\s+(process|charge)|update\s+your\s+payment\s+(method|details|information)|payment\s+issue|past\s+due/i,
  refund: /\brefund(ed|s)?\b/i,
  pause: /\bpaused\b|\bpause\s+(confirmed|confirmation)\b/i,
};

const BODY_RULES: KindRules = {
  failed: /\b(payment|charge|renewal)\s+(of\s+\S+\s+)?(has\s+)?(failed|was\s+declined|was\s+unsuccessful)|could\s*n[o']?t\s+(process|charge)|could\s+not\s+(process|charge)|unable\s+to\s+(process|charge)\s+your/i,
  refund: /\brefund\s+(has\s+been|was|is\s+being)\s+(issued|processed|initiated|approved)|we('ve|\s+have)\s+(issued\s+(you\s+)?a\s+refund|refunded)|(has|have)\s+been\s+refunded|was\s+refunded/i,
  pause: /\b(has\s+been|is\s+now|was)\s+paused|\bpaused\s+(until|till|through)|we('ve|\s+have)\s+paused/i,
};

const CARD_ALERT = /\b(spent\s+(on|at|using)|debited|transaction\s+alert|txn)\b/i;

const DATE_PATTERN = "([A-Z][a-z]+\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}(?:st|nd|rd|th)?\\s+[A-Z][a-z]+\\.?,?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2})";

/*
 * Paid or due. Two word lists, read together with the document type.
 *
 * PAID: the email, or the file attached to it, says money was received.
 * "receipt" itself counts: a receipt is by definition for something paid.
 * DUE: it says money is still owed -- a bill. A bill is an invoice that is
 * not shown as paid, and does not count as a payment.
 */
const PAID = new RegExp(
  "\\b(receipt|payment\\s+(received|confirmation|successful|confirmed|complete|made)|" +
  "(we('ve|\\s+have)\\s+)?received\\s+(a|your)\\s+payment|thank\\s+you\\s+for\\s+your\\s+(payment|purchase|order)|" +
  "thanks\\s+for\\s+your\\s+(payment|purchase|order)|you('ve|\\s+have)\\s+(been\\s+)?(paid|charged)|" +
  "has\\s+been\\s+(charged|renewed|paid)|was\\s+(charged|renewed|paid)|successfully\\s+(renewed|paid|charged)|" +
  "order\\s+confirmation|we('ve|\\s+have)\\s+charged|amount\\s+paid|paid\\s+on|invoice\\s+paid|status:?\\s*paid)\\b|" +
  "\\bpaid\\s+(?:on\\s+)?" + DATE_PATTERN,
  "i",
);
const DUE = /\b(amount\s+due|total\s+(amount\s+)?(payable|due)|amount\s+payable|due\s+date|payment\s+due|due\s+(on|by)|pay\s+(by|before)|balance\s+due|bill\s+(is\s+)?(ready|generated|available)|your\s+bill|bill\s+for\s+your|bill\s+for\s+the\s+month)\b/i;
const INVOICE = /\b(invoice|bill\s+(is\s+)?(ready|generated|available)|your\s+bill|statement)\b/i;
/**
 * Notices that look like billing mail but are not a payment: a bank asking to
 * confirm or authenticate a charge, a charge still pending, a renewal waiting
 * for the person to confirm it. ("confirm your payment method" is an account
 * notice, not one of these, and "payment confirmation" is a receipt.)
 */
const NOT_PAYMENT = /\bconfirm\s+(your\s+)?(\S{1,12}\s+)?(payment|renewal|charge)\b(?!\s+(method|details|information))|\bconfirm\s+renewal\b|\b(payment|charge|transaction)\s+(is\s+)?(still\s+)?pending\b|\bpending\s+(payment|charge|transaction)\b|\bauthenticat(e|ion)\b|\bverify\s+your\s+(payment|card)\b|\baction\s+(is\s+)?required\b|\bneeds?\s+your\s+(approval|confirmation)\b/i;
/**
 * A subject that asks the person to confirm or authenticate a payment or
 * renewal ("Confirm your $23.60 payment to ...", "Action needed: confirm your
 * ... renewal"). Read from the subject only, so a body that mentions an
 * invoice cannot turn it into a bill.
 */
const CONFIRM_PAYMENT_SUBJECT = /^\s*(?:[\w ]{1,30}:\s*)*confirm\s+your\s+[^:]{0,60}?\b(payment|renewal)\b(?!\s+(method|details|information))/i;
/** Wording in an attached file that says a payment really was made, which outweighs due wording in the same file. */
const STRONG_PAID_IN_FILE = new RegExp("\\b(amount\\s+paid|paid\\s+on|payment\\s+received\\s+on)\\b|\\bpaid\\s+(?:on\\s+)?" + DATE_PATTERN + "|(?:^|\\n)[^\\n]{0,40}\\breceipt\\b[^\\n]{0,40}(?:\\n|$)", "i");
/**
 * A credit card bill, statement or due reminder. Credit card information is
 * never read or stored, so such an email is never a payment and a history
 * search never keeps it. Narrow on purpose: the words "credit card" must sit
 * next to bill/statement/due wording (or a "pay now" / "credit score" nag), so
 * an ordinary receipt that says it was paid by credit card is not caught, and
 * a bank's transaction alert is not caught either.
 */
const CC_DUE_WORDS = "(?:bills?|statements?|dues?|outstanding|minimum\\s+(?:amount\\s+)?due|total\\s+(?:amount\\s+)?due|overdue)";
const CREDIT_CARD_BILL = new RegExp(
  "\\bcredit\\s*card\\b[^.\\n]{0,40}\\b" + CC_DUE_WORDS + "\\b|" +
  "\\b" + CC_DUE_WORDS + "\\b[^.\\n]{0,40}\\bcredit\\s*card\\b|" +
  "\\bcard\\s+statement\\b|" +
  "\\bcredit\\s*card\\b[^]{0,200}?\\b(?:pay\\s+now|credit\\s+score)\\b|" +
  "\\b(?:pay\\s+now|credit\\s+score)\\b[^]{0,200}?\\bcredit\\s*card\\b",
  "i",
);
/** Whether an email (subject, and the first 1500 characters of its body) is a credit card bill, statement or due reminder. */
export function isCreditCardBill(email: { subject?: string | null; content?: string | null }): boolean {
  return CREDIT_CARD_BILL.test(`${email.subject ?? ""}\n${(email.content ?? "").slice(0, 1500)}`);
}
/** A bill reminder ("bill is overdue", "due today", "due in 2 days", "pay now"): a bill, never a receipt. */
const BILL_REMINDER = /\bbill\b[^.\n]{0,30}\b(?:is\s+|are\s+)?(?:overdue|due)\b|\b(?:is\s+|are\s+)?overdue\b|\bdue\s+(?:today|soon|tomorrow|in\s+\d+\s+days?)\b|\bpay\s+now\b/i;
const REMINDER = /\b(will\s+be\s+(charged|billed|renewed|debited)|will\s+(auto[-\s]?)?renew|renews\s+(on|in|soon)|upcoming\s+(payment|charge|renewal|bill)|renewal\s+reminder|reminder|trial\s+(ends|ending|expires|is\s+ending)|expir(es|ing)\s+(soon|on|in)|is\s+about\s+to)\b/i;
const CANCELLED = /\b(cancel(l)?ed|cancel(l)?ation|has\s+ended|will\s+end|subscription\s+ended)\b/i;

const PAUSED_UNTIL = /\bpaused?\b[^.]{0,60}?\b(?:until|till|through)\s+([A-Z][a-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\.?,?\s+\d{4}|\d{4}-\d{2}-\d{2})/i;
const PAID_ON = new RegExp("\\bpaid\\s+(?:on\\s+)?" + DATE_PATTERN, "i");
const DUE_ON = new RegExp("\\b(?:due\\s+date|due\\s+on|due\\s+by|pay\\s+by)\\s*:?\\s*" + DATE_PATTERN, "i");

type Verdict = PaymentKind | "skip" | null;

/**
 * One piece of text, read for what it says about a payment. `strict` marks a
 * body (as opposed to a subject), where a "please confirm" wording is only
 * believed when nothing in it says the payment was received.
 */
function classifyText(text: string, rules: KindRules, strict = false): Verdict {
  if (rules.failed.test(text)) return "failed";
  if (rules.refund.test(text)) return "refund";
  if (rules.pause.test(text)) return "pause";
  if (NOT_PAYMENT.test(text) && !(strict && PAID.test(text))) return "skip";
  if (CARD_ALERT.test(text)) return "card_alert";
  if (PAID.test(text)) return "receipt";
  if (DUE.test(text) || INVOICE.test(text) || BILL_REMINDER.test(text)) return "invoice";
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
 * The day a receipt was paid: the "Paid <date>" in its text when it has one
 * and it is plausible (up to 45 days before the email, never after the day
 * after it), else the day the email arrived. A receipt often arrives a day
 * after the charge.
 */
export function paidDay(receivedDay: string, paidOn: string | null): string {
  if (!paidOn) return receivedDay;
  const gap = (toDay(receivedDay)!.getTime() - toDay(paidOn)!.getTime()) / DAY_MS;
  return gap >= -1 && gap <= 45 ? paidOn : receivedDay;
}

export type DocumentType = "invoice" | "receipt" | "other";
export type PaidStatus = "paid" | "due" | "unclear";

export interface PaymentReading {
  kind: PaymentKind;
  pausedUntil: string | null;
  /** What the document is called: an invoice, a receipt, or neither. */
  documentType: DocumentType;
  /** Whether it shows the money as received, still owed, or does not say. */
  paidStatus: PaidStatus;
  /** "Paid <date>" from the text, when it has one. */
  paidOn: string | null;
  /** A bill's due date from the text, when it has one. */
  dueOn: string | null;
}

/** The words of an email's attachments (file names and the text read from PDFs), as one string. */
export function attachmentTextOf(attachmentData: string | null | undefined, perFile = 2000): string {
  if (!attachmentData) return "";
  try {
    const list = JSON.parse(attachmentData)?.attachments;
    if (!Array.isArray(list)) return "";
    return list
      .map((a: any) => `${a?.filename ?? ""}\n${typeof a?.extractedText === "string" ? a.extractedText.slice(0, perFile) : ""}`)
      .join("\n")
      .trim();
  } catch {
    return "";
  }
}

/**
 * What an email says about a payment, from its subject, the start of its
 * body and, when those are unclear, the text of its attached files; null when
 * it records none (a renewal reminder, a cancellation notice, a "please
 * confirm" or pending notice, a newsletter). Simple word rules only.
 *
 * Two labels come out of it. The document type (invoice, receipt) is what the
 * paper is called; paid status (paid, due, unclear) is what it says about the
 * money. Only the second decides whether it is a payment: an invoice whose
 * text says paid is a receipt (kind 'receipt'); a bill that says amount due
 * or total payable is an invoice (kind 'invoice', not counted); an invoice
 * that says neither stays an invoice until a receipt turns up.
 *
 * The subject is read first and on its own, because a receipt's body often
 * mentions the next renewal ("your plan renews on 5 Nov") and would otherwise
 * read as a reminder. The body, then the attachments, are only consulted when
 * the subject says nothing either way -- or says "invoice", which is
 * consulted further for a "paid" in the text. An email the rules cannot place
 * counts as a receipt when it shows an amount, unless `requireWording` is set
 * (a search by company name, where an amount alone proves nothing).
 */
export function classifyPaymentEmail(email: {
  subject?: string | null;
  content?: string | null;
  amount?: number | string | null;
  attachmentText?: string | null;
}, now: Date = new Date(), options: { requireWording?: boolean } = {}): PaymentReading | null {
  const subject = email.subject ?? "";
  const body = (email.content ?? "").slice(0, 1500);
  // Failures, refunds and pauses keep being read from the first 600
  // characters only: that is where the news is, and a footer further down
  // ("see our refund policy") must not turn a receipt into one.
  const snippet = body.slice(0, 600);
  const files = (email.attachmentText ?? "").slice(0, 6000);

  if (isCreditCardBill({ subject, content: body })) return null;
  if (CONFIRM_PAYMENT_SUBJECT.test(subject)) return null;
  let verdict: Verdict = classifyText(subject, SUBJECT_RULES);
  if (verdict === null || verdict === "invoice") {
    let fromBody: Verdict = classifyText(snippet, BODY_RULES, true);
    // A "paid" further down the body still counts.
    if ((fromBody === null || fromBody === "invoice") && PAID.test(body)) fromBody = "receipt";
    if (verdict === null) verdict = fromBody;
    // A subject that only says "invoice": the text decides if it was paid.
    else if (fromBody === "receipt") verdict = "receipt";
  }
  if ((verdict === "invoice" || verdict === null) && files) {
    const fromFiles = classifyText(files, BODY_RULES, true);
    if (fromFiles === "receipt" || fromFiles === "card_alert") {
      // Words found only in a PDF do not turn a bill into a receipt: a bill
      // summary says "payment received" for the previous bill. Not when the
      // email itself says something is due, nor when the PDF says it is due
      // and has no stronger paid wording (amount paid, paid on, a receipt title).
      const ownDue = DUE.test(`${subject}\n${body}`);
      const fileDue = DUE.test(files) && !STRONG_PAID_IN_FILE.test(files);
      if (ownDue || fileDue) verdict = "invoice";
      else verdict = "receipt";
    } else if (verdict === null && (fromFiles === "invoice" || fromFiles === "skip")) verdict = fromFiles;
  }
  if (verdict === "skip") return null;

  if (verdict === null) {
    if (options.requireWording) return null;
    const amount = email.amount === null || email.amount === undefined || email.amount === "" ? null : Number(email.amount);
    if (amount === null || !isFinite(amount) || amount <= 0) return null;
    verdict = "receipt";
  }

  const all = `${subject}\n${body}\n${files}`;
  let pausedUntil: string | null = null;
  if (verdict === "pause") {
    const m = PAUSED_UNTIL.exec(subject + "\n" + snippet);
    pausedUntil = m ? parseLooseDay(m[1], now) : null;
  }

  const hasInvoiceWord = /\binvoice\b/i.test(all);
  const hasReceiptWord = /\breceipt\b/i.test(all);
  const documentType: DocumentType =
    verdict === "card_alert" || verdict === "failed" || verdict === "refund" || verdict === "pause"
      ? "other"
      : hasReceiptWord || (verdict === "receipt" && !hasInvoiceWord)
        ? "receipt"
        : hasInvoiceWord || verdict === "invoice"
          ? "invoice"
          : "other";
  const paidStatus: PaidStatus =
    verdict === "receipt" || verdict === "card_alert" ? "paid" : verdict === "invoice" && (DUE.test(all) || BILL_REMINDER.test(`${subject}\n${snippet}`)) ? "due" : "unclear";

  return {
    kind: verdict,
    pausedUntil,
    documentType,
    paidStatus,
    paidOn: paidStatus === "paid" ? parseLooseDay(PAID_ON.exec(all)?.[1] ?? null, now) : null,
    dueOn: verdict === "invoice" ? parseLooseDay(DUE_ON.exec(all)?.[1] ?? null, now) : null,
  };
}

// ---------------------------------------------------------------------------
// Reading an email as a payment row, and re-reading a stored one
// ---------------------------------------------------------------------------

/** What a payment row holds that comes from reading its email. */
export interface PaymentFields {
  paidAt: string;
  amount: string | null;
  currency: string | null;
  kind: PaymentKind;
  pausedUntil: string | null;
  documentType: DocumentType;
  paidStatus: PaidStatus;
  dueOn: string | null;
}

/** An email as the payment reader needs it. */
export interface EmailForPayment {
  subject: string;
  content: string | null;
  receivedAt: Date | string;
  extractedAmount: string | null;
  extractedCurrency: string | null;
  attachmentText?: string | null;
}

/**
 * The payment an email records, or null when it records none (not a payment,
 * or no usable date). `subscriptionCurrency` describes an amount only when the
 * email has none of its own.
 */
export function paymentFromEmail(email: EmailForPayment, subscriptionCurrency: string, now: Date): PaymentFields | null {
  const paidAt = dayString(email.receivedAt as any);
  if (!paidAt) return null;
  const amount = email.extractedAmount === null || email.extractedAmount === undefined || email.extractedAmount === ""
    ? null
    : Number(email.extractedAmount);
  const verdict = classifyPaymentEmail(
    { subject: email.subject, content: email.content, amount, attachmentText: email.attachmentText },
    now,
  );
  if (!verdict) return null;
  const hasAmount = amount !== null && isFinite(amount);
  return {
    // A receipt is dated by the "Paid <date>" in it; anything else by its email.
    paidAt: verdict.kind === "receipt" ? paidDay(paidAt, verdict.paidOn) : paidAt,
    amount: hasAmount ? amount!.toFixed(2) : null,
    // The email's own currency where it has one; the subscription's only
    // when there is an amount for it to describe.
    currency: email.extractedCurrency || (hasAmount ? subscriptionCurrency : null),
    kind: verdict.kind,
    pausedUntil: verdict.pausedUntil,
    documentType: verdict.documentType,
    paidStatus: verdict.paidStatus,
    dueOn: verdict.dueOn,
  };
}

export type RereadDecision =
  | { action: "keep" }
  | { action: "remove" }
  | { action: "update"; fields: PaymentFields };

const sameNumber = (a: unknown, b: unknown) =>
  (a === null || a === undefined || a === "") ? (b === null || b === undefined || b === "") : Number(a) === Number(b);
const sameDay = (a: unknown, b: unknown) => (dayString(a as any) ?? null) === (dayString(b as any) ?? null);

/**
 * What to do with a stored payment now that its email has been read again:
 * `fresh` is the new reading (null when the email is no longer a payment).
 * Removed when it is no longer a payment, updated when any field differs,
 * otherwise kept as it is.
 */
export function decideReread(
  stored: {
    kind: string; documentType: string | null; paidStatus: string | null; dueOn: unknown;
    amount: unknown; currency: string | null; paidAt: unknown; pausedUntil: unknown;
  },
  fresh: PaymentFields | null,
): RereadDecision {
  if (!fresh) return { action: "remove" };
  const same =
    stored.kind === fresh.kind &&
    (stored.documentType ?? null) === fresh.documentType &&
    (stored.paidStatus ?? null) === fresh.paidStatus &&
    sameDay(stored.dueOn, fresh.dueOn) &&
    sameNumber(stored.amount, fresh.amount) &&
    (stored.currency ?? null) === (fresh.currency ?? null) &&
    sameDay(stored.paidAt, fresh.paidAt) &&
    sameDay(stored.pausedUntil, fresh.pausedUntil);
  return same ? { action: "keep" } : { action: "update", fields: fresh };
}

/** The ids of the emails that are credit card bills, statements or due reminders. */
export function creditCardEmailIds(rows: { id: string; subject?: string | null; content?: string | null }[]): string[] {
  return rows.filter((r) => isCreditCardBill(r)).map((r) => r.id);
}
