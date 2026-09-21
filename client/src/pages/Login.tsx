import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AlertCircle } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { FaMicrosoft } from "react-icons/fa";

/**
 * Which sign-in methods this server can actually perform.
 *
 * A provider with no credentials was offered anyway: the button took the
 * person to Microsoft or Google, failed, and returned them here to a red
 * error. An option that cannot work is not shown at all.
 */
function useAuthProviders() {
  const { data } = useQuery<{ google: boolean; microsoft: boolean; replit: boolean }>({
    queryKey: ["/api/auth/providers"],
  });
  return data;
}

export default function Login() {
  const providers = useAuthProviders();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parse error from URL if present
  const urlParams = new URLSearchParams(window.location.search);
  const urlError = urlParams.get('error');

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiRequest("POST", "/api/auth/login", {
        email,
        password,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Login failed");
      }

      const user = await response.json();

      // Invalidate auth query to refresh user data
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });

      toast({
        title: "Login Successful",
        description: `Welcome back, ${user.firstName || user.email}!`,
      });

      // Redirect based on onboarding status
      if (user.onboardingStatus === 'pending') {
        setLocation('/onboarding/org-setup');
      } else if (user.onboardingStatus === 'org_complete') {
        setLocation('/onboarding/connect');
      } else {
        setLocation('/dashboard');
      }
    } catch (err: any) {
      setError(err.message || "Failed to log in");
      toast({
        title: "Login Failed",
        description: err.message || "Invalid email or password",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = '/api/auth/google-login';
  };

  const handleMicrosoftLogin = () => {
    window.location.href = '/api/auth/microsoft-login';
  };

  const handleReplitLogin = () => {
    window.location.href = '/api/login';
  };

  const getErrorMessage = (errorCode: string | null) => {
    if (!errorCode) return null;

    const errorMessages: Record<string, string> = {
      'google_auth_failed': 'Google authentication failed. Please try again.',
      'microsoft_auth_init_failed': 'Microsoft authentication failed to initialize.',
      'microsoft_auth_failed': 'Microsoft authentication failed. Please try again.',
      'no_user_id': 'Authentication failed: No user ID found.',
      'user_not_found': 'User account not found.',
      'callback_failed': 'Authentication callback failed.',
      'no_auth_code': 'Missing authorization code.',
      'invalid_state': 'Invalid authentication state. Please try again.',
      'session_failed': 'Failed to create session. Please try again.',
    };

    return errorMessages[errorCode] || 'An authentication error occurred. Please try again.';
  };

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="max-w-[400px] w-full">
        <div className="flex items-center justify-center gap-2.5 mb-5">
          <span className="w-[22px] h-[22px] flex-none rounded-logo bg-accent" aria-hidden="true" />
          <span className="font-serif text-[21px] leading-none tracking-[-0.02em] text-ink">Verloq</span>
        </div>
        <div className="max-w-[400px] w-full surface-card" style={{ padding: "24px" }}>

        <div className="flex flex-col gap-1 mb-5 text-center">
          <h1 className="t-section text-ink" data-testid="login-title">
            Welcome back
          </h1>
          <p className="t-body text-muted-foreground">
            Sign in to your Verloq account
          </p>
        </div>

        {(error || urlError) && (
          <div
            className="flex items-start gap-2 rounded-card border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 mb-4"
            data-testid="login-error"
          >
            <AlertCircle size={15} strokeWidth={2} className="text-destructive flex-none mt-0.5" />
            <p className="t-body text-destructive">
              {getErrorMessage(urlError) || error}
            </p>
          </div>
        )}

        {/* OAuth Buttons */}
        <div className="flex flex-col gap-2 mb-4">
          {providers?.google && (
            <button
              type="button"
              onClick={handleGoogleLogin}
              className="btn-base btn-secondary w-full"
              data-testid="button-google-login"
            >
              <FcGoogle className="h-4 w-4" />
              Sign in with Google
            </button>
          )}

          {providers?.microsoft && (
            <button
              type="button"
              onClick={handleMicrosoftLogin}
              className="btn-base btn-secondary w-full"
              data-testid="button-microsoft-login"
            >
              <FaMicrosoft className="h-4 w-4 text-blue-600" />
              Sign in with Microsoft
            </button>
          )}

          {providers?.replit && (
            <button
              type="button"
              onClick={handleReplitLogin}
              className="btn-base btn-secondary w-full"
              data-testid="button-replit-login"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21.3 17.5c0 1-.8 1.8-1.8 1.8h-6.2c-.5 0-.9-.4-.9-.9v-6.2c0-.5.4-.9.9-.9h6.2c1 0 1.8.8 1.8 1.8v4.4zm-9 1.8H5.7c-1 0-1.8-.8-1.8-1.8V13c0-1 .8-1.8 1.8-1.8h6.2c.5 0 .9.4.9.9v6.3c0 .5-.4.9-.9.9zm9-12.8c0 1-.8 1.8-1.8 1.8h-6.2c-.5 0-.9-.4-.9-.9V1.2c0-.5.4-.9.9-.9h6.2c1 0 1.8.8 1.8 1.8v4.4z"/>
              </svg>
              Sign in with Replit
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 mb-4">
          <span className="flex-1 border-t border-line" />
          <span className="t-caption">Or continue with email</span>
          <span className="flex-1 border-t border-line" />
        </div>

        {/* Email/Password Form */}
        <form onSubmit={handleEmailLogin} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="t-label">Email</label>
            <div className="field">
              <input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="input-email"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="t-label">Password</label>
            <div className="field">
              <input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="input-password"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="btn-base btn-accent w-full mt-1"
            data-testid="button-email-login"
          >
            {isLoading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="t-caption text-center mt-4">
          Don't have an account?{" "}
          <button
            onClick={() => setLocation('/signup')}
            className="text-accent hover:underline font-medium"
            data-testid="link-signup"
          >
            Sign up
          </button>
        </p>
        </div>
      </div>
    </div>
  );
}
