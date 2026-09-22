# Phase 3 — infrastructure setup

Console work, in this order. Neon and Google Cloud produce values that Railway
needs, so do Railway second-to-last and Cloudflare last.

Every variable name below is taken from the code, not invented. The complete
list with comments is in [.env.example](.env.example).

---

## 1. Neon

- **Region:** Singapore — `ap-southeast-1`. Match this to Railway's region; a
  cross-region hop on every query is the easiest latency mistake to make here.
- **Postgres version:** 16 or 17, either is fine.

Copy the **pooled** connection string — the host contains `-pooler`. Both
consumers need it:

- app queries go through `drizzle-orm/neon-http`
- the session store (`connect-pg-simple`) opens a real TCP connection via `pg`,
  which is why `pg` is now an explicit dependency

```
DATABASE_URL=postgresql://<user>:<password>@<endpoint>-pooler.ap-southeast-1.aws.neon.tech/<db>?sslmode=require
```

`sslmode=require` is not optional — Neon rejects unencrypted connections.

> The brief described this as "the WebSocket driver, needs `ws`". That's not what
> the code does — `neonConfig` and `Pool` appear nowhere, and `ws` is an unused
> dependency. Nothing to configure for it.

---

## 2. Google Cloud

One project covers the bucket, Gemini, and OAuth.

### 2a. Storage bucket

- **Location:** `asia-southeast1` (Singapore).
- **Access control:** **Uniform** (bucket-level). Object ACLs are *not* used —
  permissions are stored as custom object metadata under `custom:aclPolicy`
  ([objectAcl.ts:3](server/objectAcl.ts:3)) — so uniform access is both safe and
  the right default.
- **Public access:** blocked. Every read is streamed through the app.

**CORS rule — the app will appear to work without this and silently fail on
upload.** Uppy PUTs the file straight to GCS from the browser, so the bucket
must accept cross-origin PUTs. Save as `cors.json`:

```json
[
  {
    "origin": ["https://app.verloq.co"],
    "method": ["GET", "PUT", "HEAD"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
```

```bash
gcloud storage buckets update gs://YOUR_BUCKET --cors-file=cors.json
```

Add `http://localhost:5000` to `origin` too if you want uploads working in local
development.

### 2b. Service account

- **Role:** `roles/storage.objectAdmin`, granted **on the bucket**, not on the
  project. The app creates, reads, overwrites and deletes objects, so
  `objectViewer` is not enough — but nothing needs project-wide storage access.
- Create a **JSON key** and download it.

Signed URLs are generated locally from the key's private key, so no
`signBlob` / Token Creator role is needed.

The key goes in as **one line of JSON**:

```
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account","project_id":"...",...}
GCS_PROJECT_ID=your-project-id
```

To flatten it: `jq -c . key.json`

`GCS_PROJECT_ID` is optional — it falls back to `project_id` from the key
([objectStorage.ts](server/objectStorage.ts)) — but set it explicitly.

### 2c. Object path

```
PRIVATE_OBJECT_DIR=/YOUR_BUCKET/private
```

Leading slash, no trailing slash, bucket name first. The code splits on `/` and
treats the first segment as the bucket ([objectStorage.ts](server/objectStorage.ts)).

### 2d. Gemini

Create an API key (AI Studio, or Vertex in the same project):

```
GEMINI_API_KEY=...
```

**Billing must be enabled on this project.** Not for the quota. On the free
tier Google's terms permit using prompts and responses to improve its products,
and Verloq sends whole receipt emails. Section 4 of the privacy policy promises
that will not happen, which is true only of the paid tier -- so a free-tier key
makes the published policy false and breaks the Limited Use requirement that
`gmail.readonly` is granted under. It is the first thing a restricted-scope
reviewer can check, and the cheapest thing to get wrong.

### 2e. OAuth — one client, two redirect URIs

**Consent screen:** External. App name, support email, logo, and the privacy
policy + terms URLs. Those two URLs must be live before you can submit for
verification, so they need to exist on the marketing site.

**Scopes** — request exactly these, nothing more. A wider list slows down the
restricted-scope review:

| Scope | Restricted? | Used by |
|---|---|---|
| `openid`, `profile`, `email` | no | Google sign-in |
| `https://www.googleapis.com/auth/userinfo.email` | no | Gmail connect |
| `https://www.googleapis.com/auth/gmail.readonly` | **yes** | mailbox sync |

**Credentials → OAuth client ID → Web application.** Add **both** redirect URIs
to the same client:

```
https://app.verloq.co/api/auth/google-login/callback
https://app.verloq.co/api/auth/google/callback
```

Add the `http://localhost:5000` equivalents as well for local development.

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Leave `GOOGLE_REDIRECT_URI` unset — it exists only as an override for the Gmail
connect callback, and `APP_BASE_URL` already produces the right value.

---

## 3. Azure — two app registrations

The code uses **two separate credential pairs**, so this is two registrations,
not one. Getting this wrong produces a confusing `AADSTS` error at sign-in.

### 3a. Sign-in app

- **Supported account types:** must match `MICROSOFT_AUTH_TENANT_ID`. Use
  `common` unless you're locking to one tenant.
- **Redirect URI** (platform: Web): `https://app.verloq.co/api/auth/microsoft-login/callback`
- **API permissions** (delegated): `openid`, `profile`, `email`, `User.Read`
- Create a client secret.

```
MICROSOFT_AUTH_CLIENT_ID=...
MICROSOFT_AUTH_CLIENT_SECRET=...
MICROSOFT_AUTH_TENANT_ID=common
```

### 3b. Outlook mailbox app

- **Supported account types: must support `common`** — multitenant *and*
  personal Microsoft accounts. The authority is hardcoded to
  `https://login.microsoftonline.com/common` ([outlook.ts:14](server/services/outlook.ts:14))
  with no env override, so a single-tenant registration will fail here.
- **Redirect URI** (platform: Web): `https://app.verloq.co/api/auth/outlook/callback`
- **API permissions** (delegated): `Mail.Read`, `User.Read`, `offline_access`
- Create a client secret.

```
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
```

Leave `MICROSOFT_REDIRECT_URI` unset.

> Set a calendar reminder for the secret expiry dates. An expired Azure secret
> fails at sign-in with no warning beforehand.

---

## 4. Resend

- Add and verify the **`verloq.co`** sending domain.
- Publish the DKIM and SPF records Resend gives you in Cloudflare. These are
  **proxy-exempt** (they're TXT/CNAME records, not traffic) — the grey-cloud rule
  in step 6 applies only to the `app` record.
- The app sends as `Verloq <noreply@verloq.co>`
  ([emailVerificationService.ts:16](server/services/emailVerificationService.ts:16)) —
  no mailbox needs to exist at that address.

```
RESEND_API_KEY=re_...
```

Signup is gated on this working: a user who never receives the OTP cannot get in.

---

## 5. Railway

- **Deploy from GitHub**, branch `main`.
- **Region:** Singapore, to match Neon.
- **Health check path:** `/healthz`
- **Disable idle sleep / scale-to-zero.** The email sync now runs in the
  background after the HTTP response returns, so a host that sleeps when idle
  will kill syncs mid-flight — and because `lastSync` is written at the *start*
  of a sync, a truncated one looks identical to a successful one.
- Build and start commands come from `package.json`; no overrides needed. **Do
  not** add `db:push` to the build command.
- **Set `RAILPACK_NO_CACHE=1`.** Railpack reuses cached build layers, and a
  cached build produces no compiler output and finishes in about ten seconds —
  so a merge can be deployed, reported as successful, and never actually run.
  This has happened repeatedly. The cost of rebuilding every time is a few
  minutes; the cost of not doing it is shipping nothing and not knowing.

### Which Node the build uses

**`.node-version`.** The build log names its source outright:

    node │ 22.23.2 │ idiomatic-version-file (22.23.2)

`engines.node` is `22.x` as well and agrees, but it is not what won. An
earlier version of this section said the opposite -- that Railpack reads only
`package.json` > `engines` > `node` and ignores `.node-version` -- on the
strength of reading `applyNodeVersionResolution` in Railpack's source. That
function is real, but mise resolves an idiomatic version file first, so the
conclusion was wrong. Both files say 22, so nothing broke; the documentation
was simply misleading about which one to edit.

**Change `.node-version` first**, and keep `engines.node` in step so npm's
`EBADENGINE` warnings stay meaningful. A `RAILPACK_NODE_VERSION` service
variable would override both; none is set, and none should be.

It was `>=20` until this was pinned, which resolved to Node 20 on Railway
while every local check ran on Node 22. One real consequence: `@azure/identity`
requires Node 22 and was being installed onto Node 20, so every build printed
an `EBADENGINE` warning. Nothing broke, because nothing imports that package,
but a local check on Node 22 could never have caught it.

### The deployed bundle is ~325 kB bigger than the same commit built locally

Measured, not explained. An earlier note here blamed the Node version and
claimed the pin would take the bundle from 1,023 kB to 701 kB. **It did not.**

| Build | Node | Bundle |
|---|---|---|
| Railway, 21 Sep | 20.20.2 | 1,023 kB |
| Railway, 22 Sep | 22.23.2 | 1,042 kB |
| Local | 22.22.2 | 716 kB |

The gap is constant across Node versions, so the Node version was never the
cause. Ruled out since: `NODE_ENV=production` at build time (identical bundle
and identical hash either way), a stale `node_modules` (a clean `npm ci` from
the lockfile reproduces the local number), and anything in the client source
branching on the environment (there is none).

What is left to check: Railway transforms **1,895** modules where this
repository transforms **1,890**, so five modules enter the graph there that do
not here. Finding those five is where the next attempt should start.

This is a page-weight question, not a fault -- the app has shipped at roughly
this size throughout.

### Two deployments, one repository

`verloq.co` (the marketing site) and `app.verloq.co` (the app) are deployed by
different hosts from the same repository, and they are meant to stay that way.
Nothing in the build couples them:

| | Host | Serves | Built from |
|---|---|---|---|
| Site | Netlify | `verloq.co` | `site/`, published as-is, no build step |
| App | Railway | `app.verloq.co` | `client/` → `dist/public`, `server/` → `dist/index.js` |

- Vite's root is `client/`, so the app build never reads `site/`.
- Tailwind scans `./client/**` only, so the site cannot pull app styles in or
  push its own out.
- No application code references `site/` at all.
- `netlify.toml` carries `ignore = "git diff --quiet ... -- site/"`, so a push
  that touches only the app does not redeploy the site.

**The one asymmetry worth fixing in the dashboard.** Railway watches the whole
repository, so editing a line of copy in `site/` rebuilds and redeploys the
app. It is harmless but wasteful, and it blurs the boundary. Set **Watch
Paths** in Railway (Settings → Source) so the app only builds for its own
files:

```
client/**
server/**
shared/**
package.json
package-lock.json
vite.config.ts
tailwind.config.ts
tsconfig.json
```

That is the mirror of the rule `netlify.toml` already applies in the other
direction: each deploy reacts only to the files it actually ships.

### Checking what is actually deployed

`GET /healthz` is unauthenticated and answers it in one request:

```
curl -s https://app.verloq.co/healthz
{"status":"ok","commit":"ddfe8d6",
 "client":{"js":"assets/index-bCr6Gohp.js","css":"assets/index-B9lKmKgp.css"},
 "builtAt":"2026-09-19T09:25:54.208Z","startedAt":"..."}
```

Read the two halves against each other:

- `commit` is what the platform says it deployed. Railway sets it on the
  container at deploy time, so it moves **whether or not anything was built**.
- `client` and `builtAt` come from the build output on disk. Vite derives the
  asset names from the client source, and a reused layer keeps its old file
  timestamp.

So `commit` moving while `client` and `builtAt` stand still is a stale deploy:
new label, old code. If they move together, the deploy is real.

To know what the names *should* be, build the same commit locally and compare:
`npm run build` prints them.

**Environment variables** — the full set:

```
NODE_ENV=production
APP_BASE_URL=https://app.verloq.co
SESSION_SECRET=<openssl rand -base64 32>
DATABASE_URL=<Neon pooled string from step 1>
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_AUTH_CLIENT_ID=
MICROSOFT_AUTH_CLIENT_SECRET=
MICROSOFT_AUTH_TENANT_ID=common
GEMINI_API_KEY=
RESEND_API_KEY=
PRIVATE_OBJECT_DIR=/YOUR_BUCKET/private
GOOGLE_APPLICATION_CREDENTIALS_JSON=<one-line JSON>
GCS_PROJECT_ID=
TOKEN_ENCRYPTION_KEY=<openssl rand -base64 32>
ADMIN_EMAIL=
ADMIN_PASSWORD_HASH=
```

`TOKEN_ENCRYPTION_KEY` encrypts mailbox tokens at rest. It must be the *output*
of `openssl rand -base64 32`, not the command itself — pasting the command was
a real outage, and the key must decode to exactly 32 bytes. It is resolved on
first use rather than at import, so a wrong value still lets the app boot and
serve sign-in; only mailbox operations fail, and they fail loudly.

`ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH` enable the admin console at `/admin`
(see [docs/ADMIN_CONSOLE.md](docs/ADMIN_CONSOLE.md)). Generate the hash with
`npm run admin:password`. If either is unset the console is not mounted at all.

Do **not** set `PORT` (Railway injects it), and do not set `GOOGLE_REDIRECT_URI`,
`MICROSOFT_REDIRECT_URI`, `REPLIT_DOMAINS`, `REPL_ID`, or `ISSUER_URL`.

`APP_BASE_URL` and `SESSION_SECRET` are both hard failures at startup in
production ([config.ts](server/config.ts)) — if either is missing the app won't
boot, which is deliberate and much easier to diagnose than a silently broken
OAuth redirect.

Then add the custom domain `app.verloq.co` and copy the CNAME target Railway
gives you.

---

## 6. Cloudflare

```
Type: CNAME    Name: app    Target: <target from Railway>    Proxy: DNS only
```

**Grey cloud, not orange.** Railway cannot complete the ACME challenge to issue
the certificate through Cloudflare's proxy, and an orange-clouded record here
produces a TLS error that looks like a Railway problem.

Leave the Resend DKIM/SPF records as Resend specifies.

---

## Order of operations

1. Neon → `DATABASE_URL`
2. Google Cloud → bucket + CORS, service account key, Gemini key, OAuth client
3. Azure → two registrations
4. Resend → domain verified, key issued
5. Railway → env vars from 1–4, deploy, custom domain, copy CNAME target
6. Cloudflare → `app` CNAME, DNS-only
7. Wait for Railway to report the certificate as issued before testing

## Before any of this is worth doing

Node isn't installed on the dev machine, so the branch has never been compiled:

```bash
npm install && npm run check && npm run build
```

## Then, once — from local, not from the build

```bash
npm run db:push
```

**Take a Neon snapshot first.** Review the SQL `drizzle-kit` proposes; if it
wants to drop anything, stop. Confirm the `sessions` table exists afterwards —
`connect-pg-simple` runs with `createTableIfMissing: false`
([auth.ts:29](server/auth.ts:29)), so without that table every login fails
silently.
