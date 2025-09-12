import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { RefreshCw, Mail, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Sidebar } from "@/components/Sidebar";
import { StatsCards } from "@/components/StatsCards";
import { SubscriptionList } from "@/components/SubscriptionList";
import { EmailAnalysis } from "@/components/EmailAnalysis";
import { type Subscription, type Email } from "@shared/schema";

export default function Dashboard() {
  const { toast } = useToast();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Handle OAuth callback and initialize user
  useEffect(() => {
    const handleOAuthCallback = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const gmailConnected = urlParams.get('gmailConnected');

        console.log("Initializing dashboard, gmailConnected:", gmailConnected);

        // If returning from OAuth, handle the connection result
        if (gmailConnected === 'true') {
          const userId = urlParams.get('userId');
          console.log("OAuth success, userId:", userId);
          
          if (userId) {
            setCurrentUserId(userId);
            
            toast({
              title: "Gmail Connected!",
              description: "Successfully connected your Gmail account. Starting email sync...",
              variant: "default",
            });

            // Clear URL parameters
            window.history.replaceState({}, document.title, window.location.pathname);
            
            // Refresh user data to reflect connected status
            queryClient.invalidateQueries({ queryKey: [`/api/users/${userId}`] });
            
            // Automatically trigger email sync after a delay
            setTimeout(async () => {
              try {
                const response = await apiRequest("POST", "/api/sync-emails", { userId });
                const data = await response.json();
                
                toast({
                  title: "Email Sync Complete",
                  description: `Processed ${data.processedEmails || 0} emails and found ${data.detectedSubscriptions || 0} subscriptions`,
                });
                
                // Refresh all data after sync  
                queryClient.invalidateQueries({ queryKey: [`/api/subscriptions?userId=${userId}`] });
                queryClient.invalidateQueries({ queryKey: [`/api/emails?userId=${userId}`] });
                queryClient.invalidateQueries({ queryKey: [`/api/stats?userId=${userId}`] });
              } catch (error) {
                console.error("Auto email sync error:", error);
                toast({
                  title: "Sync Failed",
                  description: "Failed to sync emails automatically. You can try again manually.",
                  variant: "destructive",
                });
              }
            }, 1500);
          } else {
            throw new Error("No user ID received from OAuth");
          }
        } else if (gmailConnected === 'false') {
          const error = urlParams.get('error');
          toast({
            title: "Gmail Connection Failed",
            description: error || "Failed to connect Gmail account",
            variant: "destructive",
          });
          
          // Clear URL parameters and initialize normally
          window.history.replaceState({}, document.title, window.location.pathname);
          
          // Fall through to normal initialization
          const response = await apiRequest("POST", "/api/users", {
            username: "demo@example.com",
            password: "demo123"
          });
          const user = await response.json();
          console.log("Created demo user after OAuth failure:", user.id);
          setCurrentUserId(user.id);
        } else {
          // Normal initialization with demo user
          console.log("Normal initialization, creating demo user");
          const response = await apiRequest("POST", "/api/users", {
            username: "demo@example.com",
            password: "demo123"
          });
          const user = await response.json();
          console.log("Created demo user:", user.id);
          setCurrentUserId(user.id);
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

    handleOAuthCallback();
  }, []);

  // Fetch user data
  const { data: user } = useQuery({
    queryKey: [`/api/users/${currentUserId}`],
    enabled: !!currentUserId,
  });

  // Fetch subscription stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: [`/api/stats?userId=${currentUserId}`],
    enabled: !!currentUserId,
  });

  // Fetch subscriptions
  const { data: subscriptions = [], isLoading: subscriptionsLoading } = useQuery<Subscription[]>({
    queryKey: [`/api/subscriptions?userId=${currentUserId}`],
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

  // Function to trigger email sync
  const triggerEmailSync = async (userId: string) => {
    try {
      const response = await apiRequest("POST", "/api/sync-emails", { userId });
      const data = await response.json();
      
      toast({
        title: "Email Sync Complete",
        description: `Processed ${data.processedEmails || 0} emails and found ${data.detectedSubscriptions || 0} subscriptions`,
      });
      
      // Refresh all data after sync  
      queryClient.invalidateQueries({ queryKey: [`/api/subscriptions?userId=${userId}`] });
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

  // Sync emails mutation
  const syncEmailsMutation = useMutation({
    mutationFn: async () => {
      if (!currentUserId) throw new Error("No user ID");
      
      const response = await apiRequest("POST", "/api/sync-emails", {
        userId: currentUserId,
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Sync Complete",
        description: `Processed ${data.newEmails} new emails and detected ${data.detectedSubscriptions} subscriptions`,
      });
      
      // Invalidate and refetch all data
      queryClient.invalidateQueries({ queryKey: [`/api/subscriptions?userId=${currentUserId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/stats?userId=${currentUserId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/emails?userId=${currentUserId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/users/${currentUserId}`] });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync emails",
        variant: "destructive",
      });
    },
  });

  const handleConnectGmail = () => {
    gmailAuthMutation.mutate();
  };

  const handleSyncEmails = () => {
    if (!user?.gmailConnected) {
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
      <Sidebar user={user} isGmailConnected={user?.gmailConnected} />
      
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
              {!user?.gmailConnected ? (
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
              )}
              
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
            <StatsCards stats={stats || defaultStats} />
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
      </div>
    </div>
  );
}
