/**
 * Telling a bill apart from an ordinary transaction by the same merchant.
 *
 * The problem this solves, concretely: a Swiggy One membership and forty
 * takeaway orders all arrive from Swiggy, all say "Swiggy" in the sender, and
 * all carry a rupee amount. Matching on the merchant name alone -- which is
 * what the evidence search does -- pulls the food orders in alongside the
 * membership, and every one of them became an invoice in the archive.
 *
 * So an email only becomes an invoice if it looks like a bill for the thing
 * being tracked, not merely mail from the same company.
 *
 * This is a heuristic over subject lines and it will be wrong sometimes. It is
 * deliberately biased towards leaving an invoice out: a missing receipt is a
 * gap someone can fill by hand, while a receipt for last Tuesday's biryani
 * filed under a subscription is wrong in a way that makes the whole archive
 * untrustworthy.
 */

/** Words that mean "this is about money owed or paid for a service". */
const BILLING_TERMS = [
  "invoice", "receipt", "bill", "billed", "billing",
  "payment", "paid", "charged", "charge", "debited", "deducted",
  "subscription", "membership", "renew", "renewal", "renewed",
  "plan", "auto-pay", "autopay", "mandate", "recurring",
  "statement", "premium", "policy",
  // A card issuer's alert for the charge: "INR 2,255.68 spent on your card",
  // "Transaction alert". Evidence that a charge happened, even though the
  // merchant's name is not what sent it.
  "spent", "transaction",
];

/**
 * Words that mean "this is one purchase, not a subscription charge".
 *
 * Checked first and unconditionally: "Your Swiggy order invoice" contains a
 * billing term, and is still a food order.
 */
const ONE_OFF_TERMS = [
  "order", "ordered", "delivery", "delivered", "delivering",
  "out for", "on the way", "arriving", "dispatched", "shipped", "shipment",
  "tracking", "courier", "rider", "picked up",
  "refund", "refunded", "cancelled order", "returned",
  "booking", "booked", "ticket", "reservation",
  "cart", "wishlist", "offer", "deal", "coupon", "discount", "sale",
  "rate your", "how was", "feedback", "review your",
];

export interface BillingCandidate {
  subject?: string | null;
  /** The amount the sync extracted from this email, if it found one. */
  extractedAmount?: string | number | null;
}

export interface SubscriptionFacts {
  serviceName?: string | null;
  /** The subscription's own amount, used as a corroborating signal. */
  amount?: string | number | null;
  /**
   * This email carries a document the merchant actually attached.
   *
   * That is strong evidence on its own. A merchant that attaches a PDF to a
   * mail from its billing address has issued something, and demanding the
   * subject ALSO say "invoice" threw away real documents -- an insurance
   * policy whose subject is just the policy name was being dropped while its
   * PDF sat in storage.
   *
   * It does not override the one-off check. Food delivery and ticketing
   * attach invoices to every order, and those are exactly what must not be
   * filed under a subscription.
   */
  hasStoredDocument?: boolean;
}

function has(haystack: string, terms: string[]): string | null {
  return terms.find((term) => haystack.includes(term)) ?? null;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export interface BillingVerdict {
  isBill: boolean;
  /** Why, in a few words -- logged so a wrong call can be traced. */
  reason: string;
}

/**
 * Should this email become an invoice against this subscription?
 */
export function looksLikeBill(
  email: BillingCandidate,
  subscription: SubscriptionFacts = {}
): BillingVerdict {
  const subject = (email.subject ?? "").toLowerCase();

  if (!subject.trim()) {
    // No subject to judge by. The amount is the only evidence left.
    return amountMatches(email, subscription)
      ? { isBill: true, reason: "no subject, but the amount matches the subscription" }
      : { isBill: false, reason: "no subject and no matching amount" };
  }

  /*
   * The subscription's own name beats everything. "Swiggy One membership
   * renewed" names the thing being tracked; "Your Swiggy order is on the way"
   * does not. A service name of one word is no help here -- it is the
   * merchant name over again -- so only multi-word names count.
   */
  const serviceName = (subscription.serviceName ?? "").toLowerCase().trim();
  const namesTheService =
    serviceName.split(/\s+/).length > 1 && subject.includes(serviceName);

  const oneOff = has(subject, ONE_OFF_TERMS);
  if (oneOff && !namesTheService) {
    return { isBill: false, reason: `reads as a one-off: "${oneOff}"` };
  }

  const billing = has(subject, BILLING_TERMS);
  if (billing) {
    return { isBill: true, reason: `billing language: "${billing}"` };
  }

  if (namesTheService) {
    return { isBill: true, reason: "names the subscription itself" };
  }

  if (amountMatches(email, subscription)) {
    return { isBill: true, reason: "amount matches the subscription" };
  }

  // Nothing in the subject says "bill", but the merchant attached a document
  // and the subject did not read as a one-off. The document is the evidence.
  if (subscription.hasStoredDocument) {
    return { isBill: true, reason: "carries a document the merchant attached" };
  }

  return { isBill: false, reason: "no billing language, name or amount" };
}

/** The email's amount is the subscription's, within a rupee. */
function amountMatches(email: BillingCandidate, subscription: SubscriptionFacts): boolean {
  const a = toNumber(email.extractedAmount);
  const b = toNumber(subscription.amount);
  if (a === null || b === null || b === 0) return false;
  return Math.abs(a - b) < 1;
}
