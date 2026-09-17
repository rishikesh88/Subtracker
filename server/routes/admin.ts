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
import { loginPage, consolePage } from "./adminConsoleHtml";

/**
 * Sends an admin page, uncacheable.
 *
 * Two reasons it must never be stored. It is a signed-in page carrying a CSRF
 * token and whoever is logged in, so it has no business in a shared cache or
 * restored from the back-forward cache after signing out. And without any
 * cache header at all a browser is free to reuse it, which is how a deploy can
 * ship and the operator still be looking at the previous page.
 */
/**
 * The commit the running container was built from.
 *
 * Shown in the console's top bar because "has my change actually deployed?"
 * cost an afternoon: the code was merged, the page looked unchanged, and there
 * was no way to tell a stale browser from a deploy that had not happened.
 * Railway injects this; anywhere else it reads "unknown", which is itself the
 * honest answer.
 */
function deployedVersion(): string {
  const sha =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.SOURCE_COMMIT ||
    process.env.GIT_COMMIT ||
    "";
  return sha ? sha.slice(0, 7) : "unknown";
}

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
        version: deployedVersion(),
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

      res.json({ ...normaliseUserRow(detail), subscriptions_detail });
    } catch (error) {
      console.error("[Admin] Failed to load a user:", error);
      res.status(500).json({ message: "Could not load that user." });
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
