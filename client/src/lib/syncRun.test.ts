/* Run: npm run test:sync-run */
import { applyEvent, currentStep, newRun, shortStatus, steps, totals, type ProgressEvent, type SyncRun } from "./syncRun";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}
const play = (events: ProgressEvent[], run: SyncRun = newRun()) => events.reduce(applyEvent, run);
const ctx = { syncDays: 30, currency: "USD" };
const ev = (stage: string, progress: number, details: Record<string, unknown> = {}): ProgressEvent =>
  ({ type: "progress", stage, progress, details: { account: "me@x.com", ...details } });

/* --- One mailbox, start to finish ------------------------------------ */
const start = play([{ type: "progress", stage: "multi_account_sync_start", progress: 0, details: { totalAccounts: 1 } }]);
check("start: first step is active", steps(start, ctx).map((s) => s.state), ["active", "waiting", "waiting", "waiting"]);
check("start: says what it is reading", steps(start, ctx)[0].detail, "Looking through the last 30 days");

const scanning = play([ev("metadata", 10, { emailsProcessed: 500, totalEmails: 2597 })], start);
check("scanning: counts shown", steps(scanning, ctx)[0].detail, "Scanned 500 of 2,597 emails");
check("scanning: popup line", shortStatus(scanning), "Reading your inbox · 500 of 2,597");

const screening = play([ev("prefilter", 40, { emailsProcessed: 2597, totalEmails: 2597, candidateEmails: 1203 })], scanning);
check("screening: inbox step done with its count", steps(screening, ctx)[0].detail, "2,597 emails from the last 30 days");
check("screening: picking step active", steps(screening, ctx)[1], { title: "Picking out billing emails", state: "active", detail: "Checking 1,203 possible billing emails" });

const reading = play([
  ev("fetch_full", 72, { keptEmails: 716 }),
  ev("analysis", 80, { emailsChecked: 0, emailsToCheck: 716 }),
  ev("analysis", 88, { emailsChecked: 300, emailsToCheck: 716, foundSoFar: 6, foundNames: ["Azure", "Netflix", "Claude", "iCloud+"] }),
], screening);
check("reading: kept count on the picking step", steps(reading, ctx)[1].detail, "716 look like receipts, invoices or renewals");
check("reading: receipts step progress", steps(reading, ctx)[2].detail, "Checked 300 of 716");
check("reading: receipts step fraction", Math.round((steps(reading, ctx)[2].fraction ?? 0) * 100), 42);
check("reading: found so far", totals(reading).foundSoFar, 6);
check("reading: popup line", shortStatus(reading), "Reading receipts · 300 of 716");

const building = play([ev("analysis", 98, { emailsChecked: 716, emailsToCheck: 716, foundSoFar: 17 })], reading);
check("building: last step active once every email is read", currentStep(building), 3);
check("building: amounts note names the currency", steps(building, ctx)[3].detail, "Duplicates merged, amounts in USD");

const done = play([{ type: "progress", stage: "sync_complete", progress: 100, message: "Sync complete!", details: { suggestionsGenerated: 17, failed: 0 } }], building);
check("done: keeps what this run added", done.suggestionsGenerated, 17);
check("done: phase", done.phase, "done");
check("done: every step done", steps(done, ctx).map((s) => s.state), ["done", "done", "done", "done"]);

/* --- Things that must not happen ------------------------------------- */
check("progress never goes backwards", play([ev("metadata", 10), ev("metadata", 5)]).progress, 10);
check("a late event after the finish is ignored", play([ev("metadata", 20)], done).phase, "done");
check("heartbeats change nothing", play([{ type: "heartbeat" }], reading), reading);
const failedRun = play([{ type: "progress", stage: "error", progress: 99, message: "Gmail refused access" }], reading);
check("an error ends the run with its message", [failedRun.phase, failedRun.errorMessage], ["failed", "Gmail refused access"]);

/* --- Coming back mid-sync: only the latest event arrives ------------- */
const replay = play([ev("analysis", 85, { totalEmails: 2597, emailsProcessed: 2597, keptEmails: 716, emailsChecked: 150, emailsToCheck: 716 })]);
check("replay: earlier steps are done", steps(replay, ctx).slice(0, 2).map((s) => s.state), ["done", "done"]);
check("replay: earlier counts survive", steps(replay, ctx)[0].detail, "2,597 emails from the last 30 days");

/* --- Two mailboxes ---------------------------------------------------- */
const two = play([
  { type: "progress", stage: "multi_account_sync_start", progress: 0, details: { totalAccounts: 2 } },
  ev("analysis", 40, { account: "a@x.com", totalEmails: 1000, emailsChecked: 10, emailsToCheck: 100, foundSoFar: 2 }),
]);
check("two: the list waits for the mailbox that has not started", currentStep(two), 0);
const both = play([ev("prefilter", 50, { account: "b@y.com", totalEmails: 500 })], two);
check("two: the slowest mailbox sets the step", currentStep(both), 1);
check("two: email counts add up", totals(both).totalEmails, 1500);
const allIn = play([{ type: "progress", stage: "accounts_syncing", progress: 90, details: { completed: 2, total: 2 } }], both);
check("two: every mailbox finished means building the list", currentStep(allIn), 3);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
