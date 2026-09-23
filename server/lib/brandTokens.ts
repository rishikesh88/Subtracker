/**
 * The words in a subscription's name that could name the company behind it.
 *
 * Used to find the sender of its receipts when nothing links the two
 * directly. Precision matters far more than coverage here: a missing logo
 * costs nothing, a wrong one tells someone they subscribe to a company they
 * have never heard of. So this is deliberately strict.
 *
 *   "Google One (100 GB)"  -> ["google"]
 *   "Apple One Family"     -> ["apple"]
 *   "YouTube Premium"      -> ["youtube"]
 *   "Cloud Network"        -> []          nothing here names a company
 */

/* Words that appear in a subscription's name without naming its vendor.
 * "cloud" is the reason this list exists: on its own it would match half the
 * senders on an account. */
const NOT_A_BRAND = new Set([
  "cloud", "storage", "premium", "family", "personal", "business", "basic",
  "standard", "professional", "plus", "pro", "lite", "plan", "package",
  "policy", "membership", "subscription", "annual", "yearly", "monthly",
  "auto", "secure", "private", "individual", "student", "team", "teams",
  "account", "service", "services", "software", "online", "mobile", "home",
  "unlimited", "essentials", "starter", "advanced", "enterprise", "suite",
  "with", "and", "the", "for", "your", "renewal", "network", "internet",
  "prime", "plan", "bundle", "gift", "card", "insurance", "payment",
]);

function tokenise(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    /* Four characters is the floor. Below it a token matches far too much --
     * "one" is inside "onepassword", "phone", "microsoft.onmicrosoft.com". */
    .filter((word) => word.length >= 4 && !NOT_A_BRAND.has(word));
}

/**
 * Tokens to try against a sending domain, most likely first.
 *
 * The merchant name leads because the detector fills it with the company
 * ("Apple", "Google") while the service name carries the product and its
 * qualifiers. Only the first word of the service name is used: a brand is the
 * head of its own product name, and later words are what it sells.
 */
export function brandTokens(
  merchantName: string | null | undefined,
  serviceName: string | null | undefined,
): string[] {
  const fromMerchant = tokenise(merchantName);
  const fromService = tokenise(serviceName).slice(0, 1);

  const out: string[] = [];
  for (const token of [...fromMerchant, ...fromService]) {
    if (!out.includes(token)) out.push(token);
  }
  return out;
}
