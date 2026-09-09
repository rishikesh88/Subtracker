import { convertCurrency } from './currencyConverter';

/**
 * Flags a pending suggestion that looks like something the user already tracks.
 *
 * #20. The 2026-08 mailbox produced "Anthropic Claude Subscription" at
 * INR 2,261.12 and "Claude Pro" at USD 23.60 -- one subscription, detected twice
 * under different names and different currencies. `serviceKey` cannot catch that
 * on its own: the names genuinely differ and neither is wrong.
 *
 * This **flags, it does not merge.** Wrongly merging two distinct subscriptions
 * is worse than showing both, and this account demonstrates how easily that
 * happens: iCloud+, "iCloud+ with 200 GB" and Apple One Family are three real
 * subscriptions sharing one merchant. So the output is advice for the review
 * screen, and the user still decides.
 */

/** Same amount within this much, after conversion. */
const AMOUNT_TOLERANCE = 0.2;

export interface DuplicateHint {
  /** The existing subscription this may duplicate. */
  subscriptionId: string;
  serviceName: string;
  amount: string;
  currency: string;
  /** Why it was flagged, shown to the user. */
  reason: string;
  confidence: 'exact' | 'likely';
}

interface ComparableSubscription {
  id: string;
  serviceName: string;
  serviceKey: string | null;
  merchantName: string | null;
  amount: string;
  currency: string;
  frequency: string;
}

interface ComparableSuggestion {
  serviceKey: string | null;
  serviceName: string;
  merchantName: string | null;
  amount: string;
  currency: string;
  frequency: string;
}

const normalise = (value: string | null | undefined) =>
  (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Amounts equal once converted to a common currency.
 *
 * The tolerance is deliberately loose. FX rates here come from a hardcoded
 * table (USD 83, EUR 90, GBP 105 to INR), which put the Claude pair 13% apart --
 * so a tight comparison would miss the very case this exists for. That is also
 * why amount is only ever a supporting signal below, never the deciding one.
 */
function amountsMatch(
  a: { amount: string; currency: string },
  b: { amount: string; currency: string }
): boolean {
  const left = parseFloat(a.amount);
  const right = parseFloat(b.amount);
  if (!isFinite(left) || !isFinite(right) || left <= 0 || right <= 0) return false;

  try {
    const rightInLeft = convertCurrency(right, b.currency || 'INR', a.currency || 'INR');
    const larger = Math.max(left, rightInLeft);
    return Math.abs(left - rightInLeft) <= larger * AMOUNT_TOLERANCE;
  } catch {
    return false;
  }
}

/**
 * Find an existing subscription that a suggestion may duplicate.
 *
 * Two rules, both requiring the same billing frequency — a monthly and a yearly
 * plan for one service are different subscriptions, not duplicates:
 *
 *   exact  — identical serviceKey. The same service at the same cadence.
 *   likely — same merchant, and an equivalent amount once converted. This is
 *            the cross-name, cross-currency case. Merchant alone is not enough,
 *            or every Apple subscription would flag every other.
 */
export function findDuplicateHint(
  suggestion: ComparableSuggestion,
  subscriptions: ComparableSubscription[]
): DuplicateHint | null {
  const asHint = (
    subscription: ComparableSubscription,
    reason: string,
    confidence: DuplicateHint['confidence']
  ): DuplicateHint => ({
    subscriptionId: subscription.id,
    serviceName: subscription.serviceName,
    amount: subscription.amount,
    currency: subscription.currency,
    reason,
    confidence,
  });

  const sameFrequency = subscriptions.filter(
    s => normalise(s.frequency) === normalise(suggestion.frequency)
  );

  const exact = sameFrequency.find(
    s => s.serviceKey && suggestion.serviceKey && s.serviceKey === suggestion.serviceKey
  );
  if (exact) {
    return asHint(exact, `You already track ${exact.serviceName}`, 'exact');
  }

  const merchant = normalise(suggestion.merchantName);
  if (!merchant) return null;

  const likely = sameFrequency.find(
    s => normalise(s.merchantName) === merchant && amountsMatch(suggestion, s)
  );
  if (likely) {
    return asHint(
      likely,
      `Same merchant and a similar amount to ${likely.serviceName} (${likely.currency} ${likely.amount})`,
      'likely'
    );
  }

  return null;
}
