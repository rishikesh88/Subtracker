import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AlertCircle } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { FaMicrosoft } from "react-icons/fa";
import { Logo } from "@/components/Logo";

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

export default function Signup() {
  const providers = useAuthProviders();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parse error from URL if present
  const urlParams = new URLSearchParams(window.location.search);
  const urlError = urlParams.get('error');

  const handleEmailSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiRequest("POST", "/api/auth/signup", {
        email,
        password,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Signup failed");
      }

      const user = await response.json();

      // Refetch auth query to get fresh user data (with session cookie)
      await queryClient.refetchQueries({ queryKey: ['/api/auth/user'] });

      toast({
        title: "Account Created",
        description: "Please verify your email to continue. Check your inbox for the verification code.",
      });

      // Redirect to email verification (required before onboarding)
      setLocation('/verify-email');
    } catch (err: any) {
      setError(err.message || "Failed to create account");
      toast({
        title: "Signup Failed",
        description: err.message || "Failed to create account",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignup = () => {
    window.location.href = '/api/auth/google-login';
  };

  const handleMicrosoftSignup = () => {
    window.location.href = '/api/auth/microsoft-login';
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
          <Logo />
          <span className="font-serif text-[21px] leading-none tracking-[-0.02em] text-ink">Verloq</span>
        </div>
        <div className="max-w-[400px] w-full surface-card" style={{ padding: "24px" }}>

        <div className="flex flex-col gap-1 mb-5 text-center">
          <h1 className="t-section text-ink" data-testid="signup-title">
            Create your account
          </h1>
          <p className="t-body text-muted-foreground">
            Start tracking your subscriptions in minutes
          </p>
        </div>

        {(error || urlError) && (
          <div
            className="flex items-start gap-2 rounded-card border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 mb-4"
            data-testid="signup-error"
          >
            <AlertCircle size={15} strokeWidth={2} className="text-destructive flex-none mt-0.5" />
            <p className="t-body text-destructive">
              {getErrorMessage(urlError) || error}
            </p>
          </div>
        )}

        {/* OAuth Buttons - No Replit for Signup */}
        <div className="flex flex-col gap-2 mb-4">
          {providers?.google && (
            <button
              type="button"
              onClick={handleGoogleSignup}
              className="btn-base btn-secondary w-full"
              data-testid="button-google-signup"
            >
              <FcGoogle className="h-4 w-4" />
              Sign up with Google
            </button>
          )}

          {providers?.microsoft && (
            <button
              type="button"
              onClick={handleMicrosoftSignup}
              className="btn-base btn-secondary w-full"
              data-testid="button-microsoft-signup"
            >
              <FaMicrosoft className="h-4 w-4 text-blue-600" />
              Sign up with Microsoft
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 mb-4">
          <span className="flex-1 border-t border-line" />
          <span className="t-caption">Or create account with email</span>
          <span className="flex-1 border-t border-line" />
        </div>

        {/* Email/Password Form */}
        <form onSubmit={handleEmailSignup} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="firstName" className="t-label">First name</label>
              <div className="field">
                <input
                  id="firstName"
                  type="text"
                  placeholder="John"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  data-testid="input-firstName"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="lastName" className="t-label">Last name</label>
              <div className="field">
                <input
                  id="lastName"
                  type="text"
                  placeholder="Doe"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  data-testid="input-lastName"
                />
              </div>
            </div>
          </div>

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
                minLength={6}
                data-testid="input-password"
              />
            </div>
            <p className="t-caption">
              At least 6 characters
            </p>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="btn-base btn-accent w-full mt-1"
            data-testid="button-email-signup"
          >
            {isLoading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="t-caption text-center mt-4">
          Already have an account?{" "}
          <button
            onClick={() => setLocation('/login')}
            className="text-accent hover:underline font-medium"
            data-testid="link-login"
          >
            Sign in
          </button>
        </p>
        </div>
      </div>
    </div>
  );
}
