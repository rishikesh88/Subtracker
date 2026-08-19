# Verloq — session handover

Written 2026-08-19. Snapshot of the Replit → Railway migration and the sync
hardening work that followed, so a new session can resume without re-deriving
anything.

Companion documents:

| Doc | Purpose |
|---|---|
| [TESTING.md](../TESTING.md) | Per-phase manual test criteria + reference baseline |
| [PHASE3_INFRA.md](../PHASE3_INFRA.md) | Console runbook (Neon, GCP, Azure, Resend, Railway, DNS) |
| [DEPLOYMENT_BRIEF.md](../DEPLOYMENT_BRIEF.md) | The original handoff brief that started this work |
| [server/core/README.md](../server/core/README.md) | Protected-file protocol + changelog |
| `~/.claude/plans/lets-list-out-tasks-peaceful-cocoa.md` | Full six-phase plan with rationale |

---

## Where things stand

**Live:** <https://app.verloq.co> — Railway, Singapore region, custom domain with
valid TLS, deploying from GitHub `main`.

Working and verified end-to-end in production: email/password signup, session
persistence over HTTPS, Google OAuth sign-in, Gmail connect, the full sync
pipeline (2,458 emails → 7 suggestions), Gemini analysis, GCS object storage,
Resend email delivery.

**Not yet done:** Microsoft/Outlook OAuth (all four `MICROSOFT_*` vars empty, both
flows dark), Resend domain verification unconfirmed, `verloq.co` marketing site
does not exist, Google OAuth still in Testing mode (91 of 100 lifetime user slots
remain).

---

## Infrastructure

| Piece | Value |
|---|---|
| App | `https://app.verloq.co` → Railway project `trustworthy-wonder`, service `Subtracker` |
| Repo | `rishikesh88/Subtracker`, deploys from `main` |
| Database | Neon `ap-southeast-1`, pooled endpoint, 9 tables incl. `sessions` |
| Object storage | GCS bucket `subscriptiontracker-vault` (`asia-southeast1`, uniform access) |
| Service account | `verloq-storage@subscriptiontracker-469706.iam.gserviceaccount.com`, `objectAdmin` scoped to the bucket |
| GCP project | `subscriptiontracker-469706` |
| AI | Gemini via `GEMINI_API_KEY` |
| Email | Resend, sending as `Verloq <noreply@verloq.co>` |
| DNS | **GoDaddy**, not Cloudflare as the brief assumed |

### Gotchas discovered the hard way

- **Railway auto-deploy did not fire** on merge to `main`. Recovered with
  `railway redeploy --from-source --yes` (plain `redeploy` rebuilds the *same*
  commit and will not pick up new code). Worth fixing in Settings → Source.
- **Railway's Raw Editor overwrites the whole variable set.** Pasting a local
  `.env` in there silently reverted `APP_BASE_URL` to `http://localhost:5000`,
  which passed the startup guard (it checks *unset*, not *wrong*) and produced a
  localhost OAuth redirect in production.
- **A trailing newline in `GOOGLE_CLIENT_ID`** surfaced as `%0A` in the redirect
  URL. Verify pasted secrets byte-for-byte, not visually.
- **Masked terminal output was pasted into `.env`** — `GEMINI_API_KEY` literally
  contained `AIzaSyCc•••••••…`. Non-ASCII in a credential is the tell.
- **GCS billing account closed twice** mid-setup, surfacing as unrelated-looking
  storage errors.
- **DNS is GoDaddy**, so the brief's "grey cloud / DNS-only" Cloudflare guidance
  does not apply. The domain already carries GoDaddy email MX + DKIM records that
  Resend's records must coexist with.

---

## Completed work

### Migration (PR #2, merged)

Nine commits removing Replit coupling:

1. Removed `@replit/*` Vite plugins — `runtimeErrorOverlay()` was an
   unconditional import from `devDependencies` and would have broken any
   production install
2. Added `server/config.ts` — `APP_BASE_URL` + `SESSION_SECRET`, both hard-failing
   at startup in production
3. All four OAuth callbacks now derive from `APP_BASE_URL` instead of
   `REPLIT_DOMAINS`
4. `SESSION_SECRET` fail-fast; renamed `replitAuth.ts` → `auth.ts`. `trust proxy`,
   `cookie.secure`, `sameSite: 'lax'` and the 7-day TTL were already correct
5. Replaced the Replit object-storage sidecar (`127.0.0.1:1106`) with real GCS
   credentials + the SDK's own v4 signer
6. Added `/healthz`, ahead of auth middleware, no DB touch
7. Resend sender → `Verloq <noreply@verloq.co>`
8. `/api/sync-emails-llm` returns `202` and runs in the background — it previously
   awaited a 15–60 min sync inline, which no proxy tolerates
9. `.env.example`, `.env` gitignored, `pg` promoted to a direct dependency,
   `engines.node >= 20`

The dormant Replit OIDC branch was deliberately left intact — it self-disables
when `REPLIT_DOMAINS` is unset, and `isAuthenticated` is the most load-bearing
function for real users.

### Phase 1 of sync hardening (PR #3, merged, **deployed but unverified**)

- `bd581a6` 🔒 **merchants.csv path fix.** `loadMerchants()` resolved the CSV
  relative to `import.meta.dirname`, which is `server/core` under `tsx` but
  `dist/` after bundling. Production logged `ENOENT` on every sync — **merchant
  enrichment was silently disabled in every deployed build since the migration**,
  including the run that produced the current 7 suggestions. `resolveCsvPath()`
  now tries source-, bundle- and cwd-relative locations. Protected-file protocol
  followed: v1.0.0 → 1.0.1, changelog updated, lookup logic untouched.
- `67c6917` **Adaptive rate limiter.** Both Gmail batch loops slept a fixed 12s
  between batches of 50 (~4 req/sec against a ~50 req/sec budget). **588 of the
  sync's 640 seconds were spent in `setTimeout`.** `BatchPacer` starts at 1500ms,
  doubles on rate-limit signals to a 12s ceiling, eases back 15% per clean batch.
  A batch of 50 costs exactly 250 quota units — one second of budget — as a
  burst, then pauses.
- `9147681` `TESTING.md`.

---

## ⚠️ Phase 1 is deployed but NOT verified

The new build is confirmed live (deployment `0d1f4c2f…`, booted clean, healthz
green) and a full sync ran to completion on it. **The improvement was never
measured** — the session lost filesystem read access before the logs could be
analysed.

Railway logs were exported to `~/Downloads/logs.1787138487092.json`. **This is
the first thing to do in a new session.**

| Check | Search for | Pass |
|---|---|---|
| Merchant load | `merchant` | `✅ Loaded 200 known merchants`, **no `ENOENT`** |
| Metadata timing | `Metadata progress` | First `50/2458` → `✅ Retrieved metadata` **under 150s** (baseline 640s) |
| Pacer health | `backing off` | A few is healthy; dozens or a climb to 12000ms means the base rate is too aggressive |
| Regression | `sync complete` | Still ~7 suggestions |

> **Run the timing check before Phase 4 ships.** Phase 4 skips already-synced
> emails, after which a second sync fetches almost nothing and the comparison
> against the 2,458-email baseline becomes meaningless.

Also outstanding: `scripts/phase1-check.mjs` is committed but **broken** — it
guesses column names (`created_at` does not exist on `emails`). Rewrite it
against the real schema or delete it.

---

## Remaining phases

Each is independently deployable, with a check-in after every one.

### Phase 2 — progress reporting + honest watchdog
- **#12** Emit SSE progress during Gmail metadata fetch. There is currently a
  ~10.7 minute window with no SSE traffic at all, which is what the client
  misreads as a hang.
- **#13** Client watchdog: replace the total-duration cap with stall detection
  (time since last progress event) plus a long backstop.

These **must ship together** — a stall watchdog cannot be tested without progress
events to stall on. Risk: low.

> After Phase 1 the sync may land near ~4 min, under the existing 10-minute
> watchdog, making the timeout symptom *appear* fixed. It is not — a
> ~10,000-email mailbox would still trip it.

### Phase 3 — SSE resilience
- **#17** Replay a per-user progress snapshot on reconnect; filter heartbeats out
  of the visible log (source of the `Stage: undefined` entries). Risk: low.

### Phase 4 — repeat-sync cost
- **#16** Skip Gmail message IDs already stored. Risk: **medium** — an
  over-matching filter silently loses mail. Test that *new* mail is still picked
  up, not just that the second sync is fast.

### Phase 5 — durability
- **#18** `sync_jobs` table, concurrency guard (409 on double-trigger), write
  `lastSync` on completion rather than at start, sweep stuck jobs on boot.
  Risk: **higher** — only schema change, needs `db:push`.

Currently `lastSync` is written at sync *start*, so a crashed sync is
indistinguishable from a successful one.

### Phase 6 — model cost
- **#19** Pricing fetched live 2026-08-19. **Newer is not cheaper** —
  `gemini-3.7-flash` ($0.75/$3.75 per 1M) costs more than the `2.5-flash` already
  in use, and that rate doubles 1 Jan 2027.

| Model | Input | Output |
|---|---|---|
| `gemini-2.5-flash-lite` | $0.10 | $0.40 |
| `gemini-2.5-flash` ← current | $0.30 | $2.50 |
| `gemini-3.5-flash-lite` | $0.30 | $2.50 |
| `gemini-2.5-pro` ← current | $1.25 | $10.00 |

Two detectors on two paths: `server/core/geminiSubscriptionDetector.ts` 🔒
(manual sync, all `2.5-flash`) and `server/services/enhancedSubscriptionDetector.ts`
(auto-sync after OAuth connect, `2.5-flash` + **`2.5-pro` ×2**).

- **6a** `2.5-pro` → `2.5-flash` in the auto-sync path (lines 501, 648). 4x cheaper
  both directions, on the path that fires for every new signup. **Not protected.**
  Best value-to-risk.
- **6b** Pre-filter → `2.5-flash-lite`. Highest-volume call, easiest task.
- **6c** Optional: `2.5-flash` → `3.5-flash-lite`, same price, newer.

Ship **one at a time** — batching makes an accuracy regression unattributable.
Gate each on suggestion count holding. Estimated per sync: `2.5-pro` ~$0.099,
`2.5-flash` ~$0.024, `2.5-flash-lite` ~$0.007.

Also: drop the `openai` dependency — declared in `package.json`, imported nowhere.

### Phase 7 — cross-currency / cross-name deduplication
- **#20** The 2026-08-19 run produced both **"Anthropic Claude Subscription"
  (₹2,261.12/mo)** and **"Claude Pro" ($23.60/mo)** — the same subscription,
  detected twice under different names *and* different currencies. The user
  rejected the duplicate manually.

`serviceKey` dedup (normalised service name + frequency) cannot catch this: the
names genuinely differ and neither is wrong. Duplicates inflate the headline
"total monthly spend", which is the product's primary number, so this is a
correctness problem rather than cosmetics.

Worth investigating:
- Group candidates by merchant *domain* rather than service name — both emails
  come from Anthropic. `merchantDatabase` already resolves sender domain to a
  canonical merchant and is now actually loading (Phase 1), so the signal exists.
- Same merchant + same frequency + amounts equivalent once converted ⇒ likely one
  subscription. Needs an FX rate source; a coarse static table may be enough to
  flag rather than auto-merge.
- Safer first step: **flag suspected duplicates in the review UI** ("possible
  duplicate of X") instead of silently merging. Wrongly merging two genuinely
  distinct subscriptions is worse than showing both.

Note `subscriptions.currency` defaults to `INR` while amounts arrive in mixed
currencies, so any total that sums across rows is already suspect independent of
deduplication.

---

## Still pending from the migration

1. **Azure OAuth — not started.** Needs **two** app registrations (the code uses
   separate `MICROSOFT_*` and `MICROSOFT_AUTH_*` credential pairs). The Outlook
   app **must support `common`** — the authority is hardcoded to
   `login.microsoftonline.com/common` in `server/services/outlook.ts` with no env
   override, so a single-tenant registration fails regardless of
   `MICROSOFT_AUTH_TENANT_ID`.
2. **Resend domain verification unconfirmed.** Sends don't error, but DKIM/SPF
   status was never checked in the dashboard. Records go in **GoDaddy**.
3. **Google OAuth verification.** Restricted-scope (`gmail.readonly`) needs
   verification + CASA assessment, 4–8 weeks, and requires a live privacy policy
   URL — so it is blocked on the marketing site existing. Capped at 100 lifetime
   users until then; **9 already used, 91 remain**.
4. **Phase 5 deploy pipeline** — `develop` → staging on a Neon branch, PR
   previews. `db:push` must never enter the build command.
5. **Pre-existing type debt** — `npx tsc --noEmit` reports **11 errors** in four
   files (`recurrenceAnalyzer.ts` 7, `subscriptionDetector.ts` 2,
   `geminiSubscriptionDetector.ts` 1, `emails.tsx` 1). Verified identical on
   `main` via an isolated worktree. This is the baseline — an error in a file you
   touched is a real failure.

---

## Recommended next session

1. Read `~/Downloads/logs.1787138487092.json`, verify Phase 1, report pass/fail
2. Fix or delete `scripts/phase1-check.mjs`
3. If Phase 1 passes → Phase 2 (**#12 + #13** together)
4. If the metadata phase is still slow → tune `BatchPacer.BASE_DELAY_MS` in
   `server/services/gmail.ts` before moving on

Suggested opening prompt:

> Read docs/HANDOVER.md and TESTING.md. Verify Phase 1 from
> ~/Downloads/logs.1787138487092.json, then we'll decide on Phase 2.
