/* Run: npm run test:currency */
import { verifyCurrency, currencyBesideAmount } from "./currencyCheck";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}
const got = (text: string, amount: number, model: string | null) => {
  const v = verifyCurrency(text, amount, model);
  return [v.currency, v.corrected];
};

/* The case that started this. The model read the dollar sign, then talked
   itself into INR because of the GST line and another email in the batch. */
const claudeInvoice =
  "Important: Confirm your $23.60 payment to Anthropic, PBC\n" +
  "Claude Pro - monthly payment\nSubtotal $20.00\nGST - India (18%) $3.60\nTotal due $23.60";
check('Claude Pro: the dollar sign beats the GST line',
  got(claudeInvoice, 23.60, 'INR'), ['USD', true]);
check('Claude Pro: agreeing costs nothing',
  got(claudeInvoice, 23.60, 'USD'), ['USD', false]);

/* Real rupee subscriptions must not be disturbed. */
check('Airtel, with a thousands separator',
  got("Bill for your Airtel Black account\nTotal amount payable: Rs. 1,885.64", 1885.64, 'INR'),
  ['INR', false]);
check('Google One in rupees',
  got("Your subscription continues and you've been charged ₹130.00/month", 130, 'INR'),
  ['INR', false]);
check('Netflix in rupees', got("Netflix - ₹649/month", 649, 'INR'), ['INR', false]);

/* UNKNOWN is filled in when the email is clear. */
check('UNKNOWN resolved from the symbol',
  got("Your receipt from Railway Corporation\nTotal $5.90", 5.90, 'UNKNOWN'), ['USD', false]);
check('UNKNOWN stays when the email says nothing',
  got("Your plan has renewed for 499 this month", 499, 'UNKNOWN'), ['UNKNOWN', false]);

/* Ambiguity is left alone: the model saw the layout, this function did not. */
check('two currencies, model keeps the call',
  got("Charged ₹1,958 (USD 23.60 equivalent)", 23.60, 'USD'), ['USD', false]);
check('a currency far from the amount is not evidence when another is beside it',
  got("Billing address: India\nGST applies\nTotal $12.00", 12, 'INR'), ['USD', true]);

/* Codes, not just symbols. */
check('USD written as a code', got("Amount: USD 42.00", 42, 'INR'), ['USD', true]);
check('EUR symbol', got("Betrag: €9.99 monatlich", 9.99, null), ['EUR', false]);
check('GBP symbol', got("Total £7.99", 7.99, 'UNKNOWN'), ['GBP', false]);

/* Refusing to act on nothing. */
check('empty text keeps the model', got("", 10, 'INR'), ['INR', false]);
check('no text and no model', got("", 10, null), ['UNKNOWN', false]);
check('a zero amount cannot anchor anything',
  got("Total ₹500", 0, 'INR'), ['INR', false]);

/* The evidence handed in is matched by subject and sender, so it may not
   contain the amount at all. A currency floating in unrelated text must never
   overrule the model -- that is the original bug with a new culprit. */
check('a lone currency far from the amount cannot overrule the model',
  got("Your Airtel bill is ready\nAmount \u20B91,885.64", 23.60, 'USD'), ['USD', false]);
check('but it may still fill an UNKNOWN',
  got("Your Airtel bill is ready\nAmount \u20B91,885.64", 23.60, 'UNKNOWN'), ['INR', false]);

/*
 * The review inbox reads each evidence email's billed currency this way, in
 * place of the currency saved at sync time -- which labelled Anthropic's
 * "$23.60" as rupees because the same receipt carries an Indian GST line.
 */
const anthropic = "Reminder: Confirm your $23.60 payment to Anthropic, PBC\nClaude Pro  $20.00\nGST - India (18%)  \u20B90.00\nTotal due $23.60";
check('the Claude receipt reads as dollars beside the amount',
  currencyBesideAmount(anthropic, 23.60), 'USD');
check('an amount with no currency printed beside it reads as nothing',
  currencyBesideAmount("Your plan renews soon. Amount 149.00", 149), null);
check('an amount that is not in the email reads as nothing',
  currencyBesideAmount(anthropic, 99.99), null);

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
