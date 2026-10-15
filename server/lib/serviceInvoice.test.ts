/* Run: npm run test:service-invoices */
import { isInvoicingToolSender, isServiceWorkSubscription, serviceInvoiceKind } from "./serviceInvoice";
import { keepEmail } from "./historySearchRules";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}
const k = (sender: string, subject: string, text = "", fromName = "") => serviceInvoiceKind({ sender, fromName, subject, text });
const preview = (sender: string, subject: string, text = "") => serviceInvoiceKind({ sender, subject, text }, { previewOnly: true });

console.log("Invoicing tools");
for (const a of [
  "message-service@sender.zohobooks.com", "noreply@zohoinvoice.com", "invoices@zohobooks.in", "quickbooks@notification.intuit.com",
  "messaging-service@post.xero.com", "noreply@freshbooks.com", "invoices@waveapps.com", "notify@hq.bill.com", "billing@refrens.com",
]) check(`${a} is an invoicing tool`, isInvoicingToolSender(a), true);
for (const a of ["billing@zoho.com", "noreply@zohocorp.com", "billing@zohobilling.com", "receipts@stripe.com", "feedback@slack.com", "billing@xero.com", "payments@intuit.com"]) {
  check(`${a} is not`, isInvoicingToolSender(a), false);
}

console.log("Consultant and freelancer invoices are dropped");
check("Zoho invoice from a consultant", k("noreply@zohoinvoice.com", "Invoice INV-000123 from Acme Consulting", "Dear Northwind, please find attached the invoice for October. Amount due: INR 85,000."), "invoicing_tool");
check("QuickBooks invoice from an agency", k("quickbooks@notification.intuit.com", "Invoice 1045 from Brightside Studio", "Your invoice is ready. Balance due $4,500.00"), "invoicing_tool");
check("Xero invoice from a contractor", k("messaging-service@post.xero.com", "Invoice INV-0088 from J Smith Ltd", "Here's invoice INV-0088 for 2,400.00 USD."), "invoicing_tool");
check("a retainer from the consultant's own email", k("riya@riyadesigns.in", "Invoice for October", "Monthly retainer for brand design - INR 60,000"), "service_work");
check("hours at a rate", k("dev@someone.io", "October invoice", "42 hours @ $50 = $2,100"), "service_work");
check("professional fees", k("accounts@cafirm.in", "Bill for professional fees - Q3", "GST return filing"), "service_work");
check("a Stripe invoice for consulting", k("invoice+statements@stripe.com", "Your invoice from Growth Partners", "Consulting retainer - October $3,000"), "service_work");
check("a PayPal invoice from a freelancer", k("service@paypal.com", "Invoice from Maria (freelance copywriting)", ""), "service_work");
check("office rent", k("accounts@wework.com", "Office rent invoice - October", ""), "service_work");

console.log("Software is kept, whoever sends it");
check("Zoho's own subscription bill", k("billing@zoho.com", "Payment receipt for Zoho Mail", "Your Mail Lite plan subscription has been renewed"), null);
check("a small SaaS billing through Zoho Books", k("message-service@sender.zohobooks.com", "Invoice INV-2201 from Kitecraft Analytics", "Kitecraft Pro plan - 10 seats - annual subscription"), null);
check("QuickBooks charging for QuickBooks", k("quickbooks@notification.intuit.com", "Your QuickBooks Online subscription", "Your subscription renews on Nov 1"), null);
check("Xero's own bill", k("billing@xero.com", "Your Xero invoice", "Standard plan"), null);
check("FreshBooks charging for FreshBooks", k("noreply@freshbooks.com", "FreshBooks receipt", "Your Plus plan was renewed"), null);
check("a Stripe receipt for software", k("receipts@stripe.com", "Your receipt from Railway Corporation", "Hobby plan"), null);
check("Slack", k("feedback@slack.com", "Your receipt", "Pro plan, 30 members"), null);
check("Claude Pro (IT services code on the invoice)", k("invoice+statements@mail.anthropic.com", "Your receipt from Anthropic, PBC", "Claude Pro HSN Code: 998315"), null);
check("GoDaddy hosting renewal", k("renewals@godaddy.com", "Your hosting plan renewal", "Economy hosting - 12 months"), null);
check("'24 hours' is not billable hours", k("no-reply@notion.so", "Your receipt", "We'll reply within 24 hours"), null);
check("a software agency's own SaaS with a seat count", k("noreply@zohoinvoice.com", "Invoice from Taskboard", "Taskboard Teams - 5 seats"), null);

console.log("Before the email is read");
check("an invoicing tool alone waits for the full email", preview("noreply@zohoinvoice.com", "Invoice INV-000123 from Acme Consulting"), null);
check("a retainer in the preview is dropped at once", preview("riya@riyadesigns.in", "Invoice for October", "Monthly retainer for brand design"), "service_work");

console.log("Suggestions");
check("Acme Consulting", isServiceWorkSubscription({ serviceName: "Acme Consulting Retainer" }), true);
check("category Consulting", isServiceWorkSubscription({ serviceName: "J Smith Ltd", category: "Consulting" }), true);
check("category Professional Services", isServiceWorkSubscription({ serviceName: "Brightside", category: "Professional Services" }), true);
check("Zoho One is software", isServiceWorkSubscription({ serviceName: "Zoho One", category: "Productivity" }), false);
check("QuickBooks Online is software", isServiceWorkSubscription({ serviceName: "QuickBooks Online", category: "Finance" }), false);
check("Slack is software", isServiceWorkSubscription({ serviceName: "Slack", category: "Collaboration" }), false);

console.log("History search");
const plan = { owned: ["riyadesigns.in", "slack.com"], shared: [] } as any;
check("a consultant's invoice is not kept", keepEmail({ fromEmail: "riya@riyadesigns.in", subject: "Invoice for October", text: "Monthly retainer for brand design - INR 60,000 invoice" }, plan, { search: [], bodyOnly: [] } as any), { keep: false, why: "service_work" });
check("a Slack receipt is kept", keepEmail({ fromEmail: "feedback@slack.com", subject: "Your receipt", text: "Receipt for your payment" }, plan, { search: [], bodyOnly: [] } as any).keep, true);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
