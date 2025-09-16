import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import Subscriptions from "@/pages/subscriptions";
import Emails from "@/pages/emails";
import Settings from "@/pages/settings";
import AuthCallback from "@/pages/auth";
import { SuggestionsPage } from "@/pages/suggestions";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/subscriptions" component={Subscriptions} />
      <Route path="/emails" component={Emails} />
      <Route path="/settings" component={Settings} />
      <Route path="/auth/callback" component={AuthCallback} />
      <Route path="/suggestions">
        {() => {
          // Get userId from localStorage or use demo user
          const userId = localStorage.getItem('currentUserId') || 'demo-user';
          return <SuggestionsPage userId={userId} />;
        }}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
