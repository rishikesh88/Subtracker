/* Run: npm run test:status */
import {
  computeLifecycle,
  countedPayments,
  classifyPaymentEmail,
  stillActiveUntil,
  parseLooseDay,
  graceEnd,
  toDay,
  type LifecycleInput,
  type LifecyclePayment,
} from "./statusRules";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}

const NOW = new Date("2026-09-29T10:00:00Z");

const pay = (paidAt: string, amount: number | null = 499, kind = "receipt", currency: string | null = "INR", pausedUntil: string | null = null): LifecyclePayment =>
  ({ paidAt, amount, currency, kind, pausedUntil });

/** A monthly subscription on a healthy, connected, freshly synced inbox. */
function input(over: Partial<LifecycleInput> = {}): LifecycleInput {
  return {
    frequency: "monthly",
    payments: [],
    cancellation: null,
    overrides: { markedInactiveAt: null, stillActiveTaps: 0, stillActiveUntil: null },
    inboxConnected: true,
    inboxSyncedThrough: "2026-09-29",
    ...over,
  };
}
const run = (over: Partial<LifecycleInput> = {}, now = NOW) => computeLifecycle(input(over), now);
const sr = (r: { status: string; reason: string }) => `${r.status}/${r.reason}`;

/* --- Grace periods ------------------------------------------------------ */
check("grace: weekly is 14 days", graceEnd(toDay("2026-09-01")!, "weekly").toISOString().slice(0, 10), "2026-09-15");
check("grace: monthly is 2 months", graceEnd(toDay("2026-01-31")!, "monthly").toISOString().slice(0, 10), "2026-03-31");
check("grace: quarterly is 6 months", graceEnd(toDay("2026-01-15")!, "quarterly").toISOString().slice(0, 10), "2026-07-15");
check("grace: yearly is 14 months", graceEnd(toDay("2025-01-15")!, "yearly").toISOString().slice(0, 10), "2026-03-15");

/* --- The ordinary cases ------------------------------------------------- */
{
  const r = run({ payments: [pay("2026-09-05")] });
  check("paid this month: active", sr(r), "active/paid_recently");
  check("paid this month: last payment", r.lastPaymentAt, "2026-09-05");
  check("paid this month: expected next is one period on", r.expectedNextAt, "2026-10-05");
}
check("monthly, last paid 2 months ago to the day: still in grace", sr(run({ payments: [pay("2026-07-29")] })), "active/paid_recently");
check("monthly, last paid over 2 months ago: needs review", sr(run({ payments: [pay("2026-07-28")] })), "needs_review/no_recent_payment");
check("weekly, 15 days since last payment: needs review", sr(run({ frequency: "weekly", payments: [pay("2026-09-14", 99)] })), "needs_review/no_recent_payment");

/* --- Edge-case list from the PRD ---------------------------------------- */

// Cancelled but paid to a future date.
{
  const r = run({ frequency: "yearly", payments: [pay("2026-01-10", 3999)], cancellation: { cancelledAt: "2026-06-01", endsOn: "2027-01-10" } });
  check("cancelled, paid to a future date: active", sr(r), "active/cancelled_access_until");
  check("cancelled, paid to a future date: end date reported", r.endsOn, "2027-01-10");
  const later = computeLifecycle(input({ frequency: "yearly", payments: [pay("2026-01-10", 3999)], cancellation: { cancelledAt: "2026-06-01", endsOn: "2027-01-10" } }), new Date("2027-01-11T00:00:00Z"));
  check("…and once that date passes: inactive from the end date", [sr(later), later.inactiveSince, later.inactiveSource], ["inactive/cancelled", "2027-01-10", "email"]);
}
{
  const r = run({ payments: [pay("2026-08-01")], cancellation: { cancelledAt: "2026-08-20", endsOn: null } });
  check("cancelled with no end date: inactive from the cancellation", [sr(r), r.inactiveSince, r.inactiveSource], ["inactive/cancelled", "2026-08-20", "email"]);
}

// Cancelled then re-subscribed.
{
  const r = run({ payments: [pay("2026-05-01"), pay("2026-09-10")], cancellation: { cancelledAt: "2026-05-15", endsOn: "2026-06-01" } });
  check("cancelled then re-subscribed: active again", sr(r), "active/paid_after_inactive");
  check("cancelled then re-subscribed: no inactive date", r.inactiveSince, null);
}

// Receipts go to an inbox we can't see, and the person says Still active twice.
{
  const payments = [pay("2026-05-02")];
  check("receipts elsewhere: overdue and flagged", sr(run({ payments })), "needs_review/no_recent_payment");
  const holdUntil = stillActiveUntil("monthly", "2026-05-02", NOW);
  check("still active once: holds 2 periods past the next expected payment", holdUntil, "2026-12-02");
  const once = { markedInactiveAt: null, stillActiveTaps: 1, stillActiveUntil: holdUntil };
  check("still active once: not flagged while it holds", sr(run({ payments, overrides: once })), "active/kept_active");
  check("still active once: flagged again after it lapses",
    sr(computeLifecycle(input({ payments, overrides: once, inboxSyncedThrough: "2026-12-10" }), new Date("2026-12-10T00:00:00Z"))),
    "needs_review/no_recent_payment");
  const twice = { markedInactiveAt: null, stillActiveTaps: 2, stillActiveUntil: "2027-02-02" };
  check("still active twice: never flagged again, even years later",
    sr(computeLifecycle(input({ payments, overrides: twice, inboxSyncedThrough: "2029-01-01" }), new Date("2029-01-01T00:00:00Z"))),
    "active/kept_active");
}

// Paid by someone else: we never see a payment.
check("paid by someone else (no payments): never flagged", sr(run({ payments: [] })), "active/no_payments");
check("…not even years later", sr(computeLifecycle(input({ inboxSyncedThrough: "2030-01-01" }), new Date("2030-01-01T00:00:00Z"))), "active/no_payments");

// The company stopped sending receipts: indistinguishable from stopping, so it is asked about.
check("company stopped receipts: needs review (the user can say still active)", sr(run({ payments: [pay("2026-03-01"), pay("2026-04-01"), pay("2026-05-01")] })), "needs_review/no_recent_payment");

// Not synced for a while.
check("not synced since the grace date: not flagged", sr(run({ payments: [pay("2026-06-01")], inboxSyncedThrough: "2026-07-15" })), "active/not_synced_recently");
check("synced exactly on the grace date: not flagged (must be after)", sr(run({ payments: [pay("2026-06-01")], inboxSyncedThrough: "2026-08-01" })), "active/not_synced_recently");
check("synced the day after the grace date: flagged", sr(run({ payments: [pay("2026-06-01")], inboxSyncedThrough: "2026-08-02" })), "needs_review/no_recent_payment");
check("never synced: not flagged", sr(run({ payments: [pay("2026-06-01")], inboxSyncedThrough: null })), "active/not_synced_recently");

// Inbox disconnected.
check("inbox disconnected: not flagged", sr(run({ payments: [pay("2026-06-01")], inboxConnected: false })), "active/inbox_disconnected");

// Payment failed.
{
  const payments = [pay("2026-08-15"), pay("2026-09-15", 499, "failed")];
  check("payment failed: a failure is not a payment", run({ payments }).lastPaymentAt, "2026-08-15");
  check("payment failed: still active inside grace, and says so", sr(run({ payments })), "active/payment_failed");
  check("only failures ever: never flagged", sr(run({ payments: [pay("2026-01-15", 499, "failed")] })), "active/no_payments");
  check("failed and then nothing past grace: needs review",
    sr(run({ payments: [pay("2026-06-15"), pay("2026-07-15", 499, "failed")] })), "needs_review/no_recent_payment");
}

// Refund.
{
  check("refund: not counted as a payment", run({ payments: [pay("2026-08-01"), pay("2026-09-10", 499, "refund")] }).lastPaymentAt, "2026-08-01");
  check("refund without cancellation: still active", sr(run({ payments: [pay("2026-09-01"), pay("2026-09-03", 499, "refund")] })), "active/paid_recently");
  const r = run({ payments: [pay("2026-09-01"), pay("2026-09-03", 499, "refund")], cancellation: { cancelledAt: "2026-09-03", endsOn: "2026-10-01" } });
  check("full refund + cancellation: inactive now, even with a future end date", [sr(r), r.inactiveSince, r.inactiveSource], ["inactive/refunded_and_cancelled", "2026-09-03", "email"]);
  const partial = run({ payments: [pay("2026-09-01"), pay("2026-09-03", 100, "refund")], cancellation: { cancelledAt: "2026-09-03", endsOn: "2026-10-01" } });
  check("partial refund + cancellation: active until the end date", sr(partial), "active/cancelled_access_until");
}

// Price or plan change.
check("price change: both prices count", sr(run({ payments: [pay("2026-07-05", 499), pay("2026-08-05", 649), pay("2026-09-05", 649)] })), "active/paid_recently");
check("price change: 3 payments counted", countedPayments([pay("2026-07-05", 499), pay("2026-08-05", 649), pay("2026-09-05", 649)]).length, 3);

// Paused until a date.
{
  const payments = [pay("2026-05-01"), pay("2026-06-01", null, "pause", null, "2026-12-01")];
  check("paused until a future date: not flagged", sr(run({ payments })), "active/paused");
  check("pause that has ended: flagged as usual",
    sr(computeLifecycle(input({ payments, inboxSyncedThrough: "2026-12-05" }), new Date("2026-12-05T00:00:00Z"))), "needs_review/no_recent_payment");
}

// Trial never charged.
check("trial never charged (no payments): never flagged", sr(run({ payments: [] })), "active/no_payments");
check("trial 'receipt' for 0.00 is not a payment", sr(run({ payments: [pay("2026-01-01", 0)] })), "active/no_payments");

// Yearly plan: 14 months of grace.
check("yearly, paid 13 months ago: active", sr(run({ frequency: "yearly", payments: [pay("2025-08-29", 3999)] })), "active/paid_recently");
check("yearly, paid 14 months ago to the day: active", sr(run({ frequency: "yearly", payments: [pay("2025-07-29", 3999)] })), "active/paid_recently");
check("yearly, paid over 14 months ago: needs review", sr(run({ frequency: "yearly", payments: [pay("2025-07-28", 3999)] })), "needs_review/no_recent_payment");
check("yearly: expected next is a year on", run({ frequency: "yearly", payments: [pay("2025-11-02", 3999)] }).expectedNextAt, "2026-11-02");

// Usage-based: amounts vary every time.
{
  const payments = [pay("2026-07-03", 212.5, "receipt", "USD"), pay("2026-08-03", 187.2, "receipt", "USD"), pay("2026-09-03", 240.9, "receipt", "USD")];
  check("usage-based: every varying charge counts", countedPayments(payments).length, 3);
  check("usage-based: active", sr(run({ payments })), "active/paid_recently");
}

// Card alert only.
check("card alert only: counts as a payment", sr(run({ payments: [pay("2026-09-12", 2255.68, "card_alert")] })), "active/paid_recently");
check("card alert only: and is flagged when it stops", sr(run({ payments: [pay("2026-06-12", 2255.68, "card_alert")] })), "needs_review/no_recent_payment");

// Receipt with no amount.
check("receipt with no amount: counts", run({ payments: [pay("2026-09-12", null)] }).lastPaymentAt, "2026-09-12");
check("two amountless receipts two days apart are not merged", countedPayments([pay("2026-09-10", null), pay("2026-09-12", null)]).length, 2);

// Different currencies.
{
  const payments = [pay("2026-07-10", 20, "receipt", "USD"), pay("2026-08-10", 1700, "receipt", "INR"), pay("2026-09-10", 20, "receipt", "USD")];
  check("different currencies: each counts", countedPayments(payments).length, 3);
  check("different currencies: status as usual", sr(run({ payments })), "active/paid_recently");
  check("different currencies on the same day are not merged",
    countedPayments([pay("2026-09-10", 20, "receipt", "USD"), pay("2026-09-10", 20, "receipt", "EUR")]).length, 2);
}

// Added by hand: no payments at all.
check("added by hand (no payments): never flagged", sr(run({ frequency: "yearly", payments: [] })), "active/no_payments");

// The same charge seen from two inboxes.
{
  const payments = [pay("2026-09-10", 499), pay("2026-09-11", 499.5)];
  check("same charge in two inboxes: counted once", countedPayments(payments).length, 1);
  const mixed = countedPayments([pay("2026-09-12", 499.4, "card_alert"), pay("2026-09-10", 499, "invoice"), pay("2026-09-11", 499, "receipt")]);
  check("one charge, three records: the receipt is kept", [mixed.length, mixed[0].kind], [1, "receipt"]);
  check("same amount four days apart: two charges", countedPayments([pay("2026-09-01", 499), pay("2026-09-05", 499)]).length, 2);
  check("amounts two units apart: two charges", countedPayments([pay("2026-09-10", 499), pay("2026-09-10", 501.5)]).length, 2);
}

/* --- Marked inactive by the person -------------------------------------- */
{
  const r = run({ payments: [pay("2026-08-01")], overrides: { markedInactiveAt: "2026-09-01", stillActiveTaps: 0, stillActiveUntil: null } });
  check("marked inactive: inactive, from the user", [sr(r), r.inactiveSince, r.inactiveSource], ["inactive/marked_inactive", "2026-09-01", "user"]);
  const back = run({ payments: [pay("2026-08-01"), pay("2026-09-20")], overrides: { markedInactiveAt: "2026-09-01", stillActiveTaps: 0, stillActiveUntil: null } });
  check("paid after being marked inactive: active again", [sr(back), back.inactiveSource], ["active/paid_after_inactive", null]);
  const sameDay = run({ payments: [pay("2026-09-01")], overrides: { markedInactiveAt: "2026-09-01", stillActiveTaps: 0, stillActiveUntil: null } });
  check("paid on the day it was marked inactive: not after, stays inactive", sr(sameDay), "inactive/marked_inactive");
  const fail = run({ payments: [pay("2026-08-01"), pay("2026-09-20", 499, "failed")], overrides: { markedInactiveAt: "2026-09-01", stillActiveTaps: 0, stillActiveUntil: null } });
  check("a failed payment after being marked inactive does not revive it", sr(fail), "inactive/marked_inactive");
}

/* --- Still active hold -------------------------------------------------- */
check("still active hold, yearly (next due rolled to 2027-06-01, plus two years)", stillActiveUntil("yearly", "2025-06-01", NOW), "2029-06-01");
check("still active hold, no payment known", stillActiveUntil("monthly", null, NOW), "2026-11-29");

/* --- Reading an email --------------------------------------------------- */
const kind = (subject: string, content = "", amount: number | null = 499) => classifyPaymentEmail({ subject, content, amount }, NOW)?.kind ?? null;
check("email: receipt", kind("Your receipt from Railway Corporation #2139-9980"), "receipt");
check("email: invoice", kind("Your invoice for September is ready"), "invoice");
check("email: card alert", kind("INR 2,255.68 spent on your Scapia Federal Bank credit card"), "card_alert");
check("email: failed payment", kind("Your payment failed - update your payment method"), "failed");
check("email: refund", kind("Your refund has been processed"), "refund");
check("email: pause", kind("Your membership is paused"), "pause");
check("email: pause reads its end date",
  classifyPaymentEmail({ subject: "Your membership is paused", content: "Your membership has been paused until December 1, 2026." }, NOW)?.pausedUntil, "2026-12-01");
check("email: renewal reminder is not a payment", kind("Your Apple One subscription renews on Oct 5"), null);
check("email: 'will be charged' is not a payment", kind("You will be charged ₹75 in 2 days"), null);
check("email: cancellation notice is not a payment", kind("Your subscription has been cancelled"), null);
check("email: unclear subject with an amount defaults to receipt", kind("Netflix", "Hello there"), "receipt");
check("email: unclear subject and no amount records nothing", kind("Netflix", "Hello there", null), null);
check("email: receipt with no amount still a receipt", kind("Payment receipt", "", null), "receipt");
check("email: a receipt whose body mentions the next renewal stays a receipt", kind("Your receipt from Apple", "Your plan renews on 5 Nov."), "receipt");
check("email: a receipt footer offering refunds is not a refund", kind("Google Play", "Thank you for your purchase. See our refund policy."), "receipt");
check("email: a receipt footer offering a pause is not a pause", kind("Spotify", "Thanks for your payment. You can pause your subscription any time."), "receipt");
check("email: zero amount, no words, records nothing", kind("Trial started", "", 0), null);

check("loose date: long form", parseLooseDay("October 5, 2026", NOW), "2026-10-05");
check("loose date: day first", parseLooseDay("5 Oct 2026", NOW), "2026-10-05");
check("loose date: ISO", parseLooseDay("2026-10-05", NOW), "2026-10-05");
check("loose date: nonsense", parseLooseDay("soon", NOW), null);
check("loose date: absurd year", parseLooseDay("1970-01-01", NOW), null);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
