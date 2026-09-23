import { useAuth } from "@/hooks/useAuth";
import { useExchangeRates } from "@/hooks/useExchangeRates";
import { formatCurrency, isUnknownCurrency } from "@/lib/format";

/**
 * One rule for showing an amount, used by every screen that shows one.
 *
 * Amounts are stored in the currency they were billed in, which is the fact
 * on the receipt and never changes. What a person picked during onboarding is
 * a display preference, so the conversion belongs here rather than in the
 * data -- and it belongs in one place, because the dashboard, the card, the
 * detail panel and the review screen were each answering it differently.
 * That is what put rupees on a dollar account.
 */
export interface DisplayAmount {
  /** What to show large: the chosen currency wherever that is possible. */
  primary: string;
  /** What was actually billed, when that differs. Null when it does not. */
  secondary: string | null;
  /** The receipt printed no currency, so nothing was converted. */
  unknownCurrency: boolean;
}

export function useMoney() {
  const { user } = useAuth();
  const { convert, fetchedAt } = useExchangeRates();
  const userCurrency = user?.preferredCurrency || "INR";

  function display(amount: number | string | null | undefined, billedCurrency: string | null | undefined): DisplayAmount {
    const value = typeof amount === "string" ? parseFloat(amount) : (amount ?? 0);
    const safe = Number.isFinite(value) ? value : 0;
    const billed = (billedCurrency || "").toUpperCase();

    // Nothing to convert from. Showing this as the chosen currency would
    // assert a unit nobody established, which is the guess detection was
    // changed to stop making.
    if (isUnknownCurrency(billed) || !billed) {
      return { primary: formatCurrency(safe, "UNKNOWN"), secondary: null, unknownCurrency: true };
    }

    if (billed === userCurrency.toUpperCase()) {
      return { primary: formatCurrency(safe, billed), secondary: null, unknownCurrency: false };
    }

    const converted = convert(safe, billed, userCurrency);
    // No rate for this pair -- an unusual currency, or the table never
    // loaded. The billed figure is still true, so it leads rather than
    // being replaced by a wrong one.
    if (converted === null) {
      return { primary: formatCurrency(safe, billed), secondary: null, unknownCurrency: false };
    }

    return {
      primary: formatCurrency(converted, userCurrency),
      secondary: formatCurrency(safe, billed),
      unknownCurrency: false,
    };
  }

  return { display, userCurrency, ratesFetchedAt: fetchedAt };
}
