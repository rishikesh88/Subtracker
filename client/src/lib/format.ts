/**
 * Display formatting shared across screens.
 */

/**
 * Which filter segment a subscription's raw status belongs to.
 *
 * Two buckets behind three segments: All, Active, Expired. The design draws
 * four, but the extra two were both dead here. "Review" counts a status no
 * subscription in this app can hold -- unmatched charges are suggestions and
 * live in the review inbox, which the banner and the sidebar both link to --
 * and "Ending soon" read 0 for every real account. A filter nobody can ever
 * use is worse than one segment fewer.
 *
 * expiring_soon counts as active: it is still running, which is what someone
 * filtering for "Active" means.
 */
export function filterBucket(status: string): "active" | "expired" {
  if (status === "cancelled" || status === "ended") return "expired";
  return "active";
}

/** Status badge class + label for a subscription card, per the design system's
 *  status mapping (active / needs review / trial / cancelled). */
export function statusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case "active":
      return { label: "Active", cls: "status-active" };
    case "trial":
      return { label: "Trial", cls: "status-trial" };
    case "expiring_soon":
    case "needs_review":
    case "pending":
      return { label: "Needs review", cls: "status-review" };
    case "cancelled":
    case "ended":
      return { label: "Cancelled", cls: "status-cancelled" };
    default:
      return { label: status, cls: "status-active" };
  }
}

export const FREQUENCY_LABEL: Record<string, string> = {
  monthly: "Monthly",
  yearly: "Yearly",
  weekly: "Weekly",
  quarterly: "Quarterly",
};

export const FREQUENCY_SUFFIX: Record<string, string> = {
  monthly: "/mo",
  yearly: "/yr",
  weekly: "/wk",
  quarterly: "/qtr",
};

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

/** Currency formatting shared by the metric strip and subscription cards. */
export function formatCurrency(amount: number, currency: string = "INR"): string {
  const validCurrency = currency && currency.length === 3 && currency !== "unknown"
    ? currency.toUpperCase()
    : "INR";

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: validCurrency,
    }).format(amount);
  } catch (error) {
    // If currency is still invalid, fallback to INR
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "INR",
    }).format(amount);
  }
}

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
