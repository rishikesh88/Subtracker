# Phase status board

Quick reference. Detail lives in [HANDOVER.md](HANDOVER.md); test criteria in
[TESTING.md](../TESTING.md).

Last updated 2026-08-24.

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
| **3** | 17 | SSE reconnect recovery + heartbeat filter | ✅ verified (§2b, §3a); §3c untested | low |
| **4** | 16 | Skip already-synced message IDs | ✅ verified (§4a, §4b); §4c partial — see below | **medium** |
| **5** | 18 | `sync_jobs` table + concurrency guard | ⬜ pending | **higher** |
| **6** | 19 | Model cost optimisation | ⬜ pending | **higher** |
| **7** | 20 | Cross-currency / cross-name dedup | ⬜ pending | **medium** |

**#12 and #13 must ship together** — a stall watchdog is untestable without
progress events to stall on.

**Phase 4 took two attempts.** The first cut filtered against the `emails`
table, which holds only the pre-filter survivors — 124 rows against a 2,582
message window. It saved ~4s of a 333s run and nothing on the pre-filter. The
fix filters against `screened_messages`, every id the sync has looked at.

**§4c is partially satisfied.** Duplicate *suggestions* still occur — the
2026-08-22 run raised two for Airtel Black — because inserts do not check for an
existing `serviceKey`. They do not reach your subscriptions: approval logs
`Duplicate subscription detected for Airtel Black, updating existing instead`.
So the visible effect is a duplicated row in the review list, not double
counting. Removing it entirely belongs with #20.

**Still unrun:** §2d (forced stall via mid-sync redeploy) and §3c (reconnect
after sleep).

## Infrastructure

| Item | Status |
|---|---|
| Neon (`ap-southeast-1`, pooled, schema pushed) | ✅ |
| GCS bucket + CORS + scoped service account | ✅ |
| Gemini API key | ✅ |
| Resend API key | ✅ |
| Railway (Singapore, `/healthz`, custom domain, TLS) | ✅ — **auto-deploy broken, deploys are manual** |
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
| **Invoice creation has no Gmail token** | `🔑 Gmail access token available: false` on every approval. It falls back to attachments captured during the sync, so only subscriptions whose evidence email carried a PDF get invoices — **5 of 8 produced none** on 2026-08-22 despite finding evidence emails |
| **§2d and §3c never run** | The forced-stall watchdog and reconnect-after-sleep remain unverified in production |
| Client bundle differs local vs Railway | Same commit and lockfile, identical CSS hash and server bundle, but Railway emits 2,199 modules / 1,078 kB against 732 kB locally. Unexplained; not dev-React. Phase 3 *is* live (§2b passes), so it is not a stale-deploy problem |
| SSE stream cut every ~15 min | Platform proxy closes it despite 30s heartbeats; the browser reconnects instantly. #17 replays a snapshot so the reconnect is invisible |
| Unknown `/api/*` paths return **200 + HTML** | `app.use("*")` in [vite.ts:82](../server/vite.ts:82) serves `index.html` for everything unmatched. No leak — a scanner probing `/api/.env` got the SPA shell — but API 404s are indistinguishable from hits in the logs |
| `URIError: Failed to decode param '/%c0'` | Unhandled `serve-static` throw on a malformed path. Logged a stack trace; did not crash |
| Replit OIDC branch still in boot path | `[Auth] REPLIT_DOMAINS not set, skipping Replit OIDC auth setup` on every start. Dead code from the migration |
| 11 pre-existing `tsc` errors | Baseline, identical on `main`. New errors in touched files are real failures |
| `lastSync` written at sync *start* | A crashed sync looks successful. Fixed by #18 |
| **Railway auto-deploy does not fire on merge** | Confirmed across #5–#8: the merge commit carries no Railway deployment status, so the webhook is not arriving. Deploy manually with `railway redeploy --from-source --yes`; plain `redeploy` rebuilds the same commit. Check the Railway install at github.com/settings/installations |
| `openai` dependency unused | Dead weight; drop in Phase 6 |

## Reference baseline

Measured 2026-08-22 on a cleared database, so this run is directly comparable to
the pre-work column rather than being coloured by prior state.

| Measure | Pre-work | After Phase 1 | **After Phase 4** |
|---|---|---|---|
| Emails in window | 2,458 | 2,505 | 2,582 |
| Metadata fetch | 640 s | 85 s | **87 s** |
| Total sync | 751 s | 503 s | **554 s** |
| — of which pre-filter | — | 321 s | **300 s** |
| Candidates after screening | 190 | 655 | **687** |
| Approved by pre-filter | 13 | 58 | **130** |
| Suggestions | 7 | 6 | **12** (10 high conf) |
| Merchants loaded | 0 — `ENOENT` | 200 | **200** |

**Compare a first sync against the "After Phase 4" column.** A first sync on a
cleared database still costs ~9 minutes; Phase 4 changes what a *repeat* sync
costs, not a cold one.

### Repeat sync — 2026-08-24, the §4a measurement

| Measure | Value |
|---|---|
| In window | 2,551 |
| Skipped | **2,431** |
| Genuinely new | 120 |
| Metadata fetch | **4 s** (from 87 s) |
| Pre-filter | **30 s** (from 300 s) |
| Total | **40 s** (from 554 s) — **93% reduction** |

Two days elapsed between the runs, so the 30-day window rolled and 120 real new
messages arrived. That makes this a stronger result than a zero-delta re-run: it
demonstrates the skip and new-mail pickup in the same measurement, which is
exactly what §4b asks for.

The regression canary is the **service list, not the count** — a changed count
may just be Gemini non-determinism, but a missing service is real. Capture it
with `node --env-file=.env scripts/detection-baseline.mjs`.

> **The canary cannot be read from a repeat sync.** Once Phase 4 is active, the
> emails that generate suggestions are skipped, so a second run legitimately
> produces zero. Read it from a run against a cleared database.

## Canary — 2026-08-22, before the database was cleared

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
approval, so the three new services cannot be attributed to one run alone. What
it does establish is that nothing from the baseline went missing.

## Canary — 2026-08-22, first run after clearing

The cold run produced **12 suggestions, 10 high confidence**, against 6 at the
Phase 1 baseline. Services confirmed from the approval log: Claude Pro,
iCloud+, Apple One Family, Airtel Black, Netflix, plus **Swiggy Black** and
**Google Cloud Platform & APIs**, neither of which appears in any earlier run.

Partial by construction — those seven are the ones that reached invoice
creation, not the full twelve. The full list was not captured before approval.
Capture it from the review screen next time, before approving.
