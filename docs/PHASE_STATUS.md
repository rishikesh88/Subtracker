# Phase status board

Quick reference. Detail lives in [HANDOVER.md](HANDOVER.md); test criteria in
[TESTING.md](../TESTING.md).

Last updated 2026-09-09.

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
| **4** | 16 | Skip already-synced message IDs | ✅ verified (§4a, §4b); §4c fixed, unverified | **medium** |
| **5** | 18 | `sync_jobs` table + concurrency guard | ✅ deployed, table live; §5a/§5b/§5c unrun | **higher** |
| **6** | 19 | Model cost optimisation | 🔨 6a built; 6b/6c pending | **higher** |
| **7** | 20 | Cross-currency / cross-name dedup | 🔨 built — flags, does not merge | **medium** |

**#12 and #13 must ship together** — a stall watchdog is untestable without
progress events to stall on.

**Phase 4 took two attempts.** The first cut filtered against the `emails`
table, which holds only the pre-filter survivors — 124 rows against a 2,582
message window. It saved ~4s of a 333s run and nothing on the pre-filter. The
fix filters against `screened_messages`, every id the sync has looked at.

**§4c is now handled at two levels.** The 2026-08-22 run raised two Airtel
Black suggestions, because inserts did not check for an existing `serviceKey`.
`createSuggestionsBulk` now collapses same-key duplicates within a run and skips
any already `pending`. Approval remains the backstop, logging `Duplicate
subscription detected for X, updating existing instead`.

Matching is on `serviceKey` alone, so #20's cross-name case is untouched:
"Claude Pro" and "Anthropic Claude Subscription" have different keys and still
both appear. That is deliberate — merging genuinely distinct subscriptions is
worse than showing both.

**Phase 5 is deployed and its table is live**, confirmed by every sync claiming
a job — the `⚠️ Running sync without a job record` warning never appears. What is
unproven is the 409 surfacing (§5a) and crash recovery (§5b/§5d).

A follow-up fixed #18 undermining itself: a run where the only account failed on
`invalid_grant` was still recorded `succeeded`, because account failures return
`{success:false}` rather than throwing. A run is now `succeeded` only if at least
one account synced.

**Still unrun:** §2d, §3c, §5a, §5b.

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
| Invoices exist only where a receipt had an attachment | **Not the bug it looked like.** The `🔑 Gmail access token available: false` line was misleading: `approveSuggestions` took a token parameter it never used, sourced from `users.gmailAccessToken`, deprecated when tokens moved to `gmail_accounts`. Removed. Invoices are built solely from attachments captured during the sync, so a subscription whose receipts are HTML — Claude Pro, iCloud+, Apple One, Netflix — correctly gets none. **Open feature gap:** an attachment missed at sync time can never be recovered later |
| **§2d, §3c, §5a, §5b never run** | Forced stall, reconnect-after-sleep, the 409 guard, and crash recovery are all unverified. §5a and §5b became *harder* to test once Phase 4 landed: a repeat sync now finishes in ~11s, leaving almost no window to overlap a second trigger or to redeploy mid-run |
| **`users.lastSync` is effectively dead** | Written only when `wasOnboarding && privacyConsentGiven` ([routes.ts:897](../server/routes.ts#L897)), so it never updates for an existing user — still `null` on the live account. Displayed nowhere. §5c cannot be tested by any normal action, and the field itself looks vestigial |
| **6a is not exercised by a manual sync** | The changed calls live in the onboarding-only auto-sync path. A manual sync uses the protected core detector, already all-flash. Verifying 6a needs a fresh signup |
| **`serviceKey` was `monthly_monthly` for every subscription** | Fixed 2026-09-09. `generateServiceKey` took `(serviceName, merchantName?, frequency)` and every caller passed frequency into the middle slot, so the key carried no service identity — which is why duplicate detection never worked, and why two Claude Pro rows coexist. **Existing rows keep the broken keys**; a backfill is a separate decision |
| Client bundle differs local vs Railway | Same commit and lockfile, identical CSS hash and server bundle, but Railway emits 2,199 modules / 1,078 kB against 732 kB locally. Unexplained; not dev-React. Phase 3 *is* live (§2b passes), so it is not a stale-deploy problem |
| SSE stream cut every ~15 min | Platform proxy closes it despite 30s heartbeats; the browser reconnects instantly. #17 replays a snapshot so the reconnect is invisible |
| Unknown `/api/*` paths return **200 + HTML** | `app.use("*")` in [vite.ts:82](../server/vite.ts:82) serves `index.html` for everything unmatched. No leak — a scanner probing `/api/.env` got the SPA shell — but API 404s are indistinguishable from hits in the logs |
| `URIError: Failed to decode param '/%c0'` | Unhandled `serve-static` throw on a malformed path. Logged a stack trace; did not crash |
| Replit OIDC branch still in boot path | `[Auth] REPLIT_DOMAINS not set, skipping Replit OIDC auth setup` on every start. Dead code from the migration |
| 11 pre-existing `tsc` errors | Baseline, identical on `main`. New errors in touched files are real failures |
| **Railway auto-deploy does not fire on merge** | Confirmed across #5–#8: the merge commit carries no Railway deployment status, so the webhook is not arriving. Deploy manually with `railway redeploy --from-source --yes`; plain `redeploy` rebuilds the same commit. Check the Railway install at github.com/settings/installations |

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

### Repeat sync — 2026-09-09, §4a re-measured

| Measure | Value |
|---|---|
| Already seen | 4,105 screened / 198 stored |
| In window | 2,618 |
| Skipped | **2,609** |
| Genuinely new | 9 |
| Total | **11 s** (cold run that morning: 337 s) |

The strongest §4a reading yet. The cold run beforehand took 337s for 1,403 new
messages after a 16-day gap; the repeat took eleven seconds.

### Repeat sync — 2026-08-24, the first §4a measurement

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
