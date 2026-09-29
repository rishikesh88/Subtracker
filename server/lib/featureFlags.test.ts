/* Run: npm run test:flags */
import { decide, createFeatureFlags, isValidFeatureKey, isRollout, normaliseTags, type FlagSnapshot } from "./featureFlags";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}

(async () => {
  /* --- The rule itself, no database ------------------------------------ */
  check("unknown key is off", decide(undefined, false), false);
  check("unknown key is off even if somehow listed", decide(undefined, true), false);
  check("off: unlisted user does not have it", decide({ rollout: "off" }, false), false);
  check("off: listed user does not have it either", decide({ rollout: "off" }, true), false);
  check("selected: listed user has it", decide({ rollout: "selected" }, true), true);
  check("selected: unlisted user does not", decide({ rollout: "selected" }, false), false);
  check("everyone: unlisted user has it", decide({ rollout: "everyone" }, false), true);
  check("everyone: listed user has it", decide({ rollout: "everyone" }, true), true);
  check("an unexpected rollout value is off", decide({ rollout: "sometimes" }, true), false);

  /* --- Keys -------------------------------------------------------------- */
  check("snake_case key is valid", isValidFeatureKey("subscription_status"), true);
  check("digits after the first letter are fine", isValidFeatureKey("v2_checks"), true);
  check("three characters is the minimum", isValidFeatureKey("abc"), true);
  check("two characters is too short", isValidFeatureKey("ab"), false);
  check("fifty characters is the maximum", isValidFeatureKey("a" + "b".repeat(49)), true);
  check("fifty-one is too long", isValidFeatureKey("a" + "b".repeat(50)), false);
  check("uppercase is refused", isValidFeatureKey("Subscription_status"), false);
  check("a leading digit is refused", isValidFeatureKey("2fa_prompt"), false);
  check("a leading underscore is refused", isValidFeatureKey("_hidden"), false);
  check("hyphens are refused", isValidFeatureKey("new-invoice-checks"), false);
  check("spaces are refused", isValidFeatureKey("new invoice"), false);
  check("a non-string is refused", isValidFeatureKey(42), false);

  check("rollout: 'selected' is a rollout", isRollout("selected"), true);
  check("rollout: 'on' is not", isRollout("on"), false);

  /* --- Tags -------------------------------------------------------------- */
  check("tags are trimmed and deduplicated ignoring case",
    normaliseTags([" Beta ", "beta", "Billing", ""]), ["Beta", "Billing"]);
  check("tags must be a list", normaliseTags("Beta"), null);
  check("tags must be strings", normaliseTags(["Beta", 3]), null);

  /* --- Reading through the cache ----------------------------------------- */
  const snapshot: FlagSnapshot = {
    flags: [
      { id: "f1", key: "subscription_status", rollout: "selected" },
      { id: "f2", key: "new_invoice_checks", rollout: "off" },
      { id: "f3", key: "summary_email", rollout: "everyone" },
    ],
    members: [
      { flagId: "f1", userId: "alice" },
      { flagId: "f2", userId: "alice" },
    ],
  };
  let loads = 0;
  let clock = 0;
  const flags = createFeatureFlags(
    { loadSnapshot: async () => { loads++; return JSON.parse(JSON.stringify(snapshot)); } },
    { ttlMs: 30_000, now: () => clock },
  );

  check("listed user has a selected feature", await flags.isEnabled("alice", "subscription_status"), true);
  check("unlisted user does not", await flags.isEnabled("bob", "subscription_status"), false);
  check("listed user does not have an off feature", await flags.isEnabled("alice", "new_invoice_checks"), false);
  check("everyone means everyone", await flags.isEnabled("bob", "summary_email"), true);
  check("unknown key is off", await flags.isEnabled("alice", "no_such_thing"), false);
  check("enabled keys for a listed user", await flags.enabledKeysFor("alice"), ["subscription_status", "summary_email"]);
  check("enabled keys for anyone else", await flags.enabledKeysFor("bob"), ["summary_email"]);
  check("all of that was one read", loads, 1);

  snapshot.flags[1].rollout = "everyone";
  clock = 10_000;
  check("within the cache window the old answer stands", await flags.isEnabled("bob", "new_invoice_checks"), false);
  flags.invalidate();
  check("after an admin write the new answer is read", await flags.isEnabled("bob", "new_invoice_checks"), true);
  check("which took a second read", loads, 2);

  snapshot.flags[0].rollout = "off";
  clock = 45_000;
  check("after the cache window it reads again", await flags.isEnabled("alice", "subscription_status"), false);
  check("a third read", loads, 3);

  /* --- A database failure is off, not an error --------------------------- */
  const broken = createFeatureFlags({ loadSnapshot: async () => { throw new Error("no database"); } });
  const originalError = console.error;
  console.error = () => {};
  const brokenOn = await broken.isEnabled("alice", "summary_email");
  const brokenKeys = await broken.enabledKeysFor("alice");
  console.error = originalError;
  check("unreadable switches are off", brokenOn, false);
  check("and no keys are enabled", brokenKeys, []);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
