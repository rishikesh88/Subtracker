import { useQuery } from "@tanstack/react-query";

/**
 * Today's rates, for showing an amount in the currency someone picked.
 *
 * Every subscription is stored in the currency it was billed in, which is the
 * fact on the receipt. Converting is a display job, done here so a card can
 * show one figure in the chosen currency with the billed figure underneath.
 *
 * Kept for an hour. The table behind it only moves twice a day, and a rate a
 * few hours old is not a problem worth a request per page view.
 */
interface RateTable {
  base: string;
  rates: Record<string, number>;
  fetchedAt: string | null;
}

const ONE_HOUR = 60 * 60 * 1000;

/** Units of INR per unit of currency, matching the server's fallback table. */
const FALLBACK: Record<string, number> = { INR: 1, USD: 83, EUR: 90, GBP: 105 };

export function useExchangeRates() {
  const { data } = useQuery<RateTable>({
    queryKey: ["/api/exchange-rates"],
    staleTime: ONE_HOUR,
    gcTime: ONE_HOUR,
    // A page that cannot reach the rate table still has to render. Retrying
    // hard would only delay that, and the fallback is one line below.
    retry: 1,
  });

  const rates = data?.rates ?? FALLBACK;

  /**
   * Convert, or return null when there is nothing honest to show.
   *
   * Null rather than a number for a currency we hold no rate for -- including
   * the "UNKNOWN" the detector returns when a receipt printed no symbol at
   * all. Inventing a conversion for an unknown unit is exactly the guess the
   * detector was changed to stop making.
   */
  function convert(amount: number, from: string, to: string): number | null {
    if (!Number.isFinite(amount)) return null;
    const f = from?.toUpperCase();
    const t = to?.toUpperCase();
    if (!f || !t) return null;
    if (f === t) return amount;
    if (!rates[f] || !rates[t]) return null;
    return Math.round((amount * rates[f] / rates[t]) * 100) / 100;
  }

  return { convert, rates, fetchedAt: data?.fetchedAt ?? null };
}
