/* Run: npm run test:shared-sender */
import { assignSharedReceipt, usualAmounts, type SharedCandidate } from "./historySearchRules";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}

const APPLE = ["no_reply@email.apple.com"];
const icloud: SharedCandidate = {
  id: "b-icloud", serviceName: "iCloud+", amount: 75, currency: "INR", senders: APPLE,
  detectedAt: 1000, recordedAmounts: [75, 75, 75, 75],
};
// The price of Apple One Family here is an example, not a real figure.
const one: SharedCandidate = {
  id: "a-one", serviceName: "Apple One Family", amount: 195, currency: "INR", senders: APPLE,
  detectedAt: 2000, recordedAmounts: [195, 195, 195],
};
const both = [icloud, one];
const mail = (amount: number | null, text: string, currency: string | null = "INR", fromEmail = "no_reply@email.apple.com") =>
  ({ fromEmail, subject: "Your receipt from Apple", text, amount, currency });
const verdicts = (e: ReturnType<typeof mail>) => [
  assignSharedReceipt(e, icloud, both, { requireGroup: true }),
  assignSharedReceipt(e, one, both, { requireGroup: true }),
];

console.log("Apple: iCloud+ and Apple One Family");
check("iCloud+ 75: only iCloud+", verdicts(mail(75, "iCloud+ with 50 GB storage")), ["here", "other"]);
check("Apple One 195: only Apple One (even though its receipt says iCloud+)", verdicts(mail(195, "Apple One Family includes iCloud+ 200 GB")), ["other", "here"]);
check("price alone is enough, no product line", verdicts(mail(75, "Thank you for your purchase")), ["here", "other"]);
check("144 with no product name: dropped for both", verdicts(mail(144, "Thank you for your purchase")), ["none", "none"]);
check("144 naming iCloud+: still counted once, for iCloud+", verdicts(mail(144, "iCloud+ 200 GB")), ["here", "other"]);
check("same receipt is never counted twice", verdicts(mail(75, "iCloud+ and Apple One Family")).filter((v) => v === "here").length, 1);
check("price within 2% matches", verdicts(mail(76, "x"))[0], "here");
check("price 5% off does not match", verdicts(mail(79, "x"))[0], "none");
check("amount missing: the product name decides", verdicts(mail(null, "Apple One Family renewal")), ["other", "here"]);

console.log("Price change");
{
  const raised = { ...icloud, amount: 99 }; // subscription row updated, payments still at 75
  const e = mail(99, "iCloud+ 50 GB");
  check("new price counted (current amount)", assignSharedReceipt(e, raised, [raised, one], { requireGroup: true }), "here");
  const stale = { ...icloud, amount: 75 }; // subscription row still 75, receipt 99, name present
  check("new price counted by product name", assignSharedReceipt(e, stale, [stale, one], { requireGroup: true }), "here");
  const reverse = { ...icloud, amount: 99, recordedAmounts: [75, 75, 75] };
  check("old receipt at the previous price still counted (recorded price)", assignSharedReceipt(mail(75, "thanks"), reverse, [reverse, one], { requireGroup: true }), "here");
  check("usual amount: the most common", usualAmounts([75, 75, 99, null, "75.00"]), [75]);
  check("usual amount: ties keep both", usualAmounts([75, 99]), [75, 99]);
}

console.log("Other senders and currency");
{
  const netflix: SharedCandidate = { id: "n", serviceName: "Netflix", amount: 649, currency: "INR", senders: ["info@mailer.netflix.com"], detectedAt: 1, recordedAmounts: [] };
  check("Netflix: rule does not apply", assignSharedReceipt(mail(199, "x", "INR", "info@mailer.netflix.com"), netflix, [netflix], { requireGroup: true }), "not_shared");
  const claude: SharedCandidate = { id: "c", serviceName: "Claude", amount: 20, currency: "USD", senders: ["receipts@stripe.com"], detectedAt: 1, recordedAmounts: [] };
  check("Claude via Stripe, nothing to tell apart: left to the name rules", assignSharedReceipt(mail(18.5, "x", "USD", "receipts@stripe.com"), claude, [claude], { requireGroup: true }), "not_shared");
  check("a subscription not reading the sender is unaffected", assignSharedReceipt(mail(5, "x"), netflix, [netflix, icloud]), "not_shared");
  check("currency mismatch dropped even when the name is there", verdicts(mail(75, "iCloud+", "USD")), ["none", "none"]);
  check("no currency on the receipt: not held against it", verdicts(mail(75, "x", null))[0], "here");
  const google: SharedCandidate = { id: "g", serviceName: "Google One", amount: 130, currency: "INR", senders: ["payments-noreply@google.com"], detectedAt: 1, recordedAmounts: [130] };
  check("Google One alone: 130 counted", assignSharedReceipt(mail(130, "x", "INR", "payments-noreply@google.com"), google, [google], { requireGroup: true }), "here");
  check("Google One alone: another Google purchase dropped", assignSharedReceipt(mail(449, "YouTube Premium", "INR", "payments-noreply@google.com"), google, [google], { requireGroup: true }), "none");
}

console.log("Ties");
{
  const twinA: SharedCandidate = { id: "z", serviceName: "Family Storage", amount: 75, currency: "INR", senders: APPLE, detectedAt: 5, recordedAmounts: [] };
  const twinB: SharedCandidate = { id: "a", serviceName: "iCloud+ extra", amount: 75, currency: "INR", senders: APPLE, detectedAt: 9, recordedAmounts: [] };
  const e = mail(75, "thanks");
  const r = [assignSharedReceipt(e, twinA, [twinA, twinB]), assignSharedReceipt(e, twinB, [twinA, twinB])];
  check("same price, no name: the older subscription, once", r, ["here", "other"]);
  const named = mail(75, "iCloud+ extra");
  check("same price: the one whose name appears", [assignSharedReceipt(named, twinA, [twinA, twinB]), assignSharedReceipt(named, twinB, [twinA, twinB])], ["other", "here"]);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
