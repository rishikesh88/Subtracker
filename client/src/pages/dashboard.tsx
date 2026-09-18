import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
  RefreshCw,
  Mail,
  Globe,
  Plus,
  MoreVertical,
  Trash2,
  Copy,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { AddSubscriptionModal } from "@/components/AddSubscriptionModal";
import { SubscriptionSuggestionsModal } from "@/components/SubscriptionSuggestionsModal";
import { SyncProgressModal } from "@/components/SyncProgressModal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { type Subscription } from "@shared/schema";

// Supported currencies
const supportedCurrencies = [
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' }
];

// Currency formatting -- same helper used by StatsCards, kept here so the
// metric strip and subscription cards can format without a component that no
// longer sits on this page.
const formatCurrency = (amount: number, currency: string = "INR") => {
  const validCurrency = currency && currency.length === 3 && currency !== "unknown"
    ? currency.toUpperCase()
    : "INR";

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: validCurrency,
    }).format(amount);
  } catch (error) {
    // If currency is still invalid, fallback to INR
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "INR",
    }).format(amount);
  }
};

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

const FREQUENCY_LABEL: Record<string, string> = {
  monthly: "Monthly",
  yearly: "Yearly",
  weekly: "Weekly",
  quarterly: "Quarterly",
};

const FREQUENCY_SUFFIX: Record<string, string> = {
  monthly: "/mo",
  yearly: "/yr",
  weekly: "/wk",
  quarterly: "/qtr",
};

/**
 * Which filter segment a subscription's raw status belongs to.
 *
 * Three, not the design's four. The design's fourth segment is "Review", but a
 * subscription in this app is only ever active, expiring_soon or cancelled --
 * there is no status it could match, so the segment would read "Review 0"
 * forever, directly under a banner saying two charges need review. Those two
 * numbers count different things: unmatched charges are suggestions, and they
 * live in the review inbox, which the banner and the sidebar both link to.
 *
 * "Ending soon" takes its place because expiring_soon is a status a
 * subscription can actually hold.
 */
function filterBucket(status: string): "active" | "ending" | "ended" {
  if (status === "cancelled" || status === "ended") return "ended";
  if (status === "expiring_soon") return "ending";
  return "active";
}

/** Status badge class + label for a subscription card, per the design system's
 *  status mapping (active / needs review / trial / cancelled). */
function statusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case "active":
      return { label: "Active", cls: "status-active" };
    case "trial":
      return { label: "Trial", cls: "status-trial" };
    case "expiring_soon":
    case "needs_review":
    case "pending":
      return { label: "Needs review", cls: "status-review" };
    case "cancelled":
    case "ended":
      return { label: "Cancelled", cls: "status-cancelled" };
    default:
      return { label: status, cls: "status-active" };
  }
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

export default function Dashboard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const currentUserId = user?.id;
  const [suggestionsModalOpen, setSuggestionsModalOpen] = useState(false);
  const [syncProgressOpen, setSyncProgressOpen] = useState(false);
  const [addSubscriptionModalOpen, setAddSubscriptionModalOpen] = useState(false);
  const [isSyncInProgress, setIsSyncInProgress] = useState(false);
  // Presentation-only: which filter segment is selected on the subscription grid.
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "ending" | "ended">("all");

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

              setSyncProgressOpen(true);
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

  // Pending suggestions -- same endpoint the sidebar's review badge already
  // reads, used here to drive the review banner and its count.
  const { data: suggestionsData } = useQuery<{ suggestions: any[]; total: number }>({
    queryKey: [`/api/suggestions?userId=${currentUserId}`],
    enabled: !!currentUserId,
  });
  const pendingSuggestionsCount = suggestionsData?.total ?? 0;

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

  // Clear all data mutation
  const clearDataMutation = useMutation({
    mutationFn: async () => {
      if (!currentUserId) throw new Error("No user ID");
      const response = await apiRequest("DELETE", `/api/clear-data`);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Data Cleared Successfully",
        description: `Cleared ${data.clearedEmails} emails and ${data.clearedSubscriptions} subscriptions`,
      });
      // Refresh all data
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions'] });
      queryClient.invalidateQueries({ queryKey: [`/api/suggestions?userId=${currentUserId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/emails?userId=${currentUserId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/stats?userId=${currentUserId}`] });
    },
    onError: () => {
      toast({
        title: "Clear Failed",
        description: "Failed to clear data. Please try again.",
        variant: "destructive",
      });
    }
  });

  // Currency change mutation
  const changeCurrencyMutation = useMutation({
    mutationFn: async (newCurrency: string) => {
      const response = await apiRequest("PATCH", "/api/settings", {
        preferredCurrency: newCurrency
      });
      return response.json();
    },
    onSuccess: (data) => {
      const currency = supportedCurrencies.find(c => c.code === data.preferredCurrency);
      toast({
        title: "Currency Updated",
        description: `Your preferred currency is now ${currency?.symbol || ''}${data.preferredCurrency}`,
      });
      // Refresh user data to update preference
      queryClient.invalidateQueries({ queryKey: [`/api/auth/user`] });
      // Refresh stats with new currency
      queryClient.invalidateQueries({ queryKey: [`/api/stats?userId=${currentUserId}`] });
    },
    onError: () => {
      toast({
        title: "Currency Update Failed",
        description: "Failed to update your preferred currency. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Email sync days change mutation
  const changeSyncDaysMutation = useMutation({
    mutationFn: async (newDays: number) => {
      const response = await apiRequest("PATCH", "/api/settings", {
        emailSyncDays: newDays
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Sync Range Updated",
        description: `Email sync will now fetch emails from the past ${data.emailSyncDays} days. Starting sync...`,
      });
      // Refresh user data to update preference
      queryClient.invalidateQueries({ queryKey: [`/api/auth/user`] });

      // Trigger automatic sync with new duration
      localStorage.setItem('justOnboarded', 'true');
      localStorage.setItem('onboardedAt', Date.now().toString());
      setSyncProgressOpen(true);

      // Dispatch custom event to trigger SyncProgressPanel
      window.dispatchEvent(new Event('syncTrigger'));

      syncEmailsMutation.mutate();
    },
    onError: () => {
      toast({
        title: "Sync Range Update Failed",
        description: "Failed to update email sync range. Please try again.",
        variant: "destructive",
      });
    },
  });

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
      // review page are all handled by SyncProgressPanel over SSE.
      const totalAccounts = data.totalAccounts || 0;

      toast({
        title: "Email Sync Started",
        description: totalAccounts > 1
          ? `Analyzing ${totalAccounts} accounts in the background...`
          : `Analyzing emails in the background...`,
      });

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

      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync emails",
        variant: "destructive",
      });
    },
  });

  // Cleanup duplicates mutation
  const cleanupDuplicatesMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/cleanup-duplicates");
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Cleanup Complete! 🎉",
        description: `Removed ${data.duplicatesRemoved} duplicate subscriptions from ${data.groupsProcessed} groups`,
      });
      // Refresh all data to show updated results
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions'] });
      queryClient.invalidateQueries({ queryKey: [`/api/stats?userId=${currentUserId}`] });
    },
    onError: () => {
      toast({
        title: "Cleanup Failed",
        description: "Failed to cleanup duplicates. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleConnectGmail = () => {
    gmailAuthMutation.mutate();
  };

  const handleSyncEmails = () => {
    if (!user || !user.gmailConnected) {
      toast({
        title: "Gmail Not Connected",
        description: "Please connect your Gmail account first",
        variant: "destructive",
      });
      return;
    }

    // Open progress panel and set localStorage flags for auto-open
    localStorage.setItem('justOnboarded', 'true');
    localStorage.setItem('onboardedAt', Date.now().toString());
    setSyncProgressOpen(true);

    // Dispatch custom event to trigger SyncProgressPanel
    window.dispatchEvent(new Event('syncTrigger'));

    toast({
      title: "Sync Started",
      description: "Analyzing your emails... This may take a few minutes.",
    });

    syncEmailsMutation.mutate();
  };

  const handleSyncComplete = () => {
    // Refresh all data after sync
    queryClient.invalidateQueries({ queryKey: ['/api/subscriptions'] });
    queryClient.invalidateQueries({ queryKey: [`/api/suggestions?userId=${currentUserId}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/emails?userId=${currentUserId}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/stats?userId=${currentUserId}`] });

    // Navigate to review page to review suggestions
    window.location.href = '/review';
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
  const dueSoonSubscriptions = subscriptions.filter((sub) => {
    if (!sub.nextBillingDate) return false;
    const due = new Date(sub.nextBillingDate);
    return !isNaN(due.getTime()) && due >= now && due <= in7Days;
  });
  const dueSoonTotal = dueSoonSubscriptions.reduce((sum, sub) => sum + (parseFloat(sub.amount) || 0), 0);
  const yearlyRunRate = activeStats.totalMonthly * 12;

  const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const syncLabel = user?.lastSync ? `synced ${timeAgo(new Date(user.lastSync))}` : null;

  const filterCounts = {
    all: subscriptions.length,
    active: subscriptions.filter((s) => filterBucket(s.status) === "active").length,
    ending: subscriptions.filter((s) => filterBucket(s.status) === "ending").length,
    ended: subscriptions.filter((s) => filterBucket(s.status) === "ended").length,
  };
  const filteredSubscriptions = subscriptions.filter(
    (s) => statusFilter === "all" || filterBucket(s.status) === statusFilter
  );

  const segments: { key: typeof statusFilter; label: string; count: number; testId: string }[] = [
    { key: "all", label: "All", count: filterCounts.all, testId: "filter-all" },
    { key: "active", label: "Active", count: filterCounts.active, testId: "filter-active" },
    { key: "ending", label: "Ending soon", count: filterCounts.ending, testId: "filter-ending" },
    { key: "ended", label: "Ended", count: filterCounts.ended, testId: "filter-ended" },
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
          {/* Connect Gmail (when not connected) -- otherwise Sync now */}
          {(!user || !user.gmailConnected) ? (
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

          {/* 3-dot Menu for Settings and Actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="dashboard-menu"
                className={cn(
                  "btn-base btn-ghost w-8 px-0",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                )}
                aria-label="Dashboard menu"
              >
                <MoreVertical size={15} strokeWidth={2} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {/* Currency Selection */}
              <DropdownMenuLabel className="text-xs text-muted-foreground">Currency</DropdownMenuLabel>
              <div className="px-2 py-1">
                <Select
                  value={user?.preferredCurrency || 'INR'}
                  onValueChange={(value) => changeCurrencyMutation.mutate(value)}
                  disabled={changeCurrencyMutation.isPending}
                >
                  <SelectTrigger className="w-full h-8 text-sm" data-testid="currency-selector">
                    <Globe className="w-3 h-3 mr-1" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent data-testid="currency-dropdown">
                    {supportedCurrencies.map((currency) => (
                      <SelectItem
                        key={currency.code}
                        value={currency.code}
                        data-testid={`currency-option-${currency.code}`}
                      >
                        <div className="flex items-center gap-2">
                          <span>{currency.symbol}</span>
                          <span>{currency.code}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Sync Days Selection */}
              <DropdownMenuLabel className="text-xs text-muted-foreground mt-2">Sync Period</DropdownMenuLabel>
              <div className="px-2 py-1">
                <Select
                  value={String(user?.emailSyncDays || 30)}
                  onValueChange={(value) => changeSyncDaysMutation.mutate(parseInt(value))}
                  disabled={changeSyncDaysMutation.isPending}
                >
                  <SelectTrigger className="w-full h-8 text-sm" data-testid="sync-days-selector">
                    <Mail className="w-3 h-3 mr-1" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent data-testid="sync-days-dropdown">
                    <SelectItem value="30" data-testid="sync-days-option-30">30 days</SelectItem>
                    <SelectItem value="60" data-testid="sync-days-option-60">60 days</SelectItem>
                    <SelectItem value="90" data-testid="sync-days-option-90">90 days</SelectItem>
                    <SelectItem value="180" data-testid="sync-days-option-180">180 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <DropdownMenuSeparator />

              {/* Remove Duplicates */}
              <DropdownMenuItem
                onClick={() => cleanupDuplicatesMutation.mutate()}
                disabled={cleanupDuplicatesMutation.isPending}
                data-testid="cleanup-duplicates"
                className="cursor-pointer"
              >
                {cleanupDuplicatesMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Copy className="w-4 h-4 mr-2" />
                )}
                Remove Duplicates
              </DropdownMenuItem>

              {/* Clear Data */}
              <DropdownMenuItem
                onClick={() => clearDataMutation.mutate()}
                disabled={clearDataMutation.isPending}
                data-testid="clear-data"
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                {clearDataMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4 mr-2" />
                )}
                Clear All Data
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* --- Body ------------------------------------------------------------ */}
      <main
        className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-[18px]"
        style={{ padding: "20px 24px 40px" }}
      >
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

        {/* 2. Review banner */}
        {pendingSuggestionsCount > 0 && (
          <div
            className="flex items-center gap-3 flex-wrap px-[15px] py-3 rounded-card border border-warning-line bg-warning-bg"
            data-testid="review-banner"
          >
            <AlertTriangle size={16} strokeWidth={2} className="text-warning flex-none" />
            <p className="text-[13px] text-ink-strong flex-1 min-w-[200px]">
              <span className="font-semibold">
                {pendingSuggestionsCount} charge{pendingSuggestionsCount === 1 ? "" : "s"} need{pendingSuggestionsCount === 1 ? "s" : ""} review.
              </span>{" "}
              The last sync found payments it couldn't match to anything you track.
            </p>
            <Link
              href="/review"
              className={cn(
                "h-7 inline-flex items-center rounded-button border border-warning-line bg-surface",
                "text-warning text-xs font-semibold px-[11px] flex-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
              data-testid="open-review-inbox"
            >
              Open review inbox
            </Link>
          </div>
        )}

        {/* 3. Filter bar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
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
                  <span className={segment.key === "ending" ? "text-warning" : "text-muted-foreground"}>
                    {segment.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 4 & 5. Subscription grid / empty state */}
        {subscriptionsLoading ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px,1fr))" }}>
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-line-soft rounded-card min-h-[148px] animate-pulse" />
            ))}
          </div>
        ) : subscriptions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-10">
            <div className="w-full max-w-xs">{addSubscriptionTile}</div>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px,1fr))" }}>
            {filteredSubscriptions.map((sub) => {
              const badge = statusBadge(sub.status);
              const bucket = filterBucket(sub.status);
              const initial = (sub.serviceName?.[0] ?? "?").toUpperCase();
              const frequencyLabel = FREQUENCY_LABEL[sub.frequency] ?? sub.frequency;
              const frequencySuffix = FREQUENCY_SUFFIX[sub.frequency] ?? "";

              return (
                <Link
                  key={sub.id}
                  href={`/subscriptions/${sub.id}`}
                  className={cn(
                    "surface-card p-[15px] flex flex-col gap-[13px] cursor-pointer",
                    "hover:border-line-firm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  )}
                  data-testid={`subscription-card-${sub.id}`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-[34px] h-[34px] flex-none rounded-logo bg-line-soft flex items-center justify-center text-[14px] font-bold text-ink-body">
                      {initial}
                    </span>
                    <span className="t-card-title flex-1 min-w-0 line-clamp-2 [text-wrap:pretty]">{sub.serviceName}</span>
                    <span className={cn("badge-status flex-none", badge.cls)}>{badge.label}</span>
                  </div>

                  <div className="flex flex-wrap gap-[5px]">
                    <span className="badge-cadence">{frequencyLabel}</span>
                    {sub.category && <span className="badge-category">{sub.category}</span>}
                  </div>

                  <div className="border-t border-line-soft pt-[13px] flex items-end justify-between">
                    <div>
                      <div className="text-[10.5px] font-semibold text-muted-foreground">
                        {bucket === "ended" ? "Ended" : "Renews"}
                      </div>
                      <div className="text-[12px] text-ink-strong mt-0.5">{formatDate(sub.nextBillingDate)}</div>
                    </div>
                    <div className="t-price">
                      {formatCurrency(parseFloat(sub.amount) || 0, sub.currency)}
                      <span className="text-[11.5px] font-medium text-muted-foreground">{frequencySuffix}</span>
                    </div>
                  </div>
                </Link>
              );
            })}

            {addSubscriptionTile}
          </div>
        )}
      </main>

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
      {/* Sync Progress Modal */}
      <SyncProgressModal
        isOpen={syncProgressOpen}
        onOpenChange={setSyncProgressOpen}
        userId={currentUserId}
        onComplete={handleSyncComplete}
      />
    </div>
  );
}
