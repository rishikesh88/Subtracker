import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { RefreshCw, Mail, User, Globe, Plus, MoreVertical, Trash2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { StatsCards } from "@/components/StatsCards";
import { SubscriptionList } from "@/components/SubscriptionList";
import { SubscriptionSuggestionsModal } from "@/components/SubscriptionSuggestionsModal";
import { AddSubscriptionModal } from "@/components/AddSubscriptionModal";
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
import { type Subscription } from "@shared/schema";

// Supported currencies
const supportedCurrencies = [
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' }
];

export default function Dashboard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const currentUserId = user?.id;
  const [suggestionsModalOpen, setSuggestionsModalOpen] = useState(false);
  const [syncProgressOpen, setSyncProgressOpen] = useState(false);
  const [addSubscriptionModalOpen, setAddSubscriptionModalOpen] = useState(false);
  const [isSyncInProgress, setIsSyncInProgress] = useState(false);

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
      // Handle multi-account response
      const totalAccounts = data.totalAccounts || 0;
      const successfulAccounts = data.successful || 0;
      const failedAccounts = data.failed || 0;
      const totalSuggestions = data.suggestionsGenerated || 0;
      
      // Build success message
      let description = '';
      if (totalAccounts > 1) {
        description = `Synced ${successfulAccounts} of ${totalAccounts} accounts. Found ${totalSuggestions} subscription suggestions.`;
      } else {
        description = `Generated ${totalSuggestions} subscription suggestions for your review`;
      }
      
      // Show per-account errors if any failed
      if (failedAccounts > 0 && data.results) {
        const failedResults = data.results.filter((r: any) => !r.success);
        const errorDetails = failedResults
          .map((r: any) => `${r.gmailEmail}: ${r.error || 'Unknown error'}`)
          .join('\n');
        
        toast({
          title: "Sync Completed with Errors",
          description: `${description}\n\nFailed accounts:\n${errorDetails}`,
          variant: "default",
        });
      } else {
        toast({
          title: "Email Analysis Complete",
          description: description,
        });
      }
      
      // Navigate to review page if suggestions were generated
      if (totalSuggestions > 0) {
        setTimeout(() => {
          window.location.href = '/review';
        }, 500); // Small delay to allow toast to show first
      }
      
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
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Initializing application...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <header className="bg-card border-b border-border px-4 md:px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          {/* Title Section */}
          <div className="flex-1 min-w-0">
            <h2 className="text-xl md:text-2xl font-bold text-foreground">Dashboard</h2>
            <p className="text-xs md:text-sm text-muted-foreground truncate">
              Monitor your subscription spending and patterns
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Connect Gmail (when not connected) */}
            {(!user || !user.gmailConnected) && (
              <Button
                onClick={handleConnectGmail}
                disabled={gmailAuthMutation.isPending}
                data-testid="connect-gmail"
                size="sm"
                variant="outline"
              >
                {gmailAuthMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Mail className="w-4 h-4" />
                )}
                <span className="hidden sm:inline ml-1">Connect Gmail</span>
              </Button>
            )}

            {/* Sync Button - Icon only */}
            {user?.gmailConnected && (
              <Button
                onClick={handleSyncEmails}
                disabled={syncEmailsMutation.isPending || isSyncInProgress}
                data-testid="sync-emails"
                size="icon"
                variant="outline"
                title="Sync Emails"
              >
                <RefreshCw className={`w-4 h-4 ${(syncEmailsMutation.isPending || isSyncInProgress) ? 'animate-spin' : ''}`} />
              </Button>
            )}

            {/* Add New Subscription Button */}
            <Button
              onClick={() => setAddSubscriptionModalOpen(true)}
              data-testid="add-subscription"
              size="sm"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline ml-1 font-semibold">New Subscription</span>
              <span className="sm:hidden ml-1">Add</span>
            </Button>

            {/* 3-dot Menu for Settings and Actions */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" data-testid="dashboard-menu">
                  <MoreVertical className="w-4 h-4" />
                </Button>
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
        </div>
      </header>
      <main className="flex-1 flex flex-col bg-background overflow-hidden h-full">
        {/* Fixed Section: Stats Cards */}
        <div className="flex-shrink-0 p-4 md:p-6 pb-0 bg-background">
          {statsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="bg-card rounded-lg border border-border p-6 animate-pulse">
                  <div className="h-4 bg-muted rounded w-1/2 mb-2"></div>
                  <div className="h-8 bg-muted rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-muted rounded w-1/3"></div>
                </div>
              ))}
            </div>
          ) : (
            <StatsCards stats={stats || defaultStats} userCurrency={user?.preferredCurrency || 'INR'} />
          )}
        </div>

        {/* Scrollable Section: Subscriptions List */}
        <div className="flex-1 overflow-hidden px-4 md:px-6 pb-4 md:pb-6 flex flex-col min-h-0">
          {subscriptionsLoading ? (
            <div className="bg-card rounded-lg border border-border p-6 mb-6">
              <div className="animate-pulse space-y-4">
                <div className="h-4 bg-muted rounded w-1/4"></div>
                <div className="h-4 bg-muted rounded w-1/2"></div>
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex items-center space-x-4 p-4">
                    <div className="w-12 h-12 bg-muted rounded-lg"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-muted rounded w-1/3"></div>
                      <div className="h-3 bg-muted rounded w-1/4"></div>
                    </div>
                    <div className="text-right space-y-2">
                      <div className="h-4 bg-muted rounded w-16"></div>
                      <div className="h-3 bg-muted rounded w-20"></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <SubscriptionList subscriptions={subscriptions} />
          )}
        </div>
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
    </>
  );
}
