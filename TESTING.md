# Sync hardening — test guide

Manual test plan for the six-phase sync work. Each phase is independently
deployable; run its section after that phase ships and before starting the next.

---

## Setup

**Watch production logs** (most tests depend on this):

```bash
railway logs
```

If `railway` is not linked in a fresh shell:

```bash
railway link   # select: trustworthy-wonder -> production -> Subtracker
```

**Trigger a sync:** open <https://app.verloq.co>, sign in, click **Sync Emails**
on the dashboard.

**If a sync gets stuck** and the button will not re-trigger, clear the stale
status (this is a symptom Phase 5 removes permanently):

```bash
node --env-file=.env -e "
import('@neondatabase/serverless').then(async ({ neon }) => {
  const sql = neon(process.env.DATABASE_URL);
  const r = await sql\`update gmail_accounts set sync_status = 'idle', sync_error = null returning id\`;
  console.log('reset', r.length, 'account(s)');
});
"
```

### Reference baseline

Recorded from the first successful production sync, before any of this work.
Everything is measured against these numbers.

| Measure | Baseline |
|---|---|
| Emails in window | 2,458 |
| Metadata fetch | **640 s** |
| Total sync | **751 s** |
| Candidates after screening | 190 |
| Approved by pre-filter | 13 |
| Suggestions produced | **7** (5 high confidence) |
| Merchants loaded | **0** — `ENOENT`, silently disabled |

> **Suggestion count is the regression canary.** The same mailbox should keep
> producing ~7 suggestions through every phase. A drop means something changed
> detection behaviour and must be understood before shipping — cheaper or faster
> is not a win if recall falls.

---

## Phase 1 — Speed + merchant data ✅ shipped

### 1a. merchants.csv loads in the bundled build

The bug only reproduces in the esbuild bundle, never under `npm run dev`.

```bash
npm run build
```

Then trigger a sync and watch the logs.

| | Expected |
|---|---|
| ✅ Pass | `[MerchantDatabase] Loading merchants from /app/server/data/merchants.csv` followed by `✅ Loaded 200 known merchants into database` |
| ❌ Fail | Any `ENOENT`, or `Failed to load merchant database` |

Local equivalent, no deploy needed:

```bash
node --env-file=.env node_modules/.bin/tsx -e "
import('./server/core/merchantDatabase.ts').then(m => {
  const db = new m.MerchantDatabase();
  console.log('merchants loaded:', db.getCount());
});
"
```

Expect `merchants loaded: 200`.

### 1b. Sync is materially faster

Trigger a full sync and time the metadata phase from the logs — first
`📊 Metadata progress:` line to `✅ Retrieved metadata for N emails`.

| | Threshold |
|---|---|
| ✅ Pass | Metadata phase **under 150 s** (baseline 640 s) |
| ⚠️ Investigate | 150–300 s — pacer likely backing off; check for rate-limit warnings |
| ❌ Fail | Over 300 s, or sustained `⏳ Rate limited — backing off` |

Occasional back-off warnings are fine and expected — that is the pacer working.
Continuous back-off to the 12 s ceiling means the base rate is too aggressive.

### 1c. Nothing regressed

- Suggestion count still ~7 → detection unaffected by faster fetching
- No new `Failed to fetch` or `Error fetching batch` lines
- Merchant enrichment now active, so suggestion *quality* may improve — more
  suggestions is fine, fewer is a regression

> ⚠️ **Test 1b before Phase 4 ships.** Phase 4 skips already-synced emails, after
> which a second sync fetches almost nothing and the timing comparison against
> the 2,458-email baseline stops being meaningful.

---

## Phase 2 — Progress reporting + honest watchdog

### 2a. Progress advances during metadata fetch

Watch the sync panel for the full run.

| | Expected |
|---|---|
| ✅ Pass | Percentage moves continuously through the metadata phase |
| ❌ Fail | Sits at 0% for minutes, then jumps |

The old failure was a ~10.7 minute silent window with no SSE traffic at all.

### 2b. No `Stage: undefined`

The progress log must never print `Stage: undefined`. Every entry should carry
readable text.

### 2c. Watchdog does not fire falsely

Let a full sync run to completion without touching the browser.

| | Expected |
|---|---|
| ✅ Pass | Completes normally; no "timed out" message |
| ❌ Fail | Panel claims timeout while the server logs show work still progressing |

### 2d. Watchdog still catches a real stall

Hard to force safely in production. Acceptable substitute: confirm in the code
that the watchdog triggers on *time since last progress event*, not total
elapsed time, and that a long-running backstop still exists.

---

## Phase 3 — SSE reconnect

### 3a. State survives a refresh

1. Start a sync
2. Wait for progress past ~20%
3. Hard-refresh the page (`Cmd+Shift+R`)

| | Expected |
|---|---|
| ✅ Pass | Panel reappears showing true current progress |
| ❌ Fail | Shows 0%, "starting", or a false timeout |

### 3b. Heartbeats stay out of the log

The visible progress log must not fill with keep-alive entries. Only real stage
changes should appear.

### 3c. Reconnect after sleep

Start a sync, close the laptop lid for ~2 minutes, reopen.

Expect the panel to reconnect and show current state rather than a dead
connection or a stuck percentage.

---

## Phase 4 — Repeat-sync cost

### 4a. Second sync is near-instant

1. Run a full sync, let it finish
2. Immediately run another

| | Expected |
|---|---|
| ✅ Pass | Second sync completes in seconds; logs show almost no metadata fetching |
| ❌ Fail | Re-fetches the full mailbox |

### 4b. New mail is still picked up

1. Send yourself a subscription-like email (any receipt or renewal notice)
2. Run a sync

| | Expected |
|---|---|
| ✅ Pass | The new email is fetched and analysed |
| ❌ Fail | Skipped — the filter is over-matching, which silently loses mail |

This is the risk case for Phase 4. A skip filter that is too aggressive causes
permanent, invisible data loss.

### 4c. Suggestion set is stable

Existing suggestions should not be duplicated or dropped by the second run.

---

## Phase 5 — Durability

### 5a. Concurrent syncs are rejected

Open the dashboard in two tabs. Trigger a sync in both, quickly.

| | Expected |
|---|---|
| ✅ Pass | One runs; the other is rejected cleanly (409) with a clear message |
| ❌ Fail | Both run — duplicated work and possible duplicate suggestions |

### 5b. Crashes are recorded honestly

1. Start a sync
2. Mid-run, restart the service: `railway redeploy`

Then inspect job state:

```bash
node --env-file=.env -e "
import('@neondatabase/serverless').then(async ({ neon }) => {
  const sql = neon(process.env.DATABASE_URL);
  console.log(await sql\`select id, status, started_at, finished_at, error from sync_jobs order by started_at desc limit 5\`);
});
"
```

| | Expected |
|---|---|
| ✅ Pass | Job ends `failed`, not stuck `running` |
| ❌ Fail | Still `running` forever, blocking future syncs |

### 5c. `lastSync` means completed

After a *failed* or interrupted sync, `users.lastSync` must **not** have advanced.
The current bug writes it at sync *start*, so a crashed sync is indistinguishable
from a successful one.

### 5d. Stuck jobs are swept on boot

After 5b, a fresh deploy should mark any orphaned `running` job as `failed`
rather than leaving it to block the next sync.

---

## Phase 6 — Model cost

Detection quality is the whole point here, so each step is gated on recall.

### 6a. Establish the comparison

Before changing any model, record on the test mailbox:

- Number of suggestions
- Which services were found (write them down)
- Confidence split

### 6b. After each model swap

Re-run on the **same mailbox** and compare.

| | Result |
|---|---|
| ✅ Ship it | Same services found, count within ±1 |
| ⚠️ Investigate | Same count, different services |
| ❌ Revert | Any previously-found subscription now missing |

Run the three changes **one at a time** — `2.5-pro → 2.5-flash`, then the
flash-lite pre-filter, then optionally `3.5-flash-lite`. Batching them makes an
accuracy regression unattributable.

### 6c. Cost check

Confirm the drop in [Google Cloud billing](https://console.cloud.google.com/billing)
for the Generative Language API after a few real syncs. Expected direction:
~$0.099 → ~$0.024/sync for the auto-sync path.

---

## Cross-phase regression checklist

Run before considering any phase complete:

- [ ] `npm run build` succeeds
- [ ] `npx tsc --noEmit` shows **11 errors**, all in `recurrenceAnalyzer.ts` (7),
      `subscriptionDetector.ts` (2), `geminiSubscriptionDetector.ts` (1),
      `emails.tsx` (1) — this is the known pre-existing baseline, verified
      identical on `main`. Any error in a file you touched is a real failure.
- [ ] `https://app.verloq.co/healthz` returns `{"status":"ok"}`
- [ ] Signup → session → authenticated request still works
- [ ] Suggestion count on the reference mailbox is still ~7
