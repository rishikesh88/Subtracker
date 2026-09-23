/**
 * Retrying the failures that are worth retrying, and only those.
 *
 * Gemini answers 503 UNAVAILABLE when the model is momentarily overloaded.
 * It is the most common failure this app sees and it almost always clears on
 * the next attempt -- but a single unguarded call turns one bad second into a
 * whole sync producing nothing, after several minutes of fetching email.
 *
 * Deliberately narrow. A bad API key, a malformed request or a content
 * refusal will never succeed on a second attempt, so retrying them only
 * delays the error the caller needs to see.
 */

/** Statuses that mean "try again", as opposed to "this will never work". */
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

/** Network-level failures, which never carry an HTTP status at all. */
const TRANSIENT_MESSAGE = /\b(ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|network error)\b/i;

/**
 * Read an HTTP status off an error, whatever shape it arrived in.
 *
 * The Google SDK sets `status` on its ApiError, but the same number is also
 * embedded in the JSON message it carries, and other layers wrap it. Checking
 * both is what keeps this working when the SDK changes its error class.
 */
function statusOf(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;

  const withStatus = error as { status?: unknown; code?: unknown; message?: unknown };
  if (typeof withStatus.status === "number") return withStatus.status;
  if (typeof withStatus.code === "number") return withStatus.code;

  if (typeof withStatus.message === "string") {
    const match = withStatus.message.match(/"code"\s*:\s*(\d{3})/);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

export function isTransient(error: unknown): boolean {
  const status = statusOf(error);
  if (status !== null) return TRANSIENT_STATUS.has(status);

  const message = error instanceof Error ? error.message : String(error ?? "");
  return TRANSIENT_MESSAGE.test(message);
}

export interface RetryOptions {
  /** Total attempts including the first. */
  attempts?: number;
  /** Delay before the second attempt; doubles each time after. */
  baseDelayMs?: number;
  /** Named in logs so a retry says what was being retried. */
  label?: string;
  /** Test seam. */
  sleep?: (ms: number) => Promise<void>;
  /** Test seam: jitter is random in production, fixed in tests. */
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying transient failures with an exponential backoff.
 *
 * Jitter matters more than it looks: chunks are processed in a loop, so
 * without it every retry in a run would land at the same moment and hit an
 * already-struggling service in a burst.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const label = options.label ?? "request";

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Anything that will not succeed on a retry is thrown straight back,
      // unchanged, so the caller sees the real cause and not a timeout.
      if (!isTransient(error)) throw error;
      if (attempt === attempts) break;

      const backoff = baseDelayMs * Math.pow(2, attempt - 1);
      const jittered = Math.round(backoff * (0.5 + random() * 0.5));
      console.warn(
        `${label}: transient failure on attempt ${attempt}/${attempts}, retrying in ${jittered}ms`
      );
      await sleep(jittered);
    }
  }

  throw lastError;
}
