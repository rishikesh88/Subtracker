/* Run: npm run test:retry */
import { isTransient, withRetry } from "./retryTransient";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}

/* The error the failed sync actually threw, shape and all. */
const geminiUnavailable = Object.assign(
  new Error('{"error":{"code":503,"message":"The service is currently unavailable.","status":"UNAVAILABLE"}}'),
  { status: 503 }
);

/* --- which failures are worth another attempt ------------------------- */

check("the 503 that broke the sync is transient", isTransient(geminiUnavailable), true);
check("a 503 known only by its message is transient",
  isTransient(new Error('{"error":{"code":503,"message":"unavailable"}}')), true);
check("rate limiting is transient", isTransient({ status: 429 }), true);
check("a gateway error is transient", isTransient({ status: 502 }), true);
check("an upstream timeout is transient", isTransient({ status: 504 }), true);
check("a dropped socket is transient", isTransient(new Error("socket hang up")), true);
check("a failed fetch is transient", isTransient(new Error("fetch failed")), true);

/* These never succeed on a retry, so retrying only delays the real error. */
check("a bad key is not transient", isTransient({ status: 401 }), false);
check("a forbidden call is not transient", isTransient({ status: 403 }), false);
check("a malformed request is not transient", isTransient({ status: 400 }), false);
check("a missing model is not transient", isTransient({ status: 404 }), false);
check("a parse error is not transient", isTransient(new SyntaxError("Unexpected token")), false);
check("undefined is not transient", isTransient(undefined), false);

/* --- the retry loop --------------------------------------------------- */

const noSleep = async () => {};
const fixedJitter = () => 0.5;

async function run() {
  /* The exact shape of the failed run: one blip, then fine. */
  let calls = 0;
  const recovered = await withRetry(async () => {
    calls++;
    if (calls === 1) throw geminiUnavailable;
    return "analysed";
  }, { sleep: noSleep, random: fixedJitter });
  check("one 503 then success returns the result", recovered, "analysed");
  check("and it took exactly two attempts", calls, 2);

  /* A permanent failure must not be retried at all. */
  let authCalls = 0;
  let authError: string | null = null;
  try {
    await withRetry(async () => { authCalls++; throw { status: 401, message: "bad key" }; },
      { sleep: noSleep, random: fixedJitter });
  } catch (e: any) { authError = e.message; }
  check("a bad key is thrown on the first attempt", authCalls, 1);
  check("and the original error survives, not a timeout", authError, "bad key");

  /* Giving up eventually, with the real cause intact. */
  let alwaysCalls = 0;
  let finalStatus: number | null = null;
  try {
    await withRetry(async () => { alwaysCalls++; throw geminiUnavailable; },
      { attempts: 4, sleep: noSleep, random: fixedJitter });
  } catch (e: any) { finalStatus = e.status; }
  check("four attempts are made before giving up", alwaysCalls, 4);
  check("the last real error is what surfaces", finalStatus, 503);

  /* Backoff grows, and is never the same number twice in a row by design. */
  const waits: number[] = [];
  try {
    await withRetry(async () => { throw geminiUnavailable; }, {
      attempts: 4,
      baseDelayMs: 1000,
      sleep: async (ms) => { waits.push(ms); },
      random: fixedJitter,
    });
  } catch { /* expected */ }
  check("it waits three times for four attempts", waits.length, 3);
  check("and each wait is longer than the last", waits, [750, 1500, 3000]);

  /* Success on the first go must cost nothing. */
  const waitsOnSuccess: number[] = [];
  const straight = await withRetry(async () => "fine", {
    sleep: async (ms) => { waitsOnSuccess.push(ms); },
  });
  check("a call that works never sleeps", waitsOnSuccess.length, 0);
  check("and returns its value", straight, "fine");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
