/* Run: npm run test:evidence */
import { pickEvidence, merchantSender, isIntermediary, parseEvidenceRef } from "./evidence";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}
const ids = (p: { emails: { gmailId: string }[] }) => p.emails.map((e) => e.gmailId);

/* The inbox from the sync that showed each problem, subject lines as they were. */
const inbox = [
  { gmailId: "nfx-promo", subject: "Rishikesh, we've just added a film you might like", fromEmail: "info@members.netflix.com", fromName: "Netflix", receivedAt: "2026-09-18T18:30:00Z" },
  { gmailId: "rail", subject: "Your receipt from Railway Corporation #2139-9980", fromEmail: "invoice+statements@stripe.com", fromName: "Railway Corporation", receivedAt: "2026-09-18T11:05:00Z", extractedAmount: "5.90" },
  { gmailId: "g1", subject: "Your subscription from Google Ireland Limited on Google Play", fromEmail: "googleplay-noreply@google.com", fromName: "Google Play", receivedAt: "2026-09-19T08:00:00Z", extractedAmount: "130" },
  { gmailId: "yt", subject: "Your Google Play Order Receipt from Sep 10, 2026", fromEmail: "googleplay-noreply@google.com", fromName: "Google Play", receivedAt: "2026-09-10T08:00:00Z", extractedAmount: "149" },
  { gmailId: "tos", subject: "We're updating the terms of service for YouTube, Google Play, Google One, and Subscribe with Google", fromEmail: "payments-noreply@google.com", fromName: "Google Payments", receivedAt: "2026-09-04T23:12:00Z" },
  { gmailId: "anth-1", subject: "Important: Confirm your $23.60 payment to Anthropic, PBC", fromEmail: "billing@mail.anthropic.com", fromName: "Anthropic", receivedAt: "2026-08-29T23:01:00Z", extractedAmount: "23.60" },
  { gmailId: "bank", subject: "INR 2,255.68 spent on your Scapia Federal Bank credit card", fromEmail: "scapiacards@federalbank.co.in", fromName: "Scapia", receivedAt: "2026-08-30T10:00:00Z", extractedAmount: "2255.68" },
];

/* --- 2. A film recommendation is not evidence ------------------------ */
const netflix = { serviceName: "Netflix", merchantName: "Netflix", amount: 649, evidenceEmailIds: ["nfx-promo"] };
check("Netflix: the promo the detector named is dropped", ids(pickEvidence(netflix, inbox)), []);
check("Netflix: and the search does not bring it back", pickEvidence(netflix, inbox).source, "none");

/* --- 3. Evidence is found when the detector names none --------------- */
const railway = { serviceName: "Railway Hobby Plan", merchantName: "Railway", amount: 5.9, evidenceEmailIds: [] };
check("Railway: the receipt is found by brand", ids(pickEvidence(railway, inbox)), ["rail"]);
check("Railway: and marked as found by search", pickEvidence(railway, inbox).source, "fallback");

const googleOne = { serviceName: "Google One 100 GB", merchantName: "Google", amount: 130, evidenceEmailIds: [] };
const claimedByYouTube = new Set(["yt"]);
check("Google One: its own receipt, not YouTube's, not the terms notice",
  ids(pickEvidence(googleOne, inbox, claimedByYouTube)), ["g1"]);
check("Google One: without YouTube's claim, its own amount still ranks first",
  ids(pickEvidence(googleOne, inbox))[0], "g1");

/* --- 1. The card alert is evidence, but not the logo ----------------- */
const claude = { serviceName: "Claude Pro", merchantName: "Anthropic", amount: 23.6, evidenceEmailIds: ["bank", "anth-1"] };
check("Claude: both the receipt and the card alert are evidence",
  ids(pickEvidence(claude, inbox)).sort(), ["anth-1", "bank"]);
check("Claude: the merchant is Anthropic, not the bank, though the bank is newer",
  merchantSender(["scapiacards@federalbank.co.in", "billing@mail.anthropic.com"], { merchantName: "Anthropic", serviceName: "Claude Pro" }),
  "billing@mail.anthropic.com");
check("with no branded sender, a bank is still never chosen",
  merchantSender(["scapiacards@federalbank.co.in"], { merchantName: "Acme", serviceName: "Acme Pro" }), null);
check("with no branded sender, the most frequent real sender is",
  merchantSender(["a@shop.example", "b@other.example", "a@shop.example"], { merchantName: "Zzzz", serviceName: "Zzzz" }), "a@shop.example");

check("a bank is an intermediary", isIntermediary("scapiacards@federalbank.co.in"), true);
check("HDFC is an intermediary", isIntermediary("alerts@hdfcbank.net"), true);
check("Stripe is an intermediary", isIntermediary("invoice+statements@stripe.com"), true);
check("Anthropic is not", isIntermediary("billing@mail.anthropic.com"), false);
check("Netflix is not", isIntermediary("info@members.netflix.com"), false);

/* --- References however the model writes them ------------------------ */
check("E3", parseEvidenceRef("E3"), 3);
check("e3", parseEvidenceRef("e3"), 3);
check("[E3]", parseEvidenceRef("[E3]"), 3);
check("E03", parseEvidenceRef("E03"), 3);
check("3", parseEvidenceRef("3"), 3);
check("a number", parseEvidenceRef(3), 3);
check("E0 is nothing", parseEvidenceRef("E0"), null);
check("words are nothing", parseEvidenceRef("the Railway receipt"), null);
check("an id-like string is nothing", parseEvidenceRef("18f3c2a4b5e6d789"), null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
