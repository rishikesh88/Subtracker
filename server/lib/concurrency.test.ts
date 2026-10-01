/* Run: npm run test:concurrency */
import { mapWithConcurrency } from "./concurrency";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("mapWithConcurrency");
  let running = 0, peak = 0;
  const items = [1, 2, 3, 4, 5, 6, 7];
  const out = await mapWithConcurrency(items, 3, async (n) => {
    running++; peak = Math.max(peak, running);
    await sleep((8 - n) * 3); // later items finish first
    running--;
    return n * 10;
  });
  check("results are in the items' order", out.map((r) => (r.ok ? r.value : null)), [10, 20, 30, 40, 50, 60, 70]);
  check("never more than 3 at once", peak, 3);

  const mixed = await mapWithConcurrency([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error("boom"); return n; });
  check("a failure is returned in its place", mixed.map((r) => (r.ok ? r.value : "error")), [1, "error", 3]);
  check("empty input", await mapWithConcurrency([], 3, async () => 1), []);
  check("a limit of 0 still runs, one at a time", (await mapWithConcurrency([1, 2], 0, async (n) => n)).length, 2);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
void main();
