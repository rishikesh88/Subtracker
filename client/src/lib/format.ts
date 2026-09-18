/**
 * Display formatting shared across screens.
 */

/**
 * One category, not two.
 *
 * The categories are written by the model that reads the receipts, and it
 * hands back compound labels -- "Food Delivery / Membership", "Cloud Storage /
 * Software", "Entertainment/Software Bundle". Two categories joined by a slash
 * is not a category: it is the model hedging, and on a card it wraps to a
 * second line and makes that card taller than the ones beside it.
 *
 * The first part is taken as the answer, trailing filler like "Bundle" or
 * "Membership" is dropped, and the result is title-cased so "streaming" and
 * "Streaming" stop appearing side by side.
 *
 * This is display-only. The stored value is untouched, so nothing is lost and
 * fixing the model's prompt later needs no migration.
 */
const FILLER = new Set(["bundle", "membership", "subscription", "service", "plan", "other"]);

export function displayCategory(raw?: string | null): string | null {
  if (!raw) return null;

  const firstPart = raw.split(/[/|,\u2013\u2014]/)[0].trim();
  if (!firstPart) return null;

  const words = firstPart
    .split(/\s+/)
    .filter((word) => word && !FILLER.has(word.toLowerCase()));

  if (words.length === 0) return null;

  return words
    .map((word) =>
      // A capital anywhere but the first letter means the word is cased on
      // purpose -- SaaS, iCloud, YouTube, VPN. Title-casing those produces
      // "Saas" and "Icloud", which is worse than the inconsistency being
      // fixed. Only all-lower or all-upper words get normalised.
      /[A-Z]/.test(word.slice(1))
        ? word
        : word[0].toUpperCase() + word.slice(1).toLowerCase()
    )
    .join(" ");
}
