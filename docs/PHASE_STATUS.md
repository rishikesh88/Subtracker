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
| **2** | 12 | SSE progress during metadata fetch | ✅ verified (§2a) | low |
| **2** | 13 | Stall-based client watchdog | ✅ verified (§2c); §2d untested | low |
| **3** | 17 | SSE reconnect recovery + heartbeat filter | ⚠️ deployed; §2b passes, **§3a untested** | low |
| **4** | 16 | Skip already-synced message IDs | 🔨 built, not yet deployed | **medium** |
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
| Client bundle differs local vs Railway | Same commit and lockfile, identical CSS hash and server bundle, but Railway emits 2,199 modules / 1,078 kB against 732 kB locally. Unexplained; not dev-React. Phase 3 *is* live (§2b passes), so it is not a stale-deploy problem |
| §3a and §2d never run | Phase 3's reconnect replay and the forced-stall watchdog are both unverified in production |
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
with `node --env-file=.env scripts/detection-baseline.mjs`.

## Canary — 2026-08-22, after Phases 2 and 3

No baseline service lost, three gained:

| Service | Amount |
|---|---|
| Airtel Black 1598 Plan | ₹1,885.64 / mo |
| Apple One Family | ₹365.00 / mo |
| Claude Pro | ₹2,261.12 / mo |
| iCloud+ | ₹219.00 / mo |
| Memorisely Membership | $180.00 / yr |
| **Netflix** | ₹649.00 / mo |
| **Google One (100 GB)** | ₹130.00 / mo |
| **YouTube Premium** | ₹149.00 / mo |

"Anthropic Claude Subscription" is absent, and that is the *correct* outcome —
it was the #20 duplicate of Claude Pro. The surviving row has the right amount:
₹1,916.20 + 18% GST = ₹2,261.12, the same pattern as Airtel's 1598 + GST.
**#20 is still unimplemented**, so a future run can resurface the pair.

Read this list with one caveat: it is the *Subscriptions* view, captured after
approval, so the three new services cannot be attributed to this run alone.
What it does establish is that nothing from the baseline went missing.
