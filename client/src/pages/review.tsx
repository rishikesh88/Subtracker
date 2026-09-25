import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Link } from "wouter";
import { Check, Inbox, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { ReviewCard, type Decision, type ReviewSuggestion } from "@/components/ReviewCard";

/**
 * How long a card shows its green or red before it leaves. Long enough to
 * register which button was pressed, short enough not to feel like a wait.
 */
const TINT_MS = 260;

/** The slide out, then the gap closing behind it. */
const EXIT_MS = 460;

/** Everything the inbox holds, in one request: the list is worked through
 *  top to bottom, and a pager would split that into arbitrary pieces. */
const PAGE_SIZE = 100;

function invalidateAfterDecision() {
  for (const prefix of ["/api/suggestions", "/api/subscriptions", "/api/stats"]) {
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0]?.toString().startsWith(prefix) ?? false,
    });
  }
}

/**
 * The review inbox.
 *
 * One suggestion is open at a time and the first opens by itself. Approving
 * turns the card green and sends it off to the right; rejecting turns it red
 * and sends it left; either way the next one opens, so a batch is cleared as
 * a run of decisions rather than a list to scan.
 *
 * Each decision is saved as it is made -- nothing is lost by closing the tab
 * halfway -- and a message offers Undo for a few seconds afterwards.
 */
export default function ReviewInbox() {
  const { user } = useAuth();
  const userId = user?.id;
  const { toast } = useToast();
  const reduceMotion = useReducedMotion();

  const [isSyncInProgress, setIsSyncInProgress] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ stage: '', progress: 0, message: '', suggestionsFound: 0 });

  /* undefined until the list first loads, so the first card can open itself
     once; null afterwards means the person closed every card on purpose, and
     nothing reopens behind their back. */
  const [openId, setOpenId] = useState<string | null | undefined>(undefined);
  const [leaving, setLeaving] = useState<Record<string, Decision>>({});
  const [gone, setGone] = useState<Record<string, Decision>>({});
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const { data: suggestionsData = { suggestions: [], total: 0 }, isLoading, refetch } = useQuery<{
    suggestions: ReviewSuggestion[];
    total: number;
  }>({
    queryKey: [`/api/suggestions?userId=${userId}&page=1&pageSize=${PAGE_SIZE}`],
    enabled: !!userId,
    refetchOnMount: true,
    staleTime: 0,
  });

  // Listen for SSE events for progressive loading of suggestions
  useEffect(() => {
    if (!userId) return;

    const eventSource = new EventSource(`/api/sync-progress/${userId}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle suggestion_found events - refresh suggestions list
        if (data.stage === 'suggestion_found') {
          setIsSyncInProgress(true);
          setSyncProgress({
            stage: data.stage,
            progress: data.progress || 0,
            message: data.message || '',
            suggestionsFound: data.details?.totalSuggestions || 0
          });
          // Refetch suggestions to show new ones
          refetch();
        } else if (data.stage === 'stage1_complete') {
          setIsSyncInProgress(true);
          setSyncProgress({
            stage: data.stage,
            progress: data.progress || 30,
            message: data.message || 'Analyzing subscriptions...',
            suggestionsFound: 0
          });
        } else if (data.stage === 'stage2_complete' || data.stage === 'suggestions_ready') {
          setSyncProgress({
            stage: data.stage,
            progress: 100,
            message: 'Analysis complete!',
            suggestionsFound: data.details?.totalSuggestions || syncProgress.suggestionsFound
          });
          // Final refetch and clear sync state after a short delay
          refetch();
          setTimeout(() => setIsSyncInProgress(false), 2000);
        } else if (data.stage === 'syncing' || data.stage === 'fetching' || data.stage === 'processing' || data.stage === 'analyzing') {
          setIsSyncInProgress(true);
          setSyncProgress({
            stage: data.stage,
            progress: data.progress || 0,
            message: data.message || 'Syncing...',
            suggestionsFound: 0
          });
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    eventSource.onerror = () => {
      // Connection lost - will auto-reconnect
    };

    return () => {
      eventSource.close();
    };
  }, [userId, refetch]);

  /* The order people work in: as detected, with anything skipped moved to
     the back so it comes round again after everything else. */
  const queue = useMemo(() => {
    const live = suggestionsData.suggestions.filter((s) => !gone[s.id]);
    const skippedSet = new Set(skipped);
    const fresh = live.filter((s) => !skippedSet.has(s.id));
    const later = skipped
      .map((id) => live.find((s) => s.id === id))
      .filter((s): s is ReviewSuggestion => Boolean(s));
    return [...fresh, ...later];
  }, [suggestionsData.suggestions, gone, skipped]);

  useEffect(() => {
    if (openId === undefined && queue.length > 0) setOpenId(queue[0].id);
  }, [openId, queue]);

  /** The card after this one, once this one is out of the way. */
  const nextAfter = useCallback(
    (id: string, order: ReviewSuggestion[] = queue): string | null => {
      const index = order.findIndex((s) => s.id === id);
      const rest = order.filter((s) => s.id !== id);
      return (rest[index] ?? rest[0])?.id ?? null;
    },
    [queue],
  );

  /* Focus follows the open card. Without this, deciding with the keyboard
     drops focus on the page body the moment the card it was in disappears. */
  const focusCard = (id: string | null) => {
    if (!id) return;
    window.setTimeout(() => document.getElementById(`review-header-${id}`)?.focus({ preventScroll: false }), TINT_MS + 40);
  };

  const undoMutation = useMutation({
    mutationFn: async (body: { suggestionIds: string[]; createdSubscriptionIds: string[] }) => {
      const response = await apiRequest("POST", "/api/suggestions/undo", body);
      return response.json();
    },
  });

  const undo = async (ids: string[], createdSubscriptionIds: string[], reopen: string) => {
    try {
      await undoMutation.mutateAsync({ suggestionIds: ids, createdSubscriptionIds });
      setGone((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
      setLeaving((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
      setOpenId(reopen);
      invalidateAfterDecision();
      focusCard(reopen);
    } catch {
      toast({
        title: "Couldn't undo",
        description: "The decision was saved and could not be reversed. You can change it from Subscriptions.",
        variant: "destructive",
      });
    }
  };

  /**
   * Record a decision on one or more cards.
   *
   * The card is tinted first and leaves a beat later, so the colour is seen;
   * the request goes out at once rather than after the animation. If it
   * fails, the cards come back exactly where they were.
   */
  const decide = async (ids: string[], decision: Decision) => {
    if (ids.length === 0 || busy) return;
    setBusy(true);

    const upcoming = ids.length === 1 ? nextAfter(ids[0]) : null;
    const first = queue.find((s) => s.id === ids[0]);

    setLeaving((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = decision;
      return next;
    });

    const request = apiRequest(
      "POST",
      decision === "approve" ? "/api/suggestions/approve" : "/api/suggestions/reject",
      decision === "approve" ? { userId, suggestionIds: ids } : { suggestionIds: ids },
    ).then((r) => r.json());

    window.setTimeout(() => {
      setGone((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = decision;
        return next;
      });
      setOpenId(upcoming);
      focusCard(upcoming);
    }, reduceMotion ? 0 : TINT_MS);

    try {
      const result = await request;
      const createdSubscriptionIds: string[] = result.createdSubscriptionIds ?? [];
      /* Refreshed only once the card has gone. The request usually returns
         well inside the tint, and refetching then pulled the card out of the
         list before anyone saw it turn green -- it vanished rather than
         leaving. */
      window.setTimeout(invalidateAfterDecision, reduceMotion ? 0 : TINT_MS + EXIT_MS + 60);

      const single = ids.length === 1 && first ? first.serviceName : null;
      toast({
        title:
          decision === "approve"
            ? single ? `${single} added` : `${ids.length} subscriptions added`
            : single ? `${single} rejected` : `${ids.length} suggestions rejected`,
        description:
          decision === "approve"
            ? "It's on your Subscriptions page now."
            : "It won't be suggested again from these emails.",
        duration: 6000,
        action: (
          <ToastAction altText="Undo" onClick={() => undo(ids, createdSubscriptionIds, ids[0])}>
            Undo
          </ToastAction>
        ),
      });
    } catch {
      // Put everything back where it was: the decision did not happen.
      setGone((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
      setLeaving((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
      setOpenId(ids[0]);
      toast({
        title: decision === "approve" ? "Couldn't approve" : "Couldn't reject",
        description: "Nothing was changed. Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const skip = (id: string) => {
    const upcoming = nextAfter(id);
    setSkipped((prev) => [...prev.filter((x) => x !== id), id]);
    setOpenId(upcoming);
    focusCard(upcoming);
  };

  if (!userId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Please log in to view suggestions.</p>
      </div>
    );
  }

  const count = queue.length;
  const subline = isLoading
    ? "Checking what your last sync found…"
    : count === 0
      ? "Nothing waiting for review right now."
      : `Your last sync found ${count} subscription${count === 1 ? "" : "s"}. Approve the ones you want to track.`;

  const allIds = queue.map((s) => s.id);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-[hsl(0,0%,95%)]">
      {/* Progressive Loading Banner */}
      {isSyncInProgress && (
        <div
          className="flex-shrink-0 flex items-center gap-3 border-b border-line bg-line-soft"
          style={{ padding: "10px 24px" }}
        >
          <div className="w-4 h-4 border-2 border-ink-body border-t-transparent rounded-full animate-spin flex-none" />
          <div className="flex-1 min-w-0">
            <p className="text-[12.5px] font-medium text-ink-strong truncate">
              {syncProgress.message || 'Analyzing your emails...'}
            </p>
            {syncProgress.suggestionsFound > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {syncProgress.suggestionsFound} subscription{syncProgress.suggestionsFound !== 1 ? 's' : ''} found so far
              </p>
            )}
          </div>
          <div className="hidden sm:block w-32 h-1.5 bg-line rounded-full overflow-hidden flex-none">
            <div
              className="h-full bg-ink rounded-full transition-all duration-500"
              style={{ width: `${syncProgress.progress}%` }}
            />
          </div>
        </div>
      )}
      <main className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 pt-8 pb-16">
        <div className="mx-auto w-full max-w-[1000px] flex flex-col gap-7">
          <header className="flex items-end justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <h1 className="t-page">Review inbox</h1>
              <p className="text-[13px] text-muted-foreground mt-1.5">{subline}</p>
            </div>
            {count > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-base btn-secondary !h-9 !px-3.5 !text-[13px] font-semibold"
                  onClick={() => decide(allIds, "reject")}
                  disabled={busy}
                  data-testid="button-reject-all"
                >
                  <X size={15} strokeWidth={2.2} aria-hidden="true" />
                  Reject all
                </button>
                <button
                  type="button"
                  className="btn-base btn-approve !h-9 !px-3.5 !text-[13px]"
                  onClick={() => decide(allIds, "approve")}
                  disabled={busy}
                  data-testid="button-approve-all"
                >
                  <Check size={15} strokeWidth={2.4} aria-hidden="true" />
                  Approve all ({count})
                </button>
              </div>
            )}
          </header>

          {isLoading ? (
            <div className="flex flex-col gap-3" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className={`bg-surface border border-line rounded-[16px] animate-pulse ${i === 0 ? "h-[320px]" : "h-[76px]"}`} />
              ))}
            </div>
          ) : count === 0 ? (
            <div className="bg-surface border border-line rounded-[16px] flex flex-col items-center justify-center text-center py-12 px-6">
              <Inbox size={20} strokeWidth={2} className="text-muted-foreground" aria-hidden="true" />
              <h2 className="text-[14px] font-semibold text-ink mt-3">All caught up</h2>
              <p className="text-[12.5px] text-muted-foreground mt-1">
                Everything the last sync found has been decided.{" "}
                <Link href="/subscriptions" className="text-accent font-medium">See your subscriptions</Link>
              </p>
            </div>
          ) : (
            <ul className="flex flex-col" aria-label="Suggestions to review">
              <AnimatePresence initial={false}>
                {queue.map((s) => (
                  /*
                   * Leaving is two movements: the card slides off toward its
                   * verdict, then the space it held closes. They overlap a
                   * little so it reads as one gesture.
                   *
                   * No `layout` here. Layout animation fakes size changes with
                   * transforms, so the list item's real height dropped to zero
                   * at once and the cards below jumped up underneath a card
                   * still on its way out. Animating the real height lets the
                   * rest of the list follow it down smoothly.
                   *
                   * The clip is vertical only: it hides the card as its row
                   * closes without cutting off the sideways slide.
                   */
                  <motion.li
                    key={s.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0, x: 0 }}
                    exit={
                      reduceMotion
                        ? { opacity: 0, transition: { duration: 0.15 } }
                        : {
                            opacity: 0,
                            x: leaving[s.id] === "reject" ? -160 : 160,
                            height: 0,
                            paddingBottom: 0,
                            clipPath: "inset(0px -400px 0px -400px)",
                            transition: {
                              x: { duration: 0.28, ease: [0.4, 0, 1, 1] },
                              opacity: { duration: 0.26, ease: "easeIn" },
                              height: { duration: 0.24, delay: 0.2, ease: [0.4, 0, 0.2, 1] },
                              paddingBottom: { duration: 0.24, delay: 0.2 },
                            },
                          }
                    }
                    transition={{ type: "spring", stiffness: 420, damping: 38 }}
                    className="pb-3"
                  >
                    <ReviewCard
                      suggestion={s}
                      open={openId === s.id}
                      leaving={leaving[s.id]}
                      busy={busy}
                      onToggle={() => setOpenId(openId === s.id ? null : s.id)}
                      onApprove={() => decide([s.id], "approve")}
                      onReject={() => decide([s.id], "reject")}
                      onSkip={() => skip(s.id)}
                    />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
