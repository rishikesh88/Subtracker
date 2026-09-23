// Rates live in exchangeRates.ts, which refreshes them from a live service
// and keeps a fallback for when that service is unreachable. This file is the
// arithmetic only.
import { ratesToInr, SUPPORTED_CURRENCIES } from '../lib/exchangeRates';

/**
 * Convert an amount between currencies at today's rate, or return null.
 *
 * Null is the important part. This used to fall back to the rupee rate for
 * any currency it did not recognise, which meant an account set to AED got
 * its rupee total back with the letters changed -- "AED 7,689.82" for what
 * was really ₹7,689.82, a number roughly twelve times too large. Silently
 * relabelling money is worse than refusing, because nothing on screen looks
 * wrong.
 *
 * Callers must decide what to show when the answer is null. Showing the
 * amount in the currency it was billed in is almost always right.
 */
export function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string = 'INR'
): number | null {
  if (!Number.isFinite(amount) || amount < 0) return null;

  const from = (fromCurrency || '').toUpperCase();
  const to = (toCurrency || '').toUpperCase();
  if (!from || !to) return null;

  if (from === to) return amount;

  const rates = ratesToInr();
  const fromRate = rates[from];
  const toRate = rates[to];
  if (!fromRate || !toRate) return null;

  const inInr = amount * fromRate;
  return Math.round((inInr / toRate) * 100) / 100;
}

/**
 * Convert a list, marking the ones that could not be converted.
 *
 * `convertedAmount` is null where no rate was available, so a caller cannot
 * accidentally treat an unconverted figure as converted.
 */
export function convertSubscriptions(
  subscriptions: Array<{ amount: string; currency: string; [key: string]: any }>,
  toCurrency: string = 'INR'
) {
  return subscriptions.map(subscription => {
    const originalAmount = parseFloat(subscription.amount);
    const convertedAmount = convertCurrency(originalAmount, subscription.currency, toCurrency);

    return {
      ...subscription,
      convertedAmount,
      displayCurrency: convertedAmount === null ? subscription.currency : toCurrency,
    };
  });
}

/** Name and symbol for each currency, keyed by code. */
const CURRENCY_META: Record<string, { name: string; symbol: string }> = {
  INR: { name: 'Indian Rupee', symbol: '₹' },
  USD: { name: 'US Dollar', symbol: '$' },
  EUR: { name: 'Euro', symbol: '€' },
  GBP: { name: 'British Pound', symbol: '£' },
  AED: { name: 'UAE Dirham', symbol: 'AED' },
  CAD: { name: 'Canadian Dollar', symbol: 'CA$' },
  AUD: { name: 'Australian Dollar', symbol: 'A$' },
  JPY: { name: 'Japanese Yen', symbol: '¥' },
  CNY: { name: 'Chinese Yuan', symbol: '¥' },
  SGD: { name: 'Singapore Dollar', symbol: 'S$' },
};

/**
 * The currencies a person can pick.
 *
 * Derived from the same list the rate fetcher asks for, so the picker and the
 * rate table cannot drift apart. A currency offered here but missing from
 * there is the bug that put a dirham sign on a rupee total.
 */
export function getSupportedCurrencies(): Array<{ code: string; name: string; symbol: string }> {
  return SUPPORTED_CURRENCIES.map((code) => ({
    code,
    name: CURRENCY_META[code]?.name ?? code,
    symbol: CURRENCY_META[code]?.symbol ?? code,
  }));
}
