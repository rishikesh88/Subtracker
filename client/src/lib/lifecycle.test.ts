/* Run: npm run test:lifecycle */
import {
  lifecycleOf,
  cardWhen,
  formatDay,
  formatDayLong,
  formatDayShort,
  formatMonthYear,
  relativeDay,
  isPast,
  groupByYear,
  paymentCount,
  FLAT_LIMIT,
  type PaymentRow,
} from "./lifecycle";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}

const NOW = new Date(2026, 8, 29, 10, 0, 0); // 29 Sep 2026, local

/* --- Status ------------------------------------------------------------- */
check("status: the rules' answer wins", lifecycleOf({ status: "active", lifecycleStatus: "needs_review" }), "needs_review");
check("status: not computed yet, active", lifecycleOf({ status: "active", lifecycleStatus: null }), "active");
check("status: not computed yet, cancelled is inactive", lifecycleOf({ status: "cancelled" }), "inactive");
check("status: not computed yet, expiring soon is active", lifecycleOf({ status: "expiring_soon" }), "active");

/* --- Days --------------------------------------------------------------- */
check("day: plain", formatDay("2026-10-03"), "Oct 3, 2026");
check("day: long", formatDayLong("2026-07-14"), "14 Jul 2026");
check("day: short", formatDayShort("2026-10-12"), "Oct 12");
check("day: month and year", formatMonthYear("2025-10-01"), "Oct 2025");
check("day: none", formatDay(null), "");
check("day: not shifted by the zone", formatDay("2026-01-01"), "Jan 1, 2026");
check("relative: ahead", relativeDay("2026-10-12", NOW), "in 13 days");
check("relative: today", relativeDay("2026-09-29", NOW), "today");
check("relative: past", relativeDay("2026-09-27", NOW), "2 days ago");
check("past", [isPast("2026-09-28", NOW), isPast("2026-09-29", NOW), isPast("2026-09-30", NOW)], [true, false, false]);

/* --- The card's footer -------------------------------------------------- */
const base = { status: "active", lifecycleStatus: "active", expectedNextPaymentAt: "2026-10-17", nextBillingDate: "2026-12-25T00:00:00.000Z" };
check("card: active renews on the expected date", cardWhen(base, NOW), { label: "Renews", date: "2026-10-17" });
check("card: active, expected date passed: payment due, not a made-up date",
  cardWhen({ ...base, expectedNextPaymentAt: "2026-09-03" }, NOW), { label: "Payment due", date: "2026-09-03" });
check("card: active with nothing worked out yet uses the renewal date",
  cardWhen({ status: "active", lifecycleStatus: null, nextBillingDate: "2026-10-05T00:00:00.000Z" }, NOW),
  { label: "Renews", date: "2026-10-05T00:00:00.000Z" });
check("card: cancelled but paid up shows when it ends", cardWhen({ ...base, endsOn: "2026-10-12" }, NOW), { label: "Ends", date: "2026-10-12" });
check("card: needs review shows last paid",
  cardWhen({ ...base, lifecycleStatus: "needs_review", lastPaymentAt: "2026-06-03" }, NOW), { label: "Last paid", date: "2026-06-03" });
check("card: inactive shows since",
  cardWhen({ ...base, lifecycleStatus: "inactive", inactiveSince: "2026-07-14" }, NOW), { label: "Inactive since", date: "2026-07-14" });
check("card: inactive from an old cancelled row",
  cardWhen({ status: "cancelled", nextBillingDate: "2026-02-01T00:00:00.000Z" }, NOW), { label: "Inactive since", date: null });

/* --- Payments grouped by year ------------------------------------------ */
const row = (date: string, amount: string | null = "1598.00", currency: string | null = "INR"): PaymentRow => ({ date, amount, currency, source: "Receipt" });
{
  const rows = [row("2025-11-17"), row("2026-09-17"), row("2026-08-17"), row("2025-12-17"), row("2026-01-17")];
  const groups = groupByYear(rows);
  check("groups: newest year first", groups.map((g) => g.year), ["2026", "2025"]);
  check("groups: newest payment first inside a year", groups[0].rows.map((r) => r.date), ["2026-09-17", "2026-08-17", "2026-01-17"]);
  check("groups: counts", groups.map((g) => g.rows.length), [3, 2]);
  check("groups: total", groups[0].total, { amount: 4794, currency: "INR" });
}
check("groups: no total when an amount is not shown", groupByYear([row("2026-01-01"), row("2026-02-01", null)])[0].total, null);
check("groups: no total across currencies", groupByYear([row("2026-01-01"), row("2026-02-01", "5.00", "USD")])[0].total, null);
check("groups: none", groupByYear([]), []);
check("flat limit", FLAT_LIMIT, 6);
check("count wording", [paymentCount(1), paymentCount(9)], ["1 payment", "9 payments"]);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
