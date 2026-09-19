import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Mail, Shield, Database, Lock, ChevronRight } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

const BACKFILL_OPTIONS = [
  { days: 7, label: "7 days" },
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
      const response = await apiRequest("POST", "/api/onboarding/connect", {
        provider: selectedProvider,
        emailSyncDays: backfillDays,
        privacyConsentGiven: true,
      });

      const data = await response.json();

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
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="surface-card w-full max-w-[520px]" style={{ padding: "24px" }} data-testid="connect-page">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 flex-none rounded-logo bg-accent-soft flex items-center justify-center">
            <Mail size={17} strokeWidth={2} className="text-accent" />
          </span>
          <h1 className="t-section">Connect Your Email</h1>
        </div>
        <p className="t-body text-ink-body mt-2 mb-6">
          Connect your email accounts to automatically detect subscriptions
        </p>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => handleConnectClick('gmail')}
            data-testid="button-connect-gmail"
            className="btn-base btn-secondary w-full h-11 justify-between px-4"
          >
            <span className="flex items-center gap-2.5">
              <SiGoogle size={15} className="text-muted-foreground" />
              Connect Gmail
            </span>
            <ChevronRight size={15} strokeWidth={2} className="text-muted-foreground" />
          </button>

          <button
            type="button"
            onClick={() => handleConnectClick('outlook')}
            data-testid="button-connect-outlook"
            className="btn-base btn-secondary w-full h-11 justify-between px-4"
          >
            <span className="flex items-center gap-2.5">
              <Mail size={15} strokeWidth={2} className="text-muted-foreground" />
              Connect Outlook
            </span>
            <ChevronRight size={15} strokeWidth={2} className="text-muted-foreground" />
          </button>
        </div>

        <div className="relative my-5">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-line-soft" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-surface px-2 t-caption">Or</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSkip}
          data-testid="button-skip"
          className="btn-base btn-ghost w-full justify-center"
        >
          Skip for now
        </button>
      </div>

      {/* Privacy Modal with Backfill Selector */}
      <Dialog open={showPrivacyModal} onOpenChange={setShowPrivacyModal}>
        <DialogContent
          className="w-[calc(100%-32px)] max-w-[560px] max-h-[85vh] overflow-y-auto rounded-shell sm:rounded-shell border-line bg-surface"
          data-testid="modal-privacy"
        >
          <DialogHeader>
            <DialogTitle className="t-section flex items-center gap-2">
              <Shield size={17} strokeWidth={2} className="text-accent" />
              Privacy & Data Access
            </DialogTitle>
            <DialogDescription className="t-body text-ink-body mt-1">
              Exactly what Verloq reads, what it cannot do, and what happens when you disconnect.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5 py-2">
            {/* Privacy Guarantees */}
            <div className="flex flex-col gap-3.5">
              <div className="flex gap-3">
                <div className="w-9 h-9 flex-none rounded-logo bg-line-soft flex items-center justify-center">
                  <Database size={17} strokeWidth={2} className="text-muted-foreground" />
                </div>
                <div>
                  <h4 className="t-card-title">What Verloq reads</h4>
                  <p className="t-body text-ink-body mt-0.5">
                    It scans message headers (subject, sender and date) across the window you pick,
                    then opens only the messages that look like receipts. Those it reads in full,
                    including any attached invoice, and sends to Google's Gemini API to pull out the
                    service, amount and date. The rest of your mail is never opened.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="w-9 h-9 flex-none rounded-logo bg-line-soft flex items-center justify-center">
                  <Shield size={17} strokeWidth={2} className="text-muted-foreground" />
                </div>
                <div>
                  <h4 className="t-card-title">Read-Only Access</h4>
                  <p className="t-body text-ink-body mt-0.5">
                    We can't send, delete, or modify your emails. Your inbox stays exactly as it is.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="w-9 h-9 flex-none rounded-logo bg-line-soft flex items-center justify-center">
                  <Lock size={17} strokeWidth={2} className="text-muted-foreground" />
                </div>
                <div>
                  <h4 className="t-card-title">Disconnect anytime</h4>
                  <p className="t-body text-ink-body mt-0.5">
                    Disconnecting deletes the tokens Verloq holds and asks Google to revoke the
                    permission, so it stops reading your mailbox and drops off your account
                    permissions. Subscriptions it already found stay until you clear them. You can
                    also remove the permission yourself at{" "}
                    <a
                      href="https://myaccount.google.com/permissions"
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2 text-accent"
                    >
                      myaccount.google.com/permissions
                    </a>
                    .
                  </p>
                </div>
              </div>
            </div>

            {/* Backfill Window Selector */}
            <div className="border-t border-line-soft pt-5">
              <h4 className="t-label">Scan History</h4>
              <p className="t-caption mt-1 mb-3.5">
                Choose how far back we should scan for subscriptions
              </p>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-1 flex-wrap px-1">
                  {BACKFILL_OPTIONS.map((option) => (
                    <button
                      key={option.days}
                      type="button"
                      onClick={() => setBackfillDays(option.days)}
                      className={cn(
                        "t-caption px-3 py-1 rounded-full transition-colors",
                        backfillDays === option.days
                          ? "bg-primary text-primary-foreground font-medium"
                          : "text-muted-foreground hover:text-ink"
                      )}
                      data-testid={`button-backfill-${option.days}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <Slider
                  value={[backfillDays]}
                  onValueChange={(values) => setBackfillDays(values[0])}
                  min={7}
                  max={180}
                  step={selectedProvider === 'gmail' ? 1 : 30}
                  className="w-full"
                  data-testid="slider-backfill"
                />

                <div className="flex justify-between t-caption px-1">
                  <span>7 days</span>
                  <span className="font-medium text-ink">{backfillDays} days selected</span>
                  <span>180 days</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => setShowPrivacyModal(false)}
              className="btn-base btn-secondary flex-1 justify-center"
              data-testid="button-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePrivacyAccept}
              className="btn-base btn-accent flex-1 justify-center"
              data-testid="button-accept-and-connect"
            >
              Accept and connect
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
