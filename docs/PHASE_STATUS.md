# Phase status board

Quick reference. Detail lives in [HANDOVER.md](HANDOVER.md); test criteria in
[TESTING.md](../TESTING.md).

Last updated 2026-08-19.

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
| **1** | 14 | Adaptive Gmail rate limiter | 🚀 **deployed, UNVERIFIED** | low |
| **1** | 15 | 🔒 merchants.csv path fix | 🚀 **deployed, UNVERIFIED** | low |
| **2** | 12 | SSE progress during metadata fetch | ⬜ pending | low |
| **2** | 13 | Stall-based client watchdog | ⬜ pending | low |
| **3** | 17 | SSE reconnect recovery + heartbeat filter | ⬜ pending | low |
| **4** | 16 | Skip already-synced message IDs | ⬜ pending | **medium** |
| **5** | 18 | `sync_jobs` table + concurrency guard | ⬜ pending | **higher** |
| **6** | 19 | Model cost optimisation | ⬜ pending | **higher** |

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
| Phase 1 never measured | Don't start Phase 2 until verified — and **verify before Phase 4**, which invalidates the baseline |
| `scripts/phase1-check.mjs` broken | Guesses column names; `created_at` doesn't exist on `emails` |
| 11 pre-existing `tsc` errors | Baseline, identical on `main`. New errors in touched files are real failures |
| `lastSync` written at sync *start* | A crashed sync looks successful. Fixed by #18 |
| Railway auto-deploy unreliable | Use `railway redeploy --from-source --yes`; plain `redeploy` rebuilds the same commit |
| `openai` dependency unused | Dead weight; drop in Phase 6 |

## Reference baseline

From the first successful production sync, before any hardening:

| Measure | Value |
|---|---|
| Emails in window | 2,458 |
| Metadata fetch | **640 s** |
| Total sync | **751 s** |
| Candidates after screening | 190 |
| Approved by pre-filter | 13 |
| Suggestions | **7** (5 high confidence) |
| Merchants loaded | **0** — `ENOENT` |

Suggestion count is the regression canary: ~7 on this mailbox through every
phase. Fewer means something changed detection behaviour.
