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

  // Initialize with a demo user for testing
  useEffect(() => {
    const initUser = async () => {
      try {
        const response = await apiRequest("POST", "/api/users", {
          username: "demo@example.com",
          password: "demo123"
        });
        const user = await response.json();
        setCurrentUserId(user.id);
      } catch (error) {
        console.error("Failed to create demo user:", error);
        toast({
          title: "Error",
          description: "Failed to initialize user session",
          variant: "destructive",
        });
      }
    };

    initUser();
  }, [toast]);

  // Fetch user data
  const { data: user } = useQuery({
    queryKey: ["/api/users", currentUserId],
    enabled: !!currentUserId,
  });

  // Fetch subscription stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/stats", currentUserId],
    enabled: !!currentUserId,
  });

  // Fetch subscriptions
  const { data: subscriptions = [], isLoading: subscriptionsLoading } = useQuery<Subscription[]>({
    queryKey: ["/api/subscriptions", currentUserId],
    enabled: !!currentUserId,
  });

  // Fetch recent emails
  const { data: emails = [], isLoading: emailsLoading } = useQuery<Email[]>({
    queryKey: ["/api/emails", currentUserId],
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
      // Open Gmail OAuth in new window
      window.open(data.authUrl, "_blank");
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
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
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
