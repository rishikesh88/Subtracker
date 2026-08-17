# Merloq — production deployment brief

Handoff document. Drop this in the repo root and open it as the first prompt in Claude Code.

---

## Context for Claude Code

This repo (`rishikesh88/Subtracker`, product name **Merloq**) was built on Replit and currently runs at `merloq.replit.app`. We are moving it to our own infrastructure and domain for a real (small) user launch.

**Stack, as of the last read of `package.json`:**

- Vite + React 18 SPA in `client/`, Express server in `server/`, shared Drizzle schema in `shared/`
- Single deployable: `npm run build` compiles the client with Vite and bundles the server with esbuild into `dist/`; `npm start` runs one Node process that serves both the API and the built client
- Postgres via `drizzle-orm` + `@neondatabase/serverless` (WebSocket driver, needs `ws`)
- Sessions: `express-session` + `connect-pg-simple` (server-side, stored in Postgres)
- Auth: `passport-local`, `passport-google-oauth20`, `passport-azure-ad`; mailbox access via `googleapis` and `@microsoft/microsoft-graph-client`
- Object storage: `@google-cloud/storage` server-side, `@uppy/aws-s3` client-side
- AI: `@google/genai` (Gemini), plus `openai` and `pdf-parse` in the dependency list
- Transactional email: `resend`

**Target architecture:**

| Piece | Where | Notes |
|---|---|---|
| `verloq.co` | Marketing site, hosted separately | Static. Not in this repo. Links to the app. |
| `app.verloq.co` | This repo, on Railway | Serves API + React client from one Node process |
| Database | Neon, Singapore (`ap-southeast-1`) | Keep the existing serverless driver — do not swap to `node-postgres` |
| Object storage | Google Cloud Storage bucket | Keep `@google-cloud/storage`; replace Replit's provisioned bucket |
| AI | Gemini via Google Cloud | Same project as the bucket |
| Email | Resend | Domain `verloq.co` |
| DNS | Cloudflare | `app` CNAME → Railway, DNS-only (not proxied) |

Note the domain is `verloq.co`, not `merloq.com`. The product name in the README says Merloq — leave copy alone for now unless asked; this is a hosting task, not a rename.

**Constraints:**

- Minimal changes. No refactor, no framework swaps, no rewriting the data layer. If a change is not required to run off Replit, don't make it — raise it instead.
- Real users will sign up, so correctness of auth, sessions, and the background sync matters more than tidiness.
- Deploy must be push-to-main → live, with no manual build steps.

---

## Phase 1 — Repo audit (do this first, change nothing yet)

Read the repo and produce a written report before editing. Specifically:

1. **Environment variables.** Grep `server/`, `client/`, `shared/`, and all config files for `process.env` and `import.meta.env`. Produce a table: variable name, where it's read, what it's for, and whether Replit was providing it implicitly (look for `REPL*`, Replit object-storage defaults, Replit-injected DB URLs, and anything used to build OAuth callback URLs). Output a `.env.example` with every variable and a one-line comment each.

2. **Replit coupling.** List everything that will break or noop off Replit: the `@replit/vite-plugin-cartographer` and `@replit/vite-plugin-runtime-error-modal` plugins in `vite.config.ts`, anything in `.replit`, any hardcoded `*.replit.app` URLs or Replit sidecar endpoints.

3. **OAuth callback construction.** Find exactly how the Google and Microsoft redirect URIs are built — hardcoded, env var, or derived from the request host. Report the exact callback paths so we can register them in the Google and Azure consoles.

4. **Session config.** Report the current `express-session` options: store, `cookie.secure`, `sameSite`, `trust proxy`, secret source, and TTL.

5. **The background sync.** Find where the Gmail/Outlook sync runs. Report: is it fired-and-forgotten after the HTTP response, is there any persisted job state, and roughly what's the worst-case wall-clock time for a 180-day sync? This determines whether an idle-sleeping host would corrupt a sync mid-flight.

6. **Object storage.** Report how the GCS client authenticates (ADC, key file, env-embedded JSON?) and how the client-side Uppy S3 flow gets its signed URLs.

7. **Secrets in git history.** Run `git log --all --full-history -- .env .env.local` and grep history for anything key-shaped. 434 commits of Replit autosave is a plausible place for a leaked key. Report findings — do not attempt to rewrite history without asking.

Stop after this report. Wait for confirmation before Phase 2.

---

## Phase 2 — Code changes

Once the audit is agreed:

1. Remove the `@replit/*` Vite plugins from `vite.config.ts` and `package.json`.
2. Make npm scripts cross-platform (`cross-env` for the inline `NODE_ENV=`), if any development happens on Windows.
3. Session hardening: `app.set('trust proxy', 1)`, `cookie.secure` true in production, `sameSite: 'lax'`, secret from `SESSION_SECRET` with a hard failure (not a fallback default) if unset in production.
4. Replace any hardcoded `merloq.replit.app` or Replit-derived base URL with an `APP_BASE_URL` env var, defaulting to `http://localhost:5000` in development.
5. Add a `/healthz` route returning 200 for Railway's health check.
6. Commit `.env.example`. Confirm `.env` is gitignored.

Keep each of these as a separate commit with a clear message.

---

## Phase 3 — Infrastructure (I'll do the console work; tell me what you need)

For each of these, tell me the exact values to paste and where:

1. **Neon** — project in `ap-southeast-1`. I'll return the pooled connection string.
2. **Google Cloud** — project, GCS bucket, service account scoped to that bucket, Gemini API key, OAuth consent screen + client credentials with the callback path from the audit.
3. **Azure** — app registration, client secret, redirect URI.
4. **Resend** — `verloq.co` sending domain; I'll add the DKIM/SPF records in Cloudflare.
5. **Railway** — deploy from GitHub, Singapore region, env vars, custom domain `app.verloq.co`.
6. **Cloudflare** — `app` CNAME to Railway's target, **DNS-only / grey cloud** so Railway can issue the certificate.

---

## Phase 4 — First deploy

1. Run `npm run build` locally and fix whatever fails before touching Railway.
2. Run `npm run db:push` once against Neon from local. Take a Neon snapshot first. Review the SQL `drizzle-kit` proposes — if it wants to drop anything, stop and ask.
3. Deploy. Verify in this order: `/healthz` → email OTP signup → Google sign-in → Microsoft sign-in → org setup → a short 7-day sync → PDF appears in the vault → dashboard renders.
4. Confirm the session cookie survives a refresh over HTTPS. This is the most likely thing to break.

---

## Phase 5 — Deploy pipeline

Goal: `git push origin main` → Railway builds and swaps traffic, zero downtime, no manual steps.

- Set up a `develop` branch → staging Railway environment, backed by a Neon branch of prod.
- Enable PR preview environments.
- **Do not** add `db:push` to the build command. Migrations stay a deliberate manual step.

---

## Known blocker (not solvable in code)

Gmail read scopes are Google-restricted. Production access needs OAuth verification plus a third-party CASA security assessment — typically 4–8 weeks. Until then the app is capped at 100 manually-added test users, each seeing an unverified-app warning. The verification form requires the live domain, a privacy policy URL, and a screen recording of the consent flow, so it can only start after Phase 4.

Flag anywhere in the code where the scope list is broader than it needs to be — a smaller scope set is a faster review.

---

## Ground rules

- Ask before: rewriting git history, changing the database driver, altering the schema, touching anything in `attached_assets/`.
- Don't invent env var names — take them from the audit.
- Don't commit any real secret, ever, including in `.env.example`.
- If something in the audit contradicts this brief, the code wins. Tell me what's different.
