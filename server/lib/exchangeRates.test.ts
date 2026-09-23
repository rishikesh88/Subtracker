/* Run: npm run test:rates */
import { __parseRatesForTest as parseRates, BASELINE_TO_INR, SUPPORTED_CURRENCIES } from "./exchangeRates";
import { convertCurrency, getSupportedCurrencies } from "../utils/currencyConverter";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}
function near(label: string, actual: number | null | undefined, expected: number) {
  const ok = typeof actual === "number" && Math.abs(actual - expected) < 0.02;
  if (ok) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${actual}\n       want ~${expected}`); failed++; }
}

/*
 * The response shape could not be exercised against the live service from the
 * build container, whose egress policy blocks it. So these tests pin the
 * shape this code expects, and every case that does not match it must come
 * back null -- which means "keep the rates we already had".
 */
const ALL = { USD: 0.0113, EUR: 0.0096, GBP: 0.0084, AED: 0.0415, CAD: 0.0154,
              AUD: 0.0171, JPY: 1.77, CNY: 0.0805, SGD: 0.0145 };
const body = (rates: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ result: "success", base_code: "INR", rates, ...extra });

const good = parseRates(body(ALL));
near("one dollar is about 88 rupees", good?.USD, 88.50);
near("one dirham is about 24 rupees", good?.AED, 24.10);
near("a yen is less than a rupee", good?.JPY, 0.56);
check("rupees are the pivot and worth one", good?.INR, 1.0);

/* The bug this release exists to fix: AED had no rate, so an account set to
   dirhams got its rupee total back with the letters changed. */
check("every currency onboarding offers now has a rate",
  SUPPORTED_CURRENCIES.filter((c) => !good?.[c]), []);
check("the picker offers exactly what can be converted",
  getSupportedCurrencies().map((c) => c.code).sort(), [...SUPPORTED_CURRENCIES].sort());

/* Anything unexpected keeps the rates we already had. */
check("a wrong base is refused", parseRates(body(ALL, { base_code: "USD" })), null);
check("a failure result is refused", parseRates(body(ALL, { result: "error" })), null);
check("no rates object is refused", parseRates({ base_code: "INR" }), null);
check("an empty body is refused", parseRates({}), null);
check("null is refused", parseRates(null), null);
check("a string body is refused", parseRates("88.5"), null);
check("a table missing most currencies is refused", parseRates(body({ USD: 0.0113 })), null);

/*
 * The dollar is the anchor. If the service ever answers the other way round,
 * inverting it would price a dollar at about a paisa and every total would
 * collapse. It cannot be a blanket "all rates below 1" rule any more: a rupee
 * buys roughly 1.8 yen, and that is a real rate.
 */
check("an inverted table is refused", parseRates(body({ ...ALL, USD: 88.5 })), null);
check("a missing dollar is refused", parseRates(body({ ...ALL, USD: undefined })), null);
check("a string dollar is refused", parseRates(body({ ...ALL, USD: "0.0113" })), null);
check("a yen above one is still accepted", typeof parseRates(body(ALL))?.JPY, "number");

/* A currency the service does not carry is dropped, never guessed. */
const partial = parseRates(body({ ...ALL, SGD: undefined }));
check("a currency the service omits is left out", partial?.SGD, undefined);
check("and the rest still load", typeof partial?.AED, "number");

/* --- the converter must refuse rather than relabel --------------------- */

check("a currency with no rate converts to null", convertCurrency(100, "INR", "AED"), null);
check("an unknown code converts to null", convertCurrency(100, "INR", "XYZ"), null);
check("an empty target converts to null", convertCurrency(100, "INR", ""), null);
check("the same currency needs no rate", convertCurrency(100, "AED", "AED"), 100);
near("a known pair still converts", convertCurrency(83, "INR", "USD"), 1.0);
check("a negative amount converts to null", convertCurrency(-5, "USD", "INR"), null);

/* The fallback has to stay usable, since it runs before the first fetch. */
check("the fallback covers the four this app shipped with",
  Object.keys(BASELINE_TO_INR).sort(), ["EUR", "GBP", "INR", "USD"]);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
