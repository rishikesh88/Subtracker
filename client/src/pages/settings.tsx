import { signOut } from "@/lib/signOut";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useQuery, useMutation } from "@tanstack/react-query";
import { User, LogOut, Mail, Calendar, Save, Trash2, RefreshCw, AlertTriangle, Plus, ChevronRight } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useMailboxes } from "@/hooks/useMailboxes";
import type { SafeUser, GmailAccount, OutlookAccount } from "@shared/schema";
import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToastAction } from "@/components/ui/toast";
import { CURRENCIES } from "@/lib/currencies";

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
  const [addInboxOpen, setAddInboxOpen] = useState(false);

  const mailboxes = useMailboxes();

  const { toast } = useToast();
  const [emailSyncDays, setEmailSyncDays] = useState<number>(90);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
  const [showClearDataDialog, setShowClearDataDialog] = useState(false);

  // Initialize emailSyncDays from user data
  useEffect(() => {
    if (user?.emailSyncDays) {
      setEmailSyncDays(user.emailSyncDays);
    }
  }, [user]);

  /* Deleting everything read from the mailboxes.
   *
   * The endpoint has existed for a while with nothing calling it, which meant
   * the only route was emailing us by hand. Google's review of a restricted
   * Gmail scope looks for a path a user can find on their own, and so does
   * anyone who simply changes their mind.
   *
   * It does not close the account or disconnect a mailbox -- those are their
   * own controls, and disconnecting is what cancels Google's permission. This
   * removes what was read. */
  const clearDataMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('DELETE', '/api/clear-data');
      return response.json();
    },
    onSuccess: (result) => {
      setShowClearDataDialog(false);
      toast({
        title: "Everything read from your mailboxes is deleted",
        description: `${result.clearedSubscriptions ?? 0} subscriptions and ${result.clearedEmails ?? 0} stored emails removed. Your mailboxes stay connected.`,
      });
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0]?.toString() ?? "";
          return key.startsWith('/api/subscriptions')
            || key.startsWith('/api/suggestions')
            || key.startsWith('/api/emails')
            || key.startsWith('/api/stats')
            || key.startsWith('/api/auth/user');
        },
      });
    },
    onError: () => {
      toast({
        title: "That didn't delete",
        description: "Nothing was removed. Try again, or write to us and we will do it by hand.",
        variant: "destructive",
      });
    },
  });

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

  const currentCurrency = user?.preferredCurrency || "INR";

  /*
   * Applies at once, no Save: the change is easy to see and easy to undo.
   * Stored amounts never change -- each subscription keeps what it was billed
   * in, and only how totals and cards are shown moves.
   */
  const changeCurrencyMutation = useMutation({
    mutationFn: async ({ code }: { code: string; previous: string }) => {
      const response = await apiRequest("PATCH", "/api/settings", { preferredCurrency: code });
      return response.json();
    },
    onSuccess: (_data, { code, previous }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0]?.toString().startsWith("/api/stats") ?? false,
      });
      toast({
        title: `Now showing amounts in ${code}`,
        description: "Totals and cards are converted at today's rate. What each receipt charged stays as it was.",
        action: (
          <ToastAction altText={`Switch back to ${previous}`} onClick={() => changeCurrencyMutation.mutate({ code: previous, previous: code })}>
            Undo
          </ToastAction>
        ),
      });
    },
    onError: () => {
      toast({
        title: "Couldn't change the currency",
        description: "Nothing was changed. Try again in a moment.",
        variant: "destructive",
      });
    },
  });

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
    // The sync window follows the sync from here.
    onMutate: () => {
      window.dispatchEvent(new Event('syncTrigger'));
    },
    onSuccess: () => {
      const userId = user?.id;

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
      // Shown in the sync window, which is already open.
      window.dispatchEvent(new CustomEvent('syncStartFailed', { detail: error?.message }));
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

      // Opens the sync window
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
    void signOut();
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
        {/* Profile and Detection share the top row; the mailbox list gets the
            full width beneath it, because an address like
            accounts.payable.india@verloq.co has nowhere to go in half a column
            and the list is the part that grows as accounts are added. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
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

          {/* Preferences */}
          <section className="surface-card flex flex-col" style={{ padding: "14px 16px" }}>
            <h2 className="t-label mb-3">Preferences</h2>

            {/* The currency every total and card is shown in. It used to be
                fixed text reading INR, whatever the account had chosen, and
                the only way to change it was the dashboard menu. */}
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-line-soft">
              <label htmlFor="currency-select" className="text-[13px] font-medium text-ink-strong">
                Currency
              </label>
              <Select
                value={currentCurrency}
                onValueChange={(code) => changeCurrencyMutation.mutate({ code, previous: currentCurrency })}
                disabled={changeCurrencyMutation.isPending}
              >
                <SelectTrigger id="currency-select" className="w-[230px] h-[38px] flex-none text-[13.5px]" data-testid="currency-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((currency) => (
                    <SelectItem key={currency.code} value={currency.code} data-testid={`currency-option-${currency.code}`}>
                      <span className="inline-flex items-center gap-2">
                        {/* AED's symbol is its code; showing it twice reads as a typo. */}
                        <span className="w-9 font-semibold text-ink-body">
                          {currency.symbol === currency.code ? "" : currency.symbol}
                        </span>
                        <span>
                          <span className="font-semibold">{currency.code}</span> · {currency.name}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
        </div>

{/* Email accounts */}
        <section className="surface-card flex flex-col" style={{ padding: "14px 16px" }}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h2 className="t-label">Connected inboxes</h2>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Connect up to 4 Gmail or Outlook inboxes. Each sync reads all of them.
              </p>
            </div>
            {/* With nothing connected, the empty state below carries the two
                connect buttons; the header adds nothing until then. */}
            {mailboxes.hasAny && (
              <div className="flex gap-2 flex-none">
                <button
                  type="button"
                  onClick={() => syncEmailsMutation.mutate()}
                  disabled={syncEmailsMutation.isPending}
                  data-testid="sync-now-settings"
                  className="btn-base btn-secondary"
                >
                  <RefreshCw
                    size={15}
                    strokeWidth={2}
                    className={syncEmailsMutation.isPending ? "animate-spin" : undefined}
                  />
                  Sync now
                </button>
                <button
                  type="button"
                  onClick={() => setAddInboxOpen(true)}
                  disabled={!canAddMore}
                  title={canAddMore ? undefined : "4 inboxes is the limit"}
                  data-testid="add-inbox-button"
                  className="btn-base btn-accent"
                >
                  <Plus size={15} strokeWidth={2} />
                  Add inbox
                </button>
              </div>
            )}
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
                {canAddMore && (
                  <p className="text-[12.5px] text-muted-foreground border border-dashed border-line rounded-lg px-3 py-2.5">
                    {4 - totalAccounts} more {4 - totalAccounts === 1 ? "inbox" : "inboxes"} can be connected: a work Gmail, a family Outlook, anything that gets bills.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Add inbox: which kind of account. Each provider takes 2 at most. */}
        <Dialog open={addInboxOpen} onOpenChange={setAddInboxOpen}>
          <DialogContent className="sm:max-w-[460px]" data-testid="add-inbox-dialog">
            <div className="flex flex-col gap-1">
              <DialogTitle className="font-serif text-[26px] font-normal tracking-[-0.02em] leading-tight">
                Add an inbox
              </DialogTitle>
              <DialogDescription className="text-[13px] text-ink-body">
                Which kind of email account is it?
              </DialogDescription>
            </div>
            <div className="flex flex-col gap-2.5">
              {[
                {
                  key: "gmail",
                  name: "Gmail",
                  note: gmailAccounts.length >= 2 ? "2 Gmail inboxes is the limit" : "Gmail and Google Workspace",
                  full: gmailAccounts.length >= 2,
                  pending: connectGmailMutation.isPending,
                  icon: <SiGoogle size={15} className="text-ink-body" />,
                  connect: handleConnectGmail,
                },
                {
                  key: "outlook",
                  name: "Outlook",
                  note: outlookAccounts.length >= 2 ? "2 Outlook inboxes is the limit" : "Outlook, Hotmail and Microsoft 365",
                  full: outlookAccounts.length >= 2,
                  pending: connectOutlookMutation.isPending,
                  icon: <Mail size={16} strokeWidth={2} className="text-ink-body" />,
                  connect: handleConnectOutlook,
                },
              ].map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={option.connect}
                  disabled={option.full || option.pending}
                  data-testid={`add-inbox-${option.key}`}
                  className="flex items-center gap-3.5 h-16 px-4 rounded-[10px] border border-line-firm bg-surface text-left transition-colors hover:bg-[hsl(0,0%,97%)] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center justify-center h-9 w-9 rounded-[9px] bg-line-soft flex-none">{option.icon}</span>
                  <span className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <span className="text-[14.5px] font-semibold text-ink">{option.pending ? "Connecting…" : option.name}</span>
                    <span className="text-[12.5px] text-muted-foreground">{option.note}</span>
                  </span>
                  <ChevronRight size={16} strokeWidth={2} className="text-muted-foreground flex-none" />
                </button>
              ))}
            </div>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              Verloq only reads billing emails, and never sends, changes or deletes anything.
            </p>
          </DialogContent>
        </Dialog>

        {/* Deleting what was read. Its own card at the foot of the page:
            destructive, and nothing above it should be mistaken for it. */}
        <section className="surface-card flex flex-col" style={{ padding: "14px 16px" }}>
          <h2 className="t-label mb-3">Your data</h2>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 max-w-[62ch]">
              <p className="text-[13px] font-medium text-ink-strong">
                Delete everything read from your mailboxes
              </p>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Every subscription, every stored receipt and everything found during a sync.
                Your mailboxes stay connected and can be synced again &mdash; to cut off access
                entirely, remove them above.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowClearDataDialog(true)}
              disabled={clearDataMutation.isPending}
              className="btn-base btn-secondary text-destructive flex-none"
              data-testid="clear-data-button"
            >
              <Trash2 size={15} strokeWidth={2} />
              {clearDataMutation.isPending ? "Deleting\u2026" : "Delete my data"}
            </button>
          </div>
        </section>
      </main>

      <AlertDialog open={showClearDataDialog} onOpenChange={setShowClearDataDialog}>
        <AlertDialogContent data-testid="clear-data-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete everything read from your mailboxes?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p className="font-semibold text-destructive">This cannot be undone.</p>
              <ul className="list-disc list-inside pl-4 space-y-1">
                <li>Every subscription Verloq found or you added</li>
                <li>Every receipt and invoice stored against them</li>
                <li>Everything kept from previous syncs</li>
              </ul>
              <p>
                Your account stays open and your mailboxes stay connected, so a future sync
                starts again from empty. To cut off access to a mailbox, remove it instead.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="btn-base btn-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="cancel-clear-data"
            >
              Keep my data
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => clearDataMutation.mutate()}
              disabled={clearDataMutation.isPending}
              className="btn-base bg-destructive text-white hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="confirm-clear-data"
            >
              <AlertTriangle size={15} strokeWidth={2} />
              Delete everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
