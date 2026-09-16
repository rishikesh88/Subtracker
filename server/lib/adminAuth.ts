/**
 * Authentication for the admin console.
 *
 * Kept completely apart from the app's own sign-in. The console has its own
 * cookie, scoped to /admin so it is never sent with an ordinary request, and
 * it does not touch passport or express-session at all. Signing into the
 * console does not sign you into Verloq, and signing into Verloq -- as any
 * user, including one who shares the admin address -- does not get you into
 * the console. That separation is the point: an account takeover on the app
 * side must not become an account takeover on every user's data.
 *
 * Credentials come from the environment, so there is no admin table and no
 * schema change. That also means there is nothing in the database to steal
 * and no "forgot password" path to attack.
 *
 * The session is a signed value rather than a stored row, for two reasons:
 * there is one operator, so a server-side session store buys nothing; and the
 * signing key includes the password hash, so changing the password instantly
 * invalidates every cookie ever issued. That is the revocation story.
 */

import bcrypt from "bcrypt";
import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import type { Request, Response, RequestHandler } from "express";
import { getSessionSecret } from "../config";

const COOKIE_NAME = "verloq_admin";
const COOKIE_PATH = "/admin";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // One working day, then sign in again.

function adminEmail(): string | undefined {
  return process.env.ADMIN_EMAIL?.trim().toLowerCase() || undefined;
}

/**
 * Every bcrypt hash: a version tag, a two-digit cost, then exactly 53
 * characters of salt and digest. Nothing else is comparable, and in
 * particular a plain password is not -- bcrypt.compare against one returns
 * false for every input, so the console would show a sign-in form that
 * silently refuses the right password forever.
 */
const BCRYPT_HASH = /^\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}$/;

function adminPasswordHash(): string | undefined {
  const raw = process.env.ADMIN_PASSWORD_HASH?.trim();
  if (!raw) return undefined;
  // Some dashboards keep the quotes when a value is pasted with them.
  const unquoted = raw.replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
  return unquoted || undefined;
}

/**
 * Why the console is not available, or null when it is.
 *
 * Separated from adminConfigured so registerAdminRoutes can say which of the
 * three things is wrong. A misconfigured value used to fail the same way as an
 * unset one -- an unexplained sign-in that never works -- and that has now
 * cost real time twice on this project, once here and once on
 * TOKEN_ENCRYPTION_KEY.
 */
export function adminConfigProblem(): string | null {
  const email = adminEmail();
  const hash = adminPasswordHash();

  if (!email && !hash) {
    return "ADMIN_EMAIL and ADMIN_PASSWORD_HASH are not set.";
  }
  if (!email) return "ADMIN_PASSWORD_HASH is set but ADMIN_EMAIL is not.";
  if (!hash) return "ADMIN_EMAIL is set but ADMIN_PASSWORD_HASH is not.";

  if (!BCRYPT_HASH.test(hash)) {
    return (
      "ADMIN_PASSWORD_HASH is not a bcrypt hash, so no password could ever be " +
      "accepted. It must be the OUTPUT of `npm run admin:password` -- a " +
      "60-character string starting with $2b$ -- not the password itself. " +
      `Got ${hash.length} character(s) starting "${hash.slice(0, 4)}".`
    );
  }

  return null;
}

/**
 * True only when both credentials are present and the hash is usable. When
 * false the console is not mounted at all and /admin falls through like any
 * unknown path, so a deploy that has not been configured does not advertise
 * that a console exists.
 */
export function adminConfigured(): boolean {
  return adminConfigProblem() === null;
}

/**
 * Signing key for the session cookie. Derived from the express-session secret
 * and the admin password hash together, so it is not the same key as anything
 * else signs with, and changing either one logs the console out everywhere.
 */
function signingKey(): string {
  return `${getSessionSecret()}::${adminPasswordHash() ?? ""}`;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

function equals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length, so the lengths are compared first and the result folded in.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function verifyAdminCredentials(
  email: unknown,
  password: unknown
): Promise<boolean> {
  if (typeof email !== "string" || typeof password !== "string") return false;
  if (!adminConfigured()) return false;

  const expectedEmail = adminEmail()!;
  const emailMatches = equals(email.trim().toLowerCase(), expectedEmail);

  // bcrypt.compare runs either way, so a wrong address costs the same as a
  // wrong password and the response time cannot be used to discover which
  // address is the admin's -- and the address is a personal email.
  //
  // The wrong-address branch compares random bytes against the real hash
  // rather than a fixed decoy hash. bcrypt's cost is carried in the hash, not
  // the input, so using the same hash makes the two branches take the same
  // time by construction. A decoy would have to be generated at the same cost
  // as whatever hash the operator configured, and would quietly stop matching
  // the moment it was not.
  const candidate = emailMatches ? password : randomBytes(32).toString("hex");
  const passwordMatches = await bcrypt.compare(candidate, adminPasswordHash()!);

  return emailMatches && passwordMatches;
}

export function issueAdminCookie(res: Response): void {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = String(expiresAt);
  res.cookie(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Strict, not lax: nothing should ever navigate into the console from
    // another site, and this is what stops a cross-site form post reaching a
    // delete endpoint with the cookie attached.
    sameSite: "strict",
    path: COOKIE_PATH,
    maxAge: SESSION_TTL_MS,
  });
}

export function clearAdminCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: COOKIE_PATH });
}

function readCookie(req: Request, name: string): string | undefined {
  // The app does not use cookie-parser, and adding it globally would put a
  // parsed cookie object on every request in the app for the sake of one
  // route. Parsing the one header here keeps the change contained.
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}

function readAdminSession(req: Request): { token: string } | null {
  if (!adminConfigured()) return null;

  const raw = readCookie(req, COOKIE_NAME);
  if (!raw) return null;

  const separator = raw.lastIndexOf(".");
  if (separator === -1) return null;

  const payload = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (!equals(signature, sign(payload))) return null;

  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

  return { token: raw };
}

export function isAdminSignedIn(req: Request): boolean {
  return readAdminSession(req) !== null;
}

/**
 * Guards the console's JSON endpoints. Answers 401 rather than redirecting,
 * because everything it protects is called by fetch.
 */
export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!isAdminSignedIn(req)) {
    return res.status(401).json({ message: "Not signed in" });
  }
  next();
};

/**
 * A CSRF token derived from the session cookie rather than stored alongside
 * it. Anyone holding the cookie can compute it and nobody else can, which is
 * all that is needed: the attack this blocks is a request that carries the
 * cookie automatically but cannot read it.
 *
 * SameSite=Strict already blocks that request in every current browser. This
 * is the second lock, because what is behind it deletes people's data.
 */
export function csrfTokenFor(req: Request): string {
  const session = readAdminSession(req);
  if (!session) return "";
  return sign(`csrf:${session.token}`);
}

export const requireAdminCsrf: RequestHandler = (req, res, next) => {
  const supplied = req.get("x-admin-csrf") ?? "";
  const expected = csrfTokenFor(req);
  if (!expected || !equals(supplied, expected)) {
    return res.status(403).json({ message: "Request could not be verified. Reload the page." });
  }
  next();
};
