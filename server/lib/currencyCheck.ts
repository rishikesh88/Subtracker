/**
 * Check the currency a model reported against the currency printed in the email.
 *
 * Whether a body contains "$23.60" is a regex, not a judgement, so it should
 * not be left to a language model. The model got exactly this wrong on a
 * Claude Pro invoice: it read "Total due $23.60", saw a "GST - India (18%)"
 * line, and reported INR -- reasoning out loud that it had borrowed the
 * currency from another email in the same batch.
 *
 * The prompt now forbids that. This is the second line: if the text is
 * unambiguous and the model disagrees, the text wins.
 *
 * It only ever overrides on clear evidence. Where the email is genuinely
 * ambiguous -- several currencies, or none -- the model's answer stands,
 * because guessing differently is not an improvement.
 */

export type CurrencyVerdict = {
  currency: string;
  /** True when the email contradicted the model and the email won. */
  corrected: boolean;
  reason: string;
};

/* Only the currencies this product handles. A symbol outside this set is not
   evidence of anything, so it is ignored rather than guessed at. */
const SYMBOLS: [RegExp, string][] = [
  [/[₹]|\bRs\.?\b|\bINR\b/i, "INR"],
  [/\$|\bUSD\b/i, "USD"],
  [/[€]|\bEUR\b/i, "EUR"],
  [/[£]|\bGBP\b/i, "GBP"],
];

/** Every currency named anywhere in the text, deduplicated. */
function currenciesIn(text: string): string[] {
  return SYMBOLS.filter(([pattern]) => pattern.test(text)).map(([, code]) => code);
}

/**
 * The currency printed immediately before the amount.
 *
 * This is the strongest signal in an invoice: "$23.60" says dollars no matter
 * what the rest of the document is about. The window is short on purpose --
 * far enough back for "USD 23.60" or "Rs. 1,885.64", not far enough to catch
 * an unrelated symbol from the line above.
 */
export function currencyBesideAmount(text: string, amount: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;

  // The same number is written several ways: 1885.64, 1,885.64, 1885.
  const whole = Math.floor(amount);
  const written = [
    amount.toFixed(2),
    amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","),
    String(whole),
    whole.toLocaleString("en-US"),
  ];

  for (const form of written) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(form, from);
      if (at === -1) break;
      const before = text.slice(Math.max(0, at - 6), at);
      const found = SYMBOLS.find(([pattern]) => pattern.test(before));
      if (found) return found[1];
      from = at + 1;
    }
  }
  return null;
}

export function verifyCurrency(
  text: string | null | undefined,
  amount: number,
  modelCurrency: string | null | undefined,
): CurrencyVerdict {
  const claimed = (modelCurrency ?? "").trim().toUpperCase();
  const body = text ?? "";

  const beside = currencyBesideAmount(body, amount);
  if (beside) {
    if (!claimed || claimed === "UNKNOWN") {
      return { currency: beside, corrected: false, reason: `printed beside the amount: ${beside}` };
    }
    if (beside !== claimed) {
      return {
        currency: beside,
        corrected: true,
        reason: `email prints ${beside} beside the amount, model said ${claimed}`,
      };
    }
    return { currency: claimed, corrected: false, reason: "email and model agree" };
  }

  /* Nothing beside the amount.
   *
   * A single currency elsewhere in the text is enough to fill in an UNKNOWN,
   * but deliberately NOT enough to overrule the model. The text handed to this
   * function is the evidence emails matched by subject and sender, capped at
   * five, so it may not be the email the amount came from at all. Overriding
   * on that would reintroduce the bug being fixed -- one email's currency
   * applied to another's amount -- with this function as the culprit instead
   * of the model. */
  const mentioned = currenciesIn(body);
  if (mentioned.length === 1 && (!claimed || claimed === "UNKNOWN")) {
    return {
      currency: mentioned[0],
      corrected: false,
      reason: `only currency in the evidence: ${mentioned[0]}`,
    };
  }

  if (!claimed) return { currency: "UNKNOWN", corrected: false, reason: "no currency anywhere" };
  return { currency: claimed, corrected: false, reason: "email is ambiguous, model's answer kept" };
}
