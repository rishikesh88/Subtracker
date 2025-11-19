import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation } from "@tanstack/react-query";
import { User, LogOut, Mail, Unlink, Calendar, Save, Plus, Trash2 } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SafeUser, GmailAccount, OutlookAccount } from "@shared/schema";
import { useState, useEffect } from "react";

export default function Settings() {
  const { data: user } = useQuery<SafeUser>({ 
    queryKey: ['/api/auth/user']
  });
  
  // Fetch Gmail accounts
  const { data: gmailAccounts = [], isLoading: gmailAccountsLoading } = useQuery<GmailAccount[]>({ 
    queryKey: ['/api/gmail/accounts']
  });
  
  // Fetch Outlook accounts
  const { data: outlookAccounts = [], isLoading: outlookAccountsLoading } = useQuery<OutlookAccount[]>({ 
    queryKey: ['/api/outlook/accounts']
  });
  
  const accountsLoading = gmailAccountsLoading || outlookAccountsLoading;
  
  // Unified account list with proper typing
  type UnifiedAccount = 
    | ({ provider: 'gmail' } & GmailAccount)
    | ({ provider: 'outlook' } & OutlookAccount);
  
  const unifiedAccounts: UnifiedAccount[] = [
    ...gmailAccounts.map(acc => ({ ...acc, provider: 'gmail' as const })),
    ...outlookAccounts.map(acc => ({ ...acc, provider: 'outlook' as const }))
  ].sort((a, b) => {
    // Sort by creation time (most recent first)
    const dateA = new Date(a.createdAt || 0);
    const dateB = new Date(b.createdAt || 0);
    return dateB.getTime() - dateA.getTime();
  });
  
  const totalAccounts = gmailAccounts.length + outlookAccounts.length;
  const canAddMore = totalAccounts < 4;
  
  const { toast } = useToast();
  const [emailSyncDays, setEmailSyncDays] = useState<number>(90);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());

  // Initialize emailSyncDays from user data
  useEffect(() => {
    if (user?.emailSyncDays) {
      setEmailSyncDays(user.emailSyncDays);
    }
  }, [user]);

  // Delete Gmail account mutation
  const deleteGmailAccountMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const response = await apiRequest('DELETE', `/api/gmail/accounts/${accountId}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to disconnect account' }));
        throw new Error(errorData.message || 'Failed to disconnect account');
      }
      
      // DELETE returns 204 No Content, so don't try to parse JSON
      return null;
    },
    onMutate: (accountId) => {
      setPendingDeletes(prev => new Set(Array.from(prev).concat(accountId)));
    },
    onSuccess: (_data, accountId) => {
      setPendingDeletes(prev => {
        const next = new Set(Array.from(prev));
        next.delete(accountId);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['/api/gmail/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      toast({
        title: "Account Disconnected",
        description: "Gmail account has been successfully removed.",
      });
    },
    onError: (error: any, accountId) => {
      setPendingDeletes(prev => {
        const next = new Set(Array.from(prev));
        next.delete(accountId);
        return next;
      });
      toast({
        title: "Disconnect Failed",
        description: error?.message || "Failed to disconnect Gmail account. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Delete Outlook account mutation
  const deleteOutlookAccountMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const response = await apiRequest('DELETE', `/api/outlook/accounts/${accountId}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to disconnect account' }));
        throw new Error(errorData.message || 'Failed to disconnect account');
      }
      
      // DELETE returns 204 No Content, so don't try to parse JSON
      return null;
    },
    onMutate: (accountId) => {
      setPendingDeletes(prev => new Set(Array.from(prev).concat(accountId)));
    },
    onSuccess: (_data, accountId) => {
      setPendingDeletes(prev => {
        const next = new Set(Array.from(prev));
        next.delete(accountId);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['/api/outlook/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      toast({
        title: "Account Disconnected",
        description: "Outlook account has been successfully removed.",
      });
    },
    onError: (error: any, accountId) => {
      setPendingDeletes(prev => {
        const next = new Set(Array.from(prev));
        next.delete(accountId);
        return next;
      });
      toast({
        title: "Disconnect Failed",
        description: error?.message || "Failed to disconnect Outlook account. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Gmail connect mutation (reused for adding accounts)
  const connectGmailMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/auth/google/connect');
      return response.json();
    },
    onSuccess: (data: { authUrl: string }) => {
      // Redirect to Gmail OAuth flow
      window.location.href = data.authUrl;
    },
    onError: (error: any) => {
      toast({
        title: "Connection Failed",
        description: error?.message || "Failed to start Gmail connection. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Outlook connect mutation
  const connectOutlookMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/auth/outlook/connect');
      return response.json();
    },
    onSuccess: (data: { authUrl: string }) => {
      // Redirect to Outlook OAuth flow
      window.location.href = data.authUrl;
    },
    onError: (error: any) => {
      toast({
        title: "Connection Failed",
        description: error?.message || "Failed to start Outlook connection. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleDisconnectGmailAccount = (accountId: string) => {
    deleteGmailAccountMutation.mutate(accountId);
  };

  const handleDisconnectOutlookAccount = (accountId: string) => {
    deleteOutlookAccountMutation.mutate(accountId);
  };

  const handleConnectGmail = () => {
    connectGmailMutation.mutate();
  };

  const handleConnectOutlook = () => {
    connectOutlookMutation.mutate();
  };
  
  const getSyncStatusBadge = (status: string) => {
    switch (status) {
      case 'syncing':
        return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Syncing</Badge>;
      case 'error':
        return <Badge variant="destructive">Error</Badge>;
      case 'idle':
        return <Badge variant="outline" className="text-green-600 border-green-200 dark:text-green-400 dark:border-green-800">Ready</Badge>;
      case 'completed':
        return <Badge variant="outline" className="text-green-600 border-green-200 dark:text-green-400 dark:border-green-800">Completed</Badge>;
      case 'disabled':
        return <Badge variant="secondary" className="text-gray-600 dark:text-gray-400">Disabled</Badge>;
      case 'pending':
        return <Badge variant="secondary">Pending</Badge>;
      default:
        return <Badge variant="secondary">{status || 'Unknown'}</Badge>;
    }
  };

  // Sync emails mutation
  const syncEmailsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/sync-emails-llm");
      const data = await response.json().catch(() => ({ message: 'Invalid response' }));
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to sync emails');
      }
      
      return data;
    },
    onSuccess: (data) => {
      const totalSuggestions = data.suggestionsGenerated || 0;
      const userId = user?.id;
      
      toast({
        title: "Email Sync Started",
        description: `Analyzing emails in background...`,
      });
      
      // Invalidate all relevant queries to refresh data (aligned with dashboard)
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions'] });
      if (userId) {
        queryClient.invalidateQueries({ queryKey: [`/api/suggestions?userId=${userId}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/stats?userId=${userId}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/emails?userId=${userId}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/users/${userId}`] });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/emails'] }); // Non-scoped emails
      queryClient.invalidateQueries({ queryKey: ['/api/gmail/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/outlook/accounts'] });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error?.message || "Failed to sync emails. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Update settings mutation
  const updateSettingsMutation = useMutation({
    mutationFn: async (settings: { emailSyncDays?: number }) => {
      const response = await apiRequest('POST', '/api/settings/update', settings);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      setHasUnsavedChanges(false);
      toast({
        title: "Settings Saved",
        description: "Your preferences have been updated successfully. Starting sync...",
      });
      
      // Trigger automatic sync with new duration
      localStorage.setItem('justOnboarded', 'true');
      localStorage.setItem('onboardedAt', Date.now().toString());
      
      // Dispatch custom event to trigger SyncProgressPanel
      window.dispatchEvent(new Event('syncTrigger'));
      
      syncEmailsMutation.mutate();
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error?.message || "Failed to update settings. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSyncDaysChange = (value: string) => {
    const numValue = parseInt(value);
    if (!isNaN(numValue) && numValue >= 1 && numValue <= 180) {
      setEmailSyncDays(numValue);
      setHasUnsavedChanges(true);
    } else if (value === '') {
      setEmailSyncDays(90); // Reset to default if empty
      setHasUnsavedChanges(true);
    }
  };

  const handleSaveSettings = () => {
    if (emailSyncDays < 1 || emailSyncDays > 180) {
      toast({
        title: "Invalid Value",
        description: "Email sync days must be between 1 and 180.",
        variant: "destructive",
      });
      return;
    }
    updateSettingsMutation.mutate({ emailSyncDays });
  };
  
  const handleLogout = () => {
    // Clear all cached data before logout for seamless account switching
    queryClient.clear();
    
    // Show signing out feedback
    toast({
      title: "Signing out...",
      description: "You'll be redirected to sign in with a different account.",
    });
    
    // Redirect to logout endpoint
    setTimeout(() => {
      window.location.href = '/api/logout';
    }, 500);
  };

  return (
    <div className="container mx-auto px-6 py-8" data-testid="settings-page">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage your account settings and preferences
        </p>
      </div>

      <div className="grid gap-6">
        {/* User Profile Card */}
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              Your account information and preferences
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center space-x-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={user?.profileImageUrl || undefined} alt={user?.firstName || 'User'} />
                <AvatarFallback className="bg-primary/10">
                  <User className="h-8 w-8" />
                </AvatarFallback>
              </Avatar>
              <div className="space-y-1">
                <h3 className="font-semibold text-lg" data-testid="profile-name">
                  {user?.firstName && user?.lastName 
                    ? `${user.firstName} ${user.lastName}` 
                    : 'User'
                  }
                </h3>
                <p className="text-muted-foreground" data-testid="profile-email">
                  {user?.email}
                </p>
                <Badge variant="outline" className="text-xs">
                  Joined {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Recently'}
                </Badge>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" disabled>
                Edit Profile
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleLogout}
                className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950"
                data-testid="logout-settings-button"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Email Accounts</CardTitle>
                <CardDescription>
                  Connect multiple Gmail and Outlook accounts for comprehensive subscription tracking (max 4 total)
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleConnectGmail}
                  disabled={connectGmailMutation.isPending || (gmailAccounts.length >= 2) || !canAddMore}
                  data-testid="connect-gmail-button"
                  className="gap-1.5"
                >
                  <SiGoogle className="h-3.5 w-3.5" />
                  {connectGmailMutation.isPending ? "Connecting..." : "Gmail"}
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleConnectOutlook}
                  disabled={connectOutlookMutation.isPending || (outlookAccounts.length >= 2) || !canAddMore}
                  data-testid="connect-outlook-button"
                  className="gap-1.5"
                >
                  <Mail className="h-3.5 w-3.5" />
                  {connectOutlookMutation.isPending ? "Connecting..." : "Outlook"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {accountsLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading accounts...
              </div>
            ) : unifiedAccounts.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed rounded-lg">
                <Mail className="mx-auto h-12 w-12 text-muted-foreground mb-3" />
                <p className="font-medium text-muted-foreground mb-2">No email accounts connected</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Connect your Gmail or Outlook account to start tracking subscriptions
                </p>
                <div className="flex gap-2 justify-center">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleConnectGmail}
                    disabled={connectGmailMutation.isPending}
                    data-testid="connect-first-gmail-button"
                    className="gap-1.5"
                  >
                    <SiGoogle className="h-3.5 w-3.5" />
                    {connectGmailMutation.isPending ? "Connecting..." : "Connect Gmail"}
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleConnectOutlook}
                    disabled={connectOutlookMutation.isPending}
                    data-testid="connect-first-outlook-button"
                    className="gap-1.5"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {connectOutlookMutation.isPending ? "Connecting..." : "Connect Outlook"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {unifiedAccounts.map((account) => {
                  const isGmail = account.provider === 'gmail';
                  const email = isGmail ? (account as GmailAccount).gmailEmail : (account as OutlookAccount).outlookEmail;
                  const accountId = account.id;
                  const testId = isGmail ? `gmail-account-${accountId}` : `outlook-account-${accountId}`;
                  
                  return (
                    <div 
                      key={`${account.provider}-${accountId}`}
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                      data-testid={testId}
                    >
                      <div className="flex items-center space-x-3 flex-1">
                        {isGmail ? (
                          <div className="flex items-center justify-center h-8 w-8 rounded bg-primary/10">
                            <SiGoogle className="h-4 w-4 text-primary" />
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-8 w-8 rounded bg-blue-100 dark:bg-blue-900">
                            <Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                          </div>
                        )}
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium" data-testid={isGmail ? `gmail-email-${accountId}` : `outlook-email-${accountId}`}>
                              {email}
                            </p>
                            {isGmail ? (
                              <Badge variant="outline" className="text-xs">Gmail</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">Outlook</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            {getSyncStatusBadge(account.syncStatus)}
                            {account.lastSync && (
                              <span className="text-xs text-muted-foreground">
                                Last sync: {new Date(account.lastSync).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          {account.syncError && (
                            <p className="text-xs text-destructive mt-1" data-testid={`sync-error-${accountId}`}>
                              {account.syncError}
                            </p>
                          )}
                        </div>
                      </div>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => isGmail ? handleDisconnectGmailAccount(accountId) : handleDisconnectOutlookAccount(accountId)}
                        disabled={pendingDeletes.has(accountId)}
                        className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950"
                        data-testid={isGmail ? `disconnect-gmail-${accountId}` : `disconnect-outlook-${accountId}`}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {pendingDeletes.has(accountId) ? "Removing..." : "Remove"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Detection Settings</CardTitle>
            <CardDescription>
              Configure how subscriptions are detected and processed
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Currency</p>
                <p className="text-sm text-muted-foreground">
                  Primary currency for subscription tracking
                </p>
              </div>
              <Badge variant="outline">INR</Badge>
            </div>

            <div className="space-y-3 pt-4 border-t">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="emailSyncDays" className="font-medium">
                  Email Sync Period
                </Label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <Input
                    id="emailSyncDays"
                    type="number"
                    min="1"
                    max="180"
                    value={emailSyncDays}
                    onChange={(e) => handleSyncDaysChange(e.target.value)}
                    className="w-24"
                    data-testid="email-sync-days-input"
                  />
                  <span className="text-sm text-muted-foreground">days (max 180)</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Number of days to fetch emails when syncing with Gmail. Default is 90 days.
                </p>
                {hasUnsavedChanges && (
                  <Button
                    size="sm"
                    onClick={handleSaveSettings}
                    disabled={updateSettingsMutation.isPending}
                    className="mt-2"
                    data-testid="save-settings-button"
                  >
                    <Save className="mr-2 h-3 w-3" />
                    {updateSettingsMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}