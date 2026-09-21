// Tests for telling a bill apart from other mail by the same merchant.
// Run with `npm run test:billing-email`.
//
// The cases are real subject lines, or close paraphrases of them: the Swiggy
// ones are the shape that put takeaway receipts into a subscription's invoice
// archive, which is what this module exists to stop.

import { looksLikeBill } from "./billingEmail";

let pass = 0,
  fail = 0;
const check = (name: string, cond: boolean) => {
  cond ? (pass++, console.log("  ok   " + name)) : (fail++, console.log("  FAIL " + name));
};

const bill = (subject: string, sub = {}, amount?: number) =>
  looksLikeBill({ subject, extractedAmount: amount ?? null }, sub).isBill;

console.log("\n  Swiggy: a membership among forty food orders");
const swiggy = { serviceName: "Swiggy One", amount: "99" };

check("membership renewal is a bill", bill("Your Swiggy One membership has been renewed", swiggy));
check("subscription charge is a bill", bill("Payment received for Swiggy One", swiggy));
check("food order is not", !bill("Your order from Biryani House is delivered", swiggy));
check("order confirmation is not", !bill("Order confirmed - Swiggy", swiggy));
check("delivery update is not", !bill("Your Swiggy order is on the way", swiggy));
check(
  "an order 'invoice' is still not a bill",
  !bill("Your Swiggy order invoice for order #88213", swiggy)
);
check("rating request is not", !bill("Rate your last Swiggy order", swiggy));
check("a promo is not", !bill("Flat 50% off your next Swiggy order", swiggy));

console.log("\n  The service's own name overrides the one-off words");
check(
  "an order-shaped subject that names the service is kept",
  bill("Swiggy One membership - your order benefits", swiggy)
);
check(
  "a one-word service name does not override",
  !bill("Your Netflix order is on the way", { serviceName: "Netflix", amount: "649" })
);

console.log("\n  Ordinary subscription mail");
check("invoice", bill("Invoice for your Claude Pro subscription", { serviceName: "Claude Pro" }));
check("receipt", bill("Your receipt from Apple", { serviceName: "Apple One" }));
check("charged", bill("You were charged 649.00", { serviceName: "Netflix" }));
check("auto-debit", bill("Amount debited towards your policy premium", { serviceName: "Car Policy" }));
check("renewal notice", bill("Your plan renews on 3 October", { serviceName: "Google One" }));

console.log("\n  The amount as a last resort");
check(
  "amount matches the subscription",
  bill("A note from Airtel", { serviceName: "Airtel Black", amount: "1885.64" }, 1885.64)
);
check(
  "a different amount is not enough",
  !bill("A note from Airtel", { serviceName: "Airtel Black", amount: "1885.64" }, 240)
);
check(
  "no amount and nothing else is not enough",
  !bill("A note from Airtel", { serviceName: "Airtel Black", amount: "1885.64" })
);

console.log("\n  Edge cases");
check("empty subject with a matching amount is kept", looksLikeBill({ subject: "", extractedAmount: 99 }, swiggy).isBill);
check("empty subject with nothing else is dropped", !looksLikeBill({ subject: "" }, swiggy).isBill);
check("missing subject is dropped", !looksLikeBill({ subject: null }, swiggy).isBill);
check("no subscription facts at all still works", bill("Your invoice is ready"));
check("case is ignored", bill("YOUR INVOICE IS READY"));
check("a zero subscription amount never matches", !bill("A note", { amount: "0" }, 0));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
