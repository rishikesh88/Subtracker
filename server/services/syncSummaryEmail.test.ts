/* Run: npm run test:sync-email */
import { buildSyncSummaryEmail, type SummaryInput } from "./syncSummaryEmail";

let passed = 0, failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ""}`); failed++; }
}

const base: SummaryInput = {
  to: "person@example.com",
  suggestions: [],
  currency: "USD",
  mailboxes: ["person@example.com"],
  syncDays: 30,
  appUrl: "https://app.verloq.co/",
};
const sub = (serviceName: string, amount: number, currency = "USD", frequency = "monthly") =>
  ({ serviceName, amount, currency, frequency });

/* --- One or many ----------------------------------------------------- */
const one = buildSyncSummaryEmail({ ...base, suggestions: [sub("Netflix", 6.76)] });
check("one: subject is singular", one.subject === "Verloq found 1 subscription in your inbox", one.subject);
check("one: button is singular", one.html.includes(">Review 1 subscription<"));
check("one: no 'and N more'", !one.html.includes("more</td>"));

const many = buildSyncSummaryEmail({
  ...base,
  suggestions: [
    sub("Netflix", 6.76), sub("Railway", 5.9), sub("Azure", 50), sub("Claude Pro", 23.6),
    sub("Spotify", 11.99), sub("Domain", 12, "USD", "yearly"), sub("iCloud+", 2.99),
  ],
});
check("many: subject is plural", many.subject === "Verloq found 7 subscriptions in your inbox");
check("many: lists five and says 'and 2 more'", many.html.includes("and 2 more") && many.text.includes("and 2 more"));
check("many: most expensive a month comes first", many.text.indexOf("Azure") < many.text.indexOf("Claude Pro"));
check("many: the yearly domain is left out of the top five", !many.text.includes("Domain"));
check("many: button goes to the review page", many.html.includes('href="https://app.verloq.co/review"'));
check("many: yearly shows /yr when listed", buildSyncSummaryEmail({ ...base, suggestions: [sub("Domain", 12, "USD", "yearly")] }).text.includes("$12.00/yr"));

/* --- Whose inbox ------------------------------------------------------ */
check("one mailbox is named", one.text.includes("30 days of person@example.com"));
const two = buildSyncSummaryEmail({ ...base, mailboxes: ["a@x.com", "b@y.com"], suggestions: [sub("Netflix", 6.76)] });
check("two mailboxes are counted, not listed", two.text.includes("your 2 connected inboxes") && !two.text.includes("a@x.com"));

/* --- Currency ----------------------------------------------------------- */
check("same currency: no conversion note", !one.html.includes("converted from"));
const unknown = buildSyncSummaryEmail({ ...base, suggestions: [sub("Mystery", 9, "UNKNOWN")] });
check("unknown currency: the number is shown, not relabelled", unknown.text.includes("Mystery: 9.00") && !unknown.text.includes("$9.00"));

/* --- Content from emails is escaped -------------------------------------- */
const hostile = buildSyncSummaryEmail({ ...base, suggestions: [sub('<img src=x onerror="alert(1)">', 5)] });
check("a service name cannot inject markup", !hostile.html.includes("<img src=x") && hostile.html.includes("&lt;img src=x"));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
