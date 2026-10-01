/* Run: npm run test:renewal */
import {
  DUE_AFTER_DAYS,
  ReconnectNeeded,
  checksPerUserPerDay,
  decideCheck,
  decideClaim,
  isReconnectError,
  mailboxKey,
  nextRetryDay,
  planUserChecks,
  renewalChecksEnabled,
  shouldSendReconnectEmail,
  stateAfter,
  windowDays,
  windowSince,
  STALE_RUN_MS,
  type CheckCandidate,
  type CheckState,
} from "./renewalChecks";
import {
  remindIfNeeded,
  runRenewalJob,
  type CheckResult,
  type FlaggedMailbox,
  type JobDeps,
  type ReminderIo,
} from "./renewalJob";
import { buildReconnectEmail, shortDay } from "../services/reconnectEmail";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}
function ok(label: string, condition: boolean) { check(label, condition, true); }

// Quiet the job's own logging.
const realLog = console.log, realErr = console.error, realWarn = console.warn;
function quiet<T>(fn: () => Promise<T>): Promise<T> {
  console.log = () => {}; console.error = () => {}; console.warn = () => {};
  return fn().finally(() => { console.log = realLog; console.error = realErr; console.warn = realWarn; });
}

const DAY = 24 * 60 * 60 * 1000;
function plusDays(day: string, n: number): string {
  return new Date(new Date(day + "T00:00:00Z").getTime() + n * DAY).toISOString().slice(0, 10);
}

const GMAIL = { provider: "gmail" as const, id: "g1" };

/** A subscription whose expected next payment is `renewal`. */
function cand(over: Partial<CheckCandidate> & { renewal?: string | null } = {}): CheckCandidate {
  const { renewal = "2026-09-10", ...rest } = over;
  return {
    id: "s1",
    frequency: "monthly",
    status: "active",
    lifecycleStatus: "active",
    cancelledAt: null,
    endsOn: null,
    expectedNextPaymentAt: renewal,
    nextBillingDate: null,
    lastPaymentAt: "2026-08-10",
    mailbox: GMAIL,
    ...rest,
  };
}
const none = new Set<string>();
const dueOn = (c: CheckCandidate, today: string, state: CheckState | null = null, flagged = none) => decideCheck(c, state, today, flagged);
const isDue = (c: CheckCandidate, today: string, state: CheckState | null = null, flagged = none) => dueOn(c, today, state, flagged).due;
const reason = (c: CheckCandidate, today: string, state: CheckState | null = null, flagged = none) => {
  const d = dueOn(c, today, state, flagged);
  return d.due ? "due" : d.reason;
};

async function main() {
  console.log("\nWhich subscriptions are due: the N-day boundary, every frequency");
  check("N: weekly 2, monthly/quarterly/yearly 3", DUE_AFTER_DAYS, { weekly: 2, monthly: 3, quarterly: 3, yearly: 3 });
  // Renewal 2026-09-10.
  check("weekly: 1 day after is not due", reason(cand({ frequency: "weekly", renewal: "2026-09-10" }), "2026-09-11"), "not_yet");
  check("weekly: exactly 2 days after is due", reason(cand({ frequency: "weekly", renewal: "2026-09-10" }), "2026-09-12"), "due");
  check("monthly: 2 days after is not due", reason(cand(), "2026-09-12"), "not_yet");
  check("monthly: exactly 3 days after is due", reason(cand(), "2026-09-13"), "due");
  check("quarterly: 2 days not due, 3 due", [
    reason(cand({ frequency: "quarterly", lastPaymentAt: "2026-06-10" }), "2026-09-12"),
    reason(cand({ frequency: "quarterly", lastPaymentAt: "2026-06-10" }), "2026-09-13"),
  ], ["not_yet", "due"]);
  check("yearly: 2 days not due, 3 due", [
    reason(cand({ frequency: "yearly", lastPaymentAt: "2025-09-10" }), "2026-09-12"),
    reason(cand({ frequency: "yearly", lastPaymentAt: "2025-09-10" }), "2026-09-13"),
  ], ["not_yet", "due"]);
  check("before the renewal is not due", reason(cand(), "2026-09-05"), "not_yet");
  check("an unknown frequency is read as monthly", reason(cand({ frequency: "fortnightly" }), "2026-09-13"), "due");
  check("a Date as the expected day works", isDue(cand({ renewal: null, expectedNextPaymentAt: new Date("2026-09-10T00:00:00Z") }), "2026-09-13"), true);
  check("no expected date: the stored renewal date is used", isDue(cand({ renewal: null, nextBillingDate: new Date("2026-09-10T08:00:00Z"), lastPaymentAt: null }), "2026-09-13"), true);
  check("no expected date and no renewal date: nothing to measure", reason(cand({ renewal: null, lastPaymentAt: null }), "2026-09-13"), "no_renewal_date");

  console.log("\nGrace period: after it the normal status rules take over");
  // Monthly, last paid 2026-08-10: grace ends 2026-10-10.
  check("monthly: inside grace is due", reason(cand(), "2026-10-10"), "due");
  check("monthly: after grace is past_grace", reason(cand(), "2026-10-11"), "past_grace");
  check("weekly: grace is 14 days from the last payment", [
    reason(cand({ frequency: "weekly", renewal: "2026-09-10", lastPaymentAt: "2026-09-03" }), "2026-09-17"),
    reason(cand({ frequency: "weekly", renewal: "2026-09-10", lastPaymentAt: "2026-09-03" }), "2026-09-18"),
  ], ["due", "past_grace"]);

  console.log("\nSkipped: inactive, cancelled, ended, no mailbox, reconnect needed");
  check("lifecycle inactive", reason(cand({ lifecycleStatus: "inactive" }), "2026-09-20"), "inactive");
  check("status cancelled", reason(cand({ status: "cancelled" }), "2026-09-20"), "inactive");
  check("cancelledAt set", reason(cand({ cancelledAt: "2026-09-01" }), "2026-09-20"), "inactive");
  check("access ends on a date (ended)", reason(cand({ endsOn: "2026-09-30" }), "2026-09-20"), "inactive");
  check("needs_review is still checked", reason(cand({ lifecycleStatus: "needs_review" }), "2026-09-20"), "due");
  check("manual subscription (no mailbox)", reason(cand({ mailbox: null }), "2026-09-20"), "no_mailbox");
  check("its mailbox needs reconnecting", reason(cand(), "2026-09-20", null, new Set([mailboxKey(GMAIL)])), "mailbox_needs_reconnect");
  check("another mailbox flagged: still due", reason(cand(), "2026-09-20", null, new Set(["outlook:o1"])), "due");
  check("same id, other provider: not the same mailbox", reason(cand(), "2026-09-20", null, new Set(["outlook:g1"])), "due");

  console.log("\nSearch window");
  check("since = last payment minus 3 days", windowSince(cand({ lastPaymentAt: "2026-08-10" }))!.toISOString().slice(0, 10), "2026-08-07");
  check("since = renewal minus 7 days with no payment", windowSince(cand({ lastPaymentAt: null, renewal: "2026-09-10" }))!.toISOString().slice(0, 10), "2026-09-03");
  check("window days round up", windowDays(new Date("2026-09-03T00:00:00Z"), new Date("2026-09-13T10:00:00Z")), 11);
  ok("a short window is nowhere near 12 months", windowDays(windowSince(cand())!, new Date("2026-09-13T10:00:00Z")) < 60);

  console.log("\nRetry schedule");
  const m = cand({ frequency: "monthly" });
  // Walk the days: attempt on every day that is due, nothing found.
  function walk(c: CheckCandidate, firstDay: string, days: number) {
    let state: CheckState | null = null;
    const attemptDays: string[] = [];
    for (let i = 0; i < days; i++) {
      const today = plusDays(firstDay, i);
      const d = decideCheck(c, state, today, none);
      if (d.due) {
        attemptDays.push(today);
        state = stateAfter(state, c, d.renewalOn, { kind: "miss" }, today);
      }
    }
    return { attemptDays, state };
  }
  const monthly = walk(m, "2026-09-13", 30);
  check("monthly: first attempt, then +7 and +14 days after the first", monthly.attemptDays, ["2026-09-13", "2026-09-20", "2026-09-27"]);
  check("monthly: stops after the last retry", monthly.state?.nextCheckOn, null);
  check("monthly: then retries_done", reason(m, "2026-10-05", monthly.state), "retries_done");
  const weekly = walk(cand({ frequency: "weekly", renewal: "2026-09-10", lastPaymentAt: "2026-09-03" }), "2026-09-12", 6);
  check("weekly: first attempt, one retry 4 days later, then stop", weekly.attemptDays, ["2026-09-12", "2026-09-16"]);
  check("yearly follows +7/+14", walk(cand({ frequency: "yearly", lastPaymentAt: "2025-09-10" }), "2026-09-13", 20).attemptDays, ["2026-09-13", "2026-09-20", "2026-09-27"]);
  check("nextRetryDay: unknown attempts", [nextRetryDay("monthly", 1, "2026-09-13"), nextRetryDay("monthly", 2, "2026-09-13"), nextRetryDay("monthly", 3, "2026-09-13")], ["2026-09-20", "2026-09-27", null]);
  check("nextRetryDay weekly", [nextRetryDay("weekly", 1, "2026-09-12"), nextRetryDay("weekly", 2, "2026-09-12")], ["2026-09-16", null]);
  const waiting = stateAfter(null, m, "2026-09-10", { kind: "miss" }, "2026-09-13");
  check("waiting for a retry", reason(m, "2026-09-15", waiting), "waiting_retry");
  check("checked today is never checked again today", reason(m, "2026-09-13", waiting), "already_checked_today");
  const lateRetry = stateAfter(null, m, "2026-09-10", { kind: "miss" }, "2026-09-13");
  check("a retry that is a day late is still due", reason(m, "2026-09-22", lateRetry), "due");
  check("found: no more tries for that renewal", stateAfter(null, m, "2026-09-10", { kind: "found" }, "2026-09-13").nextCheckOn, null);
  check("a new renewal date starts a new cycle", reason(cand({ renewal: "2026-10-10", lastPaymentAt: "2026-09-10" }), "2026-10-13", monthly.state), "due");
  const e1 = stateAfter(null, m, "2026-09-10", { kind: "error" }, "2026-09-13");
  check("an error does not use up an attempt and tries again tomorrow", [e1.attempts, e1.nextCheckOn], [0, "2026-09-14"]);
  const e3 = stateAfter(stateAfter(e1, m, "2026-09-10", { kind: "error" }, "2026-09-14"), m, "2026-09-10", { kind: "error" }, "2026-09-15");
  check("three errors in a row give up for that renewal", [e3.errorCount, e3.nextCheckOn], [3, null]);

  console.log("\nDaily limit per person");
  const many = Array.from({ length: 15 }, (_, i) => cand({ id: `s${String(i).padStart(2, "0")}`, renewal: plusDays("2026-09-01", i % 5) }));
  const plan = planUserChecks(many, [], none, "2026-09-20", 10);
  check("15 due, 10 planned", [plan.checks.length, plan.overLimit], [10, 5]);
  check("the most overdue renewals go first", plan.checks[0].renewalOn, "2026-09-01");
  const doneToday: CheckState[] = Array.from({ length: 4 }, (_, i) => ({
    subscriptionId: `d${i}`, cycleRenewalOn: "2026-08-10", attempts: 1, firstAttemptOn: "2026-09-20", lastCheckedOn: "2026-09-20", nextCheckOn: "2026-09-27", errorCount: 0,
  }));
  const plan2 = planUserChecks(many, doneToday, none, "2026-09-20", 10);
  check("4 already done today leave room for 6", [plan2.doneToday, plan2.checks.length], [4, 6]);
  check("all 10 done: none left", planUserChecks(many, [...doneToday, ...Array.from({ length: 6 }, (_, i) => ({ ...doneToday[0], subscriptionId: `e${i}` }))], none, "2026-09-20", 10).checks.length, 0);
  check("the default limit is 10", planUserChecks(many, [], none, "2026-09-20").checks.length, 10);
  check("env limit: default, set, junk, clamped", [
    checksPerUserPerDay({}), checksPerUserPerDay({ RENEWAL_CHECKS_PER_USER_PER_DAY: "3" }),
    checksPerUserPerDay({ RENEWAL_CHECKS_PER_USER_PER_DAY: "x" }), checksPerUserPerDay({ RENEWAL_CHECKS_PER_USER_PER_DAY: "5000" }),
  ], [10, 3, 10, 100]);
  check("kill switch: default on; off for 0/false/off/no", [
    renewalChecksEnabled({}), renewalChecksEnabled({ RENEWAL_CHECKS_ENABLED: "true" }),
    renewalChecksEnabled({ RENEWAL_CHECKS_ENABLED: "false" }), renewalChecksEnabled({ RENEWAL_CHECKS_ENABLED: " OFF " }),
    renewalChecksEnabled({ RENEWAL_CHECKS_ENABLED: "0" }),
  ], [true, true, false, false, false]);

  console.log("\nExpired mailbox access is recognised");
  check("the app's own message", isReconnectError(new Error("the mailbox needs to be reconnected")), true);
  check("invalid_grant", isReconnectError(new Error("invalid_grant: Token has been expired or revoked.")), true);
  check("Outlook refresh refused", isReconnectError(new Error("Token refresh failed: 400 {\"error\":\"invalid_grant\"}")), true);
  check("401 status", isReconnectError(Object.assign(new Error("Request failed"), { status: 401 })), true);
  check("401 in a response", isReconnectError({ message: "x", response: { status: 401 } }), true);
  check("ReconnectNeeded", isReconnectError(new ReconnectNeeded([GMAIL])), true);
  check("a timeout is not", isReconnectError(new Error("ETIMEDOUT")), false);
  check("a 500 is not", isReconnectError(Object.assign(new Error("boom"), { status: 500 })), false);
  check("a rate limit is not", isReconnectError(Object.assign(new Error("slow down"), { status: 429 })), false);

  console.log("\nNo double run the same day");
  const T = (iso: string) => new Date(iso);
  check("never run: claim", decideClaim(null, "2026-09-20", T("2026-09-20T01:00:00Z")), true);
  check("yesterday's run: claim", decideClaim({ lastRunDay: "2026-09-19", startedAt: T("2026-09-19T01:00:00Z"), finishedAt: T("2026-09-19T01:10:00Z") }, "2026-09-20", T("2026-09-20T01:00:00Z")), true);
  check("today finished: no", decideClaim({ lastRunDay: "2026-09-20", startedAt: T("2026-09-20T01:00:00Z"), finishedAt: T("2026-09-20T01:10:00Z") }, "2026-09-20", T("2026-09-20T09:00:00Z")), false);
  check("today running (started a minute ago): no", decideClaim({ lastRunDay: "2026-09-20", startedAt: T("2026-09-20T01:00:00Z"), finishedAt: null }, "2026-09-20", T("2026-09-20T01:01:00Z")), false);
  check("today, never finished, long ago (process died): taken over", decideClaim({ lastRunDay: "2026-09-20", startedAt: T("2026-09-20T01:00:00Z"), finishedAt: null }, "2026-09-20", new Date(T("2026-09-20T01:00:00Z").getTime() + STALE_RUN_MS)), true);
  check("a clock behind the last run: no", decideClaim({ lastRunDay: "2026-09-21", startedAt: T("2026-09-21T01:00:00Z"), finishedAt: T("2026-09-21T01:10:00Z") }, "2026-09-20", T("2026-09-20T23:00:00Z")), false);

  // A fake job world.
  interface World {
    row: { lastRunDay: string | null; startedAt: Date | null; finishedAt: Date | null } | null;
    calls: string[];
    states: Map<string, CheckState>;
    flagged: Set<string>;
    subs: Map<string, CheckCandidate[]>;
    enabled: Set<string>;
    results: Map<string, CheckResult | Error>;
    reminders: string[];
    clock: Date;
  }
  function world(over: Partial<World> = {}): World {
    return {
      row: null, calls: [], states: new Map(), flagged: new Set(), subs: new Map(), enabled: new Set(),
      results: new Map(), reminders: [], clock: new Date("2026-09-20T02:00:00Z"), ...over,
    };
  }
  function reminderIo(w: World, over: Partial<ReminderIo> = {}): ReminderIo {
    return {
      flaggedMailboxes: async (userId) => [...w.flagged].filter((k) => k.startsWith(userId + "|")).map((k) => {
        const [, provider, id] = k.split("|");
        return { provider: provider as "gmail", id, address: `${id}@example.com` } as FlaggedMailbox;
      }),
      lastSentAt: async () => null,
      send: async (userId) => { w.reminders.push(userId); return true; },
      markSent: async () => {},
      ...over,
    };
  }
  function deps(w: World, over: Partial<JobDeps> = {}): JobDeps {
    return {
      now: () => w.clock,
      sleep: async () => {},
      claim: async (today, now) => {
        const ok = decideClaim(w.row, today, now);
        if (ok) w.row = { lastRunDay: today, startedAt: now, finishedAt: null };
        return ok;
      },
      finish: async () => { if (w.row) w.row.finishedAt = w.clock; },
      listUserIds: async () => [...w.subs.keys()],
      statusEnabled: async (u) => w.enabled.has(u),
      refreshStatus: async (u) => { w.calls.push(`refresh:${u}`); },
      userBusy: () => false,
      loadChecks: async (u) => ({
        candidates: w.subs.get(u) ?? [],
        states: [...w.states.values()].filter((s) => (w.subs.get(u) ?? []).some((c) => c.id === s.subscriptionId)),
        flagged: new Set([...w.flagged].filter((k) => k.startsWith(u + "|")).map((k) => k.split("|").slice(1).join(":"))),
      }),
      runCheck: async (u, c) => {
        w.calls.push(`check:${u}:${c.id}`);
        const r = w.results.get(c.id);
        if (r instanceof Error) throw r;
        return r ?? { kind: "miss", reconnect: [] };
      },
      saveState: async (_u, s) => { w.states.set(s.subscriptionId, s); },
      markReconnect: async (u, mb) => { w.flagged.add(`${u}|${mb.provider}|${mb.id}`); },
      reminder: reminderIo(w),
      ...over,
    };
  }
  const opts = { today: "2026-09-20", limitPerUser: 10, userPauseMs: 0, checkPauseMs: 0 };
  const due = (id: string, mailbox = GMAIL) => cand({ id, mailbox, renewal: "2026-09-10" });

  console.log("\nThe job: no double run");
  {
    const w = world({ subs: new Map([["u1", [due("a")]]]), enabled: new Set(["u1"]) });
    const first = await quiet(() => runRenewalJob(deps(w), opts));
    const second = await quiet(() => runRenewalJob(deps(w), opts));
    check("first run happens", first?.checked, 1);
    check("second run the same day is refused", second, null);
    check("the person was checked once", w.calls.filter((c) => c.startsWith("check:")).length, 1);
    // Two instances at the same moment: only one claims.
    const w2 = world({ subs: new Map([["u1", [due("a")]]]), enabled: new Set(["u1"]) });
    const both = await quiet(() => Promise.all([runRenewalJob(deps(w2), opts), runRenewalJob(deps(w2), opts)]));
    check("two starts at once: exactly one runs", both.filter((r) => r !== null).length, 1);
    w2.clock = new Date("2026-09-21T02:00:00Z");
    const next = await quiet(() => runRenewalJob(deps(w2), { ...opts, today: "2026-09-21" }));
    ok("the next day runs again", next !== null);
    // A restart mid-run: the same day is picked up again once the first run is stale, and does not repeat finished checks.
    const w3 = world({ subs: new Map([["u1", [due("a"), due("b")]]]), enabled: new Set(["u1"]) });
    w3.row = { lastRunDay: "2026-09-20", startedAt: new Date("2026-09-20T01:00:00Z"), finishedAt: null };
    w3.clock = new Date("2026-09-20T05:00:00Z");
    w3.states.set("a", { subscriptionId: "a", cycleRenewalOn: "2026-09-10", attempts: 1, firstAttemptOn: "2026-09-20", lastCheckedOn: "2026-09-20", nextCheckOn: "2026-09-27", errorCount: 0 });
    const resumed = await quiet(() => runRenewalJob(deps(w3), opts));
    check("a crashed run is resumed without repeating what was checked", [resumed?.checked, w3.calls.filter((c) => c.startsWith("check:"))], [1, ["check:u1:b"]]);
  }

  console.log("\nThe job: one person failing does not stop the others");
  {
    const w = world({
      subs: new Map([["u1", [due("a")]], ["u2", [due("b")]], ["u3", [due("c")]]]),
      enabled: new Set(["u1", "u2", "u3"]),
    });
    const stats = await quiet(() => runRenewalJob(deps(w, {
      refreshStatus: async (u) => { w.calls.push(`refresh:${u}`); if (u === "u1") throw new Error("db down"); },
      loadChecks: async (u) => {
        if (u === "u2") throw new Error("cannot read u2");
        return { candidates: w.subs.get(u)!, states: [], flagged: new Set() };
      },
    }), opts));
    check("everyone was refreshed", w.calls.filter((c) => c.startsWith("refresh:")), ["refresh:u1", "refresh:u2", "refresh:u3"]);
    check("u1's refresh failed but u1 was still checked; u2 failed to load; u3 checked", w.calls.filter((c) => c.startsWith("check:")), ["check:u1:a", "check:u3:c"]);
    check("failures counted, run finished", [stats?.failures, stats?.users, w.row?.finishedAt !== null], [2, 3, true]);

    const w2 = world({ subs: new Map([["u1", [due("a"), due("b")]], ["u2", [due("c")]]]), enabled: new Set(["u1", "u2"]) });
    w2.results.set("a", new Error("Gmail exploded"));
    const stats2 = await quiet(() => runRenewalJob(deps(w2), opts));
    check("a failing check does not stop the next one or the next person", w2.calls.filter((c) => c.startsWith("check:")), ["check:u1:a", "check:u1:b", "check:u2:c"]);
    check("the failed one is kept for tomorrow, not used up", [w2.states.get("a")?.attempts, w2.states.get("a")?.nextCheckOn, stats2?.failures], [0, "2026-09-21", 1]);
    check("a miss is stored with its retry", [w2.states.get("b")?.attempts, w2.states.get("b")?.nextCheckOn], [1, "2026-09-27"]);

    const w3 = world({ subs: new Map([["u1", [due("a")]], ["u2", [due("b")]]]), enabled: new Set(["u1", "u2"]) });
    const stats3 = await quiet(() => runRenewalJob(deps(w3, {
      statusEnabled: async (u) => { if (u === "u1") throw new Error("flags unreadable"); return true; },
    }), opts));
    check("a person whose switch cannot be read is skipped, the next goes on", [w3.calls.filter((c) => c.startsWith("check:")), stats3?.failures], [["check:u2:b"], 1]);

    const w4 = world({ subs: new Map([["u1", [due("a")]]]), enabled: new Set(["u1"]) });
    const stats4 = await quiet(() => runRenewalJob(deps(w4, { listUserIds: async () => { throw new Error("db"); }, finish: async () => { throw new Error("db"); } }), opts));
    ok("even listing and finishing failing never throws", stats4 !== null);
  }

  console.log("\nThe job: only people with the switch");
  {
    const w = world({ subs: new Map([["on", [due("a")]], ["off", [due("b")]]]), enabled: new Set(["on"]) });
    await quiet(() => runRenewalJob(deps(w), opts));
    check("no refresh, no check, no reminder for a switch-off person", w.calls, ["refresh:on", "check:on:a"]);
  }

  console.log("\nThe job: the daily limit is per person");
  {
    const subs = Array.from({ length: 14 }, (_, i) => due(`s${String(i).padStart(2, "0")}`));
    const w = world({ subs: new Map([["u1", subs], ["u2", [due("x")]]]), enabled: new Set(["u1", "u2"]) });
    await quiet(() => runRenewalJob(deps(w), opts));
    check("10 for the busy person, the other still gets theirs", [w.calls.filter((c) => c.startsWith("check:u1")).length, w.calls.filter((c) => c.startsWith("check:u2")).length], [10, 1]);
    // A restart the same day: the 10 done are counted, so no more for u1.
    w.row = { lastRunDay: "2026-09-20", startedAt: new Date("2026-09-20T01:00:00Z"), finishedAt: null };
    w.clock = new Date("2026-09-20T09:00:00Z");
    w.calls.length = 0;
    await quiet(() => runRenewalJob(deps(w), opts));
    check("a resumed run does not go past 10 for the day", w.calls.filter((c) => c.startsWith("check:u1")).length, 0);
  }

  console.log("\nExpired access: marked, then not checked, until reconnected");
  {
    const o1 = { provider: "outlook" as const, id: "o1" };
    const w = world({ subs: new Map([["u1", [due("a"), due("b"), due("c", o1)]]]), enabled: new Set(["u1"]) });
    w.results.set("a", { kind: "unavailable", reconnect: [GMAIL] });
    const stats = await quiet(() => runRenewalJob(deps(w), opts));
    check("the mailbox is flagged", [...w.flagged], ["u1|gmail|g1"]);
    check("the other sub on that mailbox is skipped in the same run; the Outlook one still checked", w.calls.filter((c) => c.startsWith("check:")), ["check:u1:a", "check:u1:c"]);
    check("flagged counted; the unavailable check used no attempt and stored nothing", [stats?.reconnectMarked, w.states.has("a"), w.states.has("b")], [1, false, false]);
    check("a reminder was sent after marking", w.reminders, ["u1"]);

    // Next day: still flagged, so nothing for the gmail mailbox.
    w.clock = new Date("2026-09-21T02:00:00Z");
    w.calls.length = 0;
    await quiet(() => runRenewalJob(deps(w), { ...opts, today: "2026-09-21" }));
    check("next day: no checks for the flagged mailbox", w.calls.filter((c) => c.startsWith("check:") && !c.endsWith(":c")), []);

    // Reconnected: the flag is cleared (storage.clearMailboxNeedsReconnect), checks resume.
    w.flagged.delete("u1|gmail|g1");
    w.results.delete("a");
    w.clock = new Date("2026-09-22T02:00:00Z");
    w.calls.length = 0;
    await quiet(() => runRenewalJob(deps(w), { ...opts, today: "2026-09-22" }));
    check("after reconnecting, checks resume", w.calls.filter((c) => c.startsWith("check:")).sort(), ["check:u1:a", "check:u1:b"]);

    // A found/miss that also saw an expired second mailbox still flags it.
    const w2 = world({ subs: new Map([["u1", [due("a")]]]), enabled: new Set(["u1"]) });
    w2.results.set("a", { kind: "miss", reconnect: [o1] });
    await quiet(() => runRenewalJob(deps(w2), opts));
    check("a miss that met an expired second mailbox flags it and keeps the attempt", [[...w2.flagged], w2.states.get("a")?.attempts], [["u1|outlook|o1"], 1]);

    // Found.
    const w3 = world({ subs: new Map([["u1", [due("a")]]]), enabled: new Set(["u1"]) });
    w3.results.set("a", { kind: "found", reconnect: [] });
    const s3 = await quiet(() => runRenewalJob(deps(w3), opts));
    check("found: counted, no retry scheduled", [s3?.found, w3.states.get("a")?.nextCheckOn], [1, null]);

    // A sync running defers the person's remaining checks without using attempts.
    const w4 = world({ subs: new Map([["u1", [due("a"), due("b")]]]), enabled: new Set(["u1"]) });
    w4.results.set("a", { kind: "deferred", reconnect: [] });
    await quiet(() => runRenewalJob(deps(w4), opts));
    check("a sync running: stop for the day, nothing stored", [w4.calls.filter((c) => c.startsWith("check:")), w4.states.size], [["check:u1:a"], 0]);

    // A history search running for the person.
    const w5 = world({ subs: new Map([["u1", [due("a")]]]), enabled: new Set(["u1"]) });
    await quiet(() => runRenewalJob(deps(w5, { userBusy: () => true }), opts));
    check("a history search running: no checks", w5.calls.filter((c) => c.startsWith("check:")), []);
  }

  console.log("\nReconnect email: at most one per person per 7 days");
  {
    const day0 = new Date("2026-09-20T02:00:00Z");
    check("never sent: send", shouldSendReconnectEmail(null, day0), true);
    check("6 days 23 hours later: suppressed", shouldSendReconnectEmail(day0, new Date(day0.getTime() + 7 * DAY - 3600_000)), false);
    check("exactly 7 days later: send", shouldSendReconnectEmail(day0, new Date(day0.getTime() + 7 * DAY)), true);

    const w = world({ flagged: new Set(["u1|gmail|g1", "u1|outlook|o1"]) });
    let last: Date | null = null;
    const sent: { to: string; mailboxes: string[] }[] = [];
    const io = reminderIo(w, {
      lastSentAt: async () => last,
      send: async (u, mailboxes) => { sent.push({ to: u, mailboxes: mailboxes.map((m) => m.address) }); return true; },
      markSent: async (_u, now) => { last = now; },
    });
    check("first: sent, one email naming both mailboxes", [await remindIfNeeded("u1", io, day0), sent.length, sent[0].mailboxes], [true, 1, ["g1@example.com", "o1@example.com"]]);
    check("a day later: suppressed", [await remindIfNeeded("u1", io, new Date(day0.getTime() + DAY)), sent.length], [false, 1]);
    check("six days later: suppressed", [await remindIfNeeded("u1", io, new Date(day0.getTime() + 6 * DAY)), sent.length], [false, 1]);
    check("seven days later: sent again (weekly while unreconnected)", [await remindIfNeeded("u1", io, new Date(day0.getTime() + 7 * DAY)), sent.length], [true, 2]);
    check("someone with nothing flagged: nothing", [await remindIfNeeded("u9", io, new Date(day0.getTime() + 30 * DAY)), sent.length], [false, 2]);

    let marked = 0;
    const failing = reminderIo(w, { send: async () => false, markSent: async () => { marked++; } });
    check("a send that failed is not recorded, so tomorrow tries again", [await remindIfNeeded("u1", failing, day0), marked], [false, 0]);
    const nothing = reminderIo(w, { send: async () => "nothing_to_say", markSent: async () => { marked++; } });
    check("nothing to say is not recorded", [await remindIfNeeded("u1", nothing, day0), marked], [false, 0]);
    // Stops when reconnected.
    w.flagged.clear();
    check("reconnected: no more reminders", [await remindIfNeeded("u1", io, new Date(day0.getTime() + 30 * DAY)), sent.length], [false, 2]);
  }

  console.log("\nReconnect email: the builder");
  {
    const base = { to: "me@example.com", appUrl: "https://app.verloq.co/" };
    const many = buildReconnectEmail({
      ...base,
      mailboxes: ["rishikesh@example.com"],
      subscriptions: [
        { name: "Airtel Black", lastPaidOn: "2026-09-29" },
        { name: "Claude Pro", lastPaidOn: "2026-09-30" },
        { name: "Netflix", lastPaidOn: "2026-06-03" },
        { name: "Spotify", lastPaidOn: "2026-05-01" },
      ],
    });
    check("subject", many.subject, "Reconnect your inbox so Verloq can keep checking your payments");
    ok("heading", many.html.includes("Verloq needs you to reconnect your inbox"));
    ok("preheader", many.html.includes("Your subscriptions are safe. We just can&#39;t see new payments until you reconnect."));
    ok("body names the mailbox", many.html.includes("Access to rishikesh@example.com has expired, so we could not check it for new payments. Your subscriptions and payment history are safe."));
    ok("plural intro with the count", many.html.includes("Until you reconnect, we cannot tell whether these 4 subscriptions are still being paid:"));
    ok("shows three names, 'and 1 more'", many.html.includes("Airtel Black") && many.html.includes("Claude Pro") && many.html.includes("Netflix") && !many.html.includes("Spotify") && many.html.includes("and 1 more"));
    ok("last paid as Mon D", many.html.includes("last paid Sep 29") && many.html.includes("last paid Jun 3"));
    ok("button links to settings", many.html.includes('href="https://app.verloq.co/settings"') && many.html.includes("Reconnect rishikesh@example.com"));
    ok("note and footer", many.html.includes("It takes about 10 seconds. We will pick up where we left off.") && many.html.includes("at most once a week"));
    ok("footer links", many.html.includes("verloq.co") && many.html.includes("privacy.html"));
    ok("plain text version", many.text.includes("- Airtel Black: last paid Sep 29") && many.text.includes("and 1 more") && many.text.includes("Reconnect rishikesh@example.com: https://app.verloq.co/settings"));
    ok("never an amount", !/[$€£₹]|\d+\.\d{2}\b(?!em)|amount|price/i.test(many.text) && !/[$€£₹]|amount|price/i.test(many.html));

    const exactly3 = buildReconnectEmail({ ...base, mailboxes: ["a@x.com"], subscriptions: many.html ? [{ name: "A", lastPaidOn: null }, { name: "B", lastPaidOn: null }, { name: "C", lastPaidOn: null }] : [] });
    ok("exactly 3: no 'and K more'", !exactly3.html.includes("more") && !exactly3.text.includes("more"));
    ok("no payment date: just the name", !exactly3.html.includes("last paid"));
    ok("N is 3 in the intro", exactly3.html.includes("these 3 subscriptions"));

    const one = buildReconnectEmail({ ...base, mailboxes: ["a@x.com"], subscriptions: [{ name: "Claude Pro", lastPaidOn: "2026-09-30" }] });
    ok("singular: 'this subscription', no '1 subscriptions'", one.html.includes("whether this subscription is still being paid:") && !one.html.includes("1 subscriptions"));

    const two = buildReconnectEmail({ ...base, mailboxes: ["a@x.com", "b@y.com"], subscriptions: [{ name: "Claude Pro", lastPaidOn: "2026-09-30" }] });
    ok("two mailboxes are both named in one email", two.html.includes("a@x.com and b@y.com") && two.text.includes("a@x.com and b@y.com"));
    const three = buildReconnectEmail({ ...base, mailboxes: ["a@x.com", "b@y.com", "c@z.com"], subscriptions: [{ name: "Claude Pro", lastPaidOn: null }] });
    ok("three mailboxes: commas and 'and'", three.html.includes("a@x.com, b@y.com and c@z.com"));

    const hostile = buildReconnectEmail({
      ...base,
      mailboxes: ['<img src=x onerror=alert(1)>@evil.com'],
      subscriptions: [{ name: '<script>alert("x")</script> & Co', lastPaidOn: "2026-09-30" }],
      appUrl: 'https://app.verloq.co/"><script>',
    });
    ok("names are escaped", !hostile.html.includes("<script>") && hostile.html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Co"));
    ok("mailbox is escaped", !hostile.html.includes("<img src=x") && hostile.html.includes("&lt;img src=x onerror=alert(1)&gt;@evil.com"));
    ok("the link is escaped", !hostile.html.includes('"><script>'));

    check("shortDay", [shortDay("2026-09-05"), shortDay("2026-01-31"), shortDay(null), shortDay("nope"), shortDay("2026-13-01")], ["Sep 5", "Jan 31", null, null, null]);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
