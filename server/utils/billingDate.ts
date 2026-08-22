/**
 * Billing-date arithmetic shared by the suggestion and approval paths.
 *
 * The model extracts `nextBillingDate` from the text of a renewal email, so it
 * can return a date that was correct when the email was sent and is stale by
 * the time anyone looks at it -- a yearly notice read in August 2026 yields a
 * "next payment" date days later in 2026, not 2027. That date was previously
 * trusted unchanged, which put an already-past next-payment date on a live
 * subscription.
 *
 * The fallback path (last email + one period) never had this problem, which is
 * why only the model-supplied dates were wrong.
 */

/** Guards the roll-forward loop; weekly over a decade is ~520 steps. */
const MAX_PERIODS = 2000;

/**
 * Advance a date by one billing period. Unknown frequencies are treated as
 * monthly, matching the existing behaviour of every caller.
 */
export function advanceOnePeriod(date: Date, frequency: string | null | undefined): Date {
  const next = new Date(date);

  switch (frequency) {
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'quarterly':
      next.setMonth(next.getMonth() + 3);
      break;
    case 'yearly':
      next.setFullYear(next.getFullYear() + 1);
      break;
    case 'monthly':
    default:
      next.setMonth(next.getMonth() + 1);
      break;
  }

  return next;
}

/**
 * Roll a billing date forward until it is in the future.
 *
 * A date already in the future is returned untouched, so a correctly extracted
 * date keeps the exact day the provider stated rather than being recomputed.
 */
export function ensureFutureBillingDate(
  date: Date | null | undefined,
  frequency: string | null | undefined,
  now: Date = new Date()
): Date | null {
  if (!date || isNaN(date.getTime())) return null;

  let candidate = new Date(date);

  for (let i = 0; candidate.getTime() <= now.getTime() && i < MAX_PERIODS; i++) {
    candidate = advanceOnePeriod(candidate, frequency);
  }

  // Still stale only if the arithmetic could not move it -- treat as unknown
  // rather than surfacing a past date as if it were a scheduled payment.
  return candidate.getTime() > now.getTime() ? candidate : null;
}
