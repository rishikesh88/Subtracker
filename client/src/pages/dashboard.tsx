import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { RefreshCw, Mail, Plus, Search, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMailboxes } from "@/hooks/useMailboxes";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { AddSubscriptionModal } from "@/components/AddSubscriptionModal";
import { SubscriptionSuggestionsModal } from "@/components/SubscriptionSuggestionsModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import SubscriptionDetail from "@/pages/subscription-detail";
import { cn } from "@/lib/utils";
import { filterBucket, formatCurrency, displayCategory } from "@/lib/format";
import { SubscriptionCard } from "@/components/SubscriptionCard";
import { useExchangeRates } from "@/hooks/useExchangeRates";
import { ReviewBanner } from "@/components/ReviewBanner";
import { type Subscription } from "@shared/schema";


// "synced 2 hours ago" -- purely a display formatter for the sync
// timestamp the page already has (user.lastSync).
function timeAgo(date: Date): string {
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function Dashboard() {
  const mailboxes = useMailboxes();
  const { convert } = useExchangeRates();
  const { toast } = useToast();
  const { user } = useAuth();
  const currentUserId = user?.id;
  const [suggestionsModalOpen, setSuggestionsModalOpen] = useState(false);
  const [addSubscriptionModalOpen, setAddSubscriptionModalOpen] = useState(false);
  const [isSyncInProgress, setIsSyncInProgress] = useState(false);
  // Presentation-only: which filter segment is selected on the subscription grid.
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "expired">("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  /*
   * The subscription detail is a drawer over the dashboard. It keeps its own
   * URL, /subscriptions/:id, so a shared link, a refresh and the back button
   * behave -- the Subscriptions page it used to open over is gone.
   */
  const [detailMatches, detailParams] = useRoute("/subscriptions/:id");
  const [, setLocation] = useLocation();
  const openSubscriptionId = detailMatches ? detailParams?.id : undefined;

  // Track sync progress from localStorage
  useEffect(() => {
    const checkSyncProgress = () => {
      const syncInProgress = localStorage.getItem('syncInProgress') === 'true';
      setIsSyncInProgress(syncInProgress);
    };

    // Check initially
    checkSyncProgress();

    // Poll for changes (simple approach)
    const interval = setInterval(checkSyncProgress, 500);

    return () => clearInterval(interval);
  }, []);

  // Legacy event listener removed - suggestions modal replaced with dedicated /review page

  // Handle Gmail OAuth callback
  useEffect(() => {
    const handleGmailCallback = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const gmailConnected = urlParams.get('gmailConnected');

        console.log("Gmail OAuth callback, gmailConnected:", gmailConnected);

        // If returning from Gmail OAuth, handle the connection result
        if (gmailConnected === 'true' && currentUserId) {
            toast({
              title: "Gmail Connected!",
              description: "Successfully connected your Gmail account. Starting email sync...",
              variant: "default",
            });

            // Clear URL parameters
            window.history.replaceState({}, document.title, window.location.pathname);

            // Refresh user data
            queryClient.invalidateQueries({ queryKey: [`/api/auth/user`] });

            // Automatically trigger email sync with progress modal after a delay
            setTimeout(() => {
              // Set sync flags and dispatch event before starting sync
              localStorage.setItem('justOnboarded', 'true');
              localStorage.setItem('onboardedAt', Date.now().toString());
              window.dispatchEvent(new Event('syncTrigger'));

              syncEmailsMutation.mutate();
            }, 1500);
        } else if (gmailConnected === 'false') {
          const error = urlParams.get('error');
          toast({
            title: "Gmail Connection Failed",
            description: error || "Failed to connect Gmail account",
            variant: "destructive",
          });

          // Clear URL parameters
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } catch (error) {
        console.error("Initialization error:", error);
        toast({
          title: "Initialization Error",
          description: "Failed to initialize application. Please refresh the page.",
          variant: "destructive",
        });
      }
    };

    handleGmailCallback();
  }, [currentUserId, toast]);

  // User data is available from useAuth hook

  // Fetch subscription stats
  const { data: stats, isLoading: statsLoading } = useQuery<{totalMonthly: number, activeCount: number, emailsAnalyzed: number, avgPerService: number, newThisMonth: number, changePercent: number}>({
    queryKey: [`/api/stats?userId=${currentUserId}`],
    enabled: !!currentUserId,
  });

  // Fetch approved subscriptions for dashboard display
  const { data: subscriptions = [], isLoading: subscriptionsLoading } = useQuery<Subscription[]>({
    queryKey: ['/api/subscriptions'],
    enabled: !!currentUserId,
  });

  // Gmail auth mutation
  const gmailAuthMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("GET", "/api/auth/google");
      const data = await response.json();
      return data;
    },
    onSuccess: (data) => {
      // Redirect to Gmail OAuth in same window (so we can handle the callback)
      window.location.href = data.authUrl;
      toast({
        title: "Gmail Authentication",
        description: "Please complete the authentication in the popup window",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to initiate Gmail authentication",
        variant: "destructive",
      });
    },
  });

  // Function to trigger enhanced email sync with suggestions
  const triggerEmailSync = async (userId: string) => {
    try {
      const response = await apiRequest("POST", "/api/sync-enhanced", { userId });
      const data = await response.json();

      toast({
        title: "Email Analysis Complete",
        description: `Generated ${data.suggestionsGenerated || 0} subscription suggestions for your review`,
      });

      // Navigate to review page if suggestions were generated
      if (data.redirectToSuggestions && data.suggestionsGenerated > 0) {
        window.location.href = '/review';
      }

      // Refresh all data after sync
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions'] });
      queryClient.invalidateQueries({ queryKey: [`/api/suggestions?userId=${userId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/emails?userId=${userId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/stats?userId=${userId}`] });
    } catch (error) {
      console.error("Email sync error:", error);
      toast({
        title: "Sync Failed",
        description: "Failed to sync emails. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Enhanced sync emails mutation with multi-account support
  const syncEmailsMutation = useMutation({
    mutationFn: async () => {
      if (!currentUserId) throw new Error("No user ID");

      const response = await apiRequest("POST", "/api/sync-emails-llm");
      return response.json();
    },
    onSuccess: (data) => {
      // The sync now runs in the background, so this response only confirms it
      // started. Completion, per-account results and the link through to the
      // review page are all handled by the sync window (SyncExperience).

      // Invalidate and refetch all data
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions'] });
      queryClient.invalidateQueries({ queryKey: [`/api/suggestions?userId=${currentUserId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/stats?userId=${currentUserId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/emails`] });
      queryClient.invalidateQueries({ queryKey: [`/api/users/${currentUserId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/gmail/accounts'] });
    },
    onError: (error: any) => {
      // Handle 410 response from disabled legacy endpoint
      if (error.status === 410) {
        toast({
          title: "Please Use Enhanced Sync",
          description: "Subscription detection has been upgraded. Use the Sync Emails button for the new experience.",
          variant: "default",
        });
        return;
      }

      // Shown in the sync window, which is already open.
      window.dispatchEvent(new CustomEvent('syncStartFailed', { detail: error.message }));
    },
  });

  const handleConnectGmail = () => {
    gmailAuthMutation.mutate();
  };

  const handleSyncEmails = () => {
    // Any mailbox will do. This asked about Gmail specifically, so an account
    // with only Outlook connected was told to connect Gmail first.
    if (!mailboxes.hasAny) {
      toast({
        title: "No mailbox connected",
        description: "Connect a mailbox in Settings before syncing.",
        variant: "destructive",
      });
      return;
    }

    // Opens the sync window, which follows the sync from here
    window.dispatchEvent(new Event('syncTrigger'));

    syncEmailsMutation.mutate();
  };

  const defaultStats = {
    totalMonthly: 0,
    activeCount: 0,
    emailsAnalyzed: 0,
    avgPerService: 0,
    newThisMonth: 0,
    changePercent: 0,
  };

  if (!currentUserId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-accent" />
          <p className="text-muted-foreground">Initializing application...</p>
        </div>
      </div>
    );
  }

  const activeStats = stats || defaultStats;
  const userCurrency = user?.preferredCurrency || 'INR';

  // --- Derived, presentation-only figures ---------------------------------
  // "Due in 7 days" and "Yearly run rate" are computed client-side from the
  // subscriptions array already fetched above; no extra API calls.
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  /*
   * Same rules as the monthly total: only active subscriptions, each amount
   * converted into the account's currency, and one with no rate left out
   * rather than added as if it were already in that currency -- which is how
   * a $50 renewal used to count as 50 rupees here.
   */
  const dueSoonSubscriptions = subscriptions.filter((sub) => {
    if (sub.status !== "active" || !sub.nextBillingDate) return false;
    const due = new Date(sub.nextBillingDate);
    return !isNaN(due.getTime()) && due >= now && due <= in7Days;
  });
  const dueSoonTotal = dueSoonSubscriptions.reduce((sum, sub) => {
    const converted = convert(parseFloat(sub.amount) || 0, sub.currency, userCurrency);
    return converted === null ? sum : sum + converted;
  }, 0);
  const yearlyRunRate = activeStats.totalMonthly * 12;

  const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const syncLabel = user?.lastSync ? `synced ${timeAgo(new Date(user.lastSync))}` : null;

  const filterCounts = {
    all: subscriptions.length,
    active: subscriptions.filter((s) => filterBucket(s.status) === "active").length,
    expired: subscriptions.filter((s) => filterBucket(s.status) === "expired").length,
  };
  // The categories actually present, normalised the way the badges are, so
  // "streaming" and "Streaming" are one choice.
  const categories = Array.from(
    new Set(subscriptions.map((s) => displayCategory(s.category)).filter(Boolean) as string[])
  ).sort((a, b) => a.localeCompare(b));
  const filteredSubscriptions = subscriptions.filter((s) => {
    const matchesStatus = statusFilter === "all" || filterBucket(s.status) === statusFilter;
    const matchesSearch = s.serviceName.toLowerCase().includes(searchQuery.trim().toLowerCase());
    const matchesCategory = categoryFilter === "all" || displayCategory(s.category) === categoryFilter;
    return matchesStatus && matchesSearch && matchesCategory;
  });
  const isFiltering = searchQuery.trim() !== "" || categoryFilter !== "all";

  const segments: { key: typeof statusFilter; label: string; count: number; testId: string }[] = [
    // Active first: it is the segment people are actually here for, and it is
    // also what the page opens on.
    { key: "active", label: "Active", count: filterCounts.active, testId: "filter-active" },
    { key: "expired", label: "Ended", count: filterCounts.expired, testId: "filter-expired" },
    { key: "all", label: "All", count: filterCounts.all, testId: "filter-all" },
  ];

  const addSubscriptionTile = (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setAddSubscriptionModalOpen(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setAddSubscriptionModalOpen(true);
        }
      }}
      className={cn(
        "border border-dashed border-line-firm rounded-card min-h-[148px]",
        "flex flex-col items-center justify-center gap-1 cursor-pointer",
        "hover:border-accent hover:bg-accent-soft/40 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
      data-testid="add-subscription-tile"
    >
      <Plus size={20} strokeWidth={2} className="text-ink-body" />
      <span className="text-[13px] font-semibold text-ink-body">Add a subscription</span>
      <span className="text-[11.5px] text-muted-foreground">Or let the next sync find it</span>
    </div>
  );

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-canvas">
      {/* --- Page header ---------------------------------------------------- */}
      <header
        className="flex-shrink-0 bg-surface border-b border-line flex items-end justify-between gap-4 flex-wrap"
        style={{ padding: "20px 24px 16px" }}
      >
        <div className="min-w-0">
          <h1 className="t-page">Dashboard</h1>
          <p className="text-[12.5px] text-muted-foreground mt-1">
            {monthLabel}
            {syncLabel ? ` · ${syncLabel}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Sync now once any mailbox is connected; otherwise offer to connect one.
              While the answer is still loading, neither is drawn -- guessing
              "no mailbox" for a moment flashes the wrong button at someone who
              has one. */}
          {mailboxes.isLoading ? null : !mailboxes.hasAny ? (
            <button
              type="button"
              onClick={handleConnectGmail}
              disabled={gmailAuthMutation.isPending}
              data-testid="connect-gmail"
              className="btn-base btn-secondary"
            >
              {gmailAuthMutation.isPending ? (
                <RefreshCw size={15} strokeWidth={2} className="animate-spin" />
              ) : (
                <Mail size={15} strokeWidth={2} />
              )}
              Connect Gmail
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSyncEmails}
              disabled={syncEmailsMutation.isPending || isSyncInProgress}
              data-testid="sync-emails"
              className="btn-base btn-secondary"
              title="Sync Emails"
            >
              <RefreshCw
                size={15}
                strokeWidth={2}
                className={(syncEmailsMutation.isPending || isSyncInProgress) ? "animate-spin" : ""}
              />
              Sync now
            </button>
          )}

          {/* The one forward action on this page. */}
          <button
            type="button"
            onClick={() => setAddSubscriptionModalOpen(true)}
            data-testid="add-subscription"
            className="btn-base btn-accent"
          >
            <Plus size={15} strokeWidth={2} />
            Add subscription
          </button>

        </div>
      </header>

      {/* --- Body ------------------------------------------------------------ */}
      <main
        className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-[18px]"
        style={{ padding: "20px 24px 40px" }}
      >
        <ReviewBanner />

        {/* 1. Metric strip */}
        {statsLoading ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px,1fr))" }}>
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-line-soft rounded-card p-[13px_16px] h-[76px] animate-pulse" />
            ))}
          </div>
        ) : (
          // flex-none matters: this sits in a column flex container, and
          // overflow-hidden makes its min-content height zero, so flexbox is
          // free to crush it to nothing but its borders the moment the page is
          // taller than the viewport. It rendered on a tall desktop window and
          // vanished entirely on a phone.
          <div className="flex-none border border-line rounded-card overflow-hidden bg-line-soft">
            <div
              className="grid gap-px"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px,1fr))" }}
            >
              <div className="bg-surface flex flex-col gap-[3px]" style={{ padding: "13px 16px" }} data-testid="metric-monthly">
                <span className="t-eyebrow">Monthly total</span>
                <span className="t-metric">{formatCurrency(activeStats.totalMonthly, userCurrency)}</span>
                {activeStats.changePercent !== 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    {activeStats.changePercent > 0 ? "+" : ""}
                    {activeStats.changePercent}% vs last month
                  </span>
                )}
              </div>

              <div className="bg-surface flex flex-col gap-[3px]" style={{ padding: "13px 16px" }} data-testid="metric-active">
                <span className="t-eyebrow">Active</span>
                <span className="t-metric">{activeStats.activeCount}</span>
                {activeStats.newThisMonth > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    {activeStats.newThisMonth} added this month
                  </span>
                )}
              </div>

              <div className="bg-surface flex flex-col gap-[3px]" style={{ padding: "13px 16px" }} data-testid="metric-due">
                <span className="t-eyebrow">Due in 7 days</span>
                <span className="t-metric">{formatCurrency(dueSoonTotal, userCurrency)}</span>
                <span className="text-[11px] text-muted-foreground">
                  Across {dueSoonSubscriptions.length} renewal{dueSoonSubscriptions.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="bg-surface flex flex-col gap-[3px]" style={{ padding: "13px 16px" }} data-testid="metric-runrate">
                <span className="t-eyebrow">Yearly run rate</span>
                <span className="t-metric">{formatCurrency(yearlyRunRate, userCurrency)}</span>
                <span className="text-[11px] text-muted-foreground">Normalised</span>
              </div>
            </div>
          </div>
        )}

        {/* 2. Filter bar: search and category on the left, status on the right */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="field w-[260px] max-w-full">
              <Search size={15} strokeWidth={2} className="text-muted-foreground flex-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search subscriptions"
                aria-label="Search subscriptions"
                data-testid="search-subscriptions"
              />
            </div>
            {categories.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="btn-base btn-secondary" data-testid="filter-category">
                    {categoryFilter === "all" ? "All categories" : categoryFilter}
                    <ChevronDown size={13} strokeWidth={2} className="text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  <DropdownMenuItem onClick={() => setCategoryFilter("all")}>All categories</DropdownMenuItem>
                  {categories.map((category) => (
                    <DropdownMenuItem key={category} onClick={() => setCategoryFilter(category)}>
                      {category}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <div className="inline-flex gap-0.5 p-0.5 rounded-lg bg-line-soft">
            {segments.map((segment) => {
              const selected = statusFilter === segment.key;
              return (
                <button
                  key={segment.key}
                  type="button"
                  onClick={() => setStatusFilter(segment.key)}
                  data-testid={segment.testId}
                  className={cn(
                    "h-7 rounded-button px-[11px] text-[12.5px] transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "bg-surface font-semibold text-ink" : "bg-transparent font-medium text-ink-body"
                  )}
                >
                  {segment.label}{" "}
                  <span className="text-muted-foreground">
                    {segment.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 4 & 5. Subscription grid / empty state */}
        {subscriptionsLoading ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(max(250px, calc((100% - 4 * 0.75rem) / 5)), 1fr))" }}>
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-line-soft rounded-card min-h-[148px] animate-pulse" />
            ))}
          </div>
        ) : subscriptions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-10">
            <div className="w-full max-w-xs">{addSubscriptionTile}</div>
          </div>
        ) : (
          <>
            {filteredSubscriptions.length === 0 && isFiltering && (
              <p className="text-[13px] text-muted-foreground" data-testid="no-matches">
                Nothing matches that search.{" "}
                <button
                  type="button"
                  className="font-semibold text-accent hover:underline"
                  onClick={() => {
                    setSearchQuery("");
                    setCategoryFilter("all");
                  }}
                >
                  Clear filters
                </button>
              </p>
            )}
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(max(250px, calc((100% - 4 * 0.75rem) / 5)), 1fr))" }}>
              {filteredSubscriptions.map((sub) => (
                <SubscriptionCard key={sub.id} subscription={sub} />
              ))}

              {addSubscriptionTile}
            </div>
          </>
        )}
      </main>

      {/* The detail drawer, opened by /subscriptions/:id */}
      <Sheet
        open={Boolean(openSubscriptionId)}
        onOpenChange={(open) => {
          if (!open) setLocation("/");
        }}
      >
        <SheetContent
          side="right"
          // The detail draws its own close button in the same corner.
          hideClose
          className="w-full sm:max-w-[560px] p-0 overflow-y-auto bg-canvas"
          data-testid="subscription-drawer"
        >
          {openSubscriptionId && (
            <SubscriptionDetail subscriptionId={openSubscriptionId} onClose={() => setLocation("/")} />
          )}
        </SheetContent>
      </Sheet>

      {/* Suggestions Modal */}
      <SubscriptionSuggestionsModal
        open={suggestionsModalOpen}
        onOpenChange={setSuggestionsModalOpen}
      />
      {/* Add Subscription Modal */}
      <AddSubscriptionModal
        open={addSubscriptionModalOpen}
        onOpenChange={setAddSubscriptionModalOpen}
      />
    </div>
  );
}
