import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { Layout } from "@/components/Layout";
import { SyncExperience } from "@/components/SyncExperience";
import Dashboard from "@/pages/dashboard";
import Settings from "@/pages/settings";
import ReviewInbox from "@/pages/review";
import { Landing } from "@/pages/Landing";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import AuthCallback from "@/pages/auth";
import NotFound from "@/pages/not-found";
import VerifyEmail from "@/pages/VerifyEmail";
import OrgSetup from "@/pages/onboarding/OrgSetup";
import Connect from "@/pages/onboarding/Connect";

const DashboardPage = () => (
  <Layout>
    <Dashboard />
  </Layout>
);

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
          <Route path="/login" component={Login} />
          <Route path="/signup" component={Signup} />
          {/* Redirect protected routes to login when not authenticated */}
          <Route path="/dashboard" component={() => { window.location.href = '/login'; return null; }} />
          <Route path="/subscriptions" component={() => { window.location.href = '/login'; return null; }} />
          <Route path="/settings" component={() => { window.location.href = '/login'; return null; }} />
          <Route path="/onboarding/*" component={() => { window.location.href = '/login'; return null; }} />
          <Route path="/verify-email" component={() => { window.location.href = '/login'; return null; }} />
        </>
      ) : !user?.emailVerified ? (
        <>
          {/* Email verification required before proceeding */}
          <Route path="/verify-email" component={VerifyEmail} />
          <Route path="*" component={() => { window.location.href = '/verify-email'; return null; }} />
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
          {/* One page for all four: the Subscriptions page was folded into the
              dashboard, and /subscriptions/:id opens a subscription's drawer over
              it. The same component each time, so opening a card keeps the
              search and filters as they were. */}
          <Route path="/" component={DashboardPage} />
          <Route path="/dashboard" component={DashboardPage} />
          <Route path="/subscriptions" component={DashboardPage} />
          <Route path="/subscriptions/:id" component={DashboardPage} />
          <Route path="/review" component={() => <Layout><ReviewInbox /></Layout>} />
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
        <SyncExperience />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
