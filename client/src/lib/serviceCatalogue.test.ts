/* Run: npm run test:catalogue */
import { findService, brandDomain, domainsFromEmail, browseServices } from "./serviceCatalogue";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}

/*
 * The wrong-logo bug. A YouTube Premium receipt is sent by Google's billing
 * address, so resolving the brand from the sender put Google's mark on a
 * YouTube subscription. The name has to win over the sender for these.
 */
check("YouTube Premium is YouTube, not Google", brandDomain("YouTube Premium"), "youtube.com");
check("YouTube Music is YouTube", brandDomain("YouTube Music"), "youtube.com");
check("bare YouTube resolves", brandDomain("YouTube"), "youtube.com");
check("Google One keeps its own domain", brandDomain("Google One (100 GB)"), "one.google.com");

/* The missing-logo cases: brands detection finds that no list carried. */
check("Netflix resolves", brandDomain("Netflix"), "netflix.com");
check("Netflix Premium resolves by prefix", brandDomain("Netflix Premium"), "netflix.com");
check("Spotify resolves", brandDomain("Spotify Family"), "spotify.com");
check("Apple One resolves", brandDomain("Apple One"), "apple.com");

/* A name that is not a known brand must not borrow one. */
check("an unknown brand resolves to nothing", brandDomain("Acme Insurance"), undefined);
check("empty resolves to nothing", brandDomain(""), undefined);
check("null resolves to nothing", brandDomain(null), undefined);
/* Prefix matching stops at a word boundary, so this must not become YouTube. */
check("a longer word is not a prefix match", brandDomain("Netflixation Ltd"), undefined);

/*
 * These brands are for logos only. Putting them in the picker would undo the
 * decision to lead with SaaS rather than streaming and consumer accounts.
 */
const pickerNames = browseServices("", null).map((s) => s.name.toLowerCase());
check("YouTube is not offered in the picker", pickerNames.includes("youtube"), false);
check("Netflix is not offered in the picker", pickerNames.includes("netflix"), false);
check("the picker still carries SaaS", pickerNames.includes("figma"), true);

/* The catalogue still wins over the brand map where both could answer. */
check("Google Workspace is still the catalogue's", findService("Google Workspace")?.domain, "workspace.google.com");
check("a receipt-named plan still matches", findService("Figma Professional")?.domain, "figma.com");

/* The sender is the last resort and still works for everything unlisted. */
check("a sending domain is offered", domainsFromEmail("billing@swiggy.in"), ["swiggy.in"]);
check("a subdomain offers its parent too", domainsFromEmail("no-reply@mail.acme.com"), ["mail.acme.com", "acme.com"]);
check("a malformed address offers nothing", domainsFromEmail("not-an-address"), []);

/*
 * A Railway receipt is sent by Stripe. Taking the brand from the sender put
 * Stripe's purple mark on a Railway subscription, and nothing caught it
 * because Stripe has a perfectly good logo that loaded perfectly.
 */
check("a payment processor is not the brand", domainsFromEmail("invoice@stripe.com"), []);
check("nor is PayPal", domainsFromEmail("service@paypal.com"), []);
check("nor is an Indian gateway", domainsFromEmail("noreply@billdesk.com"), []);
check("nor is a mail relay", domainsFromEmail("bounce@sendgrid.net"), []);
check("a real merchant still resolves", domainsFromEmail("billing@netflix.com"), ["netflix.com"]);
check("a processor's subdomain is dropped with it", domainsFromEmail("x@mail.stripe.com"), ["mail.stripe.com"]);

/*
 * Checked by eye against the logo service: airtel.in returns an unrelated
 * company's mark, airtel.com returns Airtel's.
 */
check("Airtel uses the domain that has its logo", brandDomain("Airtel Black 1598 Plan"), "airtel.com");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
