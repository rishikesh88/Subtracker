/**
 * Feature switches.
 *
 * Any feature can be gated on a key: `await isEnabled(userId, "some_key")` on
 * the server, `useFeature("some_key")` in the app. Whether a key is on for a
 * given person is decided by the feature's rollout, which is changed only from
 * the admin console:
 *
 *   off       -- on for no one, including anyone on the list
 *   selected  -- on only for the users on the feature's list
 *   everyone  -- on for all users
 *
 * An unknown key is off. So is every key when the tables cannot be read: a
 * gated feature failing closed shows people the app they already had, while
 * failing open would show everyone something unfinished.
 *
 * The flags and their lists are small, so the whole set is read in one go and
 * held for a short while. Any admin write calls invalidateFeatureFlags(), so a
 * change made in the console is seen by the next request on this process.
 */

import type { FeatureRollout } from "@shared/schema";

export type Rollout = FeatureRollout;
export const ROLLOUTS: readonly Rollout[] = ["off", "selected", "everyone"];

export function isRollout(value: unknown): value is Rollout {
  return typeof value === "string" && (ROLLOUTS as readonly string[]).includes(value);
}

/** Lowercase snake_case, starting with a letter, 3 to 50 characters. */
export const FEATURE_KEY_PATTERN = /^[a-z][a-z0-9_]{2,49}$/;

export function isValidFeatureKey(key: unknown): key is string {
  return typeof key === "string" && FEATURE_KEY_PATTERN.test(key);
}

/**
 * Tidies a tag list from the console: trimmed, blanks dropped, duplicates
 * (ignoring case) dropped keeping the first spelling. Returns null when the
 * input is not a list of strings or breaks a limit, so the caller can refuse it.
 */
export function normaliseTags(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") return null;
    const tag = raw.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    if (tag.length > 30) return null;
    const folded = tag.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded);
    out.push(tag);
  }
  return out.length > 12 ? null : out;
}

/**
 * The whole rule, with no database: is a feature on for someone, given the
 * feature (undefined when no such key exists) and whether they are on its list.
 */
export function decide(flag: { rollout: string } | undefined, isListed: boolean): boolean {
  if (!flag) return false;
  switch (flag.rollout) {
    case "everyone":
      return true;
    case "selected":
      return isListed;
    default:
      // 'off', and anything unexpected, is off.
      return false;
  }
}

export interface FlagSnapshot {
  flags: { id: string; key: string; rollout: string }[];
  members: { flagId: string; userId: string }[];
}

export interface FlagSource {
  loadSnapshot(): Promise<FlagSnapshot>;
}

interface Indexed {
  byKey: Map<string, { id: string; key: string; rollout: string }>;
  listed: Map<string, Set<string>>;
  loadedAt: number;
}

function index(snapshot: FlagSnapshot, loadedAt: number): Indexed {
  const byKey = new Map(snapshot.flags.map((f) => [f.key, f]));
  const listed = new Map<string, Set<string>>();
  for (const { flagId, userId } of snapshot.members) {
    let set = listed.get(flagId);
    if (!set) listed.set(flagId, (set = new Set()));
    set.add(userId);
  }
  return { byKey, listed, loadedAt };
}

/**
 * A reader over some source of flags, with its own cache. The app uses the
 * one below, backed by the database; tests build their own over a fake source.
 */
export function createFeatureFlags(
  source: FlagSource,
  options: { ttlMs?: number; now?: () => number } = {},
) {
  const ttlMs = options.ttlMs ?? 30_000;
  const now = options.now ?? Date.now;
  let cached: Indexed | null = null;
  let inflight: Promise<Indexed> | null = null;
  // Bumped by invalidate() so a read that started before an admin write
  // cannot put the old answer back into the cache when it lands.
  let generation = 0;

  async function current(): Promise<Indexed | null> {
    if (cached && now() - cached.loadedAt < ttlMs) return cached;
    if (!inflight) {
      const startedIn = generation;
      const load: Promise<Indexed> = source
        .loadSnapshot()
        .then((snapshot) => {
          const fresh = index(snapshot, now());
          if (startedIn === generation) cached = fresh;
          return fresh;
        })
        .finally(() => {
          if (inflight === load) inflight = null;
        });
      inflight = load;
    }
    try {
      return await inflight;
    } catch (error) {
      console.error("[Features] Could not read feature switches; treating all as off:", error);
      return null;
    }
  }

  function on(state: Indexed, userId: string, key: string): boolean {
    const flag = state.byKey.get(key);
    return decide(flag, flag ? state.listed.get(flag.id)?.has(userId) ?? false : false);
  }

  return {
    async isEnabled(userId: string, key: string): Promise<boolean> {
      const state = await current();
      return state ? on(state, userId, key) : false;
    },

    async enabledKeysFor(userId: string): Promise<string[]> {
      const state = await current();
      if (!state) return [];
      return Array.from(state.byKey.keys()).filter((key) => on(state, userId, key)).sort();
    },

    invalidate(): void {
      generation++;
      cached = null;
      inflight = null;
    },
  };
}

/*
 * The app's instance. storage is imported lazily so this module (and its
 * test) can be loaded without a database connection.
 */
const appFlags = createFeatureFlags({
  async loadSnapshot() {
    const { storage } = await import("../storage");
    return storage.getFeatureFlagSnapshot();
  },
});

export const isEnabled = appFlags.isEnabled;
export const enabledKeysFor = appFlags.enabledKeysFor;
export const invalidateFeatureFlags = appFlags.invalidate;
