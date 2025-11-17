import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Mail, Shield, Database, Lock, ChevronRight } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { apiRequest } from "@/lib/queryClient";

const BACKFILL_OPTIONS = [
  { days: 30, label: "30 days" },
  { days: 60, label: "60 days" },
  { days: 90, label: "90 days" },
  { days: 180, label: "180 days" },
];

export default function Connect() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<'gmail' | 'outlook' | null>(null);
  const [backfillDays, setBackfillDays] = useState(90);

  const handleConnectClick = (provider: 'gmail' | 'outlook') => {
    console.log('[Event: connect_account_clicked]', { provider });
    setSelectedProvider(provider);
    setShowPrivacyModal(true);
  };

  const handlePrivacyAccept = async () => {
    if (!selectedProvider) return;

    try {
      console.log('[Event: privacy_consent_accepted]', { provider: selectedProvider, backfillDays });
      
      // Call unified endpoint that saves consent and returns OAuth URL
      const data = await apiRequest("POST", "/api/onboarding/connect", {
        provider: selectedProvider,
        emailSyncDays: backfillDays,
        privacyConsentGiven: true,
      });
      
      if (data?.authUrl) {
        // Redirect to OAuth provider
        window.location.href = data.authUrl;
      } else {
        throw new Error("No auth URL received from server");
      }
    } catch (error: any) {
      console.error('Error starting OAuth:', error);
      toast({
        title: "Failed to start OAuth",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleSkip = async () => {
    try {
      console.log('[Event: account_connection_skipped]');
      
      // Mark onboarding as complete even without connecting accounts
      await apiRequest("POST", "/api/onboarding/skip", {});
      
      toast({
        title: "Skipped for now",
        description: "You can connect accounts later from settings",
      });
      
      // Redirect to dashboard
      setLocation("/dashboard");
    } catch (error: any) {
      console.error('Error skipping onboarding:', error);
      toast({
        title: "Failed to skip onboarding",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Mail className="h-5 w-5 text-primary" />
            </div>
            <CardTitle className="text-2xl">Connect Your Email</CardTitle>
          </div>
          <CardDescription>
            Connect your email accounts to automatically detect subscriptions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            className="w-full h-14 text-base"
            variant="outline"
            onClick={() => handleConnectClick('gmail')}
            data-testid="button-connect-gmail"
          >
            <SiGoogle className="mr-2 h-5 w-5" />
            Connect Gmail
            <ChevronRight className="ml-auto h-5 w-5" />
          </Button>

          <Button
            className="w-full h-14 text-base"
            variant="outline"
            onClick={() => handleConnectClick('outlook')}
            data-testid="button-connect-outlook"
          >
            <Mail className="mr-2 h-5 w-5" />
            Connect Outlook
            <ChevronRight className="ml-auto h-5 w-5" />
          </Button>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or</span>
            </div>
          </div>

          <Button
            variant="ghost"
            className="w-full"
            onClick={handleSkip}
            data-testid="button-skip"
          >
            Skip for now
          </Button>
        </CardContent>
      </Card>

      {/* Privacy Modal with Backfill Selector */}
      <Dialog open={showPrivacyModal} onOpenChange={setShowPrivacyModal}>
        <DialogContent className="max-w-2xl" data-testid="modal-privacy">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Shield className="h-5 w-5 text-primary" />
              Privacy & Data Access
            </DialogTitle>
            <DialogDescription className="text-base mt-4">
              We take your privacy seriously. Here's exactly what we access and how we use it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Privacy Guarantees */}
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Database className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <h4 className="font-medium">Metadata Only</h4>
                  <p className="text-sm text-muted-foreground">
                    We only access email subject lines, sender info, and dates. We never read your email content.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                  <Shield className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <h4 className="font-medium">Read-Only Access</h4>
                  <p className="text-sm text-muted-foreground">
                    We can't send, delete, or modify your emails. Your inbox stays exactly as it is.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
                  <Lock className="h-5 w-5 text-purple-500" />
                </div>
                <div>
                  <h4 className="font-medium">Disconnect Anytime</h4>
                  <p className="text-sm text-muted-foreground">
                    You can revoke access instantly from your settings. Your data will be deleted.
                  </p>
                </div>
              </div>
            </div>

            {/* Backfill Window Selector */}
            <div className="border-t pt-6">
              <h4 className="font-medium mb-2">Scan History</h4>
              <p className="text-sm text-muted-foreground mb-4">
                Choose how far back we should scan for subscriptions
              </p>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  {BACKFILL_OPTIONS.map((option) => (
                    <button
                      key={option.days}
                      onClick={() => setBackfillDays(option.days)}
                      className={`text-xs px-3 py-1 rounded-full transition-colors ${
                        backfillDays === option.days
                          ? "bg-primary text-primary-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      data-testid={`button-backfill-${option.days}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <Slider
                  value={[backfillDays]}
                  onValueChange={(values) => setBackfillDays(values[0])}
                  min={30}
                  max={180}
                  step={30}
                  className="w-full"
                  data-testid="slider-backfill"
                />

                <div className="flex justify-between text-xs text-muted-foreground px-1">
                  <span>30 days</span>
                  <span className="font-medium text-foreground">{backfillDays} days selected</span>
                  <span>180 days</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowPrivacyModal(false)}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={handlePrivacyAccept}
              data-testid="button-accept-and-connect"
            >
              Accept & Connect
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
