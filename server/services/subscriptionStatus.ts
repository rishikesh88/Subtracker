/**
 * Records payments and works out each subscription's status, quietly.
 *
 * Everything here runs only for users with the `subscription_status` feature
 * switch on, and every entry point checks that itself. For anyone else each
 * function returns at once having read nothing and written nothing, so their
 * app is exactly what it was.
 *
 * Nothing here is shown to users yet; the screens come later. It exists so
 * the numbers can be compared with real inboxes (in the admin console) before
 * anyone sees them.
 *
 * The recording hooks (after approval, after a sync) never throw: a failure is
 * logged and swallowed, because a sync or an approval must never break over
 * bookkeeping nobody can see yet.
 */

import { storage, type ApprovedForStatus, type PaymentSourceEmail } from "../storage";
import { isEnabled } from "../lib/featureFlags";
import { generateServiceKey } from "../utils/serviceKey";
import {
  computeLifecycle,
  countedPayments,
  creditCardEmailIds,
  decideReread,
  explainPayments,
  dayString,
  parseLooseDay,
  paymentFromEmail,
  reconcileBills,
  stillActiveUntil,
  REASON_TEXT,
  type LifecycleReason,
  type PaymentSource,
} from "../lib/statusRules";
import type { InsertPayment, Subscription, Payment } from "@shared/schema";
import { historyDetails, historyLabel } from "../lib/historySearchRules";
import { fingerprintSecret, planBankCleanup, storedFilePaths } from "../lib/bankAlert";
import { ObjectStorageService } from "../objectStorage";
import { userPaymentView, historyState, reviewReason, type UserPayment } from "../lib/statusView";

export const STATUS_FEATURE = "subscription_status";

export function statusEnabledFor(userId: string): Promise<boolean> {
  return isEnabled(userId, STATUS_FEATURE);
}

// ---------------------------------------------------------------------------
// Payments from emails
// ---------------------------------------------------------------------------

/** Payment rows for one subscription from the emails linked to it. */
export function paymentsFromEmails(
  userId: string,
  subscription: { id: string; currency: string },
  emails: PaymentSourceEmail[],
  source: PaymentSource,
  now: Date,
): InsertPayment[] {
  const rows: InsertPayment[] = [];
  for (const email of emails) {
    const fields = paymentFromEmail(email, subscription.currency, now);
    if (!fields) continue;
    rows.push({ userId, subscriptionId: subscription.id, emailId: email.id, ...fields, source });
  }
  return rows;
}

/**
 * Store a cancellation read from an email. A newer cancellation replaces an
 * older one (someone who cancelled, came back and cancelled again); an older
 * one never overwrites a newer.
 */
export async function applyCancellation(
  userId: string,
  subscriptionId: string,
  current: { cancelledAt: string | null; endsOn: string | null } | null,
  cancelledOn: string | null,
  accessEndsOn: string | null,
): Promise<void> {
  if (!cancelledOn && !accessEndsOn) return;
  const incoming = cancelledOn ?? accessEndsOn!;
  const existing = current?.cancelledAt ?? current?.endsOn ?? null;
  if (existing && incoming < existing) return;
  await storage.updateSubscriptionStatusFields(subscriptionId, userId, {
    cancelledAt: cancelledOn,
    endsOn: accessEndsOn,
  });
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** After suggestions are approved: record their evidence as payments, carry over any cancellation, recompute. */
export async function recordAfterApproval(userId: string, approved: ApprovedForStatus[], now = new Date()): Promise<void> {
  try {
    if (approved.length === 0 || !(await statusEnabledFor(userId))) return;

    const subs = new Map((await storage.getSubscriptions(userId)).map((s) => [s.id, s]));
    let recorded = 0;
    for (const item of approved) {
      const sub = subs.get(item.subscriptionId);
      if (!sub) continue;
      const emails = await storage.getEmailsForPayments(userId, item.evidenceEmailIds);
      recorded += await storage.insertPayments(paymentsFromEmails(userId, { id: sub.id, currency: sub.currency }, emails, "approval", now));
      if (item.approvedName) await storage.rememberSubscriptionName(userId, sub.id, item.approvedName, "approval");
      await applyCancellation(userId, sub.id, sub, item.cancelledOn, item.accessEndsOn);
    }
    console.log(`[Status] Approval: ${recorded} payment(s) recorded for ${approved.length} subscription(s)`);
    await recomputeForUser(userId, now);
  } catch (error) {
    console.error("[Status] Recording after approval failed (non-fatal):", error);
  }
}

/**
 * After a subscription is renamed: remember the name it had, so a later
 * history search can still look for it. Only for users with the switch on;
 * never throws.
 */
export async function rememberOldName(
  userId: string,
  subscriptionId: string,
  oldName: string | null | undefined,
  newName: string | null | undefined,
): Promise<void> {
  try {
    const before = (oldName ?? "").trim();
    if (!before || before.toLowerCase() === (newName ?? "").trim().toLowerCase()) return;
    if (!(await statusEnabledFor(userId))) return;
    await storage.rememberSubscriptionName(userId, subscriptionId, before, "rename");
  } catch (error) {
    console.error("[Status] Could not remember an old name (non-fatal):", error);
  }
}

/** One detection from a sync, as the recorder needs it. */
export interface SyncDetection {
  serviceName: string;
  frequency: string;
  evidenceGmailIds: string[];
  cancelledOn: string | null;
  accessEndsOn: string | null;
}

/**
 * After one mailbox's analysis: when a detection is about a subscription the
 * person already tracks, record its evidence emails as payments and store any
 * cancellation. Nothing else changes -- the suggestion still goes to the
 * review inbox exactly as before, and emails are not re-linked.
 */
export async function recordFromSync(userId: string, detections: SyncDetection[], now = new Date()): Promise<void> {
  try {
    if (detections.length === 0 || !(await statusEnabledFor(userId))) return;

    const subs = new Map((await storage.getSubscriptions(userId)).map((s) => [s.id, s]));
    let matched = 0;
    let recorded = 0;
    for (const detection of detections) {
      const match = await storage.findSubscriptionForDetection(
        userId,
        detection.serviceName,
        generateServiceKey(detection.serviceName, detection.frequency),
        detection.frequency,
      );
      if (!match) continue;
      matched++;
      const emails = await storage.getEmailsForPayments(userId, detection.evidenceGmailIds);
      recorded += await storage.insertPayments(paymentsFromEmails(userId, match, emails, "sync", now));
      const sub = subs.get(match.id) ?? null;
      await applyCancellation(userId, match.id, sub, detection.cancelledOn, detection.accessEndsOn);
      if (sub && (detection.cancelledOn || detection.accessEndsOn)) {
        // Keep the in-memory copy current for a second detection of the same one.
        sub.cancelledAt = detection.cancelledOn;
        sub.endsOn = detection.accessEndsOn;
      }
    }
    console.log(`[Status] Sync: ${matched} detection(s) matched tracked subscriptions, ${recorded} payment(s) recorded`);
  } catch (error) {
    console.error("[Status] Recording from sync failed (non-fatal):", error);
  }
}

/** After a whole sync finishes. */
export async function recomputeAfterSync(userId: string, now = new Date()): Promise<void> {
  try {
    if (!(await statusEnabledFor(userId))) return;
    await recomputeForUser(userId, now);
  } catch (error) {
    console.error("[Status] Recompute after sync failed (non-fatal):", error);
  }
}

/** Dates as the rules read them; a timestamp is reduced to its day. */
function day(value: Date | string | null | undefined): string | null {
  return dayString(value as any);
}

/**
 * Recompute and store the status of every subscription this user has.
 * Callers check the switch; this does not.
 *
 * Emails linked to a subscription before the switch was on are recorded
 * first (source 'history'), so switching someone on gives them a status from
 * what the app already knows rather than from nothing.
 */
export async function recomputeForUser(userId: string, now = new Date(), onlyIds?: string[]): Promise<void> {
  const history = await storage.getLinkedEmailsWithoutPayments(userId);
  if (history.length > 0) {
    const bySub = new Map<string, typeof history>();
    for (const email of history) {
      const list = bySub.get(email.subscriptionId) ?? [];
      list.push(email);
      bySub.set(email.subscriptionId, list);
    }
    let recorded = 0;
    for (const [subscriptionId, emails] of Array.from(bySub.entries())) {
      recorded += await storage.insertPayments(
        paymentsFromEmails(userId, { id: subscriptionId, currency: emails[0].subscriptionCurrency }, emails, "history", now),
      );
    }
    if (recorded > 0) console.log(`[Status] Recorded ${recorded} payment(s) from earlier linked emails`);
  }

  const [subs, allPayments, mailboxes] = await Promise.all([
    storage.getSubscriptions(userId),
    storage.getPaymentsForUser(userId),
    storage.getMailboxHealth(userId),
  ]);

  const paymentsBySub = new Map<string, Payment[]>();
  for (const p of allPayments) {
    const list = paymentsBySub.get(p.subscriptionId) ?? [];
    list.push(p);
    paymentsBySub.set(p.subscriptionId, list);
  }

  const healthy = mailboxes.filter((m) => m.syncStatus !== "error");
  const userLevelSynced = healthy.reduce<Date | null>((latest, m) => {
    if (!m.lastSync) return latest;
    const d = new Date(m.lastSync);
    return !latest || d > latest ? d : latest;
  }, null);

  for (const sub of subs) {
    if (onlyIds && !onlyIds.includes(sub.id)) continue;

    // The subscription's own mailbox when it is known; otherwise any.
    const own = mailboxes.find((m) => m.id === (sub.providerAccountId ?? sub.gmailAccountId));
    const inboxConnected = own ? own.syncStatus !== "error" : healthy.length > 0;
    const inboxSyncedThrough = own ? (own.syncStatus !== "error" ? own.lastSync : null) : userLevelSynced;

    const result = computeLifecycle(
      {
        frequency: sub.frequency,
        payments: (paymentsBySub.get(sub.id) ?? []).map((p) => ({
          paidAt: p.paidAt,
          amount: p.amount,
          currency: p.currency,
          kind: p.kind,
          pausedUntil: p.pausedUntil,
          dueOn: p.dueOn,
        })),
        cancellation: sub.cancelledAt || sub.endsOn ? { cancelledAt: sub.cancelledAt, endsOn: sub.endsOn } : null,
        overrides: {
          markedInactiveAt: sub.inactiveSource === "user" ? sub.inactiveSince : null,
          stillActiveTaps: sub.stillActiveTaps,
          stillActiveUntil: sub.stillActiveUntil,
        },
        inboxConnected,
        inboxSyncedThrough,
      },
      now,
    );

    await storage.updateSubscriptionStatusFields(sub.id, userId, {
      lifecycleStatus: result.status,
      lifecycleReason: result.reason,
      lifecycleUpdatedAt: now,
      lastPaymentAt: result.lastPaymentAt,
      expectedNextPaymentAt: result.expectedNextAt,
      inactiveSince: result.inactiveSince,
      inactiveSource: result.inactiveSource,
    });
  }
}

/**
 * Reads the stored emails behind payments saved at an approval or a sync
 * again with today's rules, for these subscriptions. A payment whose reading
 * changed is updated; one that is no longer a payment is deleted. Emails and
 * payments without an email are never touched. The lifecycle of the
 * subscriptions is recomputed afterwards. Callers check the switch.
 */
export async function rereadStoredPayments(
  userId: string,
  subscriptionIds: string[],
  now = new Date(),
): Promise<{ checked: number; changed: number; removed: number }> {
  const stored = await storage.getStoredPaymentsWithEmails(userId, subscriptionIds);
  const updates: { id: string; fields: Partial<InsertPayment> }[] = [];
  const removeIds: string[] = [];
  for (const { payment, email, subscriptionCurrency } of stored) {
    const decision = decideReread(payment, paymentFromEmail(email, subscriptionCurrency, now));
    if (decision.action === "remove") removeIds.push(payment.id);
    else if (decision.action === "update") updates.push({ id: payment.id, fields: decision.fields });
  }
  await storage.applyPaymentRereads(userId, updates, removeIds);
  if (subscriptionIds.length > 0) await recomputeForUser(userId, now, subscriptionIds);
  return { checked: stored.length, changed: updates.length, removed: removeIds.length };
}

/** One-time clean-up: deletes this person's stored credit card emails and the payments read from them. */
export async function removeStoredCreditCardEmails(userId: string): Promise<{ emails: number; payments: number }> {
  const ids = creditCardEmailIds(await storage.getEmailsForCreditCardCheck(userId));
  const removed = await storage.deleteEmailsWithPayments(userId, ids);
  if (removed.emails > 0 || removed.payments > 0) await recomputeForUser(userId);
  return removed;
}

export interface BankCleanupResult {
  emails: number;
  /** Payments deleted with their emails (the card alerts among them were kept as fingerprinted rows first). */
  payments: number;
  /** Card alerts kept as payment records without an email. */
  kept: number;
  files: number;
  /** Files that could not be deleted (they stay in storage; the emails are removed anyway). */
  fileFailures: number;
  invoices: number;
  suggestionsCleared: number;
}

/**
 * One-time, admin-run clean-up of a person's stored bank and card emails.
 * Callers check the switch.
 *
 *  a. a card alert's payment (with an amount) is first kept as a fingerprinted
 *     payment without an email, so payment history is not lost;
 *  b. the files named in the emails' attachment data are deleted from object
 *     storage (and any invoice filed from them);
 *  c. the payments pointing at the emails, then the emails, are deleted;
 *  d. suggestions that cited them lose the model-written notes (reasoning,
 *     sender history, attachment evidence) and the ids from their evidence list.
 *
 * Nothing is deleted if the fingerprint secret is missing.
 */
export async function removeStoredBankEmails(userId: string): Promise<BankCleanupResult> {
  const secret = fingerprintSecret();
  if (!secret) throw new Error("No fingerprint secret: set EVIDENCE_FINGERPRINT_SECRET (or SESSION_SECRET) first.");
  const rows = await storage.getEmailsForBankCheck(userId);
  // Selected first (cheap), payments looked up for those only.
  const preliminary = planBankCleanup(rows, [], secret);
  const result: BankCleanupResult = { emails: 0, payments: 0, kept: 0, files: 0, fileFailures: 0, invoices: 0, suggestionsCleared: 0 };
  if (preliminary.emailIds.length === 0) return result;

  const theirPayments = await storage.getPaymentsForEmailIds(userId, preliminary.emailIds);
  const plan = planBankCleanup(rows, theirPayments, secret);
  result.kept = await storage.insertFingerprintedPayments(plan.replacements);

  const paths = new Set<string>();
  await storage.forEachAttachmentData(userId, plan.emailIds, (data) => {
    for (const path of storedFilePaths(data)) paths.add(path);
  });
  const objectStorage = new ObjectStorageService();
  const deleted: string[] = [];
  for (const path of Array.from(paths)) {
    try {
      await objectStorage.deleteObjectEntity(path);
      deleted.push(path);
    } catch (error) {
      result.fileFailures++;
      console.error("[Admin] Could not delete a stored file (non-fatal):", (error as Error).message);
    }
  }
  result.files = deleted.length;
  result.invoices = await storage.deleteInvoicesByFileUrls(userId, deleted);

  // Notes first: they are matched by the ids the emails carry.
  result.suggestionsCleared = await storage.clearSuggestionsCiting(userId, plan.messageIds);
  const removed = await storage.deleteEmailsWithPayments(userId, plan.emailIds);
  result.emails = removed.emails;
  result.payments = removed.payments;
  await recomputeForUser(userId);
  return result;
}

// ---------------------------------------------------------------------------
// The person's own answers (API for the later screens)
// ---------------------------------------------------------------------------

/** "Still active": one more tap, held until two periods after the next expected payment. */
export async function markStillActive(sub: Subscription, now = new Date()): Promise<Subscription | undefined> {
  await storage.updateSubscriptionStatusFields(sub.id, sub.userId, {
    stillActiveTaps: (sub.stillActiveTaps ?? 0) + 1,
    stillActiveUntil: stillActiveUntil(sub.frequency, sub.lastPaymentAt, now),
  });
  await recomputeForUser(sub.userId, now, [sub.id]);
  return storage.getSubscription(sub.id);
}

export async function markInactive(sub: Subscription, now = new Date()): Promise<Subscription | undefined> {
  await storage.updateSubscriptionStatusFields(sub.id, sub.userId, {
    inactiveSince: day(now),
    inactiveSource: "user",
  });
  await recomputeForUser(sub.userId, now, [sub.id]);
  return storage.getSubscription(sub.id);
}

/** Clears the person's own "inactive". A cancellation read from email still applies. */
export async function markActive(sub: Subscription, now = new Date()): Promise<Subscription | undefined> {
  if (sub.inactiveSource === "user") {
    await storage.updateSubscriptionStatusFields(sub.id, sub.userId, { inactiveSince: null, inactiveSource: null });
  }
  await recomputeForUser(sub.userId, now, [sub.id]);
  return storage.getSubscription(sub.id);
}

// ---------------------------------------------------------------------------
// What the person's own screens read
// ---------------------------------------------------------------------------

function asRules(rows: Payment[]) {
  return rows.map((p) => ({ paidAt: p.paidAt, dueOn: p.dueOn, amount: p.amount, currency: p.currency, kind: p.kind }));
}

/**
 * The detail panel's Payments list for one subscription: counted payments
 * only, with a date, amount, currency and a source label. No email subjects or
 * bodies, no email ids, and no record that is not a counted payment.
 */
export async function paymentViewFor(sub: Subscription, now = new Date()) {
  const [rows, mailboxes] = await Promise.all([
    storage.getPaymentsForSubscription(sub.id, sub.userId),
    storage.getMailboxHealth(sub.userId),
  ]);
  const view = userPaymentView(asRules(rows), sub.currency, now, sub.lifecycleReason === "payment_failed");
  const own = mailboxes.find((m) => m.id === (sub.providerAccountId ?? sub.gmailAccountId));
  return {
    payments: view.payments,
    some_bills_only: view.someBillsOnly,
    payment_failed_on: view.failedOn,
    history_state: historyState(sub, own ? own.syncStatus === "error" : false),
    searched_since: sub.historySearchedSince ? day(sub.historySearchedSince) : null,
  };
}

/** One "Still paying?" question for the review inbox. */
export interface PaymentReview {
  id: string;
  service_name: string;
  merchant_email: string | null;
  amount: string;
  currency: string;
  frequency: string;
  category: string | null;
  last_payment_at: string | null;
  /** When it was flagged, so the inbox can sort newest first. */
  flagged_at: string | null;
  reason: string;
  /** The latest few counted payments: the evidence, without any email text. */
  recent_payments: UserPayment[];
}

/** Every subscription of this user that is waiting on "Still paying?". */
export async function paymentReviewsFor(userId: string, now = new Date()): Promise<PaymentReview[]> {
  const waiting = (await storage.getSubscriptions(userId)).filter((s) => s.lifecycleStatus === "needs_review");
  if (waiting.length === 0) return [];
  const ids = new Set(waiting.map((s) => s.id));
  const all = (await storage.getPaymentsForUser(userId)).filter((p) => ids.has(p.subscriptionId));
  return waiting.map((sub) => {
    const mine = all.filter((p) => p.subscriptionId === sub.id);
    const view = userPaymentView(asRules(mine), sub.currency, now, false);
    return {
      id: sub.id,
      service_name: sub.serviceName,
      merchant_email: sub.merchantEmail,
      amount: String(sub.amount),
      currency: sub.currency,
      frequency: sub.frequency,
      category: sub.category,
      last_payment_at: day(sub.lastPaymentAt),
      flagged_at: sub.lifecycleUpdatedAt ? new Date(sub.lifecycleUpdatedAt).toISOString() : null,
      reason: reviewReason(sub.serviceName, sub.frequency, sub.lastPaymentAt),
      recent_payments: view.payments.slice(0, 3),
    };
  });
}

// ---------------------------------------------------------------------------
// Admin console
// ---------------------------------------------------------------------------

/** One row per subscription for the admin person view. Read only. */
export async function statusRowsForAdmin(userId: string) {
  const [subs, allPayments] = await Promise.all([
    storage.getSubscriptions(userId),
    storage.getPaymentsForUser(userId),
  ]);
  const subjects = await storage.getEmailSubjects(
    userId,
    allPayments.map((p) => p.emailId).filter((id): id is string => !!id),
  );
  return subs
    .map((sub) => {
      const mine = allPayments.filter((p) => p.subscriptionId === sub.id);
      const asRules = mine.map((p) => ({ paidAt: p.paidAt, dueOn: p.dueOn, amount: p.amount, currency: p.currency, kind: p.kind }));
      const counted = countedPayments(asRules, sub.currency);
      const now = new Date();
      const bills = reconcileBills(asRules, now, sub.currency);
      const why = explainPayments(asRules, now, sub.currency);
      // Every record, newest first. Subject lines only, cut short; no email bodies.
      const payment_list = mine
        .map((p, i) => ({
          paid_at: String(p.paidAt),
          kind: p.kind,
          document_type: p.documentType ?? null,
          paid_status: p.paidStatus ?? null,
          due_on: p.dueOn ? String(p.dueOn) : null,
          counted: why[i].counted,
          note: why[i].note,
          amount: p.amount === null || p.amount === undefined ? null : String(p.amount),
          currency: p.currency ?? null,
          source: p.source,
          subject: p.emailId ? (subjects.get(p.emailId) ?? "").slice(0, 120) || null : null,
          // A bank alert read and discarded: no email behind it, only date, amount and currency.
          discarded: !!p.evidenceFingerprint,
        }))
        .sort((a, b) => b.paid_at.localeCompare(a.paid_at));
      const reason = sub.lifecycleReason as LifecycleReason | null;
      return {
        id: sub.id,
        service_name: sub.serviceName,
        frequency: sub.frequency,
        lifecycle_status: sub.lifecycleStatus,
        reason: reason ? REASON_TEXT[reason] ?? reason : null,
        last_payment_at: sub.lastPaymentAt,
        expected_next_payment_at: sub.expectedNextPaymentAt,
        ends_on: sub.endsOn,
        inactive_since: sub.inactiveSince,
        inactive_source: sub.inactiveSource,
        still_active_taps: sub.stillActiveTaps ?? 0,
        payments_counted: counted.length,
        payments_recorded: mine.length,
        payment_list,
        updated_at: sub.lifecycleUpdatedAt,
        history_status: sub.historyStatus,
        history_label: historyLabel(sub),
        history_details: historyDetails(sub, bills.noReceipt.length),
        bills_no_receipt: bills.noReceipt.length,
        last_bill_at: bills.noReceipt.length + bills.open.length > 0
          ? day(new Date(Math.max(...[...bills.noReceipt, ...bills.open].map((b) => b.day.getTime()))))
          : null,
      };
    })
    .sort((a, b) => a.service_name.localeCompare(b.service_name));
}

/** A cancellation date from the detector, checked and reduced to a day. */
export function cancellationDay(value: unknown): string | null {
  return typeof value === "string" ? parseLooseDay(value) : null;
}
