/* Run: npm run test:bank */
import {
  bankAlertEvidence,
  buildBankAlertGmailQuery,
  evidenceFingerprint,
  fingerprintSecret,
  isBankOrCardSender,
  isProcessorSender,
  looksLikeBankAlertOrStatement,
  planBankCleanup,
  selectBankEmails,
  shouldDropFromSync,
  splitBankMail,
  storedFilePaths,
  type StoredEmailRow,
} from "./bankAlert";
import { isIntermediary } from "./evidence";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}

console.log("Senders");
for (const a of [
  "alerts@federalbank.co.in", "alerts@hdfcbank.net", "credit_cards@icicibank.com", "ealerts@kotak.com",
  "noreply@hsbc.co.in", "no.reply.alerts@chase.com", "info@capitalone.com", "service@discover.com",
  "alerts@barclays.com", "cards@icicicards.com", "support@uni.cards", "hello@jupiter.money", "alerts@fi.money",
  "no-reply@sliceit.com", "AmericanExpress@welcome.americanexpress.com", "alerts@aexp.com", "no-reply@amex.com",
  "emailstatements.cards@sbicard.com", "alerts@citi.com", "Federal Bank <alerts@federalbank.co.in>",
]) check(`bank or card: ${a}`, isBankOrCardSender(a), true);
for (const a of [
  "invoice+statements@mail.stripe.com", "service@paypal.com", "receipts@paddle.com", "noreply@razorpay.com",
  "payments-noreply@google.com", "no_reply@email.apple.com", "billing@railway.app", "noreply@airtel.in",
  "invoice@mail.anthropic.com", "", null, undefined,
]) check(`not a bank: ${a}`, isBankOrCardSender(a as any), false);
check("stripe is a processor", isProcessorSender("invoice+statements@mail.stripe.com"), true);
check("paypal is a processor", isProcessorSender("service@paypal.com"), true);
check("razorpay is a processor", isProcessorSender("noreply@razorpay.com"), true);
check("a bank is not a processor", isProcessorSender("alerts@hdfcbank.net"), false);
// isIntermediary keeps covering banks, processors and relays.
check("intermediary: bank", isIntermediary("alerts@hdfcbank.net"), true);
check("intermediary: processor", isIntermediary("receipts@stripe.com"), true);
check("intermediary: relay", isIntermediary("bounce@sendgrid.net"), true);
check("intermediary: merchant", isIntermediary("info@mailer.netflix.com"), false);

console.log("Alert and statement wording");
check("card alert wording", looksLikeBankAlertOrStatement("INR 2,255.68 spent on your Federal Bank credit card", "Dear Customer, INR 2,255.68 spent on your card ending 1234 at ANTHROPIC"), true);
check("transaction alert", looksLikeBankAlertOrStatement("Transaction alert for your card", "You have a new transaction"), true);
check("debited", looksLikeBankAlertOrStatement("Rs 649 debited from your account", ""), true);
check("credit card bill", looksLikeBankAlertOrStatement("Your credit card bill is due on Mar 30, 2026", "Total amount due Rs 58,317.58"), true);
check("card ending alone", looksLikeBankAlertOrStatement("Purchase approved", "Your card ending 4242 was used for a purchase"), true);
check("receipt that says card ending is not an alert", looksLikeBankAlertOrStatement("Your receipt from Netflix", "Paid by credit card ending 4242. Amount paid Rs 649"), false);
check("a merchant's 'will be debited' reminder is not an alert", looksLikeBankAlertOrStatement("Your plan renews soon", "Your card will be debited on 5 Nov"), false);
check("plain receipt", looksLikeBankAlertOrStatement("Your receipt from Railway Corporation", "Receipt #2231-8890 Amount paid $5.00"), false);

console.log("The sync's decision (kept = may be read)");
const mail = [
  { id: "1", from: "alerts@hdfcbank.net", subject: "Your transaction was successful", snippet: "INR 649.00 was spent using your HDFC Bank credit card ending 1234" },
  { id: "2", from: "alerts@federalbank.co.in", subject: "INR 2,255.68 spent on your Federal Bank credit card", snippet: "Dear customer ..." },
  { id: "3", from: "cards@icicibank.com", subject: "Your credit card bill is due on Mar 30, 2026", snippet: "Total amount due" },
  { id: "4", from: "invoice+statements@mail.stripe.com", subject: "Your receipt from Railway Corporation", snippet: "Receipt from Railway Corporation $5.00 Paid Mar 3" },
  { id: "5", from: "noreply@airtel.in", subject: "Your Airtel bill for March is ready", snippet: "Bill amount Rs 799. Pay by 20 Mar" },
  { id: "6", from: "invoice@mail.anthropic.com", subject: "Your receipt from Anthropic, PBC #2231-8890", snippet: "Receipt from Anthropic, PBC $23.60 Paid Mar 5" },
  { id: "7", from: "no_reply@email.apple.com", subject: "Your receipt from Apple.", snippet: "iCloud+ with 200 GB of storage Rs 219.00" },
  { id: "8", from: "googleplay-noreply@google.com", subject: "Your Google Play Order Receipt from Mar 7, 2026", snippet: "YouTube Premium Rs 149.00" },
  { id: "9", from: "alerts@hsbc.co.in", subject: "Hello", snippet: "hi" },
  { id: "10", from: "service@paypal.com", subject: "Receipt for your payment to Netflix", snippet: "You sent $15.49 USD to Netflix" },
];
const { kept, dropped } = splitBankMail(mail, (m) => ({ sender: m.from, subject: m.subject, snippet: m.snippet }));
check("dropped", dropped.map((m) => m.id), ["1", "2", "3", "9"]);
check("kept", kept.map((m) => m.id), ["4", "5", "6", "7", "8", "10"]);
check("a bank sender is dropped whatever it says", shouldDropFromSync("alerts@hsbc.co.in", "Hello", "hi"), true);
check("a processor is never dropped by sender", shouldDropFromSync("receipts@stripe.com", "Receipt", "Thanks"), false);

console.log("Fingerprint");
const SECRET = "test-secret-1";
const f1 = evidenceFingerprint(SECRET, "gmail", "18f3a9c2d4e5b6a7");
check("hex sha256", /^[0-9a-f]{64}$/.test(f1), true);
check("deterministic", evidenceFingerprint(SECRET, "gmail", "18f3a9c2d4e5b6a7"), f1);
check("provider matters", evidenceFingerprint(SECRET, "outlook", "18f3a9c2d4e5b6a7") === f1, false);
check("message matters", evidenceFingerprint(SECRET, "gmail", "18f3a9c2d4e5b6a8") === f1, false);
check("secret matters", evidenceFingerprint("other-secret", "gmail", "18f3a9c2d4e5b6a7") === f1, false);
check("one-way: neither id nor secret appears in it", f1.includes("18f3a9c2d4e5b6a7") || f1.includes(SECRET), false);
check("secret from its own variable", fingerprintSecret({ EVIDENCE_FINGERPRINT_SECRET: "abc", SESSION_SECRET: "xyz" }), "abc");
const derived = fingerprintSecret({ SESSION_SECRET: "xyz" });
check("secret derived from the session secret, not equal to it", [typeof derived, derived === "xyz", /^[0-9a-f]{64}$/.test(derived ?? "")], ["string", false, true]);
check("derived is stable", fingerprintSecret({ SESSION_SECRET: "xyz" }), derived);
check("no secret: none", fingerprintSecret({}), null);

console.log("Reading an alert as evidence");
const sub = { currency: "USD", names: ["Anthropic", "Claude"] };
const subInr = { currency: "INR", names: ["Anthropic", "Claude"] };
const alertBody = "Dear Customer, INR 1,950.00 spent on your Federal Bank credit card ending 4242 at ANTHROPIC on 05-03-2026. Available limit INR 84,000.00. Not you? Call 1800 000 0000.";
const alert = { from: "alerts@federalbank.co.in", subject: "INR 1,950.00 spent on your Federal Bank credit card", body: alertBody, date: "Thu, 05 Mar 2026 09:14:00 +0530" };
check("INR alert for an INR subscription", bankAlertEvidence(alert, subInr), { paidAt: "2026-03-05", amount: "1950.00", currency: "INR" });
check("what comes out holds only date, amount and currency", Object.keys(bankAlertEvidence(alert, subInr) ?? {}).sort(), ["amount", "currency", "paidAt"]);
check("no card digits, limit or text in the output", /4242|84,?000|Dear|Federal/.test(JSON.stringify(bankAlertEvidence(alert, subInr))), false);
check("currency differs from the subscription's: dropped", bankAlertEvidence(alert, sub), null);
check("USD alert", bankAlertEvidence({ ...alert, subject: "Transaction alert", body: "Your Chase card was charged $23.60 at ANTHROPIC, PBC.", from: "no.reply.alerts@chase.com", date: "Fri, 06 Mar 2026 20:00:00 +0000" }, sub), { paidAt: "2026-03-06", amount: "23.60", currency: "USD" });
check("a credit card bill: dropped", bankAlertEvidence({ ...alert, subject: "Your credit card bill is due on Mar 30, 2026", body: "ANTHROPIC INR 1,950.00 spent. Total amount due INR 58,317.58" }, subInr), null);
check("not a bank: dropped", bankAlertEvidence({ ...alert, from: "billing@somestore.com" }, subInr), null);
check("a processor: dropped here (its receipt is the evidence)", bankAlertEvidence({ ...alert, from: "receipts@stripe.com" }, subInr), null);
check("does not name the subscription: dropped", bankAlertEvidence({ ...alert, subject: "INR 1,950.00 spent on your card", body: "INR 1,950.00 spent at SWIGGY" }, subInr), null);
check("no amount: dropped", bankAlertEvidence({ ...alert, subject: "Transaction alert", body: "A transaction at ANTHROPIC was made on your card." }, subInr), null);
check("no usable date: dropped", bankAlertEvidence({ ...alert, date: "not a date" }, subInr), null);
check("a plan name alone does not name it", bankAlertEvidence(alert, { currency: "INR", names: [] }), null);
check("no charge wording (an offer): dropped", bankAlertEvidence({ ...alert, subject: "Offer on Anthropic", body: "Get INR 500 off Anthropic with your card" }, subInr), null);

console.log("Gmail query");
check("name plus charge words", buildBankAlertGmailQuery(["Anthropic"], 365), '"anthropic" newer_than:365d (spent OR debited OR "transaction alert" OR charged)');
check("no distinctive name: no query", buildBankAlertGmailQuery(["Pro"], 365), null);

console.log("Clean-up selection");
const stored: StoredEmailRow[] = [
  { id: "e1", gmailId: "g1", emailProvider: "gmail", fromEmail: "alerts@federalbank.co.in", subject: "INR 1,950.00 spent on your Federal Bank credit card", content: "spent at ANTHROPIC" },
  { id: "e2", gmailId: "g2", emailProvider: "gmail", fromEmail: "invoice+statements@mail.stripe.com", subject: "Your receipt from Railway Corporation", content: "Paid $5.00" },
  { id: "e3", gmailId: "g3", emailProvider: "outlook", fromEmail: "noreply@somewallet.in", subject: "Transaction alert", content: "Rs 199 debited for Netflix" },
  { id: "e4", gmailId: "g4", emailProvider: "gmail", fromEmail: "noreply@airtel.in", subject: "Your Airtel bill", content: "Amount due Rs 799" },
  { id: "e5", gmailId: "g5", emailProvider: "gmail", fromEmail: "cards@icicibank.com", subject: "Your credit card bill is due on Mar 30, 2026", content: "Total amount due" },
  { id: "e6", gmailId: "g6", emailProvider: "gmail", fromEmail: "invoice@mail.anthropic.com", subject: "Your receipt from Anthropic", content: "Paid by credit card ending 4242 $23.60" },
];
check("selected: banks and alert-like mail; processors and merchants stay", selectBankEmails(stored).map((e) => e.id), ["e1", "e3", "e5"]);
const pay = (emailId: string | null, kind: string, amount: string | null, subscriptionId = "s1") =>
  ({ userId: "u1", subscriptionId, emailId, paidAt: "2026-03-05", amount, currency: "INR", kind });
const plan = planBankCleanup(stored, [pay("e1", "card_alert", "1950.00"), pay("e1", "card_alert", "1950.00"), pay("e3", "card_alert", null), pay("e5", "invoice", "58317.58"), pay("e2", "receipt", "5.00"), pay("e6", "receipt", "23.60")], SECRET);
check("emails to delete", plan.emailIds, ["e1", "e3", "e5"]);
check("provider ids to remove from suggestions", plan.messageIds, ["g1", "g3", "g5"]);
check("one replacement: the card alert with an amount, once", plan.replacements.map((r) => [r.subscriptionId, r.emailId, r.paidAt, r.amount, r.currency, r.kind, r.source]), [["s1", null, "2026-03-05", "1950.00", "INR", "card_alert", "history"]]);
check("replacement fingerprint is the same scheme", plan.replacements[0].evidenceFingerprint, evidenceFingerprint(SECRET, "gmail", "g1"));
const outlookPlan = planBankCleanup(stored, [pay("e3", "card_alert", "199")], SECRET);
check("an Outlook email is fingerprinted as outlook", outlookPlan.replacements[0].evidenceFingerprint, evidenceFingerprint(SECRET, "outlook", "g3"));
check("nothing to remove: nothing planned", planBankCleanup([stored[1], stored[5]], [pay("e2", "receipt", "5.00")], SECRET), { emailIds: [], messageIds: [], replacements: [] });

console.log("Stored files");
check("object storage paths only", storedFilePaths(JSON.stringify({ attachments: [{ filename: "a.pdf", objectStoragePath: "/objects/u1/a.pdf", extractedText: "x" }, { filename: "b.png" }, { objectStoragePath: "" }] })), ["/objects/u1/a.pdf"]);
check("bad json", storedFilePaths("{not json"), []);
check("none", storedFilePaths(null), []);


console.log("Service billing notices that mention a card");
check("Netflix declined payment naming a card is kept", shouldDropFromSync("info@members.netflix.com", "Netflix: your payment was declined", "We couldn't process your payment. Your card ending in 1234 was declined. Update payment info."), false);
check("Spotify not processed (curly apostrophe) naming a card is kept", shouldDropFromSync("no-reply@spotify.com", "Your payment couldn\u2019t be processed", "We tried to charge the card ending 4242 for Rs 119 but it didn\u2019t go through."), false);
check("a renewal notice naming a card is kept", shouldDropFromSync("info@members.netflix.com", "Your membership renews on 5 Nov", "We will charge the card ending 1234 Rs 649."), false);
check("a wallet alert naming a card is still dropped", shouldDropFromSync("noreply@somewallet.in", "Your transaction was successful", "Rs 2,255.68 paid, card ending 1234"), true);
check("a card spend alert is still dropped", shouldDropFromSync("noreply@somewallet.in", "Alert", "INR 2,255.68 spent on your Federal Bank credit card"), true);
check("a bank sender is still dropped even with notice words", shouldDropFromSync("alerts@hdfcbank.net", "Your payment failed", "membership renews"), true);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
