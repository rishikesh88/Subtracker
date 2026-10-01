/**
 * Subscription status and payment history, as the screens show them (feature
 * switch `subscription_status`).
 *
 * Pure display rules, with no React: what a card's footer says, how the
 * detail panel groups payments by year, how a day is written. The status
 * itself is decided on the server; nothing here decides it.
 */

export type Lifecycle = "active" | "needs_review" | "inactive";

export const STATUS_FEATURE = "subscription_status";

/** The status, falling back to the old one for a row the rules have not reached yet. */
export function lifecycleOf(sub: { lifecycleStatus?: string | null; status: string }): Lifecycle {
  const value = sub.lifecycleStatus;
  if (value === "active" || value === "needs_review" || value === "inactive") return value;
  return sub.status === "cancelled" || sub.status === "ended" ? "inactive" : "active";
}

export const LIFECYCLE_BADGE: Record<Lifecycle, { label: string; cls: string }> = {
  active: { label: "Active", cls: "status-active" },
  needs_review: { label: "Needs review", cls: "status-review" },
  inactive: { label: "Inactive", cls: "status-cancelled" },
};

// ---------------------------------------------------------------------------
// Days. The server sends YYYY-MM-DD; those are read as that day everywhere,
// never shifted by the browser's time zone.
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(value: string | Date | null | undefined): { y: number; m: number; d: number } | null {
  if (!value) return null;
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match) return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) return null;
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

/** "Oct 3, 2026", or "" when there is no date. */
export function formatDay(value: string | Date | null | undefined): string {
  const p = parts(value);
  return p ? `${MONTHS[p.m - 1]} ${p.d}, ${p.y}` : "";
}

/** "3 Oct 2026", the way the notices read. */
export function formatDayLong(value: string | Date | null | undefined): string {
  const p = parts(value);
  return p ? `${p.d} ${MONTHS[p.m - 1]} ${p.y}` : "";
}

/** "Oct 12", for the "Ends Oct 12" tag. */
export function formatDayShort(value: string | Date | null | undefined): string {
  const p = parts(value);
  return p ? `${MONTHS[p.m - 1]} ${p.d}` : "";
}

/** "Oct 2025". */
export function formatMonthYear(value: string | Date | null | undefined): string {
  const p = parts(value);
  return p ? `${MONTHS[p.m - 1]} ${p.y}` : "";
}

/** The day as a Date at UTC midnight, for sums of days. */
export function dayToDate(value: string | Date | null | undefined): Date | null {
  const p = parts(value);
  return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)) : null;
}

/** "in 13 days" / "2 days ago" / "today", from a day to today. */
export function relativeDay(value: string | Date | null | undefined, now: Date = new Date()): string {
  const target = dayToDate(value);
  if (!target) return "";
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((target.getTime() - today) / 86400000);
  if (diff === 0) return "today";
  const past = diff < 0;
  const days = Math.abs(diff);
  if (days < 30) return past ? `${days} day${days === 1 ? "" : "s"} ago` : `in ${days} day${days === 1 ? "" : "s"}`;
  const months = Math.round(days / 30);
  return past ? `${months} month${months === 1 ? "" : "s"} ago` : `in ${months} month${months === 1 ? "" : "s"}`;
}

/** Whether a day is before today. */
export function isPast(value: string | Date | null | undefined, now: Date = new Date()): boolean {
  const target = dayToDate(value);
  if (!target) return false;
  return target.getTime() < Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

// ---------------------------------------------------------------------------
// The card's footer
// ---------------------------------------------------------------------------

interface CardFields {
  status: string;
  lifecycleStatus?: string | null;
  lastPaymentAt?: string | null;
  expectedNextPaymentAt?: string | null;
  nextBillingDate?: string | Date | null;
  endsOn?: string | null;
  inactiveSince?: string | null;
}

/**
 * The label and date at the bottom left of a card. Active says "Renews" (or
 * "Payment due" once the expected date has passed without a payment, rather
 * than inventing a later one), "Ends" when it is cancelled but paid up to a
 * date, Needs review says "Last paid", Inactive says "Inactive since".
 */
export function cardWhen(sub: CardFields, now: Date = new Date()): { label: string; date: string | Date | null } {
  switch (lifecycleOf(sub)) {
    case "inactive":
      return { label: "Inactive since", date: sub.inactiveSince ?? sub.endsOn ?? null };
    case "needs_review":
      return { label: "Last paid", date: sub.lastPaymentAt ?? null };
    default: {
      if (sub.endsOn && !isPast(sub.endsOn, now)) return { label: "Ends", date: sub.endsOn };
      if (sub.expectedNextPaymentAt) {
        return { label: isPast(sub.expectedNextPaymentAt, now) ? "Payment due" : "Renews", date: sub.expectedNextPaymentAt };
      }
      return { label: "Renews", date: sub.nextBillingDate ?? null };
    }
  }
}

// ---------------------------------------------------------------------------
// The Payments list
// ---------------------------------------------------------------------------

export interface PaymentRow {
  date: string;
  amount: string | null;
  currency: string | null;
  source: string;
}

export interface YearGroup {
  year: string;
  rows: PaymentRow[];
  /** Null when the amounts are in different currencies or some are not shown. */
  total: { amount: number; currency: string } | null;
}

/** Up to this many payments are one plain list; more are grouped by year. */
export const FLAT_LIMIT = 6;
/** Rows a year shows before "Show N more". */
export const ROWS_PER_YEAR = 4;

/** Newest year first, newest payment first within it. */
export function groupByYear(rows: PaymentRow[]): YearGroup[] {
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const groups: YearGroup[] = [];
  for (const row of sorted) {
    const year = row.date.slice(0, 4);
    let group = groups[groups.length - 1];
    if (!group || group.year !== year) {
      group = { year, rows: [], total: null };
      groups.push(group);
    }
    group.rows.push(row);
  }
  for (const group of groups) {
    const currencies = new Set(group.rows.map((r) => (r.currency ?? "").toUpperCase()));
    const complete = group.rows.every((r) => r.amount !== null && r.amount !== "");
    if (complete && currencies.size === 1 && !currencies.has("")) {
      group.total = {
        amount: group.rows.reduce((sum, r) => sum + Number(r.amount), 0),
        currency: Array.from(currencies)[0],
      };
    }
  }
  return groups;
}

/** "9 payments" / "1 payment". */
export function paymentCount(n: number): string {
  return `${n} payment${n === 1 ? "" : "s"}`;
}
