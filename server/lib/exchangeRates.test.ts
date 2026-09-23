/* Run: npm run test:rates */
import { __parseRatesForTest as parseRates, BASELINE_TO_INR } from "./exchangeRates";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}
function near(label: string, actual: number | undefined, expected: number) {
  const ok = typeof actual === "number" && Math.abs(actual - expected) < 0.01;
  if (ok) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${actual}\n       want ~${expected}`); failed++; }
}

/*
 * The response shape could not be exercised against the live service from the
 * build container, whose egress policy blocks it. So these tests pin the shape
 * this code expects, and every case that does not match it must come back null
 * -- that is what keeps an unverified assumption from turning into wrong money
 * on screen. A null means "keep the rates we already had".
 */

const body = (rates: Record<string, unknown>, base: unknown = "INR") => ({
  amount: 1.0, base, date: "2026-09-22", rates,
});

/* The documented Frankfurter shape, inverted into rupees per unit. */
const good = parseRates(body({ USD: 0.0113, EUR: 0.0096, GBP: 0.0084 }));
near("one dollar is about 88 rupees", good?.USD, 88.50);
near("one euro is about 104 rupees", good?.EUR, 104.17);
near("one pound is about 119 rupees", good?.GBP, 119.05);
check("rupees are the pivot and worth one", good?.INR, 1.0);

/* Anything unexpected keeps the rates we already had. */
check("a missing currency is refused", parseRates(body({ USD: 0.0113, EUR: 0.0096 })), null);
check("a string rate is refused", parseRates(body({ USD: "0.0113", EUR: 0.0096, GBP: 0.0084 })), null);
check("a null rate is refused", parseRates(body({ USD: null, EUR: 0.0096, GBP: 0.0084 })), null);
check("a zero rate is refused", parseRates(body({ USD: 0, EUR: 0.0096, GBP: 0.0084 })), null);
check("a negative rate is refused", parseRates(body({ USD: -0.0113, EUR: 0.0096, GBP: 0.0084 })), null);
check("NaN is refused", parseRates(body({ USD: NaN, EUR: 0.0096, GBP: 0.0084 })), null);
check("no rates object is refused", parseRates({ amount: 1, base: "INR" }), null);
check("an empty body is refused", parseRates({}), null);
check("null is refused", parseRates(null), null);
check("a string body is refused", parseRates("88.5"), null);

/*
 * The one that matters most. If the service ever answers in the other
 * direction -- rupees per dollar rather than dollars per rupee -- inverting it
 * would price a dollar at roughly one paisa and every total on every screen
 * would collapse. A rupee buys a fraction of any of these currencies, so any
 * rate at or above 1 means we have misread which way round the answer is.
 */
check("a rate of 1 or more means we read it backwards", parseRates(body({ USD: 88.5, EUR: 104, GBP: 119 })), null);
check("exactly 1 is refused", parseRates(body({ USD: 1, EUR: 0.0096, GBP: 0.0084 })), null);

/* A different base would mean rates against the wrong currency entirely. */
check("a response based on something else is refused", parseRates(body({ USD: 0.0113, EUR: 0.0096, GBP: 0.0084 }, "EUR")), null);
check("a missing base is refused", parseRates({ amount: 1, date: "2026-09-22", rates: { USD: 0.0113, EUR: 0.0096, GBP: 0.0084 } }), null);

/* The fallback has to stay usable, since it is what runs before the first fetch lands. */
check("the fallback covers every currency offered", Object.keys(BASELINE_TO_INR).sort(), ["EUR", "GBP", "INR", "USD"]);
check("the fallback prices a rupee at one", BASELINE_TO_INR.INR, 1.0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
