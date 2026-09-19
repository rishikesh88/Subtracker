import { CheckCircle2, Mail, Bot, Wallet } from "lucide-react";

export function Landing() {
  // Check for signed-out feedback
  const urlParams = new URLSearchParams(window.location.search);
  const isSignedOut = urlParams.get('signed_out') === 'true';

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-4 py-8">
      <div className="max-w-2xl mx-auto text-center flex flex-col gap-8">
        {isSignedOut && (
          <div
            className="flex items-center gap-2 rounded-card border border-success/20 bg-success-soft px-4 py-3"
            data-testid="signed-out-alert"
          >
            <CheckCircle2 size={17} strokeWidth={2} className="text-success flex-none" />
            <p className="t-body text-success text-left">
              You've been successfully signed out. You can now sign in with a different account.
            </p>
          </div>
        )}
        <div className="flex flex-col gap-4">
          <h1 className="t-display text-ink" data-testid="landing-title">
            Verloq
          </h1>
          <p className="t-body text-muted-foreground text-lg" data-testid="landing-description">
            Automatically detect and track your subscriptions from Gmail emails using AI-powered analysis.
          </p>
        </div>

        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            <div className="flex flex-col gap-2">
              <div className="w-11 h-11 rounded-lg bg-line-soft flex items-center justify-center">
                <Mail size={17} strokeWidth={2} className="text-muted-foreground" />
              </div>
              <h3 className="t-card-title text-ink">Gmail integration</h3>
              <p className="t-body text-muted-foreground">Connect securely to analyze your transaction emails</p>
            </div>

            <div className="flex flex-col gap-2">
              <div className="w-11 h-11 rounded-lg bg-line-soft flex items-center justify-center">
                <Bot size={17} strokeWidth={2} className="text-muted-foreground" />
              </div>
              <h3 className="t-card-title text-ink">AI detection</h3>
              <p className="t-body text-muted-foreground">Smart AI identifies recurring subscription patterns</p>
            </div>

            <div className="flex flex-col gap-2">
              <div className="w-11 h-11 rounded-lg bg-line-soft flex items-center justify-center">
                <Wallet size={17} strokeWidth={2} className="text-muted-foreground" />
              </div>
              <h3 className="t-card-title text-ink">Cost tracking</h3>
              <p className="t-body text-muted-foreground">Monitor your monthly subscription expenses in ₹</p>
            </div>
          </div>

          <button
            onClick={() => window.location.href = '/login'}
            data-testid="login-button"
            className="btn-base btn-accent self-center px-8 h-10 text-[13.5px]"
          >
            {isSignedOut ? 'Sign in with a different account' : 'Get started'}
          </button>

          <p className="t-caption">
            Sign in with Google, Microsoft, Replit, or create an account to start tracking your subscriptions
          </p>
        </div>
      </div>
    </div>
  );
}
