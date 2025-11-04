import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Mail, Trash2, Edit2, Check, X, Loader2, RefreshCw } from "lucide-react";
import { SiGmail } from "react-icons/si";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
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
import { Input } from "@/components/ui/input";

interface EmailAccount {
  id: string;
  userId: string;
  provider: 'gmail' | 'outlook';
  email: string;
  accountName: string;
  isActive: boolean;
  lastSync: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function AccountsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState<string | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editedName, setEditedName] = useState("");
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);

  const { data: accounts, isLoading } = useQuery<EmailAccount[]>({
    queryKey: ['/api/email-accounts'],
  });

  // Handle OAuth callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const gmailConnected = urlParams.get('gmailConnected');
    const error = urlParams.get('error');

    if (gmailConnected === 'true') {
      toast({
        title: "Gmail Connected!",
        description: "Your Gmail account has been successfully connected.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/email-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions'] });
      // Clean up URL
      window.history.replaceState({}, '', '/accounts');
    } else if (error) {
      toast({
        title: "Connection Failed",
        description: decodeURIComponent(error),
        variant: "destructive",
      });
      // Clean up URL
      window.history.replaceState({}, '', '/accounts');
    }
  }, [toast]);

  const connectGmailMutation = useMutation({
    mutationFn: async () => {
      console.log('🔵 Gmail mutation triggered - making API request...');
      const response = await apiRequest('/api/email-accounts/connect/gmail', {
        method: 'POST',
      });
      console.log('🔵 Gmail API response received:', response.status);
      const data = await response.json();
      console.log('🔵 Gmail response data:', data);
      return data;
    },
    onSuccess: (data) => {
      console.log('✅ Gmail mutation success, redirecting to:', data.authUrl);
      // Redirect to Gmail OAuth URL
      window.location.href = data.authUrl;
    },
    onError: (error) => {
      console.error('❌ Gmail mutation error:', error);
      toast({
        title: "Connection Failed",
        description: "Failed to initiate Gmail connection. Please try again.",
        variant: "destructive",
      });
    },
  });

  const connectOutlookMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('/api/email-accounts/connect/outlook', {
        method: 'POST',
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/email-accounts'] });
      toast({
        title: "Connected",
        description: "Outlook account connected successfully!",
      });
    },
    onError: () => {
      toast({
        title: "Connection Failed",
        description: "Failed to connect Outlook account. Please try again.",
        variant: "destructive",
      });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async (accountId: string) => {
      await apiRequest(`/api/email-accounts/${accountId}/disconnect`, {
        method: 'POST',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/email-accounts'] });
      toast({
        title: "Disconnected",
        description: "Email account disconnected successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to disconnect account. Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (accountId: string) => {
      await apiRequest(`/api/email-accounts/${accountId}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/email-accounts'] });
      toast({
        title: "Deleted",
        description: "Email account deleted successfully.",
      });
      setDeleteDialogOpen(false);
      setAccountToDelete(null);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete account. Please try again.",
        variant: "destructive",
      });
    },
  });

  const syncAccountMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const response = await apiRequest(`/api/sync-account/${accountId}`, {
        method: 'POST',
      });
      return response.json();
    },
    onSuccess: (data, accountId) => {
      setSyncingAccountId(accountId);
      toast({
        title: "Sync Started",
        description: data.message || "Email sync is in progress...",
      });
    },
    onError: () => {
      setSyncingAccountId(null);
      toast({
        title: "Sync Failed",
        description: "Failed to start sync. Please try again.",
        variant: "destructive",
      });
    },
  });

  const syncAllMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('/api/sync-all-accounts', {
        method: 'POST',
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Sync Started",
        description: data.message || "Syncing all email accounts...",
      });
    },
    onError: () => {
      toast({
        title: "Sync Failed",
        description: "Failed to start sync. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Listen to SSE events for sync progress
  useEffect(() => {
    if (!user?.id) return;

    const eventSource = new EventSource(`/api/sync-progress/${user.id}`);
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle terminal completion/error events
        if (data.stage === 'complete') {
          setSyncingAccountId(null);
          queryClient.invalidateQueries({ queryKey: ['/api/email-accounts'] });
          queryClient.invalidateQueries({ queryKey: ['/api/subscriptions'] });
          toast({
            title: "Sync Complete",
            description: data.message || "Email sync completed successfully.",
          });
        } else if (data.stage === 'error') {
          setSyncingAccountId(null);
          toast({
            title: "Sync Error",
            description: data.message || "An error occurred during sync.",
            variant: "destructive",
          });
        } else if (data.stage === 'account_complete') {
          // Per-account completion - show progress but don't close
          toast({
            title: "Account Synced",
            description: data.message,
          });
        } else if (data.stage === 'account_error') {
          // Per-account error - show notification but continue batch
          toast({
            title: "Account Sync Failed",
            description: data.message,
            variant: "destructive",
          });
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
  }, [user?.id, toast]);

  const updateNameMutation = useMutation({
    mutationFn: async ({ accountId, accountName }: { accountId: string; accountName: string }) => {
      const response = await apiRequest(`/api/email-accounts/${accountId}/name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountName }),
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/email-accounts'] });
      toast({
        title: "Updated",
        description: "Account name updated successfully.",
      });
      setEditingAccountId(null);
      setEditedName("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update account name. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleDelete = (accountId: string) => {
    setAccountToDelete(accountId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (accountToDelete) {
      deleteMutation.mutate(accountToDelete);
    }
  };

  const startEditing = (account: EmailAccount) => {
    setEditingAccountId(account.id);
    setEditedName(account.accountName);
  };

  const cancelEditing = () => {
    setEditingAccountId(null);
    setEditedName("");
  };

  const saveEdit = (accountId: string) => {
    if (editedName.trim()) {
      updateNameMutation.mutate({ accountId, accountName: editedName.trim() });
    }
  };

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'gmail':
        return <SiGmail className="h-5 w-5 text-red-600 dark:text-red-400" />;
      case 'outlook':
        return <Mail className="h-5 w-5 text-blue-600 dark:text-blue-400" />;
      default:
        return <Mail className="h-5 w-5" />;
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return `${Math.floor(diffMins / 1440)}d ago`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400 dark:text-gray-500" />
      </div>
    );
  }

  const gmailConnected = accounts?.some(a => a.provider === 'gmail' && a.isActive) || false;
  const outlookConnected = accounts?.some(a => a.provider === 'outlook' && a.isActive) || false;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto py-8 px-4 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Email Accounts</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Connect and manage your email accounts for subscription tracking
          </p>
        </div>

        {/* Connect New Account Section */}
        <Card className="mb-8 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
          <CardHeader>
            <CardTitle className="text-gray-900 dark:text-white">Connect New Account</CardTitle>
            <CardDescription className="text-gray-600 dark:text-gray-400">
              Add email accounts to track subscriptions across multiple inboxes
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <Button
              onClick={() => {
                console.log('🔴 Gmail button clicked! Pending:', connectGmailMutation.isPending, 'Connected:', gmailConnected);
                connectGmailMutation.mutate();
              }}
              disabled={connectGmailMutation.isPending || gmailConnected}
              className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white"
              data-testid="button-connect-gmail"
            >
              {connectGmailMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <SiGmail className="mr-2 h-4 w-4" />
              )}
              {gmailConnected ? 'Gmail Connected' : 'Connect Gmail'}
            </Button>

            <Button
              onClick={() => connectOutlookMutation.mutate()}
              disabled={connectOutlookMutation.isPending || outlookConnected}
              className="bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-500 text-white"
              data-testid="button-connect-outlook"
            >
              {connectOutlookMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Mail className="mr-2 h-4 w-4" />
              )}
              {outlookConnected ? 'Outlook Connected' : 'Connect Outlook'}
            </Button>
          </CardContent>
        </Card>

        {/* Sync All Button */}
        {accounts && accounts.length > 0 && (
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Connected Accounts</h2>
            <Button
              onClick={() => syncAllMutation.mutate()}
              disabled={syncAllMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white"
              data-testid="button-sync-all"
            >
              {syncAllMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Sync All Accounts
            </Button>
          </div>
        )}

        {/* Connected Accounts List */}
        <div className="space-y-4">
          {!accounts || accounts.length === 0 ? (
            <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
              <CardContent className="py-12 text-center">
                <Mail className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500 mb-4" />
                <p className="text-gray-600 dark:text-gray-400">No email accounts connected yet</p>
                <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
                  Connect your first account to start tracking subscriptions
                </p>
              </CardContent>
            </Card>
          ) : (
            accounts.map((account) => (
              <Card 
                key={account.id} 
                className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                data-testid={`card-account-${account.id}`}
              >
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-4 flex-1">
                      <div className="mt-1">{getProviderIcon(account.provider)}</div>
                      <div className="flex-1 min-w-0">
                        {editingAccountId === account.id ? (
                          <div className="flex items-center space-x-2 mb-2">
                            <Input
                              value={editedName}
                              onChange={(e) => setEditedName(e.target.value)}
                              className="max-w-xs bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                              autoFocus
                              data-testid={`input-edit-name-${account.id}`}
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => saveEdit(account.id)}
                              disabled={updateNameMutation.isPending}
                              className="hover:bg-gray-100 dark:hover:bg-gray-700"
                              data-testid={`button-save-name-${account.id}`}
                            >
                              <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={cancelEditing}
                              className="hover:bg-gray-100 dark:hover:bg-gray-700"
                              data-testid={`button-cancel-edit-${account.id}`}
                            >
                              <X className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-2 mb-1">
                            <h3 className="font-semibold text-gray-900 dark:text-white" data-testid={`text-account-name-${account.id}`}>
                              {account.accountName}
                            </h3>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => startEditing(account)}
                              className="h-6 w-6 hover:bg-gray-100 dark:hover:bg-gray-700"
                              data-testid={`button-edit-name-${account.id}`}
                            >
                              <Edit2 className="h-3 w-3 text-gray-500 dark:text-gray-400" />
                            </Button>
                          </div>
                        )}
                        <p className="text-sm text-gray-600 dark:text-gray-400" data-testid={`text-account-email-${account.id}`}>
                          {account.email}
                        </p>
                        <div className="flex items-center space-x-3 mt-2">
                          <Badge 
                            variant={account.isActive ? "default" : "secondary"}
                            className={account.isActive 
                              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" 
                              : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                            }
                            data-testid={`badge-status-${account.id}`}
                          >
                            {account.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                          <span className="text-sm text-gray-500 dark:text-gray-500" data-testid={`text-last-sync-${account.id}`}>
                            Last sync: {formatDate(account.lastSync)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 ml-4">
                      {account.isActive && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => syncAccountMutation.mutate(account.id)}
                            disabled={syncAccountMutation.isPending || syncingAccountId === account.id}
                            className="border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                            data-testid={`button-sync-${account.id}`}
                          >
                            {syncingAccountId === account.id ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="mr-2 h-4 w-4" />
                            )}
                            Sync
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => disconnectMutation.mutate(account.id)}
                            disabled={disconnectMutation.isPending}
                            className="border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                            data-testid={`button-disconnect-${account.id}`}
                          >
                            Disconnect
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(account.id)}
                        disabled={deleteMutation.isPending}
                        className="hover:bg-red-50 dark:hover:bg-red-900/20"
                        data-testid={`button-delete-${account.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-gray-900 dark:text-white">Delete Email Account</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-600 dark:text-gray-400">
              Are you sure you want to delete this email account? This will also remove all associated
              subscriptions and emails. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel 
              className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-600"
              data-testid="button-cancel-delete"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 text-white"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
