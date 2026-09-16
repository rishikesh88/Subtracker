// Tests for the admin console's sign-in. Run with `npm run test:admin-auth`.
//
// Nothing here touches the database or the network. The environment is set
// before the module is imported, because the module reads it lazily but the
// signing key is derived from ADMIN_PASSWORD_HASH and the tests need it fixed.

import bcrypt from "bcrypt";

const PASSWORD = "correct horse battery staple";
const HASH = bcrypt.hashSync(PASSWORD, 10);

process.env.SESSION_SECRET = "test-session-secret";
process.env.ADMIN_EMAIL = "Admin@Example.COM";
process.env.ADMIN_PASSWORD_HASH = HASH;

const m = await import("./adminAuth");

let pass = 0,
  fail = 0;
const check = (name: string, cond: boolean) => {
  cond ? (pass++, console.log("  ok   " + name)) : (fail++, console.log("  FAIL " + name));
};

// --- A fake Response that records the cookie, and a fake Request -----------

function fakeRes() {
  const state: any = { cookies: {}, cleared: [] };
  return {
    state,
    cookie(name: string, value: string, options: any) {
      state.cookies[name] = { value, options };
    },
    clearCookie(name: string, options: any) {
      state.cleared.push({ name, options });
      delete state.cookies[name];
    },
  } as any;
}

function reqWithCookie(header: string | undefined, csrf?: string) {
  return {
    headers: header ? { cookie: header } : {},
    get: (name: string) => (name.toLowerCase() === "x-admin-csrf" ? csrf : undefined),
  } as any;
}

function signedInRequest(csrf?: string) {
  const res = fakeRes();
  m.issueAdminCookie(res);
  const cookie = res.state.cookies["verloq_admin"];
  return { req: reqWithCookie(`verloq_admin=${cookie.value}`, csrf), cookie };
}

// --- Configuration --------------------------------------------------------

check("configured when both variables are set", m.adminConfigured() === true);

// --- Credentials ----------------------------------------------------------

check("right email and password is accepted", await m.verifyAdminCredentials("admin@example.com", PASSWORD));
check(
  "email comparison ignores case and surrounding space",
  await m.verifyAdminCredentials("  ADMIN@EXAMPLE.com  ", PASSWORD)
);
check("wrong password is rejected", !(await m.verifyAdminCredentials("admin@example.com", "nope")));
check("wrong email is rejected", !(await m.verifyAdminCredentials("someone@else.com", PASSWORD)));
check(
  "right password with the wrong email is still rejected",
  !(await m.verifyAdminCredentials("someone@else.com", PASSWORD))
);
check("empty password is rejected", !(await m.verifyAdminCredentials("admin@example.com", "")));
check("non-string input is rejected", !(await m.verifyAdminCredentials(null, undefined)));

// A wrong address must not be measurably faster than a wrong password, or the
// timing says whether the address is the admin's.
const timeOf = async (email: string) => {
  const started = process.hrtime.bigint();
  await m.verifyAdminCredentials(email, "wrong password");
  return Number(process.hrtime.bigint() - started) / 1e6;
};
const wrongEmailMs = await timeOf("someone@else.com");
const rightEmailMs = await timeOf("admin@example.com");
const ratio = Math.max(wrongEmailMs, rightEmailMs) / Math.max(1, Math.min(wrongEmailMs, rightEmailMs));
check(`wrong email costs about as long as wrong password (ratio ${ratio.toFixed(2)})`, ratio < 3);

// --- The session cookie ---------------------------------------------------

const issued = fakeRes();
m.issueAdminCookie(issued);
const cookie = issued.state.cookies["verloq_admin"];
check("a cookie is set", Boolean(cookie));
check("cookie is httpOnly", cookie.options.httpOnly === true);
check("cookie is SameSite=strict", cookie.options.sameSite === "strict");
check("cookie is scoped to /admin", cookie.options.path === "/admin");
check("cookie carries no password material", !cookie.value.includes(HASH) && !cookie.value.includes(PASSWORD));

check("a valid cookie signs you in", m.isAdminSignedIn(reqWithCookie(`verloq_admin=${cookie.value}`)));
check("no cookie means signed out", !m.isAdminSignedIn(reqWithCookie(undefined)));
check("an unrelated cookie is ignored", !m.isAdminSignedIn(reqWithCookie("other=value")));

// Forgery: change the payload, keep the signature.
const [payload, signature] = cookie.value.split(".");
const future = String(Number(payload) + 86_400_000);
check(
  "a cookie with an extended expiry and the old signature is rejected",
  !m.isAdminSignedIn(reqWithCookie(`verloq_admin=${future}.${signature}`))
);
check(
  "a cookie with a made-up signature is rejected",
  !m.isAdminSignedIn(reqWithCookie(`verloq_admin=${payload}.notarealsignature`))
);
check("a malformed cookie is rejected", !m.isAdminSignedIn(reqWithCookie("verloq_admin=garbage")));

// Expiry.
const expired = `0.${(await import("crypto")).createHmac("sha256", `test-session-secret::${HASH}`).update("0").digest("base64url")}`;
check("an expired cookie is rejected", !m.isAdminSignedIn(reqWithCookie(`verloq_admin=${expired}`)));

// The revocation story: changing the password invalidates issued cookies.
const oldHash = process.env.ADMIN_PASSWORD_HASH;
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync("a different password", 10);
check(
  "changing the password signs existing cookies out",
  !m.isAdminSignedIn(reqWithCookie(`verloq_admin=${cookie.value}`))
);
process.env.ADMIN_PASSWORD_HASH = oldHash;
check(
  "restoring the password makes the cookie valid again",
  m.isAdminSignedIn(reqWithCookie(`verloq_admin=${cookie.value}`))
);

// --- CSRF -----------------------------------------------------------------

const { req: signedIn } = signedInRequest();
const token = m.csrfTokenFor(signedIn);
check("a signed-in request gets a csrf token", token.length > 0);
check("a signed-out request gets no csrf token", m.csrfTokenFor(reqWithCookie(undefined)) === "");
check("the csrf token is not the session cookie", !signedIn.headers.cookie.includes(token));

const run = (handler: any, req: any) =>
  new Promise<number>((resolve) => {
    const res: any = {
      statusCode: 200,
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      json() {
        resolve(res.statusCode);
      },
    };
    handler(req, res, () => resolve(200));
  });

const { req: withGoodCsrf } = (() => {
  const res = fakeRes();
  m.issueAdminCookie(res);
  const c = res.state.cookies["verloq_admin"].value;
  const plain = reqWithCookie(`verloq_admin=${c}`);
  return { req: reqWithCookie(`verloq_admin=${c}`, m.csrfTokenFor(plain)) };
})();

check("requireAdmin lets a signed-in request through", (await run(m.requireAdmin, signedIn)) === 200);
check("requireAdmin answers 401 when signed out", (await run(m.requireAdmin, reqWithCookie(undefined))) === 401);
check("requireAdminCsrf lets a matching token through", (await run(m.requireAdminCsrf, withGoodCsrf)) === 200);
check(
  "requireAdminCsrf answers 403 with no token",
  (await run(m.requireAdminCsrf, signedInRequest().req)) === 403
);
check(
  "requireAdminCsrf answers 403 with a wrong token",
  (await run(m.requireAdminCsrf, signedInRequest("wrong").req)) === 403
);
check(
  "requireAdminCsrf answers 403 when signed out, even with a token",
  (await run(m.requireAdminCsrf, reqWithCookie(undefined, token))) === 403
);

// --- Not configured -------------------------------------------------------

delete process.env.ADMIN_PASSWORD_HASH;
check("not configured without a password hash", m.adminConfigured() === false);
check("no cookie is accepted while unconfigured", !m.isAdminSignedIn(reqWithCookie(`verloq_admin=${cookie.value}`)));
check("credentials are refused while unconfigured", !(await m.verifyAdminCredentials("admin@example.com", PASSWORD)));

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
