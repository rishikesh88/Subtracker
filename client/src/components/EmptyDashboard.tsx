import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Link } from "wouter";
import { Mail, RefreshCw, ListChecks, Inbox, CheckCircle2 } from "lucide-react";

interface EmptyDashboardProps {
  variant: "no-accounts" | "no-sync" | "no-subscriptions";
  onboardingProgress?: number;
  hasConnectedAccounts?: boolean;
  hasSyncedEmails?: boolean;
}

export function EmptyDashboard({ 
  variant, 
  onboardingProgress = 0,
  hasConnectedAccounts = false,
  hasSyncedEmails = false
}: EmptyDashboardProps) {
  const getContent = () => {
    switch (variant) {
      case "no-accounts":
        return {
          icon: <Mail className="h-16 w-16 text-muted-foreground/40" />,
          title: "Welcome to SubTracker",
          description: "Connect your email accounts to start tracking subscriptions automatically",
          cta: (
            <Link href="/onboarding/connect">
              <Button size="lg" className="gap-2" data-testid="button-connect-email">
                <Mail className="h-5 w-5" />
                Connect Email Account
              </Button>
            </Link>
          ),
        };
      
      case "no-sync":
        return {
          icon: <RefreshCw className="h-16 w-16 text-muted-foreground/40" />,
          title: "Ready to Sync Emails",
          description: "Run your first sync to analyze emails and detect subscriptions",
          cta: (
            <Button size="lg" className="gap-2" data-testid="button-run-sync">
              <RefreshCw className="h-5 w-5" />
              Run First Sync
            </Button>
          ),
        };
      
      case "no-subscriptions":
        return {
          icon: <ListChecks className="h-16 w-16 text-muted-foreground/40" />,
          title: "No Active Subscriptions",
          description: "Review AI suggestions or sync more emails to discover subscriptions",
          cta: (
            <div className="flex flex-col sm:flex-row gap-3">
              <Link href="/suggestions">
                <Button size="lg" variant="default" className="gap-2" data-testid="button-view-suggestions">
                  <ListChecks className="h-5 w-5" />
                  View Suggestions
                </Button>
              </Link>
              <Button size="lg" variant="outline" className="gap-2" data-testid="button-sync-more">
                <RefreshCw className="h-5 w-5" />
                Sync More Emails
              </Button>
            </div>
          ),
        };
    }
  };

  const content = getContent();
  const showProgress = onboardingProgress > 0 && onboardingProgress < 100;

  return (
    <div className="flex items-center justify-center min-h-[500px] p-6">
      <Card className="max-w-2xl w-full border-dashed">
        <CardContent className="pt-12 pb-12 px-6 text-center">
          {/* Icon/Illustration */}
          <div className="flex justify-center mb-6">
            <div className="p-4 bg-muted/50 rounded-full">
              {content.icon}
            </div>
          </div>

          {/* Title & Description */}
          <h2 className="text-2xl font-semibold mb-3 text-foreground" data-testid="empty-state-title">
            {content.title}
          </h2>
          <p className="text-muted-foreground mb-8 max-w-md mx-auto" data-testid="empty-state-description">
            {content.description}
          </p>

          {/* Onboarding Progress Indicator */}
          {showProgress && (
            <div className="mb-8 max-w-md mx-auto">
              <div className="flex items-center justify-between mb-2 text-sm text-muted-foreground">
                <span>Onboarding Progress</span>
                <span className="font-medium">{onboardingProgress}%</span>
              </div>
              <Progress value={onboardingProgress} className="h-2" data-testid="onboarding-progress" />
              
              {/* Step Indicators */}
              <div className="grid grid-cols-3 gap-2 mt-4 text-xs">
                <div className={`flex flex-col items-center gap-1 ${hasConnectedAccounts ? 'text-green-600' : 'text-muted-foreground'}`}>
                  {hasConnectedAccounts ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Inbox className="h-4 w-4" />
                  )}
                  <span>Connect Email</span>
                </div>
                <div className={`flex flex-col items-center gap-1 ${hasSyncedEmails ? 'text-green-600' : 'text-muted-foreground'}`}>
                  {hasSyncedEmails ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  <span>Sync Emails</span>
                </div>
                <div className={`flex flex-col items-center gap-1 text-muted-foreground`}>
                  <ListChecks className="h-4 w-4" />
                  <span>Review Subs</span>
                </div>
              </div>
            </div>
          )}

          {/* CTA Buttons */}
          <div className="flex justify-center">
            {content.cta}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
