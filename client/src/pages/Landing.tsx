import { Button } from "@/components/ui/button";

export function Landing() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl mx-auto text-center space-y-8">
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
            Get Started - Sign In
          </Button>
          
          <p className="text-sm text-muted-foreground">
            Sign in with Google, GitHub, or email to start tracking your subscriptions
          </p>
        </div>
      </div>
    </div>
  );
}