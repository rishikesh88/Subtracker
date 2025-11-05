import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { RefreshCw, Mail, User, Globe, Plus, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Sidebar } from "@/components/Sidebar";
import { StatsCards } from "@/components/StatsCards";
import { SubscriptionList } from "@/components/SubscriptionList";
import { SubscriptionSuggestionsModal } from "@/components/SubscriptionSuggestionsModal";
import { AddSubscriptionModal } from "@/components/AddSubscriptionModal";
import { SyncProgressModal } from "@/components/SyncProgressModal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type Subscription } from "@shared/schema";
import { Link } from "wouter";

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

  // Fetch email accounts to check if any are connected
  const { data: emailAccounts = [] } = useQuery<Array<{ id: string; provider: string; email: string }>>({
    queryKey: ['/api/email-accounts'],
    enabled: !!currentUserId,
  });

  // User data is available from useAuth hook

  // Fetch subscription stats
  const { data: stats, isLoading: statsLoading } = useQuery<{totalMonthly: number, activeCount: number, emailsAnalyzed: number, avgPerService: number}>({
    queryKey: [`/api/stats?userId=${currentUserId}`],
    enabled: !!currentUserId,
  });

  // Fetch approved subscriptions for dashboard display
  const { data: subscriptions = [], isLoading: subscriptionsLoading } = useQuery<Subscription[]>({
    queryKey: ['/api/subscriptions'],
    enabled: !!currentUserId,
  });



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
        description: `Email sync will now fetch emails from the past ${data.emailSyncDays} days`,
      });
      // Refresh user data to update preference
      queryClient.invalidateQueries({ queryKey: [`/api/auth/user`] });
    },
    onError: () => {
      toast({
        title: "Sync Range Update Failed",
        description: "Failed to update email sync range. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Multi-account sync mutation
  const syncAllAccountsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/sync-all-accounts');
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Sync Started",
        description: data.message || "Syncing all email accounts...",
      });
    },
    onError: () => {
      setSyncProgressOpen(false);
      toast({
        title: "Sync Failed",
        description: "Failed to start sync. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Listen to SSE events for sync progress
  useEffect(() => {
    if (!currentUserId) return;

    const eventSource = new EventSource(`/api/sync-progress/${currentUserId}`);
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle terminal completion/error events
        if (data.stage === 'complete') {
          queryClient.invalidateQueries({ queryKey: ['/api/email-accounts'] });
          queryClient.invalidateQueries({ queryKey: ['/api/subscriptions'] });
          queryClient.invalidateQueries({ queryKey: [`/api/stats?userId=${currentUserId}`] });
          setSyncProgressOpen(false);
          toast({
            title: "Sync Complete",
            description: data.message || "All accounts synced successfully.",
          });
        } else if (data.stage === 'error') {
          setSyncProgressOpen(false);
          toast({
            title: "Sync Error",
            description: data.message || "An error occurred during sync.",
            variant: "destructive",
          });
        } else if (data.stage === 'account_complete') {
          // Per-account completion - show progress
          console.log('Account synced:', data.message);
        } else if (data.stage === 'account_error') {
          // Per-account error - log but continue batch
          console.log('Account sync failed:', data.message);
        }
      } catch (error) {
        console.error('Error parsing SSE message:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE connection error, will auto-retry:', error);
      // Don't close - let browser auto-reconnect
    };

    return () => {
      eventSource.close();
    };
  }, [currentUserId, toast]);


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

  
  const handleSyncComplete = () => {
    // Refresh all data after sync
    queryClient.invalidateQueries({ queryKey: ['/api/subscriptions'] });
    queryClient.invalidateQueries({ queryKey: [`/api/suggestions?userId=${currentUserId}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/emails?userId=${currentUserId}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/stats?userId=${currentUserId}`] });
    
    // Show suggestions modal if there are suggestions
    setSuggestionsModalOpen(true);
  };

  const defaultStats = {
    totalMonthly: 0,
    activeCount: 0,
    emailsAnalyzed: 0,
    avgPerService: 0,
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
    <div className="min-h-screen flex bg-background">
      <Sidebar user={user} isGmailConnected={emailAccounts.length > 0} />
      
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>
              <p className="text-sm text-muted-foreground">
                Monitor your subscription spending and patterns
              </p>
            </div>
            <div className="flex items-center space-x-4">
              {emailAccounts.length === 0 ? (
                <div className="flex gap-2">
                  <Link href="/accounts">
                    <Button variant="default" data-testid="manage-accounts">
                      <Settings className="w-4 h-4 mr-2" />
                      Manage Accounts
                    </Button>
                  </Link>
                  <Button
                    variant="default"
                    onClick={() => setAddSubscriptionModalOpen(true)}
                    data-testid="add-subscription"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Subscription
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      setSyncProgressOpen(true);
                      syncAllAccountsMutation.mutate();
                    }}
                    disabled={syncAllAccountsMutation.isPending}
                    data-testid="sync-all-accounts"
                  >
                    {syncAllAccountsMutation.isPending ? (
                      <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-2" />
                    )}
                    Sync All Accounts
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setSuggestionsModalOpen(true)}
                    data-testid="review-suggestions"
                  >
                    📋 Review Suggestions
                  </Button>
                  <Button
                    variant="default"
                    onClick={() => setAddSubscriptionModalOpen(true)}
                    data-testid="add-subscription"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Subscription
                  </Button>
                </div>
              )}
              
              {/* Cleanup and Clear buttons - always visible for authenticated users */}
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => cleanupDuplicatesMutation.mutate()}
                  disabled={cleanupDuplicatesMutation.isPending}
                  data-testid="cleanup-duplicates"
                >
                  {cleanupDuplicatesMutation.isPending ? (
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    "🧹"
                  )}
                  Remove Duplicates
                </Button>
                
                <Button
                  variant="destructive"
                  onClick={() => clearDataMutation.mutate()}
                  disabled={clearDataMutation.isPending}
                  data-testid="clear-data"
                >
                  {clearDataMutation.isPending ? (
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    "🗑️"
                  )}
                  Clear Data
                </Button>
              </div>
              
              {/* Currency Selector */}
              <Select 
                value={user?.preferredCurrency || 'INR'} 
                onValueChange={(value) => changeCurrencyMutation.mutate(value)}
                disabled={changeCurrencyMutation.isPending}
              >
                <SelectTrigger className="w-20 h-8 data-testid-currency-selector">
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
              
              {/* Email Sync Days Selector */}
              <Select 
                value={String(user?.emailSyncDays || 90)}
                onValueChange={(value) => changeSyncDaysMutation.mutate(parseInt(value))}
                disabled={changeSyncDaysMutation.isPending}
              >
                <SelectTrigger className="w-32 h-8" data-testid="sync-days-selector">
                  <Mail className="w-3 h-3 mr-1" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent data-testid="sync-days-dropdown">
                  <SelectItem value="30" data-testid="sync-days-option-30">
                    30 days
                  </SelectItem>
                  <SelectItem value="60" data-testid="sync-days-option-60">
                    60 days
                  </SelectItem>
                  <SelectItem value="90" data-testid="sync-days-option-90">
                    90 days
                  </SelectItem>
                  <SelectItem value="180" data-testid="sync-days-option-180">
                    180 days
                  </SelectItem>
                </SelectContent>
              </Select>
              
              <div className="w-8 h-8 bg-secondary rounded-full flex items-center justify-center">
                <User className="text-secondary-foreground w-4 h-4" />
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 p-6 bg-background overflow-auto">
          {/* Stats Cards */}
          {statsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
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

          {/* Subscriptions List */}
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
    </div>
  );
}
