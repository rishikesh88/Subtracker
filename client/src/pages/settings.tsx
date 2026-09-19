import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useQuery, useMutation } from "@tanstack/react-query";
import { User, LogOut, Mail, Calendar, Save, Trash2 } from "lucide-react";
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

  // Ink-on-soft-ground badge for an account's sync status, per the design
  // system's status principle -- a saturated fill is never used for state.
  const getSyncStatusBadge = (status: string) => {
    switch (status) {
      case 'syncing':
        return <span className="badge-status bg-accent-soft text-accent-deep">Syncing</span>;
      case 'error':
        return <span className="badge-status bg-destructive/10 text-destructive">Error</span>;
      case 'idle':
        return <span className="badge-status bg-success-soft text-success">Ready</span>;
      case 'completed':
        return <span className="badge-status bg-success-soft text-success">Completed</span>;
      case 'disabled':
        return <span className="badge-status bg-line-soft text-muted-foreground">Disabled</span>;
      case 'pending':
        return <span className="badge-status bg-line-soft text-muted-foreground">Pending</span>;
      default:
        return <span className="badge-status bg-line-soft text-muted-foreground">{status || 'Unknown'}</span>;
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
    onSuccess: () => {
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
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-canvas" data-testid="settings-page">
      {/* --- Page header ---------------------------------------------------- */}
      <header
        className="flex-shrink-0 bg-surface border-b border-line"
        style={{ padding: "20px 24px 16px" }}
      >
        <h1 className="t-page">Settings</h1>
        <p className="text-[12.5px] text-muted-foreground mt-1">
          Manage your account settings and preferences
        </p>
      </header>

      {/* --- Body ------------------------------------------------------------ */}
      <main
        className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-5"
        style={{ padding: "20px 24px 40px" }}
      >
        {/* Profile */}
        <section className="surface-card flex flex-col" style={{ padding: "14px 16px" }}>
          <h2 className="t-label mb-3">Profile</h2>
          <div className="flex items-center gap-3 flex-wrap">
            <Avatar className="h-11 w-11 flex-none">
              <AvatarImage src={user?.profileImageUrl || undefined} alt={user?.firstName || 'User'} />
              <AvatarFallback className="bg-line-soft">
                <User size={17} strokeWidth={2} className="text-ink-body" />
              </AvatarFallback>
            </Avatar>
            <div className="min-w-[170px] flex-1 overflow-hidden">
              <h3 className="t-card-title truncate" data-testid="profile-name">
                {user?.firstName && user?.lastName
                  ? `${user.firstName} ${user.lastName}`
                  : 'User'
                }
              </h3>
              <p className="text-[13px] text-ink-body truncate" data-testid="profile-email">
                {user?.email}
              </p>
            </div>
            <span className="badge-category flex-none">
              Joined {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Recently'}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-line-soft">
            <button type="button" className="btn-base btn-secondary" disabled>
              Edit profile
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="btn-base btn-secondary"
              data-testid="logout-settings-button"
            >
              <LogOut size={15} strokeWidth={2} />
              Sign out
            </button>
          </div>
        </section>

        {/* Email accounts */}
        <section className="surface-card flex flex-col" style={{ padding: "14px 16px" }}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h2 className="t-label">Email accounts</h2>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Connect Gmail and Outlook accounts for subscription tracking (max 4 total)
              </p>
            </div>
            <div className="flex gap-2 flex-none">
              <button
                type="button"
                onClick={handleConnectGmail}
                disabled={connectGmailMutation.isPending || (gmailAccounts.length >= 2) || !canAddMore}
                data-testid="connect-gmail-button"
                className="btn-base btn-secondary"
              >
                <SiGoogle size={13} />
                {connectGmailMutation.isPending ? "Connecting..." : "Gmail"}
              </button>
              <button
                type="button"
                onClick={handleConnectOutlook}
                disabled={connectOutlookMutation.isPending || (outlookAccounts.length >= 2) || !canAddMore}
                data-testid="connect-outlook-button"
                className="btn-base btn-secondary"
              >
                <Mail size={15} strokeWidth={2} />
                {connectOutlookMutation.isPending ? "Connecting..." : "Outlook"}
              </button>
            </div>
          </div>

          <div className="mt-3">
            {accountsLoading ? (
              <p className="py-8 text-center text-[13px] text-muted-foreground">
                Loading accounts…
              </p>
            ) : unifiedAccounts.length === 0 ? (
              <div className="flex flex-col items-center text-center py-8 px-4 border border-dashed border-line rounded-card">
                <Mail size={17} strokeWidth={2} className="text-muted-foreground mb-2" />
                <p className="t-card-title">No email accounts connected</p>
                <p className="text-[12.5px] text-muted-foreground mt-1 max-w-[320px]">
                  Connect your Gmail or Outlook account to start tracking subscriptions
                </p>
                <div className="flex gap-2 justify-center flex-wrap mt-4">
                  {/* The one forward action on this screen: connecting a
                      mailbox when none is connected yet. */}
                  <button
                    type="button"
                    onClick={handleConnectGmail}
                    disabled={connectGmailMutation.isPending}
                    data-testid="connect-first-gmail-button"
                    className="btn-base btn-accent"
                  >
                    <SiGoogle size={13} />
                    {connectGmailMutation.isPending ? "Connecting..." : "Connect Gmail"}
                  </button>
                  <button
                    type="button"
                    onClick={handleConnectOutlook}
                    disabled={connectOutlookMutation.isPending}
                    data-testid="connect-first-outlook-button"
                    className="btn-base btn-secondary"
                  >
                    <Mail size={15} strokeWidth={2} />
                    {connectOutlookMutation.isPending ? "Connecting..." : "Connect Outlook"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {unifiedAccounts.map((account) => {
                  const isGmail = account.provider === 'gmail';
                  const email = isGmail ? (account as GmailAccount).gmailEmail : (account as OutlookAccount).outlookEmail;
                  const accountId = account.id;
                  const testId = isGmail ? `gmail-account-${accountId}` : `outlook-account-${accountId}`;

                  return (
                    <div
                      key={`${account.provider}-${accountId}`}
                      className="flex items-center gap-3 p-3 border border-line-soft rounded-lg flex-wrap"
                      data-testid={testId}
                    >
                      <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-line-soft flex-none">
                        {isGmail ? (
                          <SiGoogle size={14} className="text-ink-body" />
                        ) : (
                          <Mail size={15} strokeWidth={2} className="text-ink-body" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[13px] font-medium text-ink truncate min-w-[170px]" data-testid={isGmail ? `gmail-email-${accountId}` : `outlook-email-${accountId}`}>
                            {email}
                          </p>
                          <span className="badge-cadence flex-none">{isGmail ? "Gmail" : "Outlook"}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {getSyncStatusBadge(account.syncStatus)}
                          {account.lastSync && (
                            <span className="text-[11px] text-muted-foreground">
                              Last sync: {new Date(account.lastSync).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        {account.syncError && (
                          <p className="text-[11px] text-destructive mt-1" data-testid={`sync-error-${accountId}`}>
                            {account.syncError}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => isGmail ? handleDisconnectGmailAccount(accountId) : handleDisconnectOutlookAccount(accountId)}
                        disabled={pendingDeletes.has(accountId)}
                        className="btn-base btn-secondary flex-none"
                        data-testid={isGmail ? `disconnect-gmail-${accountId}` : `disconnect-outlook-${accountId}`}
                      >
                        <Trash2 size={15} strokeWidth={2} className="text-destructive" />
                        {pendingDeletes.has(accountId) ? "Removing..." : "Remove"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Detection settings */}
        <section className="surface-card flex flex-col" style={{ padding: "14px 16px" }}>
          <h2 className="t-label mb-3">Detection settings</h2>

          <div className="flex items-center justify-between gap-3 pb-3 border-b border-line-soft">
            <div>
              <p className="text-[13px] font-medium text-ink-strong">Currency</p>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Primary currency for subscription tracking
              </p>
            </div>
            <span className="badge-cadence flex-none">INR</span>
          </div>

          <div className="flex flex-col gap-2 pt-3">
            <div className="flex items-center gap-1.5">
              <Calendar size={15} strokeWidth={2} className="text-muted-foreground" />
              <label htmlFor="emailSyncDays" className="text-[13px] font-medium text-ink-strong">
                Email sync period
              </label>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="field w-24">
                <input
                  id="emailSyncDays"
                  type="number"
                  min={1}
                  max={180}
                  value={emailSyncDays}
                  onChange={(e) => handleSyncDaysChange(e.target.value)}
                  data-testid="email-sync-days-input"
                />
              </div>
              <span className="text-[12.5px] text-muted-foreground">days (max 180)</span>
              {hasUnsavedChanges && (
                <button
                  type="button"
                  onClick={handleSaveSettings}
                  disabled={updateSettingsMutation.isPending}
                  className="btn-base btn-primary"
                  data-testid="save-settings-button"
                >
                  <Save size={15} strokeWidth={2} />
                  {updateSettingsMutation.isPending ? "Saving..." : "Save changes"}
                </button>
              )}
            </div>
            <p className="text-[12px] text-muted-foreground">
              Number of days to fetch emails when syncing with Gmail. Default is 90 days.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
