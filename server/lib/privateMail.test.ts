/* Run: npm run test:private */
import { gmailPrivateExclusions, planPrivateCleanup, privateKind, privateSubscriptionKind, splitPrivateMail } from "./privateMail";
import { keepEmail } from "./historySearchRules";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}
const k = (sender: string, subject: string, snippet = "", fromName = "") => privateKind({ sender, fromName, subject, snippet });

console.log("Verloq's own mail");
check("sync summary", k("noreply@verloq.co", "Verloq found 12 subscriptions"), "own");
check("sign-in code", k("Verloq <noreply@verloq.co>", "Your verification code"), "own");
check("a subdomain", k("hello@mail.verloq.co", "Welcome"), "own");
check("not another domain ending in verloq", k("x@notverloq.co", "Hello"), null);

console.log("Insurance");
check("LIC by domain", k("noreply@licindia.in", "Premium due"), "insurance");
check("an insurer's domain part", k("care@hdfcergo.com", "Your renewal"), "insurance");
check("star health", k("policy@starhealth.in", "Renewal notice"), "insurance");
check("by word in the subject", k("noreply@someco.com", "Your car insurance renewal"), "insurance");
check("policy number in the preview", k("noreply@someco.com", "Reminder", "Policy No: 12345678 is due for renewal"), "insurance");
check("by the sender's name", k("noreply@mailer.net", "Reminder", "", "ICICI Lombard"), "insurance");
check("geico", k("service@geico.com", "Your bill is ready"), "insurance");
check("premium due for a policy", k("no-reply@x.com", "Premium due for your policy 4455"), "insurance");
check("term plan", k("no-reply@x.com", "Your term plan renewal"), "insurance");

console.log("Health");
check("hospital bill", k("billing@apollohospitals.com", "Your bill"), "health");
check("lab report", k("reports@x.in", "Your lab report is ready"), "health");
check("pharmacy order", k("orders@pharmeasy.in", "Order delivered"), "health");
check("doctor appointment", k("no-reply@x.com", "Your doctor appointment tomorrow"), "health");
check("clinic in the domain", k("hi@smileclinic.com", "Invoice"), "health");

console.log("Loans");
check("loan EMI", k("noreply@bajajfinserv.in", "EMI reminder"), "loans");
check("home loan", k("alerts@x.com", "Your home loan statement"), "loans");
check("EMI in capitals", k("no-reply@x.com", "Your EMI of Rs 12,000 is due"), "loans");
check("mortgage", k("hi@rocketmortgage.com", "Payment received"), "loans");

console.log("Investments");
check("SIP instalment", k("noreply@groww.in", "SIP instalment successful"), "investments");
check("mutual fund by word", k("donotreply@camsonline.com", "Mutual fund units allotted"), "investments");
check("SIP debit from an unknown sender", k("x@y.com", "Your SIP debit of Rs 5,000"), "investments");
check("folio number", k("x@y.com", "Statement", "Folio No 1234567"), "investments");
check("zerodha contract note", k("no-reply-contract-notes@reportsmailer.zerodha.net", "Contract note"), "investments");
check("NAV", k("x@y.com", "NAV update for your fund"), "investments");
check("brokerage", k("noreply@vanguard.com", "Your statement"), "investments");

console.log("Software receipts are kept");
check("Spotify Premium", k("no-reply@spotify.com", "Your Spotify Premium receipt", "Premium Individual Rs 119"), null);
check("YouTube Premium payment", k("payments-noreply@google.com", "Your YouTube Premium payment"), null);
check("privacy policy update", k("no-reply@notion.so", "We're updating our privacy policy"), null);
check("Twilio SIP trunking", k("billing@twilio.com", "Your invoice", "Elastic SIP Trunking usage $42.10"), null);
check("long-term plan upsell", k("billing@figma.com", "Save with a long-term plan"), null);
check("a name that is just Emi", k("emi@agency.com", "Invoice from Emi"), null);
check("Slack receipt", k("feedback@slack.com", "Your receipt for October", "Pro plan, 30 members"), null);
check("healthchecks.io (a developer tool)", k("billing@healthchecks.io", "Invoice for October"), null);
check("Apollo.io (sales software)", k("billing@apollo.io", "Your receipt"), null);
check("public.com is not LIC", k("hello@public.com", "Receipt"), null);
check("Claude Pro", k("invoice+statements@mail.anthropic.com", "Your receipt from Anthropic, PBC", "Claude Pro $23.60"), null);

console.log("Splitting a list");
const split = splitPrivateMail(
  [
    { s: "feedback@slack.com", j: "Your receipt" },
    { s: "noreply@licindia.in", j: "Premium due" },
    { s: "noreply@verloq.co", j: "Sync done" },
    { s: "x@groww.in", j: "SIP" },
  ],
  (m) => ({ sender: m.s, subject: m.j }),
);
check("kept", split.kept.map((m) => m.s), ["feedback@slack.com"]);
check("counted by kind", split.byKind, { insurance: 1, own: 1, investments: 1 });

console.log("Subscriptions and suggestions");
check("Star Health Insurance", privateSubscriptionKind({ serviceName: "Star Health Insurance" }), "insurance");
check("LIC by merchant email", privateSubscriptionKind({ serviceName: "LIC", merchantEmail: "noreply@licindia.in" }), "insurance");
check("a category of Insurance", privateSubscriptionKind({ serviceName: "Acme Cover", category: "Insurance" }), "insurance");
check("Groww SIP", privateSubscriptionKind({ serviceName: "Groww SIP", merchantName: "Groww" }), "investments");
check("Verloq itself", privateSubscriptionKind({ serviceName: "Verloq", merchantEmail: "noreply@verloq.co" }), "own");
check("home loan EMI", privateSubscriptionKind({ serviceName: "Home Loan EMI" }), "loans");
check("Practo Plus", privateSubscriptionKind({ serviceName: "Practo Plus" }), "health");
check("Slack is not private", privateSubscriptionKind({ serviceName: "Slack", category: "Collaboration", merchantEmail: "feedback@slack.com" }), null);
check("Spotify Premium is not private", privateSubscriptionKind({ serviceName: "Spotify Premium", category: "Entertainment" }), null);
check("Fidelity Investments category", privateSubscriptionKind({ serviceName: "Acme", category: "Investments" }), "investments");

console.log("History search never keeps private mail");
const plan = { owned: ["licindia.in", "slack.com"], shared: [] } as any;
check("insurance from a linked sender is dropped", keepEmail({ fromEmail: "noreply@licindia.in", subject: "Premium receipt", text: "Receipt for policy number 99887766" }, plan, { search: [], bodyOnly: [] } as any), { keep: false, why: "private" });
check("a Slack receipt is still kept", keepEmail({ fromEmail: "feedback@slack.com", subject: "Your receipt", text: "Receipt for your payment" }, plan, { search: [], bodyOnly: [] } as any).keep, true);

console.log("Gmail search");
const q = gmailPrivateExclusions();
check("excludes Verloq's own mail", q.includes("-from:(verloq.co)"), true);
check("excludes insurance subjects", q.includes("insurance"), true);
check("excludes mutual funds", q.includes("\"mutual fund\""), true);

console.log("Cleaning up what is already stored");
const cleanup = planPrivateCleanup({
  subscriptions: [
    { id: "s1", serviceName: "Slack", merchantEmail: "feedback@slack.com" },
    { id: "s2", serviceName: "Star Health Insurance" },
    { id: "s3", serviceName: "Zurich Coworking" },
  ],
  suggestions: [{ id: "g1", serviceName: "Groww SIP" }, { id: "g2", serviceName: "Figma" }, { id: "g3", serviceName: "Verloq" }],
  emails: [
    { id: "e1", gmailId: "m1", fromEmail: "feedback@slack.com", subject: "Your receipt", content: "Pro plan" },
    { id: "e2", gmailId: "m2", fromEmail: "noreply@verloq.co", subject: "Verloq found 3 subscriptions", content: "" },
    { id: "e3", gmailId: "m3", fromEmail: "billing@stripe.com", subject: "Receipt", content: "Thanks", subscriptionId: "s2" },
    { id: "e4", gmailId: "m4", fromEmail: "x@y.com", subject: "Your lab report", content: "" },
  ],
});
check("private subscriptions (a city name alone is not)", cleanup.subscriptionIds, ["s2"]);
check("private suggestions", cleanup.suggestionIds, ["g1", "g3"]);
check("private emails, and any filed under a private subscription", cleanup.emailIds, ["e2", "e3", "e4"]);
check("their message ids", cleanup.messageIds, ["m2", "m3", "m4"]);
const services = planPrivateCleanup({
  subscriptions: [{ id: "s1", serviceName: "Acme Consulting", category: "Consulting" }, { id: "s2", serviceName: "Zoho One", category: "Productivity", merchantEmail: "billing@zoho.com" }],
  suggestions: [{ id: "g1", serviceName: "Brightside Studio", category: "Professional Services" }],
  emails: [
    { id: "e1", gmailId: "m1", fromEmail: "noreply@zohoinvoice.com", subject: "Invoice INV-1 from Acme Consulting", content: "Amount due INR 85,000" },
    { id: "e2", gmailId: "m2", fromEmail: "billing@zoho.com", subject: "Payment receipt", content: "Your Zoho One subscription renewed" },
  ],
});
check("consultant subscriptions and suggestions, not Zoho's own", [services.subscriptionIds, services.suggestionIds], [["s1"], ["g1"]]);
check("a consultant's invoice email, not Zoho's own receipt", services.emailIds, ["e1"]);
check("counted as services", services.byKind, { services: 3 });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
