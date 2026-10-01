import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Link } from "wouter";
import { Archive, Check, ChevronDown, CircleCheck, Clock, Plus, Receipt } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useMoney } from "@/hooks/useMoney";
import { ToastAction } from "@/components/ui/toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ServiceLogo } from "@/components/ServiceLogo";
import { SuggestionEvidence, type ReviewSuggestion } from "@/components/ReviewCard";
import { cn } from "@/lib/utils";
import { displayCategory, formatCurrency, FREQUENCY_LABEL, FREQUENCY_SUFFIX } from "@/lib/format";
import { formatDay, type PaymentRow } from "@/lib/lifecycle";

/**
 * The combined review inbox (feature switch `subscription_status`).
 *
 * New-subscription suggestions and "Still paying?" questions in one list, with
 * filter chips and the buttons on every row: Approve / Not a subscription for
 * a suggestion, Still active / Mark inactive for a payment question. A row
 * opens to show why it is here.
 *
 * The decisions are the ones that already exist: approve and reject for a
 * suggestion, and the still-active / mark-inactive endpoints for a payment
 * question. Nothing here decides a status.
 */

const PAGE_SIZE = 100;
/** Rows shown before "Show N more". */
const FIRST_ROWS = 8;

interface PaymentReview {
  id: string;
  service_name: string;
  merchant_email: string | null;
  amount: string;
  currency: string;
  frequency: string;
  category: string | null;
  last_payment_at: string | null;
  flagged_at: string | null;
  reason: string;
  recent_payments: PaymentRow[];
}

type Item =
  | { kind: "new"; key: string; name: string; at: number; suggestion: ReviewSuggestion }
  | { kind: "review"; key: string; name: string; at: number; review: PaymentReview };

type Filter = "all" | "new" | "review";
type Sort = "newest" | "oldest" | "name";

const SORT_LABEL: Record<Sort, string> = { newest: "Newest first", oldest: "Oldest first", name: "Name A to Z" };

function invalidateAll() {
  for (const prefix of ["/api/suggestions", "/api/subscriptions", "/api/stats", "/api/payment-reviews", "/api/sync/status"]) {
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0]?.toString().startsWith(prefix) ?? false,
    });
  }
}

const CONFIDENCE: Record<string, { label: string; cls: string }> = {
  high: { label: "High confidence", cls: "status-active" },
  medium: { label: "Medium confidence", cls: "status-review" },
  low: { label: "Low confidence", cls: "status-cancelled" },
};

export default function CombinedReviewInbox() {
  const { user } = useAuth();
  const userId = user?.id;
  const { toast } = useToast();
  const reduceMotion = useReducedMotion();

  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  /* undefined until the list first loads, so the first row can open itself
     once; null afterwards means the person closed it on purpose. */
  const [openKey, setOpenKey] = useState<string | null | undefined>(undefined);
  const [gone, setGone] = useState<Record<string, true>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const suggestionsQuery = useQuery<{ suggestions: ReviewSuggestion[]; total: number }>({
    queryKey: [`/api/suggestions?userId=${userId}&page=1&pageSize=${PAGE_SIZE}`],
    enabled: !!userId,
    refetchOnMount: true,
    staleTime: 0,
  });
  const reviewsQuery = useQuery<{ reviews: PaymentReview[]; total: number }>({
    queryKey: ["/api/payment-reviews"],
    enabled: !!userId,
    refetchOnMount: true,
    staleTime: 0,
  });
  const isLoading = suggestionsQuery.isLoading || reviewsQuery.isLoading;
  const refetchSuggestions = suggestionsQuery.refetch;

  // A sync finding suggestions while this page is open: show them as they arrive.
  useEffect(() => {
    if (!userId) return;
    const source = new EventSource(`/api/sync-progress/${userId}`);
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.stage === "suggestion_found" || data.stage === "stage2_complete" || data.stage === "suggestions_ready") {
          refetchSuggestions();
        }
      } catch {
        /* ignore a malformed event */
      }
    };
    return () => source.close();
  }, [userId, refetchSuggestions]);

  const items: Item[] = useMemo(() => {
    const list: Item[] = [];
    for (const s of suggestionsQuery.data?.suggestions ?? []) {
      const created = (s as ReviewSuggestion & { createdAt?: string | Date | null }).createdAt;
      list.push({ kind: "new", key: `s:${s.id}`, name: s.serviceName, at: created ? new Date(created).getTime() : 0, suggestion: s });
    }
    for (const r of reviewsQuery.data?.reviews ?? []) {
      list.push({ kind: "review", key: `r:${r.id}`, name: r.service_name, at: r.flagged_at ? new Date(r.flagged_at).getTime() : 0, review: r });
    }
    return list.filter((item) => !gone[item.key]);
  }, [suggestionsQuery.data, reviewsQuery.data, gone]);

  const counts = {
    all: items.length,
    new: items.filter((i) => i.kind === "new").length,
    review: items.filter((i) => i.kind === "review").length,
  };

  const visible = useMemo(() => {
    const chosen = items.filter((i) => filter === "all" || i.kind === filter);
    return [...chosen].sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : sort === "oldest" ? a.at - b.at : b.at - a.at,
    );
  }, [items, filter, sort]);

  useEffect(() => {
    if (openKey === undefined && visible.length > 0) setOpenKey(visible[0].key);
  }, [openKey, visible]);

  const shown = showAll ? visible : visible.slice(0, FIRST_ROWS);
  const hiddenCount = visible.length - shown.length;

  // --- Decisions ---------------------------------------------------------

  const undoSuggestions = async (id: string, createdSubscriptionIds: string[]) => {
    try {
      await apiRequest("POST", "/api/suggestions/undo", { suggestionIds: [id], createdSubscriptionIds });
      setGone((prev) => {
        const next = { ...prev };
        delete next[`s:${id}`];
        return next;
      });
      invalidateAll();
    } catch {
      toast({
        title: "Couldn't undo",
        description: "The decision was saved and could not be reversed. You can change it from the dashboard.",
        variant: "destructive",
      });
    }
  };

  const decideSuggestion = useMutation({
    mutationFn: async ({ s, decision }: { s: ReviewSuggestion; decision: "approve" | "reject" }) => {
      const response = await apiRequest(
        "POST",
        decision === "approve" ? "/api/suggestions/approve" : "/api/suggestions/reject",
        decision === "approve" ? { userId, suggestionIds: [s.id] } : { suggestionIds: [s.id] },
      );
      return response.json();
    },
  });

  const decideNew = async (s: ReviewSuggestion, decision: "approve" | "reject") => {
    const key = `s:${s.id}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      const result = await decideSuggestion.mutateAsync({ s, decision });
      setGone((prev) => ({ ...prev, [key]: true }));
      invalidateAll();
      toast({
        title: decision === "approve" ? `${s.serviceName} added` : `${s.serviceName} rejected`,
        description:
          decision === "approve" ? "It's on your dashboard now." : "It won't be suggested again from these emails.",
        duration: 6000,
        action: (
          <ToastAction altText="Undo" onClick={() => undoSuggestions(s.id, result.createdSubscriptionIds ?? [])}>
            Undo
          </ToastAction>
        ),
      });
    } catch {
      toast({
        title: decision === "approve" ? "Couldn't approve" : "Couldn't reject",
        description: "Nothing was changed. Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  };

  const decideReview = async (r: PaymentReview, answer: "still-active" | "mark-inactive") => {
    const key = `r:${r.id}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      await apiRequest("POST", `/api/subscriptions/${r.id}/${answer}`);
      setGone((prev) => ({ ...prev, [key]: true }));
      invalidateAll();
      toast({
        title: answer === "still-active" ? `${r.service_name} kept as active` : `${r.service_name} marked inactive`,
        description:
          answer === "still-active"
            ? "We won't ask again for a while."
            : "It's no longer counted in your totals. You can mark it active again from its page.",
        duration: 6000,
        action:
          answer === "mark-inactive" ? (
            <ToastAction
              altText="Undo"
              onClick={async () => {
                try {
                  await apiRequest("POST", `/api/subscriptions/${r.id}/mark-active`);
                  setGone((prev) => {
                    const next = { ...prev };
                    delete next[key];
                    return next;
                  });
                  invalidateAll();
                } catch {
                  toast({ title: "Couldn't undo", description: "Open the subscription to mark it active.", variant: "destructive" });
                }
              }}
            >
              Undo
            </ToastAction>
          ) : undefined,
      });
    } catch {
      toast({
        title: "Couldn't save that",
        description: "Nothing was changed. Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  };

  if (!userId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Please log in to view your reviews.</p>
      </div>
    );
  }

  const total = counts.all;
  const subline = isLoading
    ? "Checking what needs a decision…"
    : total === 0
      ? "Nothing waiting for review."
      : `${total} ${total === 1 ? "thing needs" : "things need"} a decision.`;

  const chips: { key: Filter; label: string; count: number; icon: React.ReactNode }[] = [
    { key: "all", label: "All", count: counts.all, icon: null },
    { key: "new", label: "New subscriptions", count: counts.new, icon: <Plus size={13} strokeWidth={2.4} aria-hidden="true" /> },
    { key: "review", label: "Review payment", count: counts.review, icon: <Clock size={13} strokeWidth={2.4} className="text-warning" aria-hidden="true" /> },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-[hsl(0,0%,95%)]" data-testid="review-combined">
      <main className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 lg:px-10 pt-6 sm:pt-8 pb-16">
        <div className="mx-auto w-full max-w-[1100px] flex flex-col gap-3.5">
          <header className="flex flex-col gap-1.5">
            <h1 className="t-page">Review inbox</h1>
            <p className="text-[14px] sm:text-[15px] text-ink-body" aria-live="polite">{subline}</p>
          </header>

          {!isLoading && total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div role="group" aria-label="Filter reviews" className="flex flex-wrap gap-2">
                {chips.map((chip) => {
                  const selected = filter === chip.key;
                  return (
                    <button
                      key={chip.key}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setFilter(chip.key)}
                      data-testid={`review-filter-${chip.key}`}
                      className={cn(
                        "h-[34px] px-3.5 rounded-full border text-[13.5px] inline-flex items-center gap-1.5 transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected
                          ? "bg-primary text-primary-foreground border-primary font-semibold"
                          : "bg-surface text-ink-strong border-line-firm font-medium hover:bg-line-soft",
                      )}
                    >
                      {chip.icon}
                      {chip.label}
                      <span className={selected ? "opacity-70" : "text-muted-foreground"} aria-hidden="true">·</span>
                      <span className={selected ? "" : "font-semibold"}>{chip.count}</span>
                    </button>
                  );
                })}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Sort reviews, ${SORT_LABEL[sort]}`}
                    className="btn-base btn-secondary h-[34px] pl-3 pr-2.5 text-[13.5px]"
                    data-testid="review-sort"
                  >
                    <span className="text-muted-foreground">Sort:</span>
                    {SORT_LABEL[sort]}
                    <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(Object.keys(SORT_LABEL) as Sort[]).map((key) => (
                    <DropdownMenuItem key={key} onClick={() => setSort(key)}>
                      {SORT_LABEL[key]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {isLoading ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-surface border border-line rounded-[16px] animate-pulse h-[72px]" />
              ))}
            </div>
          ) : total === 0 ? (
            <div className="flex flex-col items-center justify-center text-center gap-[18px] py-16 px-6" data-testid="review-empty">
              <span className="w-[56px] h-[56px] rounded-full bg-success flex items-center justify-center" aria-hidden="true">
                <Check size={28} strokeWidth={2.6} className="text-white" />
              </span>
              <h2 className="font-serif text-[30px] font-normal tracking-[-0.02em] leading-tight text-ink">All caught up</h2>
              <p className="text-[14.5px] leading-relaxed text-ink-body max-w-[420px]">
                Nothing needs a decision. New subscriptions and questions about payments will show up here.
              </p>
              <Link href="/" className="btn-base btn-accent h-10 px-4 text-[13.5px]">
                Go to dashboard
              </Link>
            </div>
          ) : visible.length === 0 ? (
            <p className="text-[13px] text-muted-foreground py-6" data-testid="review-filter-empty">
              Nothing in this filter.{" "}
              <button type="button" className="font-semibold text-accent hover:underline" onClick={() => setFilter("all")}>
                Show all
              </button>
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-2" aria-label="Things to review">
                <AnimatePresence initial={false}>
                  {shown.map((item) => (
                    <motion.li
                      key={item.key}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0, marginTop: -8, transition: { duration: 0.22 } }}
                      className="overflow-hidden -mx-1 px-1 -my-1 py-1"
                    >
                      <ReviewRow
                        item={item}
                        open={openKey === item.key}
                        busy={busyKey !== null}
                        onToggle={() => setOpenKey(openKey === item.key ? null : item.key)}
                        onApprove={(s) => decideNew(s, "approve")}
                        onReject={(s) => decideNew(s, "reject")}
                        onStillActive={(r) => decideReview(r, "still-active")}
                        onMarkInactive={(r) => decideReview(r, "mark-inactive")}
                      />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
              {hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  data-testid="review-show-more"
                  className="h-10 rounded-[10px] border border-dashed border-line-firm bg-transparent text-[13.5px] font-semibold text-ink-strong inline-flex items-center justify-center gap-1.5 hover:bg-line-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Show {hiddenCount} more
                  <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------

function ReviewRow({
  item,
  open,
  busy,
  onToggle,
  onApprove,
  onReject,
  onStillActive,
  onMarkInactive,
}: {
  item: Item;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onApprove: (s: ReviewSuggestion) => void;
  onReject: (s: ReviewSuggestion) => void;
  onStillActive: (r: PaymentReview) => void;
  onMarkInactive: (r: PaymentReview) => void;
}) {
  const { display } = useMoney();
  const isNew = item.kind === "new";
  const base = isNew ? item.suggestion : item.review;
  const name = item.name;
  const amount = isNew ? item.suggestion.amount : item.review.amount;
  const currency = isNew ? item.suggestion.currency : item.review.currency;
  const frequency = isNew ? item.suggestion.frequency : item.review.frequency;
  const category = displayCategory(isNew ? item.suggestion.category : item.review.category);
  const merchantEmail = isNew
    ? item.suggestion.emailEvidence?.find((e) => e.fromEmail)?.fromEmail ?? null
    : item.review.merchant_email;
  const money = display(amount, currency);
  const confidence = isNew ? CONFIDENCE[item.suggestion.confidence] ?? { label: item.suggestion.confidence, cls: "status-cancelled" } : null;
  const panelId = `review-panel-${item.key}`;
  const headerId = `review-header-${item.key}`;
  void base;

  return (
    <div
      className={cn(
        "rounded-[16px] border transition-colors",
        open ? "border-line bg-[hsl(0,0%,97%)] p-2" : "border-line bg-surface hover:border-line-firm",
      )}
      data-testid={`review-row-${item.key}`}
    >
      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-3", open ? "px-3 pt-2.5 pb-3" : "px-4 sm:px-5 py-3")}>
        <ServiceLogo name={name} merchantEmail={merchantEmail} size={40} />
        <div className="flex flex-col gap-1.5 flex-1 min-w-[150px]">
          <span id={headerId} className="text-[16px] font-semibold text-ink leading-tight [text-wrap:pretty]">{name}</span>
          <span className="flex flex-wrap items-center gap-1.5">
            {category && <span className="badge-category">{category}</span>}
            <span className="badge-cadence">{FREQUENCY_LABEL[frequency] ?? frequency}</span>
            {isNew ? (
              <>
                <span className="badge-cadence gap-1.5" data-testid="review-type">
                  <Plus size={12} strokeWidth={2.4} className="text-ink-body" aria-hidden="true" />
                  New subscription
                </span>
                {confidence && <span className={cn("badge-status", confidence.cls)}>{confidence.label}</span>}
              </>
            ) : (
              <span className="badge-cadence gap-1.5" data-testid="review-type">
                <Clock size={12} strokeWidth={2.4} className="text-warning" aria-hidden="true" />
                Review payment
              </span>
            )}
          </span>
        </div>
        <span className="text-[19px] font-bold tracking-[-0.02em] tabular-nums text-ink max-sm:ml-14">
          {money.primary}
          <span className="text-[13px] font-medium text-muted-foreground">{FREQUENCY_SUFFIX[frequency] ?? ""}</span>
        </span>

        <div className="flex items-center gap-2 max-sm:order-last max-sm:w-full max-sm:[&>button]:flex-1">
          {isNew ? (
            <>
              <button
                type="button"
                className="btn-base btn-secondary h-9 px-3.5 text-[13.5px] font-semibold"
                onClick={() => onReject(item.suggestion)}
                disabled={busy}
                aria-label={`${name}: not a subscription`}
                data-testid={`review-reject-${item.key}`}
              >
                Not a subscription
              </button>
              <button
                type="button"
                className="btn-base btn-accent h-9 px-4 text-[13.5px]"
                onClick={() => onApprove(item.suggestion)}
                disabled={busy}
                aria-label={`Approve ${name}`}
                data-testid={`review-approve-${item.key}`}
              >
                Approve
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn-base btn-secondary h-8 px-3 text-[12.5px] font-semibold bg-rail"
                onClick={() => onMarkInactive(item.review)}
                disabled={busy}
                aria-label={`Mark ${name} inactive`}
                data-testid={`review-inactive-${item.key}`}
              >
                <Archive size={14} strokeWidth={2} aria-hidden="true" />
                Mark inactive
              </button>
              <button
                type="button"
                className="btn-base h-8 px-3 text-[12.5px] font-semibold border border-success bg-success-soft text-success hover:brightness-95"
                onClick={() => onStillActive(item.review)}
                disabled={busy}
                aria-label={`${name} is still active`}
                data-testid={`review-still-active-${item.key}`}
              >
                <CircleCheck size={14} strokeWidth={2} aria-hidden="true" />
                Still active
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? `Hide details for ${name}` : `Show details for ${name}`}
          className="btn-base btn-ghost w-[34px] h-[34px] px-0 flex-none max-sm:ml-auto"
          data-testid={`review-toggle-${item.key}`}
        >
          <ChevronDown size={18} strokeWidth={2} className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
      </div>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className="mt-1.5 bg-surface rounded-[12px] border border-line-soft px-4 sm:px-5 py-4 flex flex-col gap-3"
        >
          {isNew ? (
            <SuggestionEvidence suggestion={item.suggestion} />
          ) : (
            <PaymentEvidence review={item.review} />
          )}
        </div>
      )}
    </div>
  );
}

/** Why a payment question is asked, and the counted payments it rests on. No email text. */
function PaymentEvidence({ review: r }: { review: PaymentReview }) {
  return (
    <>
      <p className="text-[14.5px] font-semibold text-ink">{r.reason}</p>
      <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-ink-body">Evidence found</span>
      {r.recent_payments.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No payments on record.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {r.recent_payments.map((p) => (
            <li key={`${p.date}-${p.source}`} className="flex items-center gap-3 px-3.5 py-3 rounded-[10px] bg-canvas">
              <Receipt size={16} strokeWidth={2} className="flex-none text-ink-body" aria-hidden="true" />
              <span className="flex-1 min-w-0 text-[13.5px]">
                <span className="font-semibold">{p.source}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {p.amount !== null ? formatCurrency(Number(p.amount), p.currency ?? r.currency) : "amount not shown"}
                </span>
              </span>
              <span className="text-[12px] text-muted-foreground tabular-nums">{formatDay(p.date)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
