# Phase status board

Quick reference. Detail lives in [HANDOVER.md](HANDOVER.md); test criteria in
[TESTING.md](../TESTING.md).

Last updated 2026-08-20.

## Migration (PR #2)

| # | Task | Status |
|---|---|---|
| 1 | Remove `@replit` Vite plugins | ✅ verified |
| 2 | `server/config.ts` — `APP_BASE_URL` + `SESSION_SECRET` guards | ✅ verified |
| 3 | OAuth callbacks from `APP_BASE_URL` | ✅ verified |
| 4 | Session hardening; `replitAuth.ts` → `auth.ts` | ✅ verified |
| 5 | Replit sidecar → real GCS | ✅ verified |
| 6 | `/healthz` | ✅ verified |
| 7 | Resend sender → `verloq.co` | ✅ verified |
| 8 | `/api/sync-emails-llm` → 202 + background | ✅ verified |
| 9 | `.env.example`, gitignore, `pg`, `engines` | ✅ verified |

## Sync hardening

| Phase | # | Task | Status | Risk |
|---|---|---|---|---|
| **1** | 14 | Adaptive Gmail rate limiter | ✅ verified in production | low |
| **1** | 15 | 🔒 merchants.csv path fix | ✅ verified in production | low |
| **2** | 12 | SSE progress during metadata fetch | 🚀 **deployed, UNVERIFIED** | low |
| **2** | 13 | Stall-based client watchdog | 🚀 **deployed, UNVERIFIED** | low |
| **3** | 17 | SSE reconnect recovery + heartbeat filter | 🔨 built, not yet deployed | low |
| **4** | 16 | Skip already-synced message IDs | ⬜ pending | **medium** |
| **5** | 18 | `sync_jobs` table + concurrency guard | ⬜ pending | **higher** |
| **6** | 19 | Model cost optimisation | ⬜ pending | **higher** |
| **7** | 20 | Cross-currency / cross-name dedup | ⬜ pending | **medium** |

**#12 and #13 must ship together** — a stall watchdog is untestable without
progress events to stall on.

## Infrastructure

| Item | Status |
|---|---|
| Neon (`ap-southeast-1`, pooled, schema pushed) | ✅ |
| GCS bucket + CORS + scoped service account | ✅ |
| Gemini API key | ✅ |
| Resend API key | ✅ |
| Railway (Singapore, `/healthz`, custom domain, TLS) | ✅ |
| DNS — `app` CNAME (**GoDaddy**, not Cloudflare) | ✅ |
| Google OAuth — sign-in + Gmail connect | ✅ (Testing mode, 91/100 slots left) |
| Azure — 2 app registrations | ❌ not started |
| Resend domain verification (DKIM/SPF) | ⚠️ unconfirmed |
| `verloq.co` marketing site | ❌ does not exist |
| Google restricted-scope verification | ⏸ blocked on privacy policy URL |
| `develop` → staging + PR previews | ⬜ pending |

## Known issues

| Issue | Impact |
|---|---|
| Phase 2 never measured | **Verify before Phase 4**, which invalidates the baseline |
| SSE stream cut every ~15 min | Platform proxy closes it despite 30s heartbeats; the browser reconnects instantly. #17 replays a snapshot so the reconnect is invisible |
| Unknown `/api/*` paths return **200 + HTML** | `app.use("*")` in [vite.ts:82](../server/vite.ts:82) serves `index.html` for everything unmatched. No leak — a scanner probing `/api/.env` got the SPA shell — but API 404s are indistinguishable from hits in the logs |
| `URIError: Failed to decode param '/%c0'` | Unhandled `serve-static` throw on a malformed path. Logged a stack trace; did not crash |
| Replit OIDC branch still in boot path | `[Auth] REPLIT_DOMAINS not set, skipping Replit OIDC auth setup` on every start. Dead code from the migration |
| 11 pre-existing `tsc` errors | Baseline, identical on `main`. New errors in touched files are real failures |
| `lastSync` written at sync *start* | A crashed sync looks successful. Fixed by #18 |
| Railway auto-deploy unreliable | Use `railway redeploy --from-source --yes`; plain `redeploy` rebuilds the same commit |
| `openai` dependency unused | Dead weight; drop in Phase 6 |

## Reference baseline

| Measure | Pre-work | After Phase 1 |
|---|---|---|
| Emails in window | 2,458 | 2,505 |
| Metadata fetch | 640 s | **85 s** (7.5x) |
| Total sync | 751 s | **503 s** |
| — of which pre-filter | — | **321 s** (64%) |
| Candidates after screening | 190 | **655** |
| Approved by pre-filter | 13 | **58** |
| Suggestions | 7 | **6** |
| Merchants loaded | 0 — `ENOENT` | **200** |

**Compare against the "After Phase 1" column.** Phase 1 moved the bottleneck
from Gmail I/O to the AI pre-filter.

The regression canary is the **service list, not the count** — a changed count
may just be Gemini non-determinism, but a missing service is real. Capture it
with `node --env-file=.env scripts/detection-baseline.mjs`. Current set: Airtel
Black Plan, Anthropic Claude Subscription, Apple One Family, Claude Pro,
Memorisely Membership, iCloud+ 200 GB.
