import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { RefreshCw, Mail, User, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Sidebar } from "@/components/Sidebar";
import { StatsCards } from "@/components/StatsCards";
import { SubscriptionList } from "@/components/SubscriptionList";
import { EmailAnalysis } from "@/components/EmailAnalysis";
import { SubscriptionSuggestionsModal } from "@/components/SubscriptionSuggestionsModal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type Subscription, type Email } from "@shared/schema";

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
            
            // Automatically trigger email sync after a delay
            setTimeout(async () => {
              try {
                const response = await apiRequest("POST", "/api/sync-enhanced", { userId: currentUserId });
                const data = await response.json();
                
                toast({
                  title: "Email Sync Complete",
                  description: `Processed ${data.processedEmails || 0} emails and found ${data.detectedSubscriptions || 0} subscriptions`,
                });
                
                // Refresh all data after sync  
                queryClient.invalidateQueries({ queryKey: ['/api/subscriptions'] });
                queryClient.invalidateQueries({ queryKey: [`/api/suggestions?userId=${currentUserId}`] });
                queryClient.invalidateQueries({ queryKey: [`/api/emails?userId=${currentUserId}`] });
                queryClient.invalidateQueries({ queryKey: [`/api/stats?userId=${currentUserId}`] });
              } catch (error) {
                console.error("Auto email sync error:", error);
                toast({
                  title: "Sync Failed",
                  description: "Failed to sync emails automatically. You can try again manually.",
                  variant: "destructive",
                });
              }
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
  const { data: stats, isLoading: statsLoading } = useQuery<{totalMonthly: number, activeCount: number, emailsAnalyzed: number, avgPerService: number}>({
    queryKey: [`/api/stats?userId=${currentUserId}`],
    enabled: !!currentUserId,
  });

  // Fetch approved subscriptions for dashboard display
  const { data: subscriptions = [], isLoading: subscriptionsLoading } = useQuery<Subscription[]>({
    queryKey: ['/api/subscriptions'],
    enabled: !!currentUserId,
  });

  // Fetch recent emails
  const { data: emails = [], isLoading: emailsLoading } = useQuery<Email[]>({
    queryKey: [`/api/emails?userId=${currentUserId}`],
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
      
      // Open suggestions modal if suggestions were generated
      if (data.redirectToSuggestions && data.suggestionsGenerated > 0) {
        setSuggestionsModalOpen(true);
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
      const response = await apiRequest("DELETE", `/api/clear-data/${currentUserId}`);
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

  // Enhanced sync emails mutation with suggestions
  const syncEmailsMutation = useMutation({
    mutationFn: async () => {
      if (!currentUserId) throw new Error("No user ID");
      
      const response = await apiRequest("POST", "/api/sync-enhanced", {
        userId: currentUserId,
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Email Analysis Complete",
        description: `Generated ${data.suggestionsGenerated || 0} subscription suggestions for your review`,
      });
      
      // Open suggestions modal if suggestions were generated
      if (data.redirectToSuggestions && data.suggestionsGenerated > 0) {
        setSuggestionsModalOpen(true);
      }
      
      // Invalidate and refetch all data
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions'] });
      queryClient.invalidateQueries({ queryKey: [`/api/suggestions?userId=${currentUserId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/stats?userId=${currentUserId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/emails`] });
      queryClient.invalidateQueries({ queryKey: [`/api/users/${currentUserId}`] });
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
    
    syncEmailsMutation.mutate();
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
      <Sidebar user={user} isGmailConnected={user?.gmailConnected || false} />
      
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
              {!user || !user.gmailConnected ? (
                <Button
                  onClick={handleConnectGmail}
                  disabled={gmailAuthMutation.isPending}
                  data-testid="connect-gmail"
                >
                  {gmailAuthMutation.isPending ? (
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Mail className="w-4 h-4 mr-2" />
                  )}
                  Connect Gmail
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    onClick={handleSyncEmails}
                    disabled={syncEmailsMutation.isPending}
                    data-testid="sync-emails"
                  >
                    {syncEmailsMutation.isPending ? (
                      <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-2" />
                    )}
                    Sync Emails
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setSuggestionsModalOpen(true)}
                    data-testid="review-suggestions"
                  >
                    📋 Review Suggestions
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

          {/* Email Analysis */}
          <EmailAnalysis emails={emails} />
        </main>

        {/* Suggestions Modal */}
        <SubscriptionSuggestionsModal 
          open={suggestionsModalOpen}
          onOpenChange={setSuggestionsModalOpen}
        />
      </div>
    </div>
  );
}
