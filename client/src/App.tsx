import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { Layout } from "@/components/Layout";
import { SyncProgressPanel } from "@/components/SyncProgressPanel";
import Dashboard from "@/pages/dashboard";
import Subscriptions from "@/pages/subscriptions";
import SubscriptionDetail from "@/pages/subscription-detail";
import Settings from "@/pages/settings";
import { Landing } from "@/pages/Landing";
import AuthCallback from "@/pages/auth";
import NotFound from "@/pages/not-found";
import OrgSetup from "@/pages/onboarding/OrgSetup";
import Connect from "@/pages/onboarding/Connect";

function Router() {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Check if user needs onboarding (pending or org_complete)
  const needsOnboarding = isAuthenticated && (user?.onboardingStatus === 'pending' || user?.onboardingStatus === 'org_complete');

  return (
    <Switch>
      {/* Auth callback - available for both authenticated and unauthenticated users */}
      <Route path="/auth/callback" component={AuthCallback} />
      
      {!isAuthenticated ? (
        <>
          <Route path="/" component={Landing} />
          {/* Redirect protected routes to landing when not authenticated */}
          <Route path="/dashboard" component={() => { window.location.href = '/'; return null; }} />
          <Route path="/subscriptions" component={() => { window.location.href = '/'; return null; }} />
          <Route path="/settings" component={() => { window.location.href = '/'; return null; }} />
          <Route path="/onboarding/*" component={() => { window.location.href = '/'; return null; }} />
        </>
      ) : needsOnboarding ? (
        <>
          {/* Onboarding flow for new users */}
          <Route path="/onboarding/org-setup" component={OrgSetup} />
          <Route path="/onboarding/connect" component={Connect} />
          {/* Redirect any other routes to onboarding start */}
          <Route path="*" component={() => { window.location.href = '/onboarding/org-setup'; return null; }} />
        </>
      ) : (
        <>
          {/* Main app for users who completed onboarding */}
          <Route path="/" component={() => <Layout><Dashboard /></Layout>} />
          <Route path="/dashboard" component={() => <Layout><Dashboard /></Layout>} />
          <Route path="/subscriptions" component={() => <Layout><Subscriptions /></Layout>} />
          <Route path="/subscriptions/:id" component={() => <Layout><SubscriptionDetail /></Layout>} />
          <Route path="/settings" component={() => <Layout><Settings /></Layout>} />
          {/* Redirect onboarding routes to dashboard for completed users */}
          <Route path="/onboarding/*" component={() => { window.location.href = '/dashboard'; return null; }} />
        </>
      )}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <SyncProgressPanel />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
