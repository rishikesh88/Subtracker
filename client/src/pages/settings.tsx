import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation } from "@tanstack/react-query";
import { User, LogOut, Mail, Unlink, Calendar, Save } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SafeUser } from "@shared/schema";
import { useState, useEffect } from "react";

export default function Settings() {
  const { data: user } = useQuery<SafeUser>({ 
    queryKey: ['/api/auth/user']
  });
  
  const { toast } = useToast();
  const [emailSyncDays, setEmailSyncDays] = useState<number>(90);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Initialize emailSyncDays from user data
  useEffect(() => {
    if (user?.emailSyncDays) {
      setEmailSyncDays(user.emailSyncDays);
    }
  }, [user]);

  // Gmail disconnect mutation
  const disconnectGmailMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/auth/google/disconnect');
      return response.json();
    },
    onSuccess: () => {
      // Invalidate and refetch user data
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      toast({
        title: "Gmail Disconnected",
        description: "Your Gmail account has been successfully disconnected.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Disconnect Failed",
        description: error?.message || "Failed to disconnect Gmail. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Gmail connect mutation
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

  const handleDisconnectGmail = () => {
    disconnectGmailMutation.mutate();
  };

  const handleConnectGmail = () => {
    connectGmailMutation.mutate();
  };

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
        description: "Your preferences have been updated successfully.",
      });
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
            <CardTitle>Gmail Connection</CardTitle>
            <CardDescription>
              Manage your Gmail integration for subscription tracking
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Mail className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">Gmail Account</p>
                  <p className="text-sm text-muted-foreground" data-testid="gmail-email-display">
                    {user?.gmailConnected 
                      ? (user?.gmailEmail || 'Connected')
                      : 'Not connected'
                    }
                  </p>
                  {user?.lastSync && (
                    <p className="text-xs text-muted-foreground">
                      Last sync: {new Date(user.lastSync).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
              <Badge variant={user?.gmailConnected ? "default" : "secondary"} data-testid="gmail-connection-status">
                {user?.gmailConnected ? "Connected" : "Disconnected"}
              </Badge>
            </div>
            
            <div className="flex items-center gap-2">
              {user?.gmailConnected ? (
                <>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleConnectGmail}
                    disabled={connectGmailMutation.isPending}
                    data-testid="reconnect-gmail-button"
                  >
                    {connectGmailMutation.isPending ? "Connecting..." : "Connect Different Account"}
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleDisconnectGmail}
                    disabled={disconnectGmailMutation.isPending}
                    className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950"
                    data-testid="disconnect-gmail-button"
                  >
                    <Unlink className="mr-2 h-4 w-4" />
                    {disconnectGmailMutation.isPending ? "Disconnecting..." : "Disconnect"}
                  </Button>
                </>
              ) : (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleConnectGmail}
                  disabled={connectGmailMutation.isPending}
                  data-testid="connect-gmail-button"
                >
                  <Mail className="mr-2 h-4 w-4" />
                  {connectGmailMutation.isPending ? "Connecting..." : "Connect Gmail"}
                </Button>
              )}
            </div>
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