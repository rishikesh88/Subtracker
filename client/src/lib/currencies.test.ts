/* Run: npm run test:currencies */
import { CURRENCIES, COUNTRIES, CURRENCY_CODES, currencyForCountry } from "./currencies";
import { SUPPORTED_CURRENCIES } from "../../../server/lib/exchangeRates";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}

/*
 * The whole point of this file. Three lists used to disagree: onboarding
 * offered ten currencies, the dashboard picker four, and the server could
 * convert four. Picking AED gave a dashboard that printed the rupee total
 * under a dirham sign. If these two ever drift apart again, this fails.
 */
check("every currency a person can pick can be converted",
  [...CURRENCY_CODES].sort(), [...SUPPORTED_CURRENCIES].sort());

check("every country maps to a currency we support",
  COUNTRIES.filter((c) => !CURRENCY_CODES.includes(c.currency)), []);

check("the UAE is offered, which is the case that broke", currencyForCountry("AE"), "AED");
check("India still maps to rupees", currencyForCountry("IN"), "INR");
check("the US still maps to dollars", currencyForCountry("US"), "USD");
check("an unknown country falls back to dollars", currencyForCountry("ZZ"), "USD");

check("no currency is listed twice", CURRENCY_CODES.length, new Set(CURRENCY_CODES).size);
check("no country is listed twice", COUNTRIES.length, new Set(COUNTRIES.map((c) => c.code)).size);

/* Every entry has to be displayable, or the picker renders blanks. */
check("every currency has a name and a symbol",
  CURRENCIES.filter((c) => !c.name || !c.symbol || c.code.length !== 3), []);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
