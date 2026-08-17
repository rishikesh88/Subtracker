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
```

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
