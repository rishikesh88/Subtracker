/**
 * The admin console.
 *
 * A private operator tool for answering two questions during the beta: who has
 * signed up, and is the app actually working for them. It is not linked from
 * anywhere in the app and it is not part of the React bundle -- it is plain
 * server-rendered HTML on its own routes, with its own sign-in.
 *
 * Read and delete only. There is deliberately no way to edit a user's data
 * from here: an operator slip should not be able to quietly corrupt somebody's
 * account, and every read path here selects counts and timestamps rather than
 * mailbox tokens.
 *
 * The one thing it does change is feature switches (Features): which users
 * get a gated feature. Those are the console's own settings rather than
 * anyone's data, and every change to them is written to feature_flag_audit.
 *
 * Mounted only when ADMIN_EMAIL and ADMIN_PASSWORD_HASH are both set. Without
 * them these routes do not exist at all and /admin falls through to the app's
 * normal not-found handling, so an unconfigured deploy does not announce that
 * a console is there to attack.
 */

import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { storage } from "../storage";
import {
  adminConfigProblem,
  verifyAdminCredentials,
  issueAdminCookie,
  clearAdminCookie,
  isAdminSignedIn,
  requireAdmin,
  requireAdminCsrf,
  csrfTokenFor,
} from "../lib/adminAuth";
import { loginPage, consolePage, microsoftPage } from "./adminConsoleHtml";
import { checkMicrosoftConfig, relatedVariableNames } from "../lib/microsoftConfigCheck";
import { APP_BASE_URL } from "../config";
// One definition of "what is running", shared with /healthz rather than a
// second copy here that can drift from it.
import { buildInfo } from "../lib/buildInfo";
import {
  decide,
  invalidateFeatureFlags,
  isRollout,
  isValidFeatureKey,
  normaliseTags,
} from "../lib/featureFlags";
import { STATUS_FEATURE, statusRowsForAdmin, statusEnabledFor, rereadStoredPayments, removeStoredCreditCardEmails, removeStoredBankEmails, removeDuplicateInvoices, type DuplicateInvoiceResult } from "../services/subscriptionStatus";
import { queueAllForUser, queueHistorySearch } from "../services/historySearch";
import { renewalChecksEnabled } from "../lib/renewalChecks";

/**
 * Sends an admin page, uncacheable.
 *
 * Two reasons it must never be stored. It is a signed-in page carrying a CSRF
 * token and whoever is logged in, so it has no business in a shared cache or
 * restored from the back-forward cache after signing out. And without any
 * cache header at all a browser is free to reuse it, which is how a deploy can
 * ship and the operator still be looking at the previous page.
 */

function sendAdminPage(res: any, html: string, status = 200) {
  res
    .status(status)
    .set("Cache-Control", "no-store, must-revalidate")
    .set("Pragma", "no-cache")
    .type("html")
    .send(html);
}

/**
 * Deliberately tighter than the app's own login limiter. There is exactly one
 * person who should ever reach this form, so five tries in fifteen minutes is
 * generous for them and useless to anyone else.
 */
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    sendAdminPage(res, loginPage({ error: "Too many attempts. Try again in fifteen minutes." }), 429);
  },
});

/** Postgres returns count() as a string over the wire. */
function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const USER_COUNT_FIELDS = [
  "gmail_accounts",
  "outlook_accounts",
  "mailboxes_in_error",
  "subscriptions",
  "pending_suggestions",
  "invoices",
  "invoices_with_file",
  "emails",
] as const;

function normaliseUserRow(row: any) {
  const out: any = { ...row };
  for (const field of USER_COUNT_FIELDS) out[field] = toNumber(row[field]);
  out.email_verified = Boolean(row.email_verified);
  return out;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Health figures the console shows across the top.
 *
 * "Quiet over a week" is the one worth explaining. While the app is in Google's
 * testing mode a refresh token expires after seven days, and the only visible
 * symptom is that a mailbox silently stops syncing. The expiry itself is not
 * stored anywhere, so a mailbox that connected but has not synced in a week is
 * the closest honest proxy for it -- and it is the number that says "somebody
 * needs to reconnect" before they email to ask why nothing is updating.
 */
function summarise(users: any[]) {
  const now = Date.now();
  const since = (value: any) => (value ? now - new Date(value).getTime() : Infinity);

  let withMailbox = 0;
  let syncedLast7Days = 0;
  let quietOver7Days = 0;
  let mailboxesInError = 0;
  let activeSubscriptions = 0;
  let invoices = 0;
  let invoicesWithoutFile = 0;
  let verified = 0;

  for (const user of users) {
    const mailboxes = user.gmail_accounts + user.outlook_accounts;
    if (user.email_verified) verified++;
    if (mailboxes > 0) {
      withMailbox++;
      if (since(user.last_mailbox_sync) <= SEVEN_DAYS_MS) syncedLast7Days++;
      else quietOver7Days++;
    }
    mailboxesInError += user.mailboxes_in_error;
    activeSubscriptions += user.subscriptions;
    invoices += user.invoices;
    invoicesWithoutFile += user.invoices - user.invoices_with_file;
  }

  return {
    users: users.length,
    verified,
    withMailbox,
    syncedLast7Days,
    quietOver7Days,
    mailboxesInError,
    activeSubscriptions,
    invoices,
    invoicesWithoutFile,
  };
}

/**
 * Writes a deletion to the server log.
 *
 * One line, one JSON object, so it can be found in Railway's logs by searching
 * for the marker. It is not a database table: the schema tool is currently
 * blocked by pre-existing drift, and a console that cannot be deployed is
 * worth less than one whose audit trail lives in the logs. If the trail needs
 * to outlive log retention, that is a small table to add later.
 */
function recordDeletion(action: string, user: any, result: any) {
  console.log(
    `ADMIN_ACTION ${JSON.stringify({
      action,
      at: new Date().toISOString(),
      by: process.env.ADMIN_EMAIL,
      userId: user.id,
      userEmail: user.email,
      filesDeleted: result.filesDeleted,
      grantsRevoked: result.grantsRevoked,
      rowsDeleted: result.rowsDeleted,
    })}`
  );
}

function describe(result: any, verb: string): string {
  const rows = result.rowsDeleted ?? {};
  const parts = [
    `${rows.subscriptions ?? 0} subscription${rows.subscriptions === 1 ? "" : "s"}`,
    `${rows.invoices ?? 0} invoice${rows.invoices === 1 ? "" : "s"}`,
    `${result.filesDeleted ?? 0} stored file${result.filesDeleted === 1 ? "" : "s"}`,
  ];
  const revoked = result.grantsRevoked
    ? ` Mailbox access was withdrawn at Google for ${result.grantsRevoked} connection${
        result.grantsRevoked === 1 ? "" : "s"
      }.`
    : "";
  return `${verb} Removed ${parts.join(", ")}.${revoked}`;
}

// --- Feature switches ---------------------------------------------------

/** Who made a change, for the audit trail. There is one admin. */
function adminActor(): string {
  return process.env.ADMIN_EMAIL || "admin";
}

/**
 * The editable details of a switch from a request body, or the reason they
 * are refused. `current` is given for an edit, so a field left out keeps its
 * value; for a create every field is required except description and tags.
 */
function readFeatureDetails(
  body: any,
  current?: { name: string; description: string; tags: string[] }
): { ok: true; value: { name: string; description: string; tags: string[] } } | { ok: false; message: string } {
  const name = body?.name === undefined && current ? current.name : body?.name;
  const description = body?.description === undefined ? current?.description ?? "" : body?.description;
  const tagsIn = body?.tags === undefined ? current?.tags ?? [] : body?.tags;

  if (typeof name !== "string" || !name.trim()) return { ok: false, message: "Give the feature a name." };
  if (name.trim().length > 80) return { ok: false, message: "Keep the name under 80 characters." };
  if (typeof description !== "string") return { ok: false, message: "The description must be text." };
  if (description.trim().length > 500) return { ok: false, message: "Keep the description under 500 characters." };
  const tags = normaliseTags(tagsIn);
  if (!tags) return { ok: false, message: "Tags must be a list of up to 12 short words." };

  return { ok: true, value: { name: name.trim(), description: description.trim(), tags } };
}

/** A switch as the console shows it, with the counts it needs. */
function featureForAdmin(flag: any, listedUsers: number, totalUsers: number) {
  return {
    id: flag.id,
    key: flag.key,
    name: flag.name,
    description: flag.description,
    tags: flag.tags ?? [],
    rollout: flag.rollout,
    created_at: flag.createdAt,
    updated_at: flag.updatedAt,
    listed_users: listedUsers,
    total_users: totalUsers,
  };
}

/**
 * Every switch for one person: whether they have it, and why. The answer
 * comes from the same decide() the app uses, so the console cannot disagree
 * with what the person actually sees.
 */
async function featuresForUser(userId: string) {
  const [flags, memberships, totalUsers] = await Promise.all([
    storage.listFeatureFlagsForAdmin(),
    storage.getFeatureFlagMembershipsForUser(userId),
    storage.countUsers(),
  ]);
  const byFlag = new Map(memberships.map((m) => [m.flagId, m]));
  return flags.map((flag) => {
    const listed = byFlag.get(flag.id);
    return {
      ...featureForAdmin(flag, flag.listedUsers, totalUsers),
      enabled: decide(flag, Boolean(listed)),
      listed: Boolean(listed),
      added_at: listed?.addedAt ?? null,
      added_by: listed?.addedBy ?? null,
    };
  });
}

export function registerAdminRoutes(app: Express): void {
  const problem = adminConfigProblem();
  if (problem) {
    // Loud, and specific about which of the three things is wrong. A console
    // that will not sign anyone in looks identical to one that is simply
    // switched off, and the difference is only visible here.
    console.warn(`[Admin] Console NOT mounted. ${problem}`);
    return;
  }

  console.log("[Admin] Console mounted at /admin");

  // --- Sign in ----------------------------------------------------------

  app.get("/admin", (req, res) => {
    if (!isAdminSignedIn(req)) {
      return sendAdminPage(res, loginPage({}));
    }
    sendAdminPage(
      res,
      consolePage({
        csrfToken: csrfTokenFor(req),
        adminEmail: process.env.ADMIN_EMAIL!,
        version: buildInfo.commit,
      })
    );
  });

  app.post("/admin/login", adminLoginLimiter, async (req, res) => {
    const ok = await verifyAdminCredentials(req.body?.email, req.body?.password);
    if (!ok) {
      // One message for both a wrong address and a wrong password: saying
      // which was wrong confirms the address to whoever is guessing.
      console.warn(`[Admin] Failed sign-in attempt from ${req.ip}`);
      return sendAdminPage(res, loginPage({ error: "That email and password did not match." }), 401);
    }
    issueAdminCookie(res);
    res.redirect("/admin");
  });

  app.post("/admin/logout", (req, res) => {
    clearAdminCookie(res);
    res.redirect("/admin");
  });

  // --- Read -------------------------------------------------------------

  /*
   * Is Microsoft still accepting our credentials? Azure client secrets expire,
   * usually without anyone noticing until a user cannot connect, and the
   * failure happens on Microsoft's side where our logs never see it.
   */
  app.get("/admin/microsoft", requireAdmin, async (_req, res) => {
    try {
      const checks = await checkMicrosoftConfig(APP_BASE_URL);
      sendAdminPage(
        res,
        microsoftPage({
          checks,
          relatedVariables: relatedVariableNames(),
          version: buildInfo.commit,
        })
      );
    } catch (error) {
      console.error("[Admin] Microsoft configuration check failed:", error);
      res.status(500).json({ message: "Could not check the Microsoft configuration." });
    }
  });

  app.get("/admin/api/overview", requireAdmin, async (_req, res) => {
    try {
      const users = (await storage.listUsersForAdmin()).map(normaliseUserRow);
      res.json({
        generatedAt: new Date().toISOString(),
        health: summarise(users),
        users,
      });
    } catch (error) {
      console.error("[Admin] Failed to load the overview:", error);
      res.status(500).json({ message: "Could not load the user list." });
    }
  });

  // The daily renewal checks: when they last ran and what they did. Small, read only.
  app.get("/admin/api/background-checks", requireAdmin, async (_req, res) => {
    try {
      const summary = await storage.getRenewalSummary();
      res.json({
        enabled: renewalChecksEnabled(),
        lastRunDay: summary.lastRunDay,
        lastRunAt: summary.finishedAt ?? summary.startedAt,
        finished: summary.finishedAt !== null,
        people: summary.users,
        checked: summary.checked,
        found: summary.found,
        failures: summary.failures,
        remindersSent: summary.emailsSent,
        mailboxesNeedingReconnect: summary.mailboxesNeedingReconnect,
      });
    } catch (error) {
      console.error("[Admin] Failed to load the background checks summary:", error);
      res.status(500).json({ message: "Could not load the background checks summary." });
    }
  });

  app.get("/admin/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const detail = await storage.getUserDetailForAdmin(req.params.id);
      if (!detail) return res.status(404).json({ message: "No such user." });

      // The per-subscription counts come back as strings too, and the page
      // compares them rather than only printing them.
      const subscriptions_detail = (detail.subscriptions_detail ?? []).map((row: any) => ({
        ...row,
        invoices: toNumber(row.invoices),
        invoices_without_file: toNumber(row.invoices_without_file),
      }));

      // Optional: the rest of the person page is worth showing even if the
      // feature tables are unreadable.
      let features = null;
      try {
        features = await featuresForUser(req.params.id);
      } catch (error) {
        console.error("[Admin] Failed to load a user's features:", error);
      }

      // Subscription status, recorded quietly while its switch is on for this
      // person, so it can be checked against their inbox before anyone sees
      // it. Null when the switch is off; optional like features above.
      let status_payments = null;
      const statusOn = (features ?? []).some((f: any) => f.key === STATUS_FEATURE && f.enabled);
      if (statusOn) {
        try {
          status_payments = await statusRowsForAdmin(req.params.id);
        } catch (error) {
          console.error("[Admin] Failed to load a user's subscription status:", error);
        }
      }

      // Mailboxes the daily background check found expired (only ever set for
      // people with the switch on). Optional, like features above.
      let mailboxes = detail.mailboxes ?? [];
      try {
        const flags = await storage.getReconnectFlags(req.params.id);
        if (flags.length > 0) {
          const flagged = new Set(flags.map((f) => `${f.provider}:${f.accountId}`));
          mailboxes = mailboxes.map((m: any) => ({ ...m, needs_reconnect: flagged.has(`${m.provider}:${m.id}`) }));
        }
      } catch (error) {
        console.error("[Admin] Failed to load a user's reconnect flags:", error);
      }

      res.json({ ...normaliseUserRow(detail), mailboxes, subscriptions_detail, features, status_payments });
    } catch (error) {
      console.error("[Admin] Failed to load a user:", error);
      res.status(500).json({ message: "Could not load that user." });
    }
  });

  // --- Feature switches -------------------------------------------------
  //
  // Every write records an audit row (in the same batch as the change) and
  // drops the in-memory cache, so the next app request sees the change.

  app.get("/admin/api/features", requireAdmin, async (_req, res) => {
    try {
      const [flags, totalUsers] = await Promise.all([
        storage.listFeatureFlagsForAdmin(),
        storage.countUsers(),
      ]);
      res.json({ features: flags.map((flag) => featureForAdmin(flag, flag.listedUsers, totalUsers)) });
    } catch (error) {
      console.error("[Admin] Failed to load features:", error);
      res.status(500).json({ message: "Could not load the features." });
    }
  });

  app.post("/admin/api/features", requireAdmin, requireAdminCsrf, async (req, res) => {
    try {
      const key = req.body?.key;
      if (!isValidFeatureKey(key)) {
        return res.status(400).json({
          message: "The key must be 3 to 50 lowercase letters, numbers or underscores, starting with a letter.",
        });
      }
      const details = readFeatureDetails(req.body);
      if (!details.ok) return res.status(400).json({ message: details.message });
      if (await storage.getFeatureFlagByKey(key)) {
        return res.status(409).json({ message: `A feature with the key ${key} already exists.` });
      }

      const flag = await storage.createFeatureFlag({ key, ...details.value }, adminActor());
      invalidateFeatureFlags();
      res.status(201).json({ feature: featureForAdmin(flag, 0, await storage.countUsers()) });
    } catch (error) {
      console.error("[Admin] Failed to create a feature:", error);
      res.status(500).json({ message: "Could not create the feature." });
    }
  });

  app.get("/admin/api/features/:id", requireAdmin, async (req, res) => {
    try {
      const flag = await storage.getFeatureFlag(req.params.id);
      if (!flag) return res.status(404).json({ message: "No such feature." });
      const [listed, totalUsers] = await Promise.all([
        storage.getFeatureFlagUsersForAdmin(flag.id),
        storage.countUsers(),
      ]);
      res.json({
        feature: featureForAdmin(flag, listed.length, totalUsers),
        users: listed.map((u: any) => ({
          id: u.userId,
          email: u.email,
          first_name: u.firstName,
          last_name: u.lastName,
          added_at: u.addedAt,
          added_by: u.addedBy,
        })),
      });
    } catch (error) {
      console.error("[Admin] Failed to load a feature:", error);
      res.status(500).json({ message: "Could not load that feature." });
    }
  });

  // Name, description and tags. The key is used in code and never changes,
  // and the rollout has its own route so it cannot change by accident here.
  app.patch("/admin/api/features/:id", requireAdmin, requireAdminCsrf, async (req, res) => {
    try {
      const flag = await storage.getFeatureFlag(req.params.id);
      if (!flag) return res.status(404).json({ message: "No such feature." });
      if (req.body?.key !== undefined && req.body.key !== flag.key) {
        return res.status(400).json({ message: "The key is used in code and can’t be changed." });
      }
      if (req.body?.rollout !== undefined) {
        return res.status(400).json({ message: "Change the rollout with its own switch." });
      }
      const details = readFeatureDetails(req.body, flag);
      if (!details.ok) return res.status(400).json({ message: details.message });

      const updated = await storage.updateFeatureFlagDetails(flag.id, details.value, adminActor());
      invalidateFeatureFlags();
      res.json({ feature: updated, message: "Changes saved." });
    } catch (error) {
      console.error("[Admin] Failed to edit a feature:", error);
      res.status(500).json({ message: "Could not save the changes." });
    }
  });

  app.post("/admin/api/features/:id/rollout", requireAdmin, requireAdminCsrf, async (req, res) => {
    try {
      const rollout = req.body?.rollout;
      if (!isRollout(rollout)) {
        return res.status(400).json({ message: "Rollout must be off, selected or everyone." });
      }
      const updated = await storage.setFeatureFlagRollout(req.params.id, rollout, adminActor());
      if (!updated) return res.status(404).json({ message: "No such feature." });
      invalidateFeatureFlags();
      const said = rollout === "off" ? "Off for everyone." : rollout === "everyone" ? "On for everyone." : "On for the selected users.";
      res.json({ feature: updated, message: `${updated.name}: ${said}` });
    } catch (error) {
      console.error("[Admin] Failed to change a rollout:", error);
      res.status(500).json({ message: "Could not change the rollout." });
    }
  });

  // Existing users to add, by email or name. Those already listed are left out.
  app.get("/admin/api/features/:id/user-search", requireAdmin, async (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim().slice(0, 100);
      if (q.length < 2) return res.json({ users: [] });
      const users = await storage.searchUsersForFeatureFlag(req.params.id, q);
      res.json({ users });
    } catch (error) {
      console.error("[Admin] Failed to search users:", error);
      res.status(500).json({ message: "Could not search users." });
    }
  });

  app.post("/admin/api/features/:id/users", requireAdmin, requireAdminCsrf, async (req, res) => {
    try {
      const userIds = req.body?.userIds;
      if (
        !Array.isArray(userIds) ||
        userIds.length === 0 ||
        userIds.length > 100 ||
        !userIds.every((id: unknown) => typeof id === "string" && id.length > 0)
      ) {
        return res.status(400).json({ message: "Choose at least one user to add." });
      }
      const flag = await storage.getFeatureFlag(req.params.id);
      if (!flag) return res.status(404).json({ message: "No such feature." });

      const added = await storage.addFeatureFlagUsers(flag.id, Array.from(new Set<string>(userIds)), adminActor());
      invalidateFeatureFlags();
      res.json({ added, message: added === 1 ? "Added 1 user." : `Added ${added} users.` });
    } catch (error) {
      console.error("[Admin] Failed to add users to a feature:", error);
      res.status(500).json({ message: "Could not add those users." });
    }
  });

  app.delete("/admin/api/features/:id/users/:userId", requireAdmin, requireAdminCsrf, async (req, res) => {
    try {
      const removed = await storage.removeFeatureFlagUser(req.params.id, req.params.userId, adminActor());
      if (!removed) return res.status(404).json({ message: "That user is not on this feature’s list." });
      invalidateFeatureFlags();
      res.json({ message: "Removed." });
    } catch (error) {
      console.error("[Admin] Failed to remove a user from a feature:", error);
      res.status(500).json({ message: "Could not remove that user." });
    }
  });

  // --- History search (subscription_status switch only) -----------------
  //
  // Queues a look back through a person's billing emails. With a
  // subscriptionId, that one is searched again even if it was done; without,
  // every subscription of theirs not already searched is queued. It changes
  // nothing a user sees, and the search itself runs in the background.

  app.post("/admin/api/users/:id/history-search", requireAdmin, requireAdminCsrf, async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) return res.status(404).json({ message: "No such user." });
      if (!(await statusEnabledFor(user.id))) {
        return res.status(409).json({ message: "Subscription status is not on for this person." });
      }

      const subscriptionId = typeof req.body?.subscriptionId === "string" ? req.body.subscriptionId : null;
      // "From scratch" first forgets what an earlier search recorded, so the
      // new one is not held back by emails it already stored.
      const fresh = req.body?.fresh === true;
      let queued: number;
      // "From scratch" also reads the payments saved at approvals and syncs
      // again with today's rules, so one click refreshes everything.
      let reread: { checked: number; changed: number; removed: number } | null = null;
      // Duplicate invoices are removed before searching, so the search starts clean.
      let duplicates: DuplicateInvoiceResult | null = null;
      if (subscriptionId) {
        const sub = await storage.getSubscription(subscriptionId);
        if (!sub || sub.userId !== user.id) return res.status(404).json({ message: "No such subscription." });
        if (fresh) {
          duplicates = await removeDuplicateInvoices(user.id, [sub.id]);
          await storage.clearHistoryFindings(user.id, [sub.id]);
          reread = await rereadStoredPayments(user.id, [sub.id]);
        }
        queued = await queueHistorySearch(user.id, [sub.id], { force: true });
      } else if (fresh) {
        const ids = (await storage.getSubscriptions(user.id)).map((s) => s.id);
        duplicates = await removeDuplicateInvoices(user.id, ids);
        const cleared = await storage.clearHistoryFindings(user.id, ids);
        console.log(`[Admin] History findings cleared: ${cleared.payments} payment(s), ${cleared.emails} email(s)`);
        reread = await rereadStoredPayments(user.id, ids);
        queued = await queueHistorySearch(user.id, ids, { force: true });
      } else {
        queued = await queueAllForUser(user.id);
      }
      console.log(`[Admin] History search queued for ${queued} subscription(s)`);
      if (reread) console.log(`[Admin] Re-read ${reread.checked} saved payment(s): ${reread.changed} changed, ${reread.removed} removed`);
      const rereadNote = reread ? ` Re-read ${reread.checked} saved payment${reread.checked === 1 ? "" : "s"}: ${reread.changed} changed, ${reread.removed} removed.` : "";
      const dupNote = duplicates ? ` Removed ${duplicates.removed} duplicate invoice${duplicates.removed === 1 ? "" : "s"} (kept ${duplicates.kept}).` : "";
      res.json({
        queued,
        reread,
        duplicates,
        message: (queued === 0
          ? "Nothing to search: everything is already searched or searching."
          : `Searching history for ${queued} subscription${queued === 1 ? "" : "s"}.`) + rereadNote + dupNote,
      });
    } catch (error) {
      console.error("[Admin] Failed to queue a history search:", error);
      res.status(500).json({ message: "Could not start the search." });
    }
  });

  // One-time clean-up for a person with the switch on: deletes their stored
  // emails that are credit card bills or statements, and the payments read
  // from them.
  app.post("/admin/api/users/:id/remove-credit-card-emails", requireAdmin, requireAdminCsrf, async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) return res.status(404).json({ message: "No such user." });
      if (!(await statusEnabledFor(user.id))) {
        return res.status(409).json({ message: "Subscription status is not on for this person." });
      }
      const removed = await removeStoredCreditCardEmails(user.id);
      console.log(`[Admin] Credit card emails removed: ${removed.emails} email(s), ${removed.payments} payment(s)`);
      res.json({
        ...removed,
        message: `Removed ${removed.emails} credit card email${removed.emails === 1 ? "" : "s"} (and ${removed.payments} payment${removed.payments === 1 ? "" : "s"} read from them).`,
      });
    } catch (error) {
      console.error("[Admin] Failed to remove credit card emails:", error);
      res.status(500).json({ message: "Could not remove those emails." });
    }
  });

  // One-time clean-up for a person with the switch on: removes their stored
  // bank and card emails (see removeStoredBankEmails). Never runs by itself.
  app.post("/admin/api/users/:id/remove-bank-emails", requireAdmin, requireAdminCsrf, async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) return res.status(404).json({ message: "No such user." });
      if (!(await statusEnabledFor(user.id))) {
        return res.status(409).json({ message: "Subscription status is not on for this person." });
      }
      const r = await removeStoredBankEmails(user.id);
      console.log(`[Admin] Bank emails removed: ${r.emails} email(s), ${r.payments} payment(s), ${r.kept} alert(s) kept, ${r.files} file(s), ${r.suggestionsCleared} suggestion(s) cleared`);
      const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
      res.json({
        ...r,
        message:
          `Removed ${plural(r.emails, "bank/card email")} and ${plural(r.payments, "payment")} read from them; ` +
          `kept ${plural(r.kept, "bank alert")} as plain payment records; deleted ${plural(r.files, "file")}` +
          (r.fileFailures ? ` (${r.fileFailures} could not be deleted)` : "") +
          `; cleared notes on ${plural(r.suggestionsCleared, "suggestion")}.`,
      });
    } catch (error) {
      console.error("[Admin] Failed to remove bank emails:", error);
      res.status(500).json({ message: error instanceof Error && /fingerprint secret/.test(error.message) ? error.message : "Could not remove those emails." });
    }
  });

  // One-time clean-up for a person with the switch on: removes invoices filed
  // from email more than once (see removeDuplicateInvoices). Manual uploads
  // are never touched.
  app.post("/admin/api/users/:id/remove-duplicate-invoices", requireAdmin, requireAdminCsrf, async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) return res.status(404).json({ message: "No such user." });
      if (!(await statusEnabledFor(user.id))) {
        return res.status(409).json({ message: "Subscription status is not on for this person." });
      }
      const r = await removeDuplicateInvoices(user.id);
      console.log(`[Admin] Duplicate invoices removed: ${r.removed} row(s), ${r.kept} kept, ${r.files} file(s), ${r.fileFailures} file failure(s)`);
      res.json({
        ...r,
        message:
          `Removed ${r.removed} duplicate invoice${r.removed === 1 ? "" : "s"} (kept ${r.kept}), deleted ${r.files} file${r.files === 1 ? "" : "s"}` +
          (r.fileFailures ? ` (${r.fileFailures} could not be deleted)` : "") + ".",
      });
    } catch (error) {
      console.error("[Admin] Failed to remove duplicate invoices:", error);
      res.status(500).json({ message: "Could not remove the duplicate invoices." });
    }
  });

  // --- Delete -----------------------------------------------------------
  //
  // Both handlers look the user up first so the log line and the reply can
  // name an address rather than an id, and so a bad id fails before anything
  // is touched.

  app.post("/admin/api/users/:id/clear-data", requireAdmin, requireAdminCsrf, async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) return res.status(404).json({ message: "No such user." });

      const result = await storage.deleteUserData(req.params.id);
      recordDeletion("clear_data", user, result);
      res.json({ ...result, message: describe(result, "Data cleared. The account is still there.") });
    } catch (error) {
      console.error("[Admin] Failed to clear a user's data:", error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/admin/api/users/:id/delete", requireAdmin, requireAdminCsrf, async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) return res.status(404).json({ message: "No such user." });

      const result = await storage.deleteUserAccount(req.params.id);
      recordDeletion("delete_user", user, result);
      res.json({ ...result, message: describe(result, "Account deleted.") });
    } catch (error) {
      console.error("[Admin] Failed to delete a user:", error);
      res.status(500).json({ message: (error as Error).message });
    }
  });
}
