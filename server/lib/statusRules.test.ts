/* Run: npm run test:status */
import {
  computeLifecycle,
  countedPayments,
  explainPayments,
  classifyPaymentEmail,
  isCreditCardBill,
  attachmentTextOf,
  paymentFromEmail,
  decideReread,
  creditCardEmailIds,
  paidDay,
  reconcileBills,
  BILL_NO_RECEIPT_LABEL,
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

// No-amount receipt next to a payment with an amount.
{
  const claude = pay("2026-06-29", 23.6, "receipt", "USD");
  const welcome = pay("2026-06-29", null, "receipt", "USD");
  check("claude: receipt + same-day welcome with no amount: one payment", countedPayments([claude, welcome]).length, 1);
  check("claude: the amounted receipt is the one kept", countedPayments([welcome, claude])[0].amount, 23.6);
  check("welcome with no amount and no neighbour still counts", countedPayments([welcome]).length, 1);
  check("no amount, 3 days from an amounted one: covered", countedPayments([claude, pay("2026-07-02", null, "receipt", "USD")]).length, 1);
  check("no amount, 5 days from an amounted one: still counts", countedPayments([claude, pay("2026-07-04", null, "receipt", "USD")]).length, 2);
  check("a no-amount receipt is covered by a card alert with an amount", countedPayments([pay("2026-06-30", 2255.68, "card_alert", "INR"), welcome]).length, 1);
  check("a no-amount card alert is unaffected", countedPayments([claude, pay("2026-06-29", null, "card_alert", "USD")]).length, 2);
  check("a bill with an amount does not cover a no-amount receipt", countedPayments([pay("2026-06-29", 23.6, "invoice", "USD"), welcome]).length, 1);
  check("a failed payment with an amount does not cover it", countedPayments([pay("2026-06-29", 23.6, "failed", "USD"), welcome]).length, 1);
  check("two no-amount receipts do not cover each other", countedPayments([welcome, pay("2026-06-30", null, "receipt", "USD")]).length, 2);
  check("it stays recorded: explained as covered", explainPayments([claude, welcome], NOW).map((e) => e.note), ["Counts as a payment", "Not counted: no amount, covered by 29 Jun 2026 payment"]);
  check("explain: a lone no-amount receipt counts", explainPayments([welcome], NOW)[0].counted, true);
  check("explain: bill with no receipt", explainPayments([pay("2026-06-18", 23.6, "invoice", "USD")], NOW)[0].note, BILL_NO_RECEIPT_LABEL);
  check("explain: paired bill", explainPayments([pay("2026-06-28", 23.6, "invoice", "USD"), claude], NOW).map((e) => e.counted), [false, true]);
  check("explain: refund is not counted", explainPayments([pay("2026-06-29", 23.6, "refund", "USD")], NOW)[0].note, "Not counted: refund");
}

// Different currencies.
{
  const payments = [pay("2026-07-10", 20, "receipt", "USD"), pay("2026-08-10", 1700, "receipt", "INR"), pay("2026-09-10", 20, "receipt", "USD")];
  check("different currencies: each counts", countedPayments(payments).length, 3);
  check("different currencies: status as usual", sr(run({ payments })), "active/paid_recently");
  // Updated on purpose: two receipts in different currencies within 3 days, each the other's only candidate, are now one charge.
  check("a lone pair of receipts in different currencies on the same day is one charge",
    countedPayments([pay("2026-09-10", 20, "receipt", "USD"), pay("2026-09-10", 20, "receipt", "EUR")]).length, 1);
  check("... but not when they are more than 3 days apart",
    countedPayments([pay("2026-09-10", 20, "receipt", "USD"), pay("2026-09-14", 20, "receipt", "EUR")]).length, 2);
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


/* --- PR 3b: bills, receipts and notices ---------------------------------- */
const read = (e: Parameters<typeof classifyPaymentEmail>[0], opts?: { requireWording?: boolean }) => classifyPaymentEmail(e, NOW, opts);
const kindOf = (e: Parameters<typeof classifyPaymentEmail>[0]) => read(e)?.kind ?? null;

console.log("Only receipts and card alerts count");
check("an invoice alone is not a payment", countedPayments([pay("2026-09-18", 1885.64, "invoice")]).length, 0);
check("a receipt counts", countedPayments([pay("2026-09-18", 1885.64, "receipt")]).length, 1);
check("a card alert counts", countedPayments([pay("2026-09-18", 1885.64, "card_alert")]).length, 1);
check("bills only: no payment seen, never flagged", sr(run({ payments: [pay("2026-03-18", 1885.64, "invoice")] })), "active/no_payments");

console.log("Claude (Anthropic): receipt, then notices that are not payments");
{
  const receipt = read({
    subject: "Your receipt from Anthropic, PBC #2208-1234",
    content: "Receipt from Anthropic, PBC $23.60 Paid September 29, 2026 Claude Pro Amount paid $23.60",
    amount: 23.6,
    attachmentText: "Invoice-ABC-0001.pdf\nReceipt-2208-1234.pdf",
  })!;
  check("receipt email: kind receipt, paid", [receipt.kind, receipt.paidStatus], ["receipt", "paid"]);
  check("receipt email with Invoice + Receipt PDFs: document type receipt", receipt.documentType, "receipt");
  check("paid date comes from 'Paid <date>'", receipt.paidOn, "2026-09-29");
  check("receipt arriving a day later is dated by the body", paidDay("2026-09-30", receipt.paidOn), "2026-09-29");
  check("no date in the body: the email's date", paidDay("2026-09-30", null), "2026-09-30");
  check("an implausible paid date is ignored", paidDay("2026-09-30", "2025-01-01"), "2026-09-30");
  check("a paid date after the email is ignored", paidDay("2026-09-30", "2026-10-20"), "2026-09-30");
  check("confirm your payment: not a payment", kindOf({ subject: "Confirm your $23.60 payment", content: "Your bank needs you to authenticate this payment.", amount: 23.6 }), null);
  check("bank authentication notice: not a payment", kindOf({ subject: "Action needed", content: "Complete bank authentication to finish your $23.60 payment.", amount: 23.6 }), null);
  check("payment pending: not a payment", kindOf({ subject: "Your payment is pending", content: "$23.60", amount: 23.6 }), null);
  check("payment failed: failed, never counted", kindOf({ subject: "Your payment of $23.60 failed", content: "", amount: 23.6 }), "failed");
  check("access paused: not a payment", kindOf({ subject: "Your Claude access is paused", content: "Update payment.", amount: 23.6 }), "pause");
  check("confirm renewal: not a payment", kindOf({ subject: "Confirm renewal of your Claude subscription", content: "$23.60", amount: 23.6 }), null);
  check("confirm in the body with nothing paid: not a payment", kindOf({ subject: "Claude", content: "Please confirm your renewal to keep access. $23.60", amount: 23.6 }), null);
  check("a receipt's 'confirm your payment method' footer is still a receipt", kindOf({ subject: "Your receipt from Anthropic", content: "Amount paid $23.60. You can confirm your payment method any time.", amount: 23.6 }), "receipt");
  // The notices never count, the receipt does, once.
  const rows = [pay("2026-09-29", 23.6, "receipt", "USD"), pay("2026-09-28", 23.6, "failed", "USD")];
  check("receipt plus failed notice: one payment", countedPayments(rows).length, 1);
}

console.log("Two labels per email: document type and paid status");
{
  const bill = read({ subject: "Bill for your Airtel Black account - Sep'26", content: "Total amount payable: ₹1885.64 Due Date: 28 Sep 2026", amount: 1885.64 })!;
  check("bill: invoice, due, not counted", [bill.kind, bill.documentType, bill.paidStatus], ["invoice", "invoice", "due"]);
  check("bill: due date read", bill.dueOn, "2026-09-28");
  const receipt = read({ subject: "Here's your Airtel payment receipt!", content: "We have received a payment of Rs 1885.64", amount: 1885.64, attachmentText: "AirtelReceipt_123.pdf" })!;
  check("airtel receipt: receipt, paid", [receipt.kind, receipt.documentType, receipt.paidStatus], ["receipt", "receipt", "paid"]);
  check("a bill with 'pay by' wording is due", read({ subject: "Your invoice", content: "Please pay by 5 Oct 2026. Amount due $12", amount: 12 })?.paidStatus, "due");
  check("amount due: not counted", kindOf({ subject: "Statement", content: "Amount due $12.00", amount: 12 }), "invoice");
  check("bill generated: invoice", kindOf({ subject: "Your bill is generated", content: "", amount: 12 }), "invoice");
  check("your bill: invoice", kindOf({ subject: "Account update", content: "Your bill for September", amount: 12 }), "invoice");
  check("invoice whose text says paid: counts as a receipt", read({ subject: "Invoice #1001 from Acme", content: "Amount paid $12.00", amount: 12 })?.kind, "receipt");
  check("... and keeps the document type invoice", read({ subject: "Invoice #1001 from Acme", content: "Amount paid $12.00", amount: 12 })?.documentType, "invoice");
  check("invoice, nothing about paying: stays a bill, unclear", [read({ subject: "Invoice #1002 from Acme", content: "Thanks.", amount: 12 })?.kind, read({ subject: "Invoice #1002 from Acme", content: "Thanks.", amount: 12 })?.paidStatus], ["invoice", "unclear"]);
  check("payment received", kindOf({ subject: "Acme", content: "Payment received. Thank you", amount: 9 }), "receipt");
  check("payment successful", kindOf({ subject: "Acme", content: "Your payment successful", amount: 9 }), "receipt");
  check("paid <date>", read({ subject: "Acme", content: "Paid 3 Sep 2026", amount: 9 })?.kind, "receipt");
}

console.log("PDF text is an extra source");
{
  const autoSecure = { subject: "Your Auto Secure document", content: "Please find your document attached.", amount: null as number | null };
  check("no PDF text, no amount: nothing", kindOf(autoSecure), null);
  check("PDF says amount paid: a receipt", kindOf({ ...autoSecure, attachmentText: "Invoice-77.pdf\nAmount paid Rs 499" }), "receipt");
  check("PDF says amount due: a bill", kindOf({ ...autoSecure, attachmentText: "Invoice-77.pdf\nAmount due Rs 499. Due date: 5 Oct 2026" }), "invoice");
  check("subject 'invoice', PDF says paid: a receipt", kindOf({ subject: "Your invoice", content: "", attachmentText: "Receipt\nPaid on 12 Aug 2026", amount: 499 }), "receipt");
  check("PDF 'payment pending' does not make a payment", kindOf({ ...autoSecure, attachmentText: "Payment pending authentication" }), null);
  const data = JSON.stringify({ hasAttachments: true, attachments: [{ filename: "Invoice-1.pdf", extractedText: "Amount paid $5" }, { filename: "pic.png", base64Data: "AAAA" }] });
  check("attachment text collects names and PDF words, not images", attachmentTextOf(data), "Invoice-1.pdf\nAmount paid $5\npic.png");
  check("bad attachment data reads as nothing", attachmentTextOf("not json"), "");
  check("no requireWording: unclear with amount is a receipt", read({ subject: "Netflix", content: "Hello there", amount: 649 })?.kind, "receipt");
  check("requireWording: unclear with amount is nothing", read({ subject: "Netflix", content: "Hello there", amount: 649 }, { requireWording: true }), null);
}

console.log("Airtel: bill then receipt, one payment; duplicate receipt");
{
  const bill = pay("2026-09-18", 1885.64, "invoice");
  const receiptA = pay("2026-09-25", 1885.64, "receipt");
  const receiptB = pay("2026-09-25", 1885.64, "receipt");
  check("bill + receipt: one counted payment", countedPayments([bill, receiptA]).length, 1);
  check("bill + receipt: the receipt is the payment", countedPayments([bill, receiptA])[0].kind, "receipt");
  check("same receipt twice the same day: one payment", countedPayments([receiptA, receiptB]).length, 1);
  check("bill + duplicate receipts: one payment", countedPayments([bill, receiptA, receiptB]).length, 1);
  const r = reconcileBills([bill, receiptA, receiptB], NOW);
  check("the bill is paired, not left over", [r.paired, r.noReceipt.length, r.open.length], [1, 0, 0]);
  check("receipt 2 weeks after the bill still pairs", reconcileBills([bill, pay("2026-10-01", 1885.64, "receipt")], new Date("2026-10-15T00:00:00Z")).paired, 1);
  check("receipt 3 days before the bill still pairs", reconcileBills([bill, pay("2026-09-15", 1885.64, "receipt")], NOW).paired, 1);
  check("receipt 4 days before the bill does not pair", reconcileBills([bill, pay("2026-09-14", 1885.64, "receipt")], new Date("2026-12-01T00:00:00Z")).paired, 0);
  check("receipt 21 days after does not pair", reconcileBills([bill, pay("2026-10-09", 1885.64, "receipt")], new Date("2026-12-01T00:00:00Z")).paired, 0);
  const due = { ...bill, dueOn: "2026-09-28" };
  check("the window runs 20 days after the due date", reconcileBills([due, pay("2026-10-17", 1885.64, "receipt")], new Date("2026-12-01T00:00:00Z")).paired, 1);
  check("a different amount does not pair", reconcileBills([bill, pay("2026-09-25", 399, "receipt")], new Date("2026-12-01T00:00:00Z")).paired, 0);
  check("a card alert for the bill's amount pairs too", reconcileBills([bill, pay("2026-09-25", 1885.64, "card_alert")], NOW).paired, 1);
  check("a bill with no amount cannot pair", reconcileBills([pay("2026-09-18", null, "invoice"), pay("2026-09-25", 1885.64, "receipt")], new Date("2026-12-01T00:00:00Z")).paired, 0);
  const twoBills = reconcileBills([pay("2026-08-18", 1885.64, "invoice"), pay("2026-09-18", 1885.64, "invoice"), pay("2026-09-25", 1885.64, "receipt")], new Date("2026-12-01T00:00:00Z"));
  check("one receipt pays one bill only", [twoBills.paired, twoBills.noReceipt.length], [1, 1]);
}

console.log("Old bill with no receipt");
{
  const old = [pay("2026-06-18", 1885.64, "invoice")];
  const r = reconcileBills(old, NOW);
  check("old bill, no receipt: receipt not found", [r.paired, r.noReceipt.length, r.open.length], [0, 1, 0]);
  check("label for later screens", BILL_NO_RECEIPT_LABEL, "Bill, receipt not found");
  check("old bill is not a payment", countedPayments(old).length, 0);
  check("recent bill is still open, not 'not found'", reconcileBills([pay("2026-09-25", 1885.64, "invoice")], NOW).open.length, 1);
  check("last bill is available", computeLifecycle(input({ payments: old }), NOW).lastBillAt, "2026-06-18");
  check("no bills: no last bill", computeLifecycle(input({ payments: [pay("2026-09-05")] }), NOW).lastBillAt, null);
  check("a paid bill is not a 'last bill'", computeLifecycle(input({ payments: [pay("2026-09-18", 1885.64, "invoice"), pay("2026-09-25", 1885.64, "receipt")] }), NOW).lastBillAt, null);
}

console.log("Railway (Stripe receipt, plan name in the body)");
{
  const railway = read({
    subject: "Your receipt from Railway Corporation #2139-9980",
    content: "Receipt from Railway Corporation $5.90 Paid September 18, 2026 Hobby plan",
    amount: 5.9,
    attachmentText: "Invoice-AOMRQJIP-0001.pdf\nReceipt-2139-9980.pdf",
  })!;
  check("railway: receipt, paid on the stated day", [railway.kind, railway.paidOn, railway.documentType], ["receipt", "2026-09-18", "receipt"]);
}

console.log("Cross-currency: a USD receipt and an INR card alert");
{
  const usd = pay("2026-09-29", 23.6, "receipt", "USD");
  const inr = pay("2026-09-30", 2255.68, "card_alert", "INR");
  check("receipt + alert two days apart, one pair: one payment", countedPayments([usd, inr]).length, 1);
  check("the receipt is kept", countedPayments([usd, inr])[0].kind, "receipt");
  check("more than three days apart: two payments", countedPayments([usd, pay("2026-10-03", 2255.68, "card_alert", "INR")]).length, 2);
  check("same currency stays as before (receipt + alert)", countedPayments([pay("2026-09-12", 499.4, "card_alert"), pay("2026-09-11", 499, "receipt")]).length, 1);
  check("an alert without an amount is never merged", countedPayments([usd, pay("2026-09-30", null, "card_alert", "INR")]).length, 2);
  // Updated on purpose: a no-amount receipt within 3 days of an amounted payment is now covered by it (see "No-amount receipt" below).
  check("a receipt without an amount next to an amounted alert is covered by it", countedPayments([pay("2026-09-29", null, "receipt", "USD"), inr]).length, 1);
  check("an alert without a currency is not merged across currencies", countedPayments([usd, pay("2026-09-30", 2255.68, "card_alert", null)]).length, 2);
  // Ambiguous: one receipt, two alerts close by.
  check("ambiguous (two alerts near one receipt): nothing merged", countedPayments([usd, inr, pay("2026-09-29", 1900, "card_alert", "INR")]).length, 3);
  // Several pairs: a derived rate (about 95.6) is the check.
  const history = [
    pay("2026-07-29", 23.6, "receipt", "USD"), pay("2026-07-30", 2250, "card_alert", "INR"),
    pay("2026-08-29", 23.6, "receipt", "USD"), pay("2026-08-30", 2262, "card_alert", "INR"),
    usd, inr,
  ];
  check("a history of pairs at a steady rate: three payments", countedPayments(history).length, 3);
  const odd = [...history.slice(0, 4), usd, pay("2026-09-30", 900, "card_alert", "INR")];
  check("a pair far from the others' rate is not merged (12%)", countedPayments(odd).length, 4);
  check("with a derived rate, a bill in USD pairs with the INR alert it was paid by",
    reconcileBills([pay("2026-09-25", 23.6, "invoice", "USD"), ...history], new Date("2026-12-01T00:00:00Z")).paired, 1);
  check("without a rate, a USD bill does not pair with an INR alert", reconcileBills([pay("2026-09-25", 23.6, "invoice", "USD"), inr], new Date("2026-12-01T00:00:00Z")).paired, 0);
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

console.log("Airtel bills with PDF text, Claude cross-currency receipts, confirm-payment notices");
{
  const airtelBody = "Total amount payable: ₹1885.64 Due Date: 28 Jul 2026 Pay via Airtel";
  const airtelPdf = "10101012665222_Jul2026.pdf\nBill summary. Payment received on 3 Jul 2026 Rs 1885.64. Previous balance Rs 0. Total amount payable Rs 1885.64. Due Date 28 Jul 2026";
  const billEmail = { subject: "Bill for your Airtel Black account - Jul'26", content: airtelBody, amount: 1885.64 };
  const withPdf = read({ ...billEmail, attachmentText: airtelPdf })!;
  check("airtel bill + PDF with 'payment received' wording: bill, due", [withPdf.kind, withPdf.paidStatus], ["invoice", "due"]);
  check("airtel bill without PDF text: bill, due (as at approval)", [read(billEmail)!.kind, read(billEmail)!.paidStatus], ["invoice", "due"]);
  check("airtel bill due date read", withPdf.dueOn, "2026-07-28");
  check("email says due, PDF says amount paid: still a bill", kindOf({ subject: "Your bill is ready", content: "Amount due $12", amount: 12, attachmentText: "Invoice.pdf\nAmount paid $5" }), "invoice");
  check("PDF with due wording and nothing stronger, bare email: a bill", kindOf({ subject: "Invoice attached", content: "", amount: 12, attachmentText: "Invoice.pdf\nPayment received. Amount due $12. Due date: 5 Oct 2026" }), "invoice");
  check("PDF with due wording and 'amount paid': a receipt", kindOf({ subject: "Invoice attached", content: "", amount: 12, attachmentText: "Invoice.pdf\nAmount paid $12. Balance due $0 due on receipt" }), "receipt");
  check("PDF with due wording but a receipt file name: a receipt", kindOf({ subject: "Invoice attached", content: "", amount: 12, attachmentText: "Receipt-1.pdf\nPayment received. Total payable $12" }), "receipt");
  check("'Invoice attached', PDF says Amount paid: a receipt", kindOf({ subject: "Invoice attached", content: "Please find it attached.", amount: 12, attachmentText: "Invoice-9.pdf\nAmount paid Rs 12" }), "receipt");
  check("'Invoice attached', PDF says Paid on a date: a receipt", kindOf({ subject: "Invoice attached", content: "", amount: 12, attachmentText: "Invoice-9.pdf\nPaid on 12 Aug 2026" }), "receipt");

  // The full Airtel sequence: 3 receipts (one twice) and 12 bills.
  const bills: LifecyclePayment[] = [];
  for (let m = 0; m < 12; m++) {
    const d = new Date(Date.UTC(2025, 9 + m, 18)).toISOString().slice(0, 10);
    bills.push(pay(d, 1885.64, "invoice"));
  }
  const receipts = [pay("2026-07-01", 1885.64), pay("2026-08-20", 1885.64), pay("2026-09-29", 1885.64), pay("2026-09-29", 1885.64)];
  const seq = [...bills, ...receipts];
  const now = new Date("2026-09-30T10:00:00Z");
  check("airtel sequence: 3 payments counted", countedPayments(seq).length, 3);
  const why = explainPayments(seq, now);
  check("airtel sequence: counted flags", why.filter((w) => w.counted).length, 3);
  check("airtel sequence: the duplicate receipt is not counted", why.filter((w) => w.note === "Not counted: same charge as another record").length, 1);
  const billNotes = why.slice(0, 12).map((w) => w.note);
  check("airtel sequence: every bill is paired or 'receipt not found', none counted",
    billNotes.every((n) => n === BILL_NO_RECEIPT_LABEL || n.startsWith("Bill, paired")) && why.slice(0, 12).every((w) => !w.counted), true);
  check("airtel sequence: bills near a receipt are paired", billNotes.filter((n) => n.startsWith("Bill, paired")).length > 0, true);

  // Claude: the same $23.60 payment as a USD receipt and a bank's INR receipt.
  const usd = pay("2026-08-30", 23.6, "receipt", "USD");
  const inr = pay("2026-08-31", 2255.68, "receipt", "INR");
  check("claude: USD receipt + INR receipt a day apart: one counted", countedPayments([usd, inr]).length, 1);
  check("claude: the later one is kept without a known currency", countedPayments([usd, inr])[0].currency, "INR");
  check("claude: the subscription's currency is kept when known", countedPayments([usd, inr], "USD")[0].currency, "USD");
  check("claude: explain says same charge", explainPayments([usd, inr], NOW, "USD").map((w) => w.note), ["Counts as a payment", "Not counted: same charge as another record"]);
  check("claude: order of records does not matter", countedPayments([inr, usd]).length, 1);
  check("receipt + receipt without an amount are not merged this way", countedPayments([usd, pay("2026-08-31", null, "receipt", "INR")]).length, 1 /* covered by the no-amount rule */);
  check("receipts without a currency are not merged across currencies", countedPayments([usd, pay("2026-08-31", 2255.68, "receipt", null)]).length, 2);
  const steady = [
    pay("2026-06-30", 23.6, "receipt", "USD"), pay("2026-07-01", 2250, "receipt", "INR"),
    pay("2026-07-30", 23.6, "receipt", "USD"), pay("2026-07-31", 2262, "receipt", "INR"),
  ];
  check("two pairs within 12% of the median: two payments", countedPayments(steady).length, 2);
  check("an out-of-tolerance pair among others does not merge", countedPayments([...steady, pay("2026-08-30", 23.6, "receipt", "USD"), pay("2026-08-31", 900, "receipt", "INR")]).length, 4);
  check("a lone out-of-the-ordinary pair still merges (nothing to compare with)", countedPayments([usd, pay("2026-08-31", 900, "receipt", "INR")]).length, 1);
  check("two USD receipts and one INR: ambiguous, nothing merged", countedPayments([usd, pay("2026-08-29", 30, "receipt", "USD"), inr]).length, 3);
  check("receipt + card alert behaviour is unchanged", countedPayments([usd, pay("2026-08-31", 2255.68, "card_alert", "INR")]).length, 1);

  // Pending notices.
  const confirm = (subject: string, content = "Confirm your payment to Anthropic, PBC. You have an outstanding invoice.") => kindOf({ subject, content, amount: 23.6 });
  check("'Confirm your $23.60 payment' with an invoice body: not a payment", confirm("Important: Confirm your $23.60 payment to Anthropic, PBC"), null);
  check("'Action needed: confirm your ... renewal': not a payment", confirm("Action needed: confirm your Claude Pro renewal"), null);
  check("'Reminder: Confirm your ... payment': not a payment", confirm("Reminder: Confirm your $23.60 payment to Anthropic, PBC"), null);
  check("'Payment confirmation' is still a receipt", kindOf({ subject: "Payment confirmation", content: "Thanks.", amount: 23.6 }), "receipt");
  check("'Payment confirmed' is still a receipt", kindOf({ subject: "Payment confirmed", content: "", amount: 23.6 }), "receipt");
  check("'Your receipt from Anthropic, PBC' is still a receipt", kindOf({ subject: "Your receipt from Anthropic, PBC #2208-1234", content: "Invoice paid $23.60", amount: 23.6 }), "receipt");
  check("'Confirm your payment method' is not caught by the subject rule", kindOf({ subject: "Confirm your payment method", content: "Amount paid $5", amount: 5 }), "receipt");
}

console.log("Credit card bills and bill reminders");
{
  const ccSubject = "Your credit card bill is due on Mar 30, 2026: Pay now to maintain your credit score";
  check("credit card bill: never a payment (even with an amount)", kindOf({ subject: ccSubject, content: "Total due Rs 58,317.58", amount: 58317.58 }), null);
  check("credit card statement: never a payment", kindOf({ subject: "Your HDFC card statement", content: "Minimum due Rs 2,000", amount: 2000 }), null);
  check("credit card body wording in the first 1500 characters: never a payment", kindOf({ subject: "Bill update", content: "Your credit card outstanding is Rs 9,000. Pay now.", amount: 9000 }), null);
  check("isCreditCardBill: a receipt paid by credit card is not one", isCreditCardBill({ subject: "Your receipt from Netflix", content: "Paid by credit card ending 4242. Amount paid Rs 649" }), false);
  check("isCreditCardBill: a card transaction alert is not one", isCreditCardBill({ subject: "INR 2,255.68 spent on your Federal Bank credit card", content: "Transaction alert" }), false);
  check("a card alert is still a card alert", kindOf({ subject: "INR 2,255.68 spent on your Federal Bank credit card", content: "", amount: 2255.68 }), "card_alert");
  // paymentsFromEmails skips any email classifyPaymentEmail returns null for, so this is also never stored as a payment.
  check("a credit card bill reads as no payment at all (null)", read({ subject: ccSubject, content: "Total due Rs 58,317.58", amount: 58317.58 }), null);

  const reminders = [
    "your mobile postpaid bill is overdue",
    "mobile postpaid bill is due today",
    "mobile postpaid bill due in 2 days",
    "your mobile postpaid bill is due soon",
  ];
  for (const subject of reminders) {
    const r = read({ subject, content: "Rs 1471.46", amount: 1471.46 })!;
    check(`reminder '${subject}': a bill, due, not counted`, [r.kind, r.paidStatus], ["invoice", "due"]);
  }
  check("'Pay now' with an amount: a bill", kindOf({ subject: "Pay now", content: "Rs 99", amount: 99 }), "invoice");
  check("amount-only email without reminder wording: still a receipt", kindOf({ subject: "Netflix", content: "Hello there", amount: 649 }), "receipt");
  check("a normal receipt is unaffected", kindOf({ subject: "Your receipt from Railway Corporation", content: "Paid September 18, 2026 $5.90", amount: 5.9 }), "receipt");
  check("a receipt that mentions the next due date stays a receipt", kindOf({ subject: "Payment received", content: "Thanks. Your next bill is due in 30 days.", amount: 99 }), "receipt");
}

check("loose date: long form", parseLooseDay("October 5, 2026", NOW), "2026-10-05");
check("loose date: day first", parseLooseDay("5 Oct 2026", NOW), "2026-10-05");
check("loose date: ISO", parseLooseDay("2026-10-05", NOW), "2026-10-05");
check("loose date: nonsense", parseLooseDay("soon", NOW), null);
check("loose date: absurd year", parseLooseDay("1970-01-01", NOW), null);


console.log("Re-reading stored payments");
{
  const email = (subject: string, content: string, amount: number | null, receivedAt = "2026-08-29") =>
    ({ subject, content, receivedAt, extractedAmount: amount === null ? null : String(amount), extractedCurrency: null as string | null });
  const stored = (e: ReturnType<typeof email>, over: Record<string, unknown> = {}) => {
    const f = paymentFromEmail(e, "INR", NOW)!;
    return { ...f, ...over };
  };
  const reread = (row: Record<string, any>, e: ReturnType<typeof email>) => decideReread(row as any, paymentFromEmail(e, "INR", NOW));

  // Claude: stored as a Bill (invoice) by an older rule; now a confirm-payment notice, not a payment.
  const claude = email("Important: Confirm your $23.60 payment to Anthropic, PBC", "Confirm your payment to Anthropic, PBC. You have an outstanding invoice.", 23.6);
  const claudeStored = { kind: "invoice", documentType: "invoice", paidStatus: "due", dueOn: null, amount: "23.60", currency: "USD", paidAt: "2026-08-29", pausedUntil: null };
  check("claude confirm-payment stored as Bill: removed", reread(claudeStored, claude).action, "remove");

  // Airtel reminders stored as receipts (amount-only fallback): now bills, due, kept.
  const airtelStored = { kind: "receipt", documentType: "receipt", paidStatus: "paid", dueOn: null, amount: "1471.46", currency: "INR", paidAt: "2026-09-20", pausedUntil: null };
  for (const subject of [
    "your mobile postpaid bill is overdue",
    "your mobile postpaid bill is due today",
    "your mobile postpaid bill is due in 2 days",
    "your mobile postpaid bill is due soon",
  ]) {
    const e = email(subject, "Rs 1471.46", 1471.46, "2026-09-20");
    const d = reread(airtelStored, e);
    check(`airtel '${subject}': updated to a bill`, d.action === "update" ? [d.fields.kind, d.fields.paidStatus] : d.action, ["invoice", "due"]);
    check(`airtel '${subject}': not counted after the update`, d.action === "update" ? countedPayments([{ paidAt: d.fields.paidAt, amount: d.fields.amount, currency: d.fields.currency, kind: d.fields.kind, pausedUntil: d.fields.pausedUntil }]).length : -1, 0);
  }

  // A genuine receipt is left alone, and a changed amount is picked up.
  const genuine = email("Your receipt from Railway Corporation", "Paid September 18, 2026 $5.90", 5.9, "2026-09-19");
  check("genuine receipt: unchanged", reread(stored(genuine), genuine).action, "keep");
  check("genuine receipt with a date/amount as Date and number types: unchanged",
    reread(stored(genuine, { paidAt: new Date("2026-09-18T00:00:00Z"), amount: 5.9 }), genuine).action, "keep");
  const changed = reread(stored(genuine, { amount: "6.90" }), genuine);
  check("a stale amount is updated", changed.action === "update" ? changed.fields.amount : changed.action, "5.90");
}

console.log("Credit card clean-up selection");
{
  const rows = [
    { id: "a", subject: "Your HDFC credit card statement for Sep 2026", content: "Total amount due Rs 12,000" },
    { id: "b", subject: "Credit card bill due in 2 days", content: "Pay now" },
    { id: "c", subject: "Your receipt from Railway Corporation", content: "Paid $5.90" },
    { id: "d", subject: "Netflix", content: "Your credit card was charged Rs 649" },
    { id: "e", subject: null, content: null },
  ];
  check("only credit card bills are selected", creditCardEmailIds(rows), ["a", "b"]);
  check("nothing selected for none", creditCardEmailIds([]), []);
}


/* --- Failure notices from the service itself ---------------------------- */
{
  const k = (subject: string, content: string) => classifyPaymentEmail({ subject, content, amount: null })?.kind ?? null;
  check("failed: Netflix declined", k("Netflix: your payment was declined", "We couldn't process your payment."), "failed");
  check("failed: couldn't be processed (curly apostrophe)", k("Your payment couldn\u2019t be processed", "We tried to charge your card but it didn\u2019t go through."), "failed");
  check("failed: billing problem", k("There's a problem with your billing", "Please update your payment method."), "failed");
  check("failed: not processed", k("Action needed", "Your payment has not been processed."), "failed");
  check("a renewal notice is not a payment", k("Your Netflix membership renews on 5 Nov", "Your plan will renew on 5 Nov 2026."), null);
  check("a normal receipt is unchanged", k("Your receipt from Anthropic, PBC", "Receipt $23.60 Paid September 29, 2026"), "receipt");
  // Netflix's own wording (curly apostrophes as in real mail).
  check("netflix: successfully processed your payment is a receipt", k("We’ve successfully processed your payment", "Your payment has been processed."), "receipt");
  check("netflix: payment was unsuccessful is failed", k("Your payment was unsuccessful", "Let’s fix it, so your membership isn’t interrupted."), "failed");
  check("netflix: update payment is failed", k("Action needed: update payment", "Don’t lose access to series, films and games."), "failed");
  check("netflix: update your payment is failed", k("Update your payment", ""), "failed");
  check("netflix: payment has been unsuccessful (body) is failed", k("Heads up", "Your payment has been unsuccessful."), "failed");
  check("netflix: payment was successfully processed is a receipt", k("Netflix", "Your payment was successfully processed."), "receipt");
  check("confirm-payment notice is still skipped", k("Confirm your $23.60 payment", "Please confirm your payment."), null);
  check("Anthropic receipt is unchanged", k("Your receipt from Anthropic, PBC", "Receipt $23.60 Paid September 29, 2026"), "receipt");
  const noPay = run({ payments: [pay("2026-09-12", null, "failed")] });
  check("only a failure notice and no payments: active, payment failed", sr(noPay), "active/payment_failed");
  check("an old failure notice and no payments: unchanged", sr(run({ payments: [pay("2026-01-12", null, "failed")] })), "active/no_payments");
  check("no payments and no notices: unchanged", sr(run({ payments: [] })), "active/no_payments");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
