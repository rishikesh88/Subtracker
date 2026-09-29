/* Run: npm run test:history */
import {
  HISTORY_DAYS,
  MAX_MESSAGES_PER_SUBSCRIPTION,
  MAX_RETRIES,
  RETRY_DELAY_MS,
  NOTE_ADDED_BY_HAND,
  NOTE_NAME_TOO_GENERIC,
  NOTE_NO_SENDER,
  afterAttempt,
  buildGmailQuery,
  buildOutlookFilter,
  datedCancellation,
  decideSearch,
  describeFailure,
  gmailQueriesFor,
  historyLabel,
  isDue,
  isSharedSender,
  isStaleRunning,
  keepEmail,
  nameTooGeneric,
  namesSubscription,
  planSenders,
  registrableDomain,
  searchSince,
  selectNewMessageIds,
  worthSaving,
} from "./historySearchRules";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}

const NOW = new Date("2026-09-29T10:00:00Z");

console.log("Senders");
check("subdomain reduced to the brand", registrableDomain("mailer.netflix.com"), "netflix.com");
check("country second level kept", registrableDomain("email.amazon.co.uk"), "amazon.co.uk");
check("apple.com is shared", isSharedSender("apple.com"), true);
check("email.apple.com is shared", isSharedSender("email.apple.com"), true);
check("itunes.com is shared", isSharedSender("itunes.com"), true);
check("play.google.com is shared", isSharedSender("play.google.com"), true);
check("amazon.in is shared", isSharedSender("amazon.in"), true);
check("paypal.co.uk is shared", isSharedSender("paypal.co.uk"), true);
check("netflix.com is not shared", isSharedSender("netflix.com"), false);
check("amazonses.com (a relay) is not a shared brand", isSharedSender("amazonses.com"), false);

const netflixPlan = planSenders(["info@mailer.netflix.com", "info@account.netflix.com", "alerts@hdfcbank.net", "receipts@stripe.com"]);
check("brand domains kept, bank and processor dropped", netflixPlan, {
  owned: ["netflix.com"],
  shared: [],
  addresses: ["info@mailer.netflix.com", "info@account.netflix.com"],
});
const googlePlan = planSenders(["payments-noreply@google.com", "googleplay-noreply@google.com"]);
check("google senders are shared", googlePlan.shared, ["google.com"]);
check("paypal kept as shared though it is a processor", planSenders(["service@paypal.com"]).shared, ["paypal.com"]);
check("most seen first", planSenders(["a@b.com", "x@spotify.com", "y@spotify.com"]).owned, ["spotify.com", "b.com"]);

console.log("Query building");
const q = buildGmailQuery(["netflix.com", "netflixmail.com"]);
check("gmail query", q,
  "from:(netflix.com OR netflixmail.com) newer_than:365d (receipt OR invoice OR payment OR renewal OR charged OR billing OR subscription OR cancel OR cancelled)");
check("365 days", HISTORY_DAYS, 365);
check("query names both domains", q.includes("from:(netflix.com OR netflixmail.com)"), true);
check("query has the window", q.includes("newer_than:365d"), true);
const shared = gmailQueriesFor(planSenders(["no_reply@email.apple.com"]), "iCloud+");
check("shared sender query is narrowed by name", shared, [
  'from:(apple.com) "icloud" newer_than:365d (receipt OR invoice OR payment OR renewal OR charged OR billing OR subscription OR cancel OR cancelled)',
]);
const mixed = gmailQueriesFor(planSenders(["hello@spotify.com", "service@paypal.com"]), "Spotify Premium");
check("owned and shared searched separately", mixed.length, 2);
check("owned query has no name", mixed[0].startsWith("from:(spotify.com) newer_than"), true);
check("shared query has a name", mixed[1].startsWith('from:(paypal.com) "spotify" newer_than'), true);
check("search starts 365 days back", searchSince(NOW).toISOString(), "2025-09-29T10:00:00.000Z");
check(
  "outlook filter",
  buildOutlookFilter(["a@netflix.com", "o'brien@x.com"], searchSince(NOW)),
  "receivedDateTime ge 2025-09-29T10:00:00.000Z and (from/emailAddress/address eq 'a@netflix.com' or from/emailAddress/address eq 'o''brien@x.com')",
);

console.log("Shared senders: naming the subscription");
check("iCloud+ receipt kept", namesSubscription({ subject: "Your receipt from Apple.", text: "iCloud+ with 50 GB storage  ₹75.00" }, "iCloud+"), true);
check("Apple Music receipt skipped for iCloud+", namesSubscription({ subject: "Your receipt from Apple.", text: "Apple Music Individual ₹119.00" }, "iCloud+"), false);
check("bare iCloud does not stand for iCloud+", namesSubscription({ subject: "iCloud storage is full", text: "" }, "iCloud+"), false);
check("Google One named (brackets ignored)", namesSubscription({ subject: "Google One: your receipt", text: "" }, "Google One (100 GB)"), true);
check("YouTube Premium by its first word", namesSubscription({ subject: "Your Google Play order", text: "YouTube Premium monthly" }, "YouTube Premium"), true);
check("not inside another word", namesSubscription({ subject: "", text: "youtubers" }, "YouTube"), false);
check("apple alone names nothing", namesSubscription({ subject: "Your receipt from Apple", text: "" }, "Apple"), false);

const applePlan = planSenders(["no_reply@email.apple.com"]);
check("keep: iCloud+ from Apple", keepEmail({ fromEmail: "no_reply@email.apple.com", subject: "Your receipt from Apple", text: "iCloud+ 50 GB" }, applePlan, "iCloud+"), { keep: true });
check("skip: other Apple receipt", keepEmail({ fromEmail: "no_reply@email.apple.com", subject: "Your receipt from Apple", text: "Apple TV+" }, applePlan, "iCloud+"), { keep: false, why: "not_named" });
check("skip: other sender", keepEmail({ fromEmail: "x@other.com", subject: "receipt", text: "" }, netflixPlan, "Netflix"), { keep: false, why: "other_sender" });
check("skip: no billing word", keepEmail({ fromEmail: "info@mailer.netflix.com", subject: "New on Netflix", text: "Watch now" }, netflixPlan, "Netflix"), { keep: false, why: "no_keyword" });
check("keep: brand receipt without naming", keepEmail({ fromEmail: "info@mailer.netflix.com", subject: "Your payment was received", text: "" }, netflixPlan, "Netflix"), { keep: true });

console.log("Whether to search");
check("generic short name", nameTooGeneric("Max"), true);
check("generic brand word", nameTooGeneric("Apple"), true);
check("distinct name", nameTooGeneric("iCloud+"), false);
check("hand-added skipped", decideSearch({ serviceName: "Gym", linkedFromEmails: [], merchantEmail: null }), { search: false, note: NOTE_ADDED_BY_HAND });
check("shared-only + generic name skipped", decideSearch({ serviceName: "One", linkedFromEmails: ["no_reply@email.apple.com"], merchantEmail: null }), { search: false, note: NOTE_NAME_TOO_GENERIC });
check("only a bank sender: nothing to search", decideSearch({ serviceName: "Claude Pro", linkedFromEmails: ["alerts@hdfcbank.net"], merchantEmail: null }), { search: false, note: NOTE_NO_SENDER });
check("merchant email alone is enough", (decideSearch({ serviceName: "Netflix", linkedFromEmails: [], merchantEmail: "info@netflix.com" }) as any).plan?.owned, ["netflix.com"]);
check("shared + distinct name searched", decideSearch({ serviceName: "iCloud+", linkedFromEmails: ["no_reply@email.apple.com"], merchantEmail: null }).search, true);
check("generic name with an owned domain still searched", decideSearch({ serviceName: "Max", linkedFromEmails: ["billing@max.com"], merchantEmail: null }).search, true);

console.log("New messages and the cap");
check("already stored skipped", selectNewMessageIds(["a", "b", "c"], new Set(["b"]), 60), ["a", "c"]);
check("repeats dropped", selectNewMessageIds(["a", "a", "b"], new Set(), 60), ["a", "b"]);
const many = Array.from({ length: 150 }, (_, i) => `m${i}`);
check("capped at 60", selectNewMessageIds(many, new Set(), MAX_MESSAGES_PER_SUBSCRIPTION).length, 60);
check("cap counts only new ones", selectNewMessageIds(many, new Set(["m0", "m1"]), 3), ["m2", "m3", "m4"]);
check("nothing left in budget", selectNewMessageIds(many, new Set(), 0), []);

console.log("Attempts");
check("success is done", afterAttempt(1, { ok: true }), { status: "done", error: null });
check("1st failure retries", afterAttempt(1, { ok: false, error: "x" }), { status: "pending", error: "x" });
check("three retries allowed", MAX_RETRIES, 3);
check("4th attempt failing is final", afterAttempt(4, { ok: false, error: "x" }), { status: "failed", error: "x" });
check("3rd attempt failing still retries", afterAttempt(3, { ok: false, error: "x" }).status, "pending");
check("fresh pending is due", isDue({ historyStatus: "pending", historyAttempts: 0, historyStartedAt: null }, NOW), true);
check("retry waits 20 minutes", isDue({ historyStatus: "pending", historyAttempts: 1, historyStartedAt: new Date(NOW.getTime() - 5 * 60 * 1000) }, NOW), false);
check("retry due after 20 minutes", isDue({ historyStatus: "pending", historyAttempts: 1, historyStartedAt: new Date(NOW.getTime() - RETRY_DELAY_MS) }, NOW), true);
check("done is never due", isDue({ historyStatus: "done", historyAttempts: 1, historyStartedAt: null }, NOW), false);
check("running 16 min is stale", isStaleRunning({ historyStatus: "running", historyStartedAt: new Date(NOW.getTime() - 16 * 60 * 1000) }, NOW), true);
check("running 5 min is not stale", isStaleRunning({ historyStatus: "running", historyStartedAt: new Date(NOW.getTime() - 5 * 60 * 1000) }, NOW), false);
check("expired token in plain words", describeFailure({ message: "invalid_grant" }), "the mailbox needs to be reconnected");
check("quota in plain words", describeFailure({ code: 429, message: "Too many" }), "the mail provider's limit was reached");
check("network in plain words", describeFailure({ code: "ENOTFOUND", message: "getaddrinfo" }), "the mail provider could not be reached");
check("unknown in plain words, no raw text", describeFailure(new Error("secret-ish detail")), "something went wrong while searching");

console.log("Cancellations only when dated");
check("dated access end", datedCancellation({ subject: "Your subscription has been cancelled", text: "You'll have access until October 15, 2026." }, NOW), { cancelledOn: null, accessEndsOn: "2026-10-15" });
check("cancelled on a date", datedCancellation({ subject: "Cancellation confirmed", text: "Your plan was cancelled on 3 Sep 2026." }, NOW), { cancelledOn: "2026-09-03", accessEndsOn: null });
check("undated cancellation ignored", datedCancellation({ subject: "Your subscription has been cancelled", text: "We're sorry to see you go." }, NOW), null);
check("will not renew, dated", datedCancellation({ subject: "Your plan will not renew", text: "It ends on 2026-11-01." }, NOW), { cancelledOn: null, accessEndsOn: "2026-11-01" });
check("receipt footer is not a cancellation", datedCancellation({ subject: "Your receipt", text: "Cancel anytime. Renews on October 5, 2026." }, NOW), null);

console.log("What is saved");
check("receipt saved", worthSaving({ subject: "Payment received", text: "", amount: null }, NOW), "payment");
check("unplaced with an amount saved", worthSaving({ subject: "Netflix", text: "Rs. 649", amount: 649 }, NOW), "payment");
check("newsletter skipped", worthSaving({ subject: "New arrivals this week", text: "subscription perks", amount: null }, NOW), null);
check("reminder skipped", worthSaving({ subject: "Your plan renews soon", text: "", amount: 649 }, NOW), null);
check("dated cancellation saved", worthSaving({ subject: "Your subscription has been cancelled", text: "Access until 2026-10-15.", amount: null }, NOW), "cancellation");
check("undated cancellation skipped", worthSaving({ subject: "Your subscription has been cancelled", text: "Bye", amount: null }, NOW), null);

console.log("Admin label");
check("not searched", historyLabel({ historyStatus: null, historySearchedSince: null, historyError: null }), "Not searched yet");
check("searching", historyLabel({ historyStatus: "running", historySearchedSince: null, historyError: null }), "Searching…");
check("pending reads as searching", historyLabel({ historyStatus: "pending", historySearchedSince: null, historyError: null }), "Searching…");
check("done", historyLabel({ historyStatus: "done", historySearchedSince: "2025-10-02", historyError: null }), "Since Oct 2025");
check("failed", historyLabel({ historyStatus: "failed", historySearchedSince: null, historyError: "the mailbox needs to be reconnected" }), "Couldn't search: the mailbox needs to be reconnected");
check("hand-added", historyLabel({ historyStatus: "done", historySearchedSince: null, historyError: NOTE_ADDED_BY_HAND }), "Not searched: added by hand");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
