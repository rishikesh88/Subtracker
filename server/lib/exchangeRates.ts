/**
 * Live exchange rates, refreshed on a timer, with somewhere to fall back to.
 *
 * Every amount is stored in the currency it was billed in -- that is the fact
 * on the receipt and it never changes. Conversion happens when a total is
 * read, not when a subscription is found, because "what this costs me" is a
 * question about today's rate.
 *
 * Nothing here is allowed to fail a sync. A rate service having a bad minute
 * is a far smaller problem than an inbox scan that does not finish, so every
 * path out of this module returns a usable table.
 */
import { log } from "../vite";

/**
 * Every currency onboarding offers. This list and the country picker have to
 * agree: a currency someone can choose but that has no rate is worse than one
 * that is not offered, because the totals still render and are simply wrong.
 */
export const SUPPORTED_CURRENCIES = [
  "INR", "USD", "EUR", "GBP", "AED", "CAD", "AUD", "JPY", "CNY", "SGD",
] as const;

const WANTED = SUPPORTED_CURRENCIES.filter((c) => c !== "INR");

/**
 * Units of INR for one unit of the currency. INR is the pivot only because it
 * is what the converter already used.
 *
 * The last resort, behind the live fetch and the last good fetch of this
 * process. Only the four this app shipped with are here; a currency missing
 * from this table simply cannot be converted until a fetch lands, which is
 * the honest answer rather than a made-up number.
 */
const BASELINE_TO_INR: Readonly<Record<string, number>> = Object.freeze({
  INR: 1.0,
  USD: 83.0,
  EUR: 90.0,
  GBP: 105.0,
});

const TWELVE_HOURS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

let rates: Record<string, number> = { ...BASELINE_TO_INR };
let fetchedAt: number | null = null;
let inFlight: Promise<void> | null = null;
let warnedAboutBaseline = false;

/**
 * open.er-api.com, free and without a key, covering about 160 currencies.
 *
 * The European Central Bank was the first choice and had to be dropped: it
 * does not publish a dirham, so an account set to AED could never be
 * converted, which is exactly the bug this endpoint exists to fix.
 */
const ENDPOINT = "https://open.er-api.com/v6/latest/INR";

/**
 * Turn a response body into a rate table, or return null.
 *
 * Deliberately strict. We are reading somebody else's JSON and the cost of
 * accepting a malformed body is silently wrong money on every screen, so
 * anything unexpected is treated as a failed fetch and the old table stands.
 */
export function parseRates(body: unknown): Record<string, number> | null {
  if (!body || typeof body !== "object") return null;
  const payload = body as { result?: unknown; base_code?: unknown; rates?: unknown };

  if (payload.result !== undefined && payload.result !== "success") return null;
  if (payload.base_code !== "INR") return null;
  if (!payload.rates || typeof payload.rates !== "object") return null;

  const perRupee = payload.rates as Record<string, unknown>;

  /*
   * One anchor, checked before anything else: a rupee buys a small fraction
   * of a dollar. If USD comes back near or above 1 the table is inverted, and
   * inverting it again would price a dollar at about a paisa and make every
   * total on every screen collapse.
   *
   * It cannot be a blanket "every rate is below 1" check, because a rupee
   * buys roughly 1.8 yen. Only the dollar is a safe anchor.
   */
  const usd = perRupee.USD;
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0.0001 || usd >= 0.5) {
    return null;
  }

  const next: Record<string, number> = { INR: 1.0 };
  for (const code of WANTED) {
    const value = perRupee[code];
    // A currency the service does not carry is left out rather than guessed.
    // Missing is a state the converter handles; wrong is not.
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    next[code] = 1 / value;
  }

  // A table that lost most of what was asked for is a bad response, not a
  // partial one.
  if (Object.keys(next).length < WANTED.length / 2) return null;

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

    const missing = WANTED.filter((c) => !parsed[c]);
    log(
      `[rates] refreshed: ${Object.keys(parsed).length} currencies, ` +
      `USD ${parsed.USD?.toFixed(2)} AED ${parsed.AED?.toFixed(2)} INR` +
      (missing.length ? ` — not carried: ${missing.join(", ")}` : "")
    );
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

/** The current table. Always usable, never empty, but not always complete. */
export function ratesToInr(): Record<string, number> {
  if (fetchedAt === null && !warnedAboutBaseline) {
    warnedAboutBaseline = true;
    log("[rates] no live rates yet, only INR/USD/EUR/GBP can be converted");
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
