/**
 * What the status screens may show, worked out from what the rules already
 * decided (feature switch `subscription_status`).
 *
 * Pure: no database, so it can be tested. Nothing here decides what counts as
 * a payment or what a subscription's status is; that stays in statusRules.ts,
 * whose exports are only called. This file only chooses what a person sees.
 *
 * What it never lets out: email subjects, bodies, email ids, or any record
 * that is not a counted payment.
 */

import {
  countedPayments,
  reconcileBills,
  dayString,
  type LifecyclePayment,
} from "./statusRules";
import { NOTE_ADDED_BY_HAND } from "./historySearchRules";

// ---------------------------------------------------------------------------
// Counted payments, as a person sees them
// ---------------------------------------------------------------------------

/** A payment as the detail panel lists it. Nothing from the email itself. */
export interface UserPayment {
  /** YYYY-MM-DD */
  date: string;
  /** null: the email did not show an amount ("Paid, amount not shown"). */
  amount: string | null;
  currency: string | null;
  /** "Receipt" or "Card alert". */
  source: string;
}

export const SOURCE_LABELS: Record<string, string> = {
  receipt: "Receipt",
  card_alert: "Card alert",
};

export interface UserPaymentView {
  /** Counted payments only, newest first. */
  payments: UserPayment[];
  /** Some bills have no receipt and are therefore not listed (a note is shown). */
  someBillsOnly: boolean;
  /** The day of a payment that failed since the last counted one, or null. */
  failedOn: string | null;
}

export function userPaymentView(
  records: LifecyclePayment[],
  preferCurrency: string | null,
  now: Date,
  /** Only a failure the status itself reports (reason payment_failed) is shown. */
  reportFailure: boolean,
): UserPaymentView {
  const counted = countedPayments(records, preferCurrency);
  const payments: UserPayment[] = counted
    .map((c) => ({
      date: dayString(c.day) as string,
      amount: c.amount === null ? null : c.amount.toFixed(2),
      currency: c.currency,
      source: SOURCE_LABELS[c.kind] ?? "Payment",
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const someBillsOnly = reconcileBills(records, now, preferCurrency).noReceipt.length > 0;

  let failedOn: string | null = null;
  if (reportFailure) {
    const lastCounted = payments.length ? payments[0].date : null;
    for (const r of records) {
      if (r.kind !== "failed") continue;
      const day = dayString(r.paidAt);
      if (!day || (lastCounted && day <= lastCounted)) continue;
      if (!failedOn || day > failedOn) failedOn = day;
    }
  }
  return { payments, someBillsOnly, failedOn };
}

// ---------------------------------------------------------------------------
// The state of the history behind the list
// ---------------------------------------------------------------------------

/**
 * searching    still being found (pending or running)
 * cant_update  the search failed, or the inbox needs reconnecting
 * manual       added by hand: there is no inbox to look in
 * ok           nothing to say
 */
export type HistoryState = "searching" | "cant_update" | "manual" | "ok";

export function historyState(
  sub: {
    historyStatus: string | null;
    historyError: string | null;
    emailProvider: string | null;
    merchantEmail: string | null;
    lifecycleReason: string | null;
  },
  ownMailboxBroken: boolean,
): HistoryState {
  const searching = sub.historyStatus === "pending" || sub.historyStatus === "running";
  const manual =
    sub.historyError === NOTE_ADDED_BY_HAND || (!sub.historyStatus && !sub.emailProvider && !sub.merchantEmail);
  if (manual && !searching) return "manual";
  if (searching) return "searching";
  if (sub.historyStatus === "failed" || sub.lifecycleReason === "inbox_disconnected" || ownMailboxBroken) {
    return "cant_update";
  }
  return "ok";
}

// ---------------------------------------------------------------------------
// "Still paying?" reviews
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jun 3, 2026" from a YYYY-MM-DD (or a date), or "" when there is none. */
export function plainDay(value: string | Date | null | undefined): string {
  const day = dayString(value as any);
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : "";
}

const USUALLY: Record<string, string> = {
  weekly: "every week",
  monthly: "every month",
  quarterly: "every 3 months",
  yearly: "every year",
};

/**
 * Why it is being asked, in the words of the design and the PRD: what was
 * seen, never "cancelled".
 */
export function reviewReason(name: string, frequency: string | null | undefined, lastPaymentAt: string | Date | null | undefined): string {
  const since = plainDay(lastPaymentAt);
  const head = since ? `No payment since ${since}.` : "No recent payment.";
  const usual = USUALLY[(frequency ?? "").toLowerCase()];
  return usual ? `${head} ${name} usually charges ${usual}.` : head;
}

// ---------------------------------------------------------------------------
// The subscription as the app receives it
// ---------------------------------------------------------------------------

/** Every column the status feature added to a subscription. */
const STATUS_COLUMNS = [
  "lifecycleStatus",
  "lifecycleReason",
  "lifecycleUpdatedAt",
  "lastPaymentAt",
  "expectedNextPaymentAt",
  "endsOn",
  "cancelledAt",
  "inactiveSince",
  "inactiveSource",
  "stillActiveTaps",
  "stillActiveUntil",
  "historyStatus",
  "historySearchedSince",
  "historyAttempts",
  "historyError",
  "historyStartedAt",
  "historyFinishedAt",
  "historyRead",
  "historySaved",
  "historySkipped",
  "historyPartial",
] as const;

/** The ones a person's own screens need. The rest are bookkeeping. */
const SHOWN_COLUMNS: readonly string[] = [
  "lifecycleStatus",
  "lifecycleReason",
  "lastPaymentAt",
  "expectedNextPaymentAt",
  "endsOn",
  "cancelledAt",
  "inactiveSince",
  "inactiveSource",
  "historyStatus",
  "historySearchedSince",
];

/**
 * A subscription for the response. Without the switch, none of the status
 * columns are included (the response is what it was before they existed); with
 * it, only the ones the screens use.
 */
export function presentSubscription<T extends Record<string, any>>(sub: T, statusOn: boolean): T {
  const out: Record<string, any> = { ...sub };
  for (const column of STATUS_COLUMNS) {
    if (!statusOn || !SHOWN_COLUMNS.includes(column)) delete out[column];
  }
  return out as T;
}

export function presentSubscriptions<T extends Record<string, any>>(subs: T[], statusOn: boolean): T[] {
  return subs.map((s) => presentSubscription(s, statusOn));
}
