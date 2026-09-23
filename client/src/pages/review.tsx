import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import type { SubscriptionSuggestion } from "@shared/schema";

interface EmailEvidence {
  id: string;
  subject: string;
  fromName: string;
  /** The sending address, which is how a brand outside the catalogue finds
   *  its logo. A suggestion has no merchant recorded against it yet. */
  fromEmail?: string | null;
  receivedAt: Date | string;
}

interface SuggestionWithEvidence extends SubscriptionSuggestion {
  emailEvidence?: EmailEvidence[];
  /**
   * Set by the server when this looks like a subscription already tracked (#20).
   * Advisory only -- nothing is merged or hidden, because two subscriptions from
   * one merchant are often genuinely separate. The user decides.
   */
  possibleDuplicateOf?: {
    subscriptionId: string;
    serviceName: string;
    amount: string;
    currency: string;
    reason: string;
    confidence: 'exact' | 'likely';
  } | null;
}
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { displayCategory, formatDate, formatCurrency, isUnknownCurrency, FREQUENCY_LABEL, FREQUENCY_SUFFIX } from "@/lib/format";
import { ChevronLeft, ChevronRight, Check, X, Inbox, FileText, Calendar } from "lucide-react";
import { ServiceLogo } from "@/components/ServiceLogo";
import { ReviewCarousel, type ReviewCard } from "@/components/ReviewCarousel";
import { useMoney } from "@/hooks/useMoney";
import { LayoutList, Layers } from "lucide-react";

/**
 * The attachment evidence is stored as a JSON string and can be malformed or
 * absent, so a parse failure has to mean "no documents" rather than a blank
 * page. Restored along with the block that displays it.
 */
function parseAttachmentEvidence(evidence: string | null | undefined): { name: string }[] {
  if (!evidence) return [];
  try {
    const parsed = JSON.parse(evidence);
    const list = Array.isArray(parsed) ? parsed : parsed?.attachments ?? [];
    return list
      .map((item: any) => ({ name: item?.filename || item?.name || "Attachment" }))
      .slice(0, 4);
  } catch {
    return [];
  }
}

export default function ReviewInbox() {
  const { user } = useAuth();
  const userId = user?.id;
  const { toast } = useToast();
  const { display } = useMoney();
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  /* The list is the default. Stepping through one card at a time is built
     and reachable from the header, but it is a proposal rather than a
     decision -- it ships as the default only once it has been looked at. */
  const [mode, setMode] = useState<'cards' | 'list'>('list');
  const [currentPage, setCurrentPage] = useState(1);

  /* Page 3 of a ten-a-page list is not page 3 of a hundred-a-page one, so
     switching view starts from the top rather than somewhere arbitrary. */
  useEffect(() => { setCurrentPage(1); }, [mode]);
  /* Stepping through cards has to cover the whole batch in one pass -- being
     handed ten, deciding on them, then discovering there are seven more behind
     a pager is the opposite of what a single sequence is for. The list keeps
     its ten-a-page, which is what a table wants. */
  const pageSize = mode === 'cards' ? 100 : 10;
  const [processingSuggestions, setProcessingSuggestions] = useState<string[]>([]);
  const [isSyncInProgress, setIsSyncInProgress] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ stage: '', progress: 0, message: '', suggestionsFound: 0 });

  const { data: suggestionsData = { suggestions: [], total: 0 }, isLoading, refetch } = useQuery<{
    suggestions: SuggestionWithEvidence[];
    total: number;
  }>({
    queryKey: [`/api/suggestions?userId=${userId}&page=${currentPage}&pageSize=${pageSize}`],
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

  const { suggestions, total } = suggestionsData;
  const totalPages = Math.ceil(total / pageSize);

  useEffect(() => {
    if (!isLoading && suggestions.length > 0) {
      const highConfidenceIds = suggestions
        .filter(s => s.confidence === 'high')
        .map(s => s.id);
      setSelectedSuggestions(highConfidenceIds);
    }
  }, [suggestions, isLoading]);

  const approveMutation = useMutation({
    mutationFn: async (suggestionIds: string[]) => {
      const response = await apiRequest("POST", "/api/suggestions/approve", {
        userId,
        suggestionIds,
      });
      return response.json();
    },
    onMutate: async (suggestionIds: string[]) => {
      setProcessingSuggestions(prev => [...prev, ...suggestionIds]);
      setSelectedSuggestions(prev => prev.filter(id => !suggestionIds.includes(id)));
    },
    onSuccess: (data, variables) => {
      setProcessingSuggestions(prev => prev.filter(id => !variables.includes(id)));
      toast({
        title: "Subscription Approved",
        description: `Successfully approved ${data.approved} subscription${data.approved > 1 ? 's' : ''}`,
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0]?.toString().startsWith('/api/suggestions') ?? false
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0]?.toString().startsWith('/api/subscriptions') ?? false
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0]?.toString().startsWith('/api/stats') ?? false
      });
    },
    onError: (error, variables) => {
      setProcessingSuggestions(prev => prev.filter(id => !variables.includes(id)));
      toast({
        title: "Approval Failed",
        description: "Failed to approve subscription. Please try again.",
        variant: "destructive",
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (suggestionIds: string[]) => {
      const response = await apiRequest("POST", "/api/suggestions/reject", {
        suggestionIds,
      });
      return response.json();
    },
    onMutate: async (suggestionIds: string[]) => {
      setProcessingSuggestions(prev => [...prev, ...suggestionIds]);
      setSelectedSuggestions(prev => prev.filter(id => !suggestionIds.includes(id)));
    },
    onSuccess: (data, variables) => {
      setProcessingSuggestions(prev => prev.filter(id => !variables.includes(id)));
      toast({
        title: "Suggestion Rejected",
        description: `Skipped ${data.rejected} suggestion${data.rejected > 1 ? 's' : ''}`,
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0]?.toString().startsWith('/api/suggestions') ?? false
      });
    },
    onError: (error, variables) => {
      setProcessingSuggestions(prev => prev.filter(id => !variables.includes(id)));
      toast({
        title: "Rejection Failed",
        description: "Failed to reject suggestion. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSuggestionSelect = (suggestionId: string, checked: boolean) => {
    if (checked) {
      setSelectedSuggestions(prev => [...prev, suggestionId]);
    } else {
      setSelectedSuggestions(prev => prev.filter(id => id !== suggestionId));
    }
  };

  const selectHighConfidence = () => {
    const highConfidenceIds = suggestions.filter(s => s.confidence === 'high').map(s => s.id);
    setSelectedSuggestions(highConfidenceIds);
  };

  const selectAll = () => {
    setSelectedSuggestions(suggestions.map(s => s.id));
  };

  const clearSelection = () => {
    setSelectedSuggestions([]);
  };

  const handleBatchApprove = () => {
    if (selectedSuggestions.length > 0) {
      approveMutation.mutate(selectedSuggestions);
    }
  };

  const handleBatchReject = () => {
    if (selectedSuggestions.length > 0) {
      rejectMutation.mutate(selectedSuggestions);
    }
  };

  /**
   * The address a suggestion's receipts came from.
   *
   * A suggestion has no merchant recorded against it -- that is worked out
   * when it is approved -- so the first piece of evidence is the only thing
   * that can give the review screen a logo for a brand no list carries.
   */
  const merchantEmailOf = (suggestion: SuggestionWithEvidence): string | null =>
    suggestion.emailEvidence?.find((e) => e.fromEmail)?.fromEmail ?? null;

  const evidenceLineOf = (suggestion: SuggestionWithEvidence): string | null => {
    const evidence = suggestion.emailEvidence;
    if (evidence && evidence.length > 0) {
      const more = evidence.length - 1;
      return `"${evidence[0].subject}" · ${formatDate(evidence[0].receivedAt)}${
        more > 0 ? ` · +${more} more email${more > 1 ? 's' : ''}` : ''
      }`;
    }
    return suggestion.occurrences && suggestion.occurrences > 1
      ? `${suggestion.occurrences} supporting emails`
      : null;
  };

  const reviewCards: ReviewCard[] = useMemo(
    () =>
      suggestions.map((suggestion) => ({
        id: suggestion.id,
        serviceName: suggestion.serviceName,
        amount: suggestion.amount,
        currency: suggestion.currency,
        frequency: suggestion.frequency,
        category: suggestion.category,
        confidence: suggestion.confidence,
        reasoning:
          suggestion.reasoning
          || `This appears to be a ${suggestion.frequency} subscription to ${suggestion.serviceName} based on the email patterns detected.`,
        nextBillingDate: suggestion.nextBillingDate ?? null,
        merchantEmail: merchantEmailOf(suggestion),
        evidenceLine: evidenceLineOf(suggestion),
        duplicateReason: suggestion.possibleDuplicateOf?.reason ?? null,
      })),
    [suggestions]
  );

  /**
   * One save for a whole pass through the cards.
   *
   * Both calls go out together rather than one after the other, because a
   * person pressing save has made one decision about the batch, not two.
   * Either failing shows its own message and leaves the suggestions in place
   * to try again -- nothing here is lost by retrying.
   */
  const handleCarouselSave = (keep: string[], skip: string[]) => {
    if (keep.length > 0) approveMutation.mutate(keep);
    if (skip.length > 0) rejectMutation.mutate(skip);
  };

  // Confidence -> the design's status pair (ink on a soft ground), plus a
  // plain label. High reads as "on track" (active), medium as "worth a
  // second look" (review), low as inert (cancelled's neutral grey).
  const confidenceMeta = (confidence: string): { label: string; cls: string } => {
    switch (confidence) {
      case 'high': return { label: 'High confidence', cls: 'status-active' };
      case 'medium': return { label: 'Medium confidence', cls: 'status-review' };
      case 'low': return { label: 'Low confidence', cls: 'status-cancelled' };
      default: return { label: confidence, cls: 'status-cancelled' };
    }
  };

  if (!userId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Please log in to view suggestions.</p>
      </div>
    );
  }

  const subline = isLoading
    ? "Checking for unmatched charges…"
    : total === 0
      ? "Nothing waiting for review right now."
      : `${total} charge${total === 1 ? "" : "s"} the last sync couldn't match`;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-canvas">
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

      {/* --- Page header ---------------------------------------------------- */}
      <header
        className="flex-shrink-0 bg-surface border-b border-line flex items-end justify-between gap-4 flex-wrap"
        style={{ padding: "20px 24px 16px" }}
      >
        <div className="min-w-0">
          <h1 className="t-page">Review inbox</h1>
          <p className="text-[12.5px] text-muted-foreground mt-1">{subline}</p>
        </div>

        {suggestions.length > 0 && mode === 'cards' && (
          <button
            type="button"
            className="btn-base btn-ghost"
            onClick={() => setMode('list')}
            data-testid="mode-list"
          >
            <LayoutList size={15} strokeWidth={2} />
            Review as a list
          </button>
        )}

        {suggestions.length > 0 && mode === 'list' && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              className="btn-base btn-ghost"
              onClick={() => setMode('cards')}
              data-testid="mode-cards"
            >
              <Layers size={15} strokeWidth={2} />
              One at a time
            </button>
            <div className="w-px h-5 bg-line mx-1" />
            <span className="text-[12.5px] text-muted-foreground mr-1">
              {selectedSuggestions.length} of {suggestions.length} selected
            </span>
            <button type="button" className="btn-base btn-ghost" onClick={selectHighConfidence}>
              Select high confidence
            </button>
            <button type="button" className="btn-base btn-ghost" onClick={selectAll}>
              Select all
            </button>
            <button type="button" className="btn-base btn-ghost" onClick={clearSelection}>
              Clear
            </button>
            {selectedSuggestions.length > 0 && (
              <>
                <div className="w-px h-5 bg-line mx-1" />
                <button
                  type="button"
                  className="btn-base btn-secondary"
                  onClick={handleBatchReject}
                  disabled={rejectMutation.isPending}
                >
                  <X size={15} strokeWidth={2} />
                  Reject ({selectedSuggestions.length})
                </button>
                <button
                  type="button"
                  className="btn-base btn-primary"
                  onClick={handleBatchApprove}
                  disabled={approveMutation.isPending}
                >
                  <Check size={15} strokeWidth={2} />
                  Approve ({selectedSuggestions.length})
                </button>
              </>
            )}
          </div>
        )}
      </header>

      {/* --- Body ------------------------------------------------------------ */}
      <main
        className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-[18px]"
        style={{ padding: "20px 24px 40px" }}
      >
        {isLoading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-line-soft rounded-card h-[132px] animate-pulse" />
            ))}
          </div>
        ) : suggestions.length === 0 ? (
          <div className="surface-card flex flex-col items-center justify-center text-center py-10">
            <Inbox size={20} strokeWidth={2} className="text-muted-foreground" />
            <h3 className="text-[13px] font-semibold text-ink mt-3">Nothing to review</h3>
            <p className="text-[11.5px] text-muted-foreground mt-1">
              The last sync matched every charge it found.
            </p>
          </div>
        ) : mode === 'cards' ? (
          <ReviewCarousel
            cards={reviewCards}
            confidenceMeta={confidenceMeta}
            onSave={handleCarouselSave}
            isSaving={approveMutation.isPending || rejectMutation.isPending}
            onSwitchToList={() => setMode('list')}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {suggestions.map((suggestion) => {
              const isProcessing = processingSuggestions.includes(suggestion.id);
              const attachments = parseAttachmentEvidence(suggestion.attachmentEvidence);
              const isSelected = selectedSuggestions.includes(suggestion.id);
              const category = displayCategory(suggestion.category);
              const confidence = confidenceMeta(suggestion.confidence);
              const frequencyLabel = FREQUENCY_LABEL[suggestion.frequency] ?? suggestion.frequency;
              const frequencySuffix = FREQUENCY_SUFFIX[suggestion.frequency] ?? "";
              const money = display(suggestion.amount, suggestion.currency);
              const reasoningText = suggestion.reasoning
                || `This appears to be a ${suggestion.frequency} subscription to ${suggestion.serviceName} based on the email patterns detected.`;
              const evidenceLine = suggestion.emailEvidence && suggestion.emailEvidence.length > 0
                ? `"${suggestion.emailEvidence[0].subject}" · ${formatDate(suggestion.emailEvidence[0].receivedAt)}${
                    suggestion.emailEvidence.length > 1 ? ` · +${suggestion.emailEvidence.length - 1} more email${suggestion.emailEvidence.length - 1 > 1 ? 's' : ''}` : ''
                  }`
                : (suggestion.occurrences && suggestion.occurrences > 1
                    ? `${suggestion.occurrences} supporting emails`
                    : null);

              return (
                <div
                  key={suggestion.id}
                  className={cn(
                    "surface-card p-[15px] flex flex-col gap-3 transition-opacity duration-200",
                    isProcessing && "opacity-50"
                  )}
                  data-testid={`suggestion-card-${suggestion.id}`}
                >
                  {/* Top line */}
                  <div className="flex items-center gap-2.5">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) => handleSuggestionSelect(suggestion.id, checked as boolean)}
                      disabled={isProcessing}
                    />
                    <ServiceLogo name={suggestion.serviceName} merchantEmail={merchantEmailOf(suggestion)} size={34} />
                    <span className="t-card-title flex-1 min-w-0 truncate">{suggestion.serviceName}</span>
                    <span className="t-price flex-none text-right">
                      {money.primary}
                      <span className="text-[11.5px] font-medium text-muted-foreground">{frequencySuffix}</span>
                      {money.secondary && (
                        <span className="block text-[10.5px] font-medium text-muted-foreground tabular-nums">
                          billed {money.secondary}
                        </span>
                      )}
                    </span>
                  </div>

                  {/* Badge row */}
                  <div className="flex flex-wrap gap-[5px]">
                    <span className="badge-cadence">{frequencyLabel}</span>
                    {category && <span className="badge-category">{category}</span>}
                    <span className={cn("badge-status", confidence.cls)}>{confidence.label}</span>
                    {/* Detection found no currency printed in the email and
                        refused to guess one. Worth a glance before approving,
                        because the amount is right and only the unit is open. */}
                    {isUnknownCurrency(suggestion.currency) && (
                      <span className="badge-status status-trial" data-testid={`currency-unknown-${suggestion.id}`}>
                        Check currency
                      </span>
                    )}
                    {suggestion.possibleDuplicateOf && (
                      <span
                        className="badge-status status-review"
                        title={suggestion.possibleDuplicateOf.reason}
                        data-testid="badge-possible-duplicate"
                      >
                        Possible duplicate
                      </span>
                    )}
                  </div>

                  {/* Evidence */}
                  <div className="bg-line-soft rounded-lg p-3 flex flex-col gap-1.5">
                    <p className="text-[12.5px] text-ink-body">{reasoningText}</p>
                    {suggestion.possibleDuplicateOf && (
                      <p className="text-[11.5px] text-warning" data-testid="text-duplicate-reason">
                        {suggestion.possibleDuplicateOf.reason}
                      </p>
                    )}
                  </div>
                  {evidenceLine && (
                    <p className="text-[11.5px] text-muted-foreground -mt-1.5">{evidenceLine}</p>
                  )}

                  {/*
                    The rest of the evidence. These were dropped in the first
                    styling pass as decoration, but they are the page's whole
                    purpose: every one is real, stored data, and together they
                    are the answer to "why does Verloq think this is a
                    subscription". Folded into compact lines rather than the
                    three separate bordered boxes they used to occupy.
                  */}
                  {(attachments.length > 0 ||
                    (suggestion.recurringKeywords && suggestion.recurringKeywords.length > 0) ||
                    suggestion.nextBillingDate) && (
                    <div className="flex flex-col gap-2 -mt-1">
                      {attachments.length > 0 && (
                        <div className="flex items-start gap-2 text-[11.5px] text-muted-foreground">
                          <FileText size={13} strokeWidth={2} className="flex-none mt-px" />
                          <span className="min-w-0">
                            {attachments.map((att) => att.name).join(", ")}
                          </span>
                        </div>
                      )}

                      {suggestion.recurringKeywords && suggestion.recurringKeywords.length > 0 && (
                        <div className="flex flex-wrap items-center gap-[5px]">
                          {suggestion.recurringKeywords.slice(0, 5).map((keyword, index) => (
                            <span key={index} className="badge-category">
                              {keyword}
                            </span>
                          ))}
                        </div>
                      )}

                      {suggestion.nextBillingDate && (
                        <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                          <Calendar size={13} strokeWidth={2} className="flex-none" />
                          <span>Next charge expected {formatDate(suggestion.nextBillingDate)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Per-row actions */}
                  <div className="flex items-center justify-end gap-2 border-t border-line-soft pt-3">
                    <button
                      type="button"
                      className="btn-base btn-secondary"
                      onClick={() => rejectMutation.mutate([suggestion.id])}
                      disabled={isProcessing}
                    >
                      <X size={15} strokeWidth={2} />
                      Reject
                    </button>
                    <button
                      type="button"
                      className="btn-base btn-primary"
                      onClick={() => approveMutation.mutate([suggestion.id])}
                      disabled={isProcessing}
                    >
                      <Check size={15} strokeWidth={2} />
                      Approve
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {mode === 'list' && totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              className="btn-base btn-secondary"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft size={15} strokeWidth={2} />
              Previous
            </button>
            <span className="text-[12.5px] text-muted-foreground px-4">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              className="btn-base btn-secondary"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
              <ChevronRight size={15} strokeWidth={2} />
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
