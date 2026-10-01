/* Run: npm run test:history */
import {
  NOTE_BANK_ALERTS_ONLY,
  assignByPrice,
  buildNameClues,
  buildNameGmailQuery,
  buildOutlookNameFilter,
  buildOutlookNameSearch,
  withinWindow,
  companyKeys,
  historyDetails,
  isPlanName,
  isProcessorSender,
  keepEmailByName,
  buildNameOwnSenderGmailQuery,
  priceFits,
  searchCoverage,
  shouldStopEarly,
  siblingsOf,
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
  type SenderPlan,
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
check("only a bank sender and a generic name: nothing to search", decideSearch({ serviceName: "Max", linkedFromEmails: ["alerts@hdfcbank.net"], merchantEmail: null }), { search: false, note: NOTE_NO_SENDER });
check("only a bank sender but a company name: searched by name", (decideSearch({ serviceName: "Netflix", linkedFromEmails: ["alerts@hdfcbank.net"], merchantEmail: null, currency: "INR" }) as any).plan?.byName?.clues, ["Netflix"]);
check("merchant email alone is enough", (decideSearch({ serviceName: "Netflix", linkedFromEmails: [], merchantEmail: "info@netflix.com" }) as any).plan?.owned, ["netflix.com"]);
check("shared + distinct name searched", decideSearch({ serviceName: "iCloud+", linkedFromEmails: ["no_reply@email.apple.com"], merchantEmail: null }).search, true);
check("generic name with an owned domain still searched", decideSearch({ serviceName: "Max", linkedFromEmails: ["billing@max.com"], merchantEmail: null }).search, true);

console.log("New messages and the cap");
check("already stored skipped", selectNewMessageIds(["a", "b", "c"], new Set(["b"]), 150), ["a", "c"]);
check("repeats dropped", selectNewMessageIds(["a", "a", "b"], new Set(), 150), ["a", "b"]);
const many = Array.from({ length: 150 }, (_, i) => `m${i}`);
check("capped at 150", selectNewMessageIds(many.concat(["x1", "x2"]), new Set(), MAX_MESSAGES_PER_SUBSCRIPTION).length, 150);
check("the cap is 150", MAX_MESSAGES_PER_SUBSCRIPTION, 150);
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

console.log("Partial searches say so (the 150-email budget)");
{
  const full = searchCoverage({ since: searchSince(NOW), truncated: false, oldestRead: new Date("2026-01-10T00:00:00Z") });
  check("budget not hit: the whole window", full, { searchedSince: "2025-09-29", partial: false, note: null });
  const cut = searchCoverage({ since: searchSince(NOW), truncated: true, oldestRead: new Date("2026-03-12T08:00:00Z") });
  check("budget hit: searched since is the oldest email reached", cut.searchedSince, "2026-03-12");
  check("budget hit: partial", cut.partial, true);
  check("budget hit: note names the cap and the month", cut.note, "Partial: read newest 150 emails, back to Mar 2026");
  check("never claims more than the window", searchCoverage({ since: searchSince(NOW), truncated: true, oldestRead: new Date("2024-01-01T00:00:00Z") }).searchedSince, "2025-09-29");
  check("admin headline says Partial", historyLabel({ historyStatus: "done", historySearchedSince: "2026-03-12", historyError: cut.note, historyPartial: true }), "Partial, since mar 2026");
  check("admin headline: complete search unchanged", historyLabel({ historyStatus: "done", historySearchedSince: "2025-09-29", historyError: null, historyPartial: false }), "Since Sep 2025");
}

console.log("Admin details: counts, skipped, notes");
check("counts, bills, skipped and a note",
  historyDetails({ historyStatus: "done", historySearchedSince: "2025-09-29", historyError: NOTE_BANK_ALERTS_ONLY, historyRead: 40, historySaved: 12, historySkipped: 3 }, 2),
  ["40 read · 12 saved · 2 bills with no receipt", "3 skipped (no matching price)", "Found through bank alerts only"]);
check("one bill reads singular", historyDetails({ historyStatus: "done", historySearchedSince: "2025-09-29", historyError: null, historyRead: 5, historySaved: 1, historySkipped: 0 }, 1), ["5 read · 1 saved · 1 bill with no receipt"]);
check("nothing to show before a search", historyDetails({ historyStatus: "running", historySearchedSince: null, historyError: null }), []);
check("not searched: no details", historyDetails({ historyStatus: "done", historySearchedSince: null, historyError: NOTE_ADDED_BY_HAND }), []);

console.log("Name clues: order, plan names, old names");
{
  const clues = buildNameClues({
    merchantName: "Anthropic, PBC",
    serviceName: "Claude",
    remembered: [{ name: "Claude Pro", origin: "approval" }, { name: "Hobby plan", origin: "rename" }, { name: "Old Name Co", origin: "rename" }, { name: "claude", origin: "rename" }],
  });
  check("order: merchant, approval, current, then old names; repeats dropped", clues.search, ["Anthropic, PBC", "Claude Pro", "Claude", "Old Name Co"]);
  check("a plan name is body-only, never a search clue", clues.bodyOnly, ["Hobby plan"]);
  check("plan-name detection", [isPlanName("Hobby plan"), isPlanName("Pro"), isPlanName("Claude Pro"), isPlanName("Railway")], [true, true, false, false]);
  check("too-generic names dropped", buildNameClues({ merchantName: null, serviceName: "One", remembered: [{ name: "Apple", origin: "rename" }] }).search, []);
  const renamed = buildNameClues({ merchantName: null, serviceName: "Railway", remembered: [{ name: "Hobby plan", origin: "rename" }] });
  check("renamed from a plan name: current name searched, old name body-only", [renamed.search, renamed.bodyOnly], [["Railway"], ["Hobby plan"]]);
  const old = buildNameClues({ merchantName: null, serviceName: "My Streaming", remembered: [{ name: "Memorisely", origin: "rename" }] });
  check("old name is a search clue", old.search, ["My Streaming", "Memorisely"]);
  check("name-only search with only plan names: nothing to search", decideSearch({ serviceName: "Hobby plan", linkedFromEmails: ["alerts@hdfcbank.net"], merchantEmail: null, clues: buildNameClues({ merchantName: null, serviceName: "Hobby plan", remembered: [] }) }), { search: false, note: NOTE_NO_SENDER });
  check("shared sender recognised by an old name", namesSubscription({ subject: "Your receipt from Apple", text: "iCloud+ 50 GB" }, ["Storage", "iCloud+"]), true);
}

console.log("Searching by company name (no sender to search)");
{
  const decision = decideSearch({
    serviceName: "Railway",
    linkedFromEmails: ["alerts@hdfcbank.net", "receipts@stripe.com"],
    merchantEmail: null,
    clues: buildNameClues({ merchantName: null, serviceName: "Railway", remembered: [{ name: "Hobby plan", origin: "rename" }] }),
    currency: "USD",
  });
  check("bank and processor senders only: searched by name", decision.search, true);
  const plan = (decision as any).plan as SenderPlan;
  check("plan carries clues, plan name and currency", plan.byName, { clues: ["Railway"], bodyClues: ["Hobby plan"], currency: "USD" });
  const gq = buildNameGmailQuery(plan.byName!.clues);
  check("gmail query is by company name", gq, '(("railway" OR from:railway)) newer_than:365d (receipt OR invoice OR payment OR renewal OR charged OR billing OR subscription OR cancel OR cancelled)');
  check("plan name is never in the query", gq!.includes("hobby"), false);
  check("gmailQueriesFor: own-sender query first, then the by-name one", gmailQueriesFor(plan, ["Railway"]), [buildNameOwnSenderGmailQuery(plan.byName!.clues), gq]);
  check("own-sender query", buildNameOwnSenderGmailQuery(["Railway"]), "(from:railway) newer_than:365d (receipt OR invoice OR payment OR renewal OR charged OR billing OR subscription OR cancel OR cancelled)");
  check("outlook name filter (subject)", buildOutlookNameFilter(["Railway"], searchSince(NOW)), "receivedDateTime ge 2025-09-29T10:00:00.000Z and (contains(subject,'railway'))");
  check("outlook name search: full text, one name", buildOutlookNameSearch(["Railway"]), '"railway"');
  check("outlook name search: several clues ORed", buildOutlookNameSearch(["Railway", "Acme Cloud"]), '"railway OR acme"');
  check("outlook name search: duplicates collapse", buildOutlookNameSearch(["Railway", "railway"]), '"railway"');
  check("outlook name search: quotes, colons, parens never survive inside the term", /^"[^"\\:()]+"$/.test(buildOutlookNameSearch(['Rail"way:(x) \\ from:evil', "Railway"])!), true);
  check("outlook name search: nothing searchable gives null", buildOutlookNameSearch([]), null);
  check("outlook name search: no date filter inside it", buildOutlookNameSearch(["Railway"])!.includes("receivedDateTime"), false);
  check("window: inside", withinWindow(NOW.getTime() - 1000, searchSince(NOW)), true);
  check("window: before it", withinWindow(searchSince(NOW).getTime() - 1, searchSince(NOW)), false);
  check("window: bad date", withinWindow(NaN, searchSince(NOW)), false);
  const by = plan.byName!;
  const stripe = { fromEmail: "invoice+statements+acct_1A@stripe.com", fromName: "Railway Corporation", subject: "Your receipt from Railway Corporation #2139-9980", text: "Receipt from Railway Corporation $5.90 Paid September 18, 2026 Hobby plan", currency: "USD" };
  check("Stripe sender naming the company: kept", keepEmailByName(stripe, by), { keep: true });
  check("Stripe sender, display name is Stripe but the body names the company: kept", keepEmailByName({ ...stripe, fromName: "Stripe" }, by), { keep: true });
  check("Stripe receipt for another company: dropped", keepEmailByName({ ...stripe, fromName: "Stripe", subject: "Your receipt from Acme", text: "Receipt from Acme $5.90" }, by), { keep: false, why: "not_named" });
  check("Stripe receipt whose body only has the plan name: recognised (the plan name helps the body, it never started a search)", keepEmailByName({ ...stripe, fromName: "Stripe", subject: "Your receipt #2139-9980", text: "Receipt $5.90 Hobby plan" }, by), { keep: true });
  check("wrong currency (Indian Railways): dropped", keepEmailByName({ fromEmail: "irctc@railways.in", fromName: "Indian Railways", subject: "Payment receipt", text: "Railway ticket receipt Rs 540", currency: "INR" }, by), { keep: false, why: "wrong_currency" });
  check("no currency: dropped", keepEmailByName({ ...stripe, currency: null }, by), { keep: false, why: "wrong_currency" });
  check("sender's own address names the company: kept", keepEmailByName({ fromEmail: "billing@railway.com", fromName: "", subject: "Your invoice", text: "invoice $5", currency: "USD" }, by), { keep: true });
  check("an unrelated sender: dropped", keepEmailByName({ fromEmail: "news@example.com", fromName: "Example", subject: "Receipt", text: "railway $5", currency: "USD" }, by), { keep: false, why: "other_sender" });
  check("a bank alert naming the company is never a source", keepEmailByName({ fromEmail: "alerts@hdfcbank.net", fromName: "HDFC Bank", subject: "Alert: $5.90 spent at Railway", text: "payment of $5.90 at Railway", currency: "USD" }, by), { keep: false, why: "other_sender" });
  check("a card issuer is never a source", keepEmailByName({ fromEmail: "no-reply@sbicard.com", fromName: "SBI Card Railway", subject: "Transaction receipt", text: "Railway", currency: "USD" }, by), { keep: false, why: "other_sender" });
  check("no billing word: dropped", keepEmailByName({ ...stripe, subject: "Railway news", text: "hello" }, by), { keep: false, why: "no_keyword" });
  check("keepEmail routes a name plan through the name rules", keepEmail(stripe, plan, ["Railway"]), { keep: true });
  check("processor detection", [isProcessorSender("a@stripe.com"), isProcessorSender("a@mail.stripe.com"), isProcessorSender("a@hdfcbank.net")], [true, true, false]);
  check("intermediaries are still dropped from sender plans", planSenders(["alerts@hdfcbank.net", "receipts@stripe.com", "info@mailer.netflix.com"]).owned, ["netflix.com"]);
  check("a name search is not shortcut by a generic name", decideSearch({ serviceName: "Max", linkedFromEmails: ["alerts@hdfcbank.net"], merchantEmail: null }).search, false);
  check("Google One by its full name", nameTooGeneric("Google One"), false);
}

console.log("Companies with several subscriptions: assign by price");
{
  const mk = (id: string, serviceName: string, amount: string, senders: string[] = ["ebill@airtel.com"], extra: Partial<SubA> = {}): SubA =>
    ({ id, serviceName, merchantName: "Airtel", merchantEmail: null, amount, currency: "INR", senders, ...extra });
  type SubA = Parameters<typeof companyKeys>[0];
  const mobile = mk("a1", "Airtel Mobile", "399.00");
  const broadband = mk("a2", "Airtel Broadband", "1179.00");
  const black = mk("a3", "Airtel Black", "1885.64");
  const netflix = mk("n1", "Netflix", "649.00", ["info@mailer.netflix.com"], { merchantName: "Netflix" });
  const all = [mobile, broadband, black, netflix];
  check("company key: sender domain and brand word", companyKeys(black), ["domain:airtel.com", "name:airtel"]);
  check("siblings of Airtel Black", siblingsOf(black, all).map((s) => s.id), ["a1", "a2"]);
  check("Netflix has no siblings", siblingsOf(netflix, all), []);
  check("bank senders do not make a company", companyKeys({ ...netflix, merchantName: null, serviceName: "Max", senders: ["alerts@hdfcbank.net"] }), []);
  check("price fit: same price", priceFits({ amount: 1885.64, currency: "INR" }, black), true);
  check("price fit: within a unit", priceFits({ amount: 1886.2 }, black), true);
  check("price fit: other plan's price", priceFits({ amount: 399 }, black), false);
  check("price fit: other currency", priceFits({ amount: 1885.64, currency: "USD" }, black), false);
  check("price fit: no amount", priceFits({ amount: null }, black), false);
  const group = [black, mobile, broadband];
  check("Black bill goes to Black", assignByPrice({ amount: 1885.64, currency: "INR" }, group), "a3");
  check("mobile receipt goes to Mobile", assignByPrice({ amount: 399, currency: "INR" }, group), "a1");
  check("same answer in any order", assignByPrice({ amount: 1179, currency: "INR" }, [broadband, mobile, black]), assignByPrice({ amount: 1179, currency: "INR" }, [black, broadband, mobile]));
  check("no price fits: skipped (null)", assignByPrice({ amount: 2500, currency: "INR" }, group), null);
  check("no amount: skipped (null)", assignByPrice({ amount: null }, group), null);
  check("equal prices tie to the lower id", assignByPrice({ amount: 499 }, [{ id: "z", amount: "499", currency: "INR" }, { id: "b", amount: "499", currency: "INR" }]), "b");
}

console.log("PDF text helps decide what is saved");
check("unclear subject, PDF says amount paid: saved", worthSaving({ subject: "Auto Secure", text: "Hello", amount: null, attachmentText: "Invoice-1.pdf\nAmount paid Rs 4,999" }, NOW), "payment");
check("name search needs wording: an amount alone is not enough", worthSaving({ subject: "Railway", text: "Rs. 649 plans", amount: 649 }, NOW, { requireWording: true }), null);
check("name search: receipt wording is enough", worthSaving({ subject: "Your receipt from Railway", text: "", amount: 5.9 }, NOW, { requireWording: true }), "payment");

console.log("Credit card bills are never kept");
{
  const cc = { subject: "Your credit card bill is due on Mar 30, 2026: Pay now to maintain your credit score", text: "Total amount due Rs 58,317.58" };
  check("credit card bill: not kept (shared-sender search)", keepEmail({ fromEmail: "no_reply@email.apple.com", ...cc }, applePlan, "iCloud+"), { keep: false, why: "credit_card" });
  check("credit card bill: not kept (owned sender)", keepEmail({ fromEmail: "info@mailer.netflix.com", ...cc }, netflixPlan, "Netflix"), { keep: false, why: "credit_card" });
  check("credit card bill: not kept (search by name)", keepEmailByName({ fromEmail: "bills@billpay.in", fromName: "Mobile Postpaid", currency: "INR", ...cc }, { clues: ["Mobile Postpaid"], bodyClues: [], currency: "INR" }), { keep: false, why: "credit_card" });
  check("credit card bill: not worth saving, even with a PDF-like amount", worthSaving({ ...cc, amount: 58317.58 }, NOW), null);
  check("credit card bill: not worth saving in a name search either", worthSaving({ ...cc, amount: 58317.58 }, NOW, { requireWording: true }), null);
  check("a normal receipt is still kept", keepEmail({ fromEmail: "info@mailer.netflix.com", subject: "Your receipt from Netflix", text: "Paid by credit card ending 4242. Amount paid Rs 649" }, netflixPlan, "Netflix"), { keep: true });
}


console.log("Early stop for a search by name");
{
  check("name search: 59 not kept in a row: keeps reading", shouldStopEarly(true, 59), false);
  check("name search: 60 not kept in a row: stops", shouldStopEarly(true, 60), true);
  check("senders search: never stops early", shouldStopEarly(false, 500), false);
  const early = searchCoverage({ since: searchSince(NOW), truncated: false, oldestRead: new Date("2026-03-12T08:00:00Z"), stoppedEarly: 60 });
  check("early stop is Partial with an honest note", [early.partial, early.note], [true, "Partial: stopped after 60 emails in a row that were not about it, back to Mar 2026"]);
  check("no early stop: coverage unchanged", searchCoverage({ since: searchSince(NOW), truncated: false, oldestRead: new Date("2026-03-12T08:00:00Z"), stoppedEarly: null }).partial, false);
}

console.log("Netflix: its own mail from account.netflix.com, found by name");
{
  const by = { clues: ["Netflix"], bodyClues: [], currency: "INR" };
  const own = (subject: string, text: string) => ({ fromEmail: "info@account.netflix.com", fromName: "Netflix", subject, text, currency: null });
  check("processed notice kept", keepEmailByName(own("We’ve successfully processed your payment", "Your payment has been processed."), by), { keep: true });
  check("unsuccessful payment kept", keepEmailByName(own("Your payment was unsuccessful", "Let’s fix it, so your membership isn’t interrupted."), by), { keep: true });
  check("update payment kept", keepEmailByName(own("Action needed: update payment", "Don’t lose access to series, films and games. Update your payment."), by), { keep: true });
  check("own mail in another currency still dropped", keepEmailByName({ ...own("Payment receipt", "payment $5"), currency: "USD" }, by), { keep: false, why: "wrong_currency" });
  check("bank alert naming Netflix, no currency, still dropped", keepEmailByName({ fromEmail: "alerts@hdfcbank.net", fromName: "HDFC Bank", subject: "Payment alert", text: "payment at Netflix", currency: null }, by), { keep: false, why: "other_sender" });
  const qs = gmailQueriesFor({ owned: [], shared: [], addresses: [], byName: by }, ["Netflix"]);
  check("own-sender query runs before the broad one", [qs.length, qs[0].startsWith("(from:netflix)"), qs[1].includes('"netflix" OR from:netflix')], [2, true, true]);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
