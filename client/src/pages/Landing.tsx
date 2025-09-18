import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2 } from "lucide-react";

export function Landing() {
  // Check for signed-out feedback
  const urlParams = new URLSearchParams(window.location.search);
  const isSignedOut = urlParams.get('signed_out') === 'true';
  
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl mx-auto text-center space-y-8">
        {isSignedOut && (
          <Alert className="border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200" data-testid="signed-out-alert">
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              You've been successfully signed out. You can now sign in with a different account.
            </AlertDescription>
          </Alert>
        )}
        <div className="space-y-4">
          <h1 className="text-4xl font-bold text-foreground" data-testid="landing-title">
            SubTracker
          </h1>
          <p className="text-xl text-muted-foreground" data-testid="landing-description">
            Automatically detect and track your subscriptions from Gmail emails using AI-powered analysis.
          </p>
        </div>
        
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            <div className="space-y-2">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                <span className="text-2xl">📧</span>
              </div>
              <h3 className="font-semibold text-foreground">Gmail Integration</h3>
              <p className="text-sm text-muted-foreground">Connect securely to analyze your transaction emails</p>
            </div>
            
            <div className="space-y-2">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                <span className="text-2xl">🤖</span>
              </div>
              <h3 className="font-semibold text-foreground">AI Detection</h3>
              <p className="text-sm text-muted-foreground">Smart AI identifies recurring subscription patterns</p>
            </div>
            
            <div className="space-y-2">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                <span className="text-2xl">💰</span>
              </div>
              <h3 className="font-semibold text-foreground">Cost Tracking</h3>
              <p className="text-sm text-muted-foreground">Monitor your monthly subscription expenses in ₹</p>
            </div>
          </div>
          
          <Button 
            size="lg"
            onClick={() => window.location.href = '/api/login'}
            data-testid="login-button"
            className="px-8 py-3"
          >
            {isSignedOut ? 'Sign In with Different Account' : 'Get Started - Sign In'}
          </Button>
          
          <p className="text-sm text-muted-foreground">
            Sign in with Google, GitHub, or email to start tracking your subscriptions
          </p>
        </div>
      </div>
    </div>
  );
}