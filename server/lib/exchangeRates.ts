/**
 * Live exchange rates, refreshed on a timer, with somewhere to fall back to.
 *
 * Every amount is stored in the currency it was billed in -- that is the fact
 * on the receipt and it never changes. Conversion happens when a total is
 * read, not when a subscription is found, because "what this costs me" is a
 * question about today's rate. Stamping a rate on at sync time would freeze a
 * dollar subscription at whatever the rate was the week we first saw it.
 *
 * Nothing here is allowed to fail a sync. A rate service having a bad minute
 * is a far smaller problem than an inbox scan that does not finish, so every
 * path out of this module returns a usable table.
 */
import { log } from "../vite";

/**
 * Units of INR for one unit of the currency. INR is the pivot only because it
 * is what the converter already used; nothing depends on it being the user's
 * currency.
 *
 * These are the last resort, behind the live fetch and behind the last good
 * fetch of this process. They were accurate in late 2023 and are now several
 * percent out, which is why using them logs a warning rather than passing
 * quietly.
 */
const BASELINE_TO_INR: Readonly<Record<string, number>> = Object.freeze({
  INR: 1.0,
  USD: 83.0,
  EUR: 90.0,
  GBP: 105.0,
});

/** The currencies a person can pick, so the ones worth asking for. */
const WANTED = ["USD", "EUR", "GBP"] as const;

const TWELVE_HOURS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

let rates: Record<string, number> = { ...BASELINE_TO_INR };
let fetchedAt: number | null = null;
let inFlight: Promise<void> | null = null;
let warnedAboutBaseline = false;

/**
 * European Central Bank reference rates, republished free and without a key.
 * One call returns every currency we offer.
 */
const ENDPOINT = `https://api.frankfurter.app/latest?base=INR&symbols=${WANTED.join(",")}`;

/**
 * Turn a response body into a rate table, or return null.
 *
 * Deliberately strict. We are reading somebody else's JSON and the cost of
 * accepting a malformed body is silently wrong money on every screen, so
 * anything unexpected is treated as a failed fetch and the old table stands.
 */
function parseRates(body: unknown): Record<string, number> | null {
  if (!body || typeof body !== "object") return null;
  const payload = body as { base?: unknown; rates?: unknown };

  // base=INR means `rates` holds how much of each currency one rupee buys.
  if (payload.base !== "INR") return null;
  if (!payload.rates || typeof payload.rates !== "object") return null;

  const perRupee = payload.rates as Record<string, unknown>;
  const next: Record<string, number> = { INR: 1.0 };

  for (const code of WANTED) {
    const value = perRupee[code];
    // A rupee is worth a fraction of any of these, so anything at or above 1
    // means we have misread the direction and must not use it.
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value >= 1) {
      return null;
    }
    next[code] = 1 / value;
  }

  return next;
}

async function fetchRates(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, { signal: controller.signal });
    if (!response.ok) {
      log(`[rates] ${response.status} from the rate service, keeping existing rates`);
      return;
    }

    const parsed = parseRates(await response.json());
    if (!parsed) {
      log("[rates] unexpected response shape, keeping existing rates");
      return;
    }

    rates = parsed;
    fetchedAt = Date.now();
    warnedAboutBaseline = false;
    log(`[rates] refreshed: ${WANTED.map((c) => `${c} ${parsed[c].toFixed(2)}`).join(", ")} INR`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(`[rates] refresh failed (${reason}), keeping existing rates`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bring the table up to date if it is stale. Safe to call as often as you
 * like -- a fresh table returns immediately and concurrent callers share one
 * request rather than starting several.
 */
export function refreshRates(): Promise<void> {
  const fresh = fetchedAt !== null && Date.now() - fetchedAt < TWELVE_HOURS;
  if (fresh) return Promise.resolve();
  if (inFlight) return inFlight;

  inFlight = fetchRates().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** The current table. Always usable, never empty. */
export function ratesToInr(): Record<string, number> {
  if (fetchedAt === null && !warnedAboutBaseline) {
    warnedAboutBaseline = true;
    log("[rates] no live rates yet, converting with the 2023 baseline");
  }
  return rates;
}

/** When the table was last filled from the rate service, for display. */
export function ratesFetchedAt(): Date | null {
  return fetchedAt === null ? null : new Date(fetchedAt);
}

/** Test seam: drop back to the starting state. */
export function __resetRatesForTest(): void {
  rates = { ...BASELINE_TO_INR };
  fetchedAt = null;
  inFlight = null;
  warnedAboutBaseline = false;
}

export { BASELINE_TO_INR, parseRates as __parseRatesForTest };
