/* Run: npm run test:status-view */
import {
  userPaymentView,
  historyState,
  reviewReason,
  plainDay,
  presentSubscription,
} from "./statusView";
import type { LifecyclePayment } from "./statusRules";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}

const NOW = new Date("2026-09-29T10:00:00Z");
const rec = (paidAt: string, amount: number | null, kind = "receipt", currency: string | null = "INR", dueOn: string | null = null): LifecyclePayment =>
  ({ paidAt, amount, currency, kind, dueOn });

/* --- Counted payments only ---------------------------------------------- */
{
  const v = userPaymentView(
    [rec("2026-07-03", 649), rec("2026-08-03", 649), rec("2026-09-03", 649, "card_alert")],
    "INR", NOW, false,
  );
  check("newest first", v.payments.map((p) => p.date), ["2026-09-03", "2026-08-03", "2026-07-03"]);
  check("source labels", v.payments.map((p) => p.source), ["Card alert", "Receipt", "Receipt"]);
  check("amount and currency", [v.payments[0].amount, v.payments[0].currency], ["649.00", "INR"]);
  check("only date, amount, currency, source", Object.keys(v.payments[0]).sort(), ["amount", "currency", "date", "source"]);
}
{
  const v = userPaymentView([rec("2026-08-03", 649), rec("2026-09-03", 649, "failed"), rec("2026-09-10", 649, "pause"), rec("2026-09-11", 100, "refund")], "INR", NOW, true);
  check("failed, pause and refund are not rows", v.payments.length, 1);
  check("a failure after the last payment is reported", v.failedOn, "2026-09-03");
}
{
  const v = userPaymentView([rec("2026-08-03", 649), rec("2026-09-03", 649, "failed")], "INR", NOW, false);
  check("a failure is not reported unless the status says so", v.failedOn, null);
}
{
  const v = userPaymentView([rec("2026-09-03", 649, "failed"), rec("2026-09-20", 649)], "INR", NOW, true);
  check("a failure followed by a payment is not reported", v.failedOn, null);
}
{
  const v = userPaymentView([rec("2026-08-03", 649), rec("2026-08-03", 649, "card_alert")], "INR", NOW, false);
  check("one charge is one row", v.payments.length, 1);
  check("the receipt is the one kept", v.payments[0].source, "Receipt");
}
{
  const v = userPaymentView([rec("2026-08-03", null)], "INR", NOW, false);
  check("a receipt with no amount is listed without one", [v.payments.length, v.payments[0].amount], [1, null]);
}
{
  const v = userPaymentView([rec("2026-03-03", 649, "invoice"), rec("2026-08-03", 649)], "INR", NOW, false);
  check("an old bill nothing paid is not listed", v.payments.length, 1);
  check("... and sets the note", v.someBillsOnly, true);
}
{
  const v = userPaymentView([rec("2026-09-20", 649, "invoice"), rec("2026-08-03", 649)], "INR", NOW, false);
  check("a recent bill (receipt may still come) sets no note", v.someBillsOnly, false);
}
{
  const v = userPaymentView([rec("2026-08-03", 649, "invoice"), rec("2026-08-04", 649)], "INR", NOW, false);
  check("a bill a receipt paid sets no note, and shows once", [v.someBillsOnly, v.payments.length], [false, 1]);
}
check("no records", userPaymentView([], "INR", NOW, true), { payments: [], someBillsOnly: false, failedOn: null });

/* --- History state ------------------------------------------------------ */
const sub = (over: Record<string, any> = {}) => ({
  historyStatus: "done", historyError: null, emailProvider: "gmail", merchantEmail: "a@b.com", lifecycleReason: "paid_recently", ...over,
});
check("pending is searching", historyState(sub({ historyStatus: "pending" }), false), "searching");
check("running is searching", historyState(sub({ historyStatus: "running" }), false), "searching");
check("failed can't update", historyState(sub({ historyStatus: "failed" }), false), "cant_update");
check("a mailbox that needs reconnecting can't update", historyState(sub(), true), "cant_update");
check("an inbox_disconnected status can't update", historyState(sub({ lifecycleReason: "inbox_disconnected" }), false), "cant_update");
check("done is ok", historyState(sub(), false), "ok");
check("added by hand (no search)", historyState(sub({ historyStatus: "done", historyError: "added by hand", emailProvider: null, merchantEmail: null }), false), "manual");
check("added by hand, never queued", historyState(sub({ historyStatus: null, emailProvider: null, merchantEmail: null }), false), "manual");
check("never queued but linked to an inbox is not manual", historyState(sub({ historyStatus: null }), false), "ok");
check("still searching wins over manual", historyState(sub({ historyStatus: "pending", emailProvider: null, merchantEmail: null }), false), "searching");

/* --- Review wording ----------------------------------------------------- */
check("plain day", plainDay("2026-06-03"), "Jun 3, 2026");
check("plain day from a date", plainDay(new Date("2026-06-03T00:00:00Z")), "Jun 3, 2026");
check("plain day, none", plainDay(null), "");
check("reason, monthly", reviewReason("Netflix", "monthly", "2026-06-03"), "No payment since Jun 3, 2026. Netflix usually charges every month.");
check("reason, yearly", reviewReason("Car policy", "yearly", "2025-02-01"), "No payment since Feb 1, 2025. Car policy usually charges every year.");
check("reason, unknown cadence", reviewReason("X", "odd", "2026-06-03"), "No payment since Jun 3, 2026.");
check("reason never says cancelled", /cancel/i.test(reviewReason("Netflix", "monthly", "2026-06-03")), false);

/* --- The subscription as received -------------------------------------- */
const full = {
  id: "s1", serviceName: "Netflix", status: "active",
  lifecycleStatus: "needs_review", lifecycleReason: "no_recent_payment", lifecycleUpdatedAt: "x",
  lastPaymentAt: "2026-06-03", expectedNextPaymentAt: "2026-07-03", endsOn: null, cancelledAt: null,
  inactiveSince: null, inactiveSource: null, stillActiveTaps: 1, stillActiveUntil: "2026-12-01",
  historyStatus: "done", historySearchedSince: "2025-10-01", historyAttempts: 0, historyError: "note",
  historyStartedAt: null, historyFinishedAt: null, historyRead: 4, historySaved: 3, historySkipped: 0, historyPartial: false,
};
check("switch off: no status columns at all", Object.keys(presentSubscription(full, false)).sort(), ["id", "serviceName", "status"]);
check("switch on: only what the screens use", Object.keys(presentSubscription(full, true)).sort(), [
  "cancelledAt", "endsOn", "expectedNextPaymentAt", "historySearchedSince", "historyStatus", "id", "inactiveSince",
  "inactiveSource", "lastPaymentAt", "lifecycleReason", "lifecycleStatus", "serviceName", "status",
]);
check("the input is not changed", "stillActiveTaps" in full, true);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
