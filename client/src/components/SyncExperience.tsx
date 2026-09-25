import { useCallback, useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AlertCircle, ArrowRight, Check, Maximize2, Minimize2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useMoney } from "@/hooks/useMoney";
import { useExchangeRates } from "@/hooks/useExchangeRates";
import { ServiceLogo } from "@/components/ServiceLogo";
import { FREQUENCY_SUFFIX } from "@/lib/format";
import {
  applyEvent,
  finishQuietly,
  isFinalEvent,
  newRun,
  shortStatus,
  steps,
  totals,
  type ProgressEvent,
  type Step,
  type SyncRun,
} from "@/lib/syncRun";

/**
 * The one place a sync is shown, on every page.
 *
 * A sync opens in a window with a checklist of what it is doing. "Run in
 * background" shrinks that to a small popup in the corner, which opens the
 * window again. Someone who refreshes or comes back while a sync is running
 * gets the window again; one who comes back after it finished does not --
 * the dashboard's banner and the email cover that.
 */

type View = "modal" | "toast" | "hidden";

interface SyncStatus {
  running: boolean;
  pendingSuggestions: number;
}

interface PendingSuggestion {
  id: string;
  serviceName: string;
  amount: string;
  currency: string;
  frequency: string;
  emailEvidence?: { fromEmail?: string | null }[];
}

/** The review page's own query, so finishing a sync fills its cache too. */
const PENDING_KEY = (userId: string) => [`/api/suggestions?userId=${userId}&page=1&pageSize=100`];

/** How often to ask the server whether a running sync is still running. */
const STATUS_POLL_MS = 15_000;
const LIST_LIMIT = 5;
const PER_MONTH: Record<string, number> = { monthly: 1, yearly: 1 / 12, quarterly: 1 / 3, weekly: 4.33 };

async function fetchStatus(): Promise<SyncStatus | null> {
  try {
    const res = await fetch("/api/sync/status", { credentials: "include" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** "500: {"message":"..."}" from the request helper, as a sentence. */
function startError(raw: string): string {
  const body = raw.replace(/^\d{3}:\s*/, "");
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.message === "string") return parsed.message;
  } catch {
    /* Not JSON: use it as it is. */
  }
  return body || "The sync could not be started.";
}

function refreshAfterSync() {
  for (const prefix of ["/api/suggestions", "/api/subscriptions", "/api/stats", "/api/sync/status", "/api/invoices"]) {
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0]?.toString().startsWith(prefix) ?? false });
  }
}

export function SyncExperience() {
  const { user } = useAuth();
  const userId: string | undefined = user?.id;
  const [run, setRun] = useState<SyncRun | null>(null);
  const [view, setView] = useState<View>("hidden");
  const runRef = useRef<SyncRun | null>(null);
  runRef.current = run;

  const begin = useCallback((as: View) => {
    setRun(newRun());
    setView(as);
  }, []);

  // A sync started from any page: the dashboard's Sync now, settings, onboarding.
  useEffect(() => {
    const onTrigger = () => {
      if (runRef.current?.phase === "running") {
        setView("modal");
        return;
      }
      begin("modal");
    };
    // The request to start was refused. "Already running" is not a failure:
    // the window simply follows the sync that is.
    const onStartFailed = (event: Event) => {
      const raw = String((event as CustomEvent).detail ?? "");
      if (raw.startsWith("409")) return;
      setRun((r) => (r && r.phase === "running" ? { ...r, phase: "failed", errorMessage: startError(raw) } : r));
      setView("modal");
    };
    window.addEventListener("syncTrigger", onTrigger);
    window.addEventListener("syncStartFailed", onStartFailed);
    return () => {
      window.removeEventListener("syncTrigger", onTrigger);
      window.removeEventListener("syncStartFailed", onStartFailed);
    };
  }, [begin]);

  // Arriving on the app: straight from connecting a mailbox, or back mid-sync.
  useEffect(() => {
    if (!userId) return;
    try {
      const onboardedAt = Number(localStorage.getItem("onboardedAt") || 0);
      if (localStorage.getItem("justOnboarded") === "true" && Date.now() - onboardedAt < 5 * 60_000) {
        localStorage.removeItem("justOnboarded");
        localStorage.removeItem("onboardedAt");
        if (!runRef.current) begin("modal");
      }
    } catch {
      /* Storage blocked: the status check below still finds a running sync. */
    }
    let cancelled = false;
    fetchStatus().then((status) => {
      if (!cancelled && status?.running && !runRef.current) begin("modal");
    });
    return () => {
      cancelled = true;
    };
  }, [userId, begin]);

  // Progress, as the server sends it. The server replays its latest event to a
  // new connection, which is how a refreshed page picks up where it was.
  useEffect(() => {
    if (!userId) return;
    const source = new EventSource(`/api/sync-progress/${userId}`);
    source.onmessage = (message) => {
      let event: ProgressEvent;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      if (event.type !== "progress") return;
      if (!runRef.current) {
        // A replay of a finished sync is old news; the banner has it.
        if (isFinalEvent(event)) return;
        setRun(applyEvent(newRun(), event));
        setView((v) => (v === "hidden" ? "modal" : v));
        return;
      }
      setRun((r) => (r ? applyEvent(r, event) : r));
    };
    return () => source.close();
  }, [userId]);

  // The final event can be lost with the connection. While a run is going,
  // ask the server now and then, and finish it if the server has.
  useEffect(() => {
    if (run?.phase !== "running") return;
    const timer = window.setInterval(async () => {
      const status = await fetchStatus();
      if (status && !status.running) setRun((r) => (r ? finishQuietly(r) : r));
    }, STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [run?.phase]);

  // The dashboard reads this to show its Sync button as busy.
  const phase = run?.phase;
  useEffect(() => {
    try {
      if (phase === "running") localStorage.setItem("syncInProgress", "true");
      else localStorage.removeItem("syncInProgress");
    } catch {
      /* Only the button's busy state depends on it. */
    }
    if (phase === "done" || phase === "failed") refreshAfterSync();
  }, [phase]);

  const close = () => {
    setView("hidden");
    if (run && run.phase !== "running") setRun(null);
  };

  if (!run || view === "hidden" || !userId) return null;

  return view === "modal" ? (
    <SyncWindow run={run} userId={userId} onBackground={() => setView(run.phase === "running" ? "toast" : "hidden")} onClose={close} />
  ) : (
    <SyncPopup run={run} userId={userId} onExpand={() => setView("modal")} onClose={close} />
  );
}

/* ------------------------------------------------------------------ */

function useSyncContext() {
  const { user } = useAuth();
  const gmail = useQuery<{ gmailEmail?: string }[]>({ queryKey: ["/api/gmail/accounts"] });
  const outlook = useQuery<{ outlookEmail?: string }[]>({ queryKey: ["/api/outlook/accounts"] });
  const mailboxes = [
    ...(gmail.data ?? []).map((a) => a.gmailEmail),
    ...(outlook.data ?? []).map((a) => a.outlookEmail),
  ].filter((m): m is string => Boolean(m));
  const syncDays: number = user?.emailSyncDays || 30;
  const where = mailboxes.length === 1 ? mailboxes[0] : mailboxes.length > 1 ? `your ${mailboxes.length} inboxes` : "your inbox";
  return { syncDays, where, currency: (user?.preferredCurrency as string) || "USD" };
}

/** What is waiting in the review inbox once a run has finished. */
function usePending(userId: string, enabled: boolean) {
  const { data } = useQuery<{ suggestions: PendingSuggestion[]; total: number }>({
    queryKey: PENDING_KEY(userId),
    enabled,
    staleTime: 0,
  });
  return { suggestions: data?.suggestions ?? [], total: data?.total ?? 0, loaded: Boolean(data) };
}

const noun = (count: number) => (count === 1 ? "subscription" : "subscriptions");

/* ------------------------------------------------------------------ */

function SyncWindow({
  run,
  userId,
  onBackground,
  onClose,
}: {
  run: SyncRun;
  userId: string;
  onBackground: () => void;
  onClose: () => void;
}) {
  const { syncDays, where, currency } = useSyncContext();
  const finished = run.phase !== "running";

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && (finished ? onClose() : onBackground())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          data-testid="sync-window"
          className="fixed left-1/2 top-1/2 z-50 w-[min(560px,calc(100vw-32px))] max-h-[calc(100dvh-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[14px] border border-line bg-surface shadow-[0_30px_70px_-20px_rgba(0,0,0,0.45)] focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          {run.phase === "running" ? (
            <Running run={run} syncDays={syncDays} where={where} currency={currency} onBackground={onBackground} />
          ) : run.phase === "failed" ? (
            <Failed run={run} onClose={onClose} />
          ) : (
            <Finished run={run} userId={userId} syncDays={syncDays} onClose={onClose} />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Running({
  run,
  syncDays,
  where,
  currency,
  onBackground,
}: {
  run: SyncRun;
  syncDays: number;
  where: string;
  currency: string;
  onBackground: () => void;
}) {
  const list = steps(run, { syncDays, currency });
  const t = totals(run);
  const pct = Math.round(run.progress);

  return (
    <>
      <div className="flex flex-col gap-4 border-b border-line-soft bg-[hsl(0,0%,98%)] px-5 pb-5 pt-6 sm:px-7">
        <div className="flex flex-col gap-1">
          <DialogPrimitive.Title className="font-serif text-[26px] font-normal leading-tight tracking-[-0.02em] text-ink">
            Finding your subscriptions
          </DialogPrimitive.Title>
          <p className="break-words text-[13px] text-ink-body">
            Reading the last {syncDays} days of {where}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="h-1.5 flex-grow overflow-hidden rounded-full bg-line-soft"
            role="progressbar"
            aria-label="Sync progress"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[12.5px] font-semibold tabular-nums text-ink-strong">{pct}%</span>
        </div>
      </div>

      <ol className="flex flex-col px-5 pb-2 pt-5 sm:px-7" aria-label="Sync steps">
        {list.map((step, i) => (
          <StepRow key={step.title} step={step} last={i === list.length - 1} nextDone={list[i + 1]?.state !== "waiting"} />
        ))}
      </ol>

      {t.foundSoFar > 0 && (
        <div className="mx-5 mt-3 flex items-center gap-3 rounded-xl bg-[hsl(0,0%,97%)] px-4 py-3.5 sm:mx-7" aria-live="polite">
          <div className="flex flex-none">
            {t.foundNames.map((name, i) => (
              <span
                key={name + i}
                className={cn(
                  "flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-line bg-surface text-[13px] font-bold text-ink-body",
                  i > 0 && "-ml-2",
                )}
              >
                {name.trim().charAt(0).toUpperCase()}
              </span>
            ))}
          </div>
          <span className="text-[13px] text-ink-strong">
            <span className="font-bold tabular-nums">{t.foundSoFar}</span> {noun(t.foundSoFar)} found so far
          </span>
        </div>
      )}

      <div className="flex flex-col gap-3 px-5 pb-5 pt-5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-7">
        <span className="max-w-[260px] text-[12px] leading-snug text-muted-foreground">
          You can close this. We'll email you if we find anything.
        </span>
        <button type="button" onClick={onBackground} className="btn-base btn-secondary h-[38px] gap-2 self-end px-4 text-[13px] font-semibold sm:self-auto" data-testid="button-run-in-background">
          <Minimize2 size={15} strokeWidth={2} aria-hidden="true" />
          Run in background
        </button>
      </div>
    </>
  );
}

function StepRow({ step, last, nextDone }: { step: Step; last: boolean; nextDone: boolean }) {
  return (
    <li className={cn("flex gap-3.5", last ? "pb-1.5" : "pb-[18px]")} aria-current={step.state === "active" ? "step" : undefined}>
      <div className="flex flex-col items-center">
        {step.state === "done" ? (
          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-success">
            <Check size={13} strokeWidth={3} className="text-white" aria-hidden="true" />
          </span>
        ) : step.state === "active" ? (
          <span className="block h-6 w-6 flex-none animate-spin rounded-full border-[2.5px] border-accent-soft border-t-accent motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <span className="block h-6 w-6 flex-none rounded-full border-2 border-line-firm" aria-hidden="true" />
        )}
        {!last && <span className={cn("mt-1 w-0.5 flex-grow", step.state === "done" && nextDone ? "bg-success" : "bg-line-firm")} />}
      </div>
      <div className="flex min-w-0 flex-grow flex-col gap-2 pt-0.5">
        <div className="flex flex-col gap-0.5">
          <span className={cn("text-[14px]", step.state === "waiting" ? "font-medium text-muted-foreground" : "font-semibold text-ink")}>
            {step.title}
            <span className="sr-only">{step.state === "done" ? " (done)" : step.state === "active" ? " (in progress)" : " (not started)"}</span>
          </span>
          <span className="text-[12.5px] tabular-nums text-muted-foreground">{step.detail}</span>
        </div>
        {step.fraction !== undefined && (
          <div className="h-1 w-full overflow-hidden rounded-sm bg-accent-soft">
            <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round(step.fraction * 100)}%`, opacity: 0.55 }} />
          </div>
        )}
      </div>
    </li>
  );
}

function Finished({ run, userId, syncDays, onClose }: { run: SyncRun; userId: string; syncDays: number; onClose: () => void }) {
  const [, setLocation] = useLocation();
  const { display, userCurrency } = useMoney();
  const { convert } = useExchangeRates();
  const pending = usePending(userId, true);
  const t = totals(run);
  // Nothing new from this run, or nothing waiting at all.
  const nothingNew = run.suggestionsGenerated === 0 || (pending.loaded && pending.total === 0);

  const monthly = (s: PendingSuggestion) => {
    const value = convert(Number(s.amount) || 0, s.currency, userCurrency);
    return value === null ? -1 : value * (PER_MONTH[s.frequency] ?? 1);
  };
  const top = [...pending.suggestions].sort((a, b) => monthly(b) - monthly(a)).slice(0, LIST_LIMIT);
  const more = pending.total - top.length;

  const review = () => {
    onClose();
    setLocation("/review");
  };

  const read = t.totalEmails !== undefined ? `In ${t.totalEmails.toLocaleString("en-US")} emails from the last ${syncDays} days. ` : "";

  return (
    <>
      <div className="flex items-start gap-4 border-b border-line-soft bg-[hsl(0,0%,98%)] px-5 pb-5 pt-6 sm:px-7">
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-success-soft">
          <Check size={22} strokeWidth={2.6} className="text-success" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <DialogPrimitive.Title className="font-serif text-[26px] font-normal leading-tight tracking-[-0.02em] text-ink">
            {nothingNew
              ? "No new subscriptions found"
              : pending.loaded
                ? `Found ${pending.total} ${noun(pending.total)}`
                : "Sync finished"}
          </DialogPrimitive.Title>
          <p className="text-[13px] leading-snug text-ink-body">
            {nothingNew
              ? pending.total > 0
                ? `${read}You still have ${pending.total} ${noun(pending.total)} waiting for review.`
                : `${read}Anything you've already reviewed isn't shown again.`
              : `${read}Nothing is added until you approve it.`}
          </p>
        </div>
      </div>

      {top.length > 0 && (
        <ul className="flex flex-col px-5 pt-4 sm:px-7" aria-label="Found subscriptions">
          {top.map((s, i) => (
            <li key={s.id} className={cn("flex items-center gap-3 py-2.5", i > 0 && "border-t border-line-soft")}>
              <ServiceLogo name={s.serviceName} merchantEmail={s.emailEvidence?.find((e) => e.fromEmail)?.fromEmail ?? null} size={32} />
              <span className="min-w-0 flex-grow truncate text-[14px] font-semibold text-ink">{s.serviceName}</span>
              <span className="flex-none text-[14px] font-semibold tabular-nums text-ink">
                {display(s.amount, s.currency).primary}
                <span className="text-[11.5px] font-medium text-muted-foreground">{FREQUENCY_SUFFIX[s.frequency] ?? ""}</span>
              </span>
            </li>
          ))}
          {more > 0 && <li className="pb-1 pt-2.5 text-[12.5px] text-muted-foreground">and {more} more</li>}
        </ul>
      )}

      {run.failedMailboxes > 0 && run.finalMessage && (
        <p className="mx-5 mt-4 flex gap-2 rounded-lg bg-warning-bg px-3 py-2.5 text-[12.5px] leading-snug text-ink-strong sm:mx-7">
          <AlertCircle size={15} strokeWidth={2} className="mt-px flex-none text-warning" aria-hidden="true" />
          {run.finalMessage}
        </p>
      )}

      <div className="mt-3 flex items-center justify-end gap-2 border-t border-line-soft px-5 pb-5 pt-4 sm:px-7">
        {pending.total > 0 ? (
          <>
            <button type="button" onClick={onClose} className="btn-base btn-ghost h-10 px-4 text-[13.5px] font-semibold">
              Later
            </button>
            <button type="button" onClick={review} className="btn-base btn-accent h-10 gap-2 px-[18px] text-[13.5px]" data-testid="button-review-found">
              Review {pending.total} {noun(pending.total)}
              <ArrowRight size={15} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </>
        ) : (
          <button type="button" onClick={onClose} className="btn-base btn-secondary h-10 px-4 text-[13.5px]">
            Close
          </button>
        )}
      </div>
    </>
  );
}

function Failed({ run, onClose }: { run: SyncRun; onClose: () => void }) {
  return (
    <>
      <div className="flex items-start gap-4 px-5 pb-4 pt-6 sm:px-7">
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-destructive-soft">
          <AlertCircle size={22} strokeWidth={2.2} className="text-destructive" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <DialogPrimitive.Title className="font-serif text-[26px] font-normal leading-tight tracking-[-0.02em] text-ink">
            The sync didn't finish
          </DialogPrimitive.Title>
          <p className="break-words text-[13px] leading-snug text-ink-body">{run.errorMessage}</p>
        </div>
      </div>
      <div className="flex justify-end border-t border-line-soft px-5 pb-5 pt-4 sm:px-7">
        <button type="button" onClick={onClose} className="btn-base btn-secondary h-10 px-4 text-[13.5px]">
          Close
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function SyncPopup({
  run,
  userId,
  onExpand,
  onClose,
}: {
  run: SyncRun;
  userId: string;
  onExpand: () => void;
  onClose: () => void;
}) {
  const [, setLocation] = useLocation();
  const pending = usePending(userId, run.phase === "done");
  const t = totals(run);

  const iconButton =
    "btn-base btn-ghost h-[30px] w-[30px] flex-none px-0 bg-[hsl(0,0%,96%)] hover:!bg-line-soft";

  let body: JSX.Element;
  if (run.phase === "running") {
    body = (
      <>
        <div className="flex items-center gap-2.5">
          <span className="block h-4 w-4 flex-none animate-spin rounded-full border-2 border-accent-soft border-t-accent motion-reduce:animate-none" aria-hidden="true" />
          <span className="flex-grow text-[13.5px] font-semibold text-ink">Finding your subscriptions</span>
          <button type="button" onClick={onExpand} aria-label="Open sync details" className={iconButton} data-testid="button-open-sync">
            <Maximize2 size={14} strokeWidth={2} aria-hidden="true" />
          </button>
          <button type="button" onClick={onClose} aria-label="Hide" className={iconButton}>
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <div className="h-[5px] overflow-hidden rounded-full bg-accent-soft">
          <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round(run.progress)}%` }} />
        </div>
        <div className="flex justify-between gap-3 text-[12px] text-ink-body">
          <span className="truncate tabular-nums">{shortStatus(run)}</span>
          {t.foundSoFar > 0 && <span className="flex-none font-semibold tabular-nums text-ink-strong">{t.foundSoFar} found</span>}
        </div>
      </>
    );
  } else if (run.phase === "failed") {
    body = (
      <div className="flex items-center gap-2.5">
        <AlertCircle size={16} strokeWidth={2.2} className="flex-none text-destructive" aria-hidden="true" />
        <span className="flex-grow text-[13.5px] font-semibold text-ink">The sync didn't finish</span>
        <button type="button" onClick={onExpand} className="btn-base btn-ghost h-[30px] px-2.5 text-[12.5px] font-semibold">
          Details
        </button>
        <button type="button" onClick={onClose} aria-label="Close" className={iconButton}>
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    );
  } else {
    const count = pending.total;
    const nothingNew = pending.loaded && count === 0;
    body = (
      <div className="flex items-center gap-2.5">
        <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-success-soft">
          <Check size={12} strokeWidth={3} className="text-success" aria-hidden="true" />
        </span>
        <span className="flex-grow text-[13.5px] font-semibold text-ink">
          {nothingNew ? "No new subscriptions found" : pending.loaded ? `Found ${count} ${noun(count)}` : "Sync finished"}
        </span>
        {count > 0 && (
          <button
            type="button"
            onClick={() => {
              onClose();
              setLocation("/review");
            }}
            className="btn-base btn-accent h-[30px] px-3 text-[12.5px]"
            data-testid="button-review-found"
          >
            Review
          </button>
        )}
        <button type="button" onClick={onClose} aria-label="Close" className={iconButton}>
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="sync-popup"
      className="fixed bottom-4 right-4 z-50 flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-3 rounded-[14px] border border-line bg-surface py-4 pl-[18px] pr-4 shadow-[0_18px_44px_-14px_rgba(10,10,10,0.28)] animate-in fade-in-0 slide-in-from-bottom-4 sm:bottom-7 sm:right-7"
    >
      {body}
    </div>
  );
}
