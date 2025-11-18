import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AlertCircle } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { FaMicrosoft } from "react-icons/fa";

export default function Login() {
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
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center" data-testid="login-title">
            Sign in to SubTracker
          </CardTitle>
          <CardDescription className="text-center">
            Choose your preferred sign-in method
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(error || urlError) && (
            <Alert variant="destructive" data-testid="login-error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {getErrorMessage(urlError) || error}
              </AlertDescription>
            </Alert>
          )}

          {/* OAuth Buttons */}
          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full"
              onClick={handleGoogleLogin}
              type="button"
              data-testid="button-google-login"
            >
              <FcGoogle className="mr-2 h-5 w-5" />
              Sign in with Google
            </Button>

            <Button
              variant="outline"
              className="w-full"
              onClick={handleMicrosoftLogin}
              type="button"
              data-testid="button-microsoft-login"
            >
              <FaMicrosoft className="mr-2 h-4 w-4 text-blue-600" />
              Sign in with Microsoft
            </Button>

            <Button
              variant="outline"
              className="w-full"
              onClick={handleReplitLogin}
              type="button"
              data-testid="button-replit-login"
            >
              <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21.3 17.5c0 1-.8 1.8-1.8 1.8h-6.2c-.5 0-.9-.4-.9-.9v-6.2c0-.5.4-.9.9-.9h6.2c1 0 1.8.8 1.8 1.8v4.4zm-9 1.8H5.7c-1 0-1.8-.8-1.8-1.8V13c0-1 .8-1.8 1.8-1.8h6.2c.5 0 .9.4.9.9v6.3c0 .5-.4.9-.9.9zm9-12.8c0 1-.8 1.8-1.8 1.8h-6.2c-.5 0-.9-.4-.9-.9V1.2c0-.5.4-.9.9-.9h6.2c1 0 1.8.8 1.8 1.8v4.4z"/>
              </svg>
              Sign in with Replit
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or continue with email</span>
            </div>
          </div>

          {/* Email/Password Form */}
          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="input-email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="input-password"
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading}
              data-testid="button-email-login"
            >
              {isLoading ? "Signing in..." : "Sign in with Email"}
            </Button>
          </form>

          <div className="text-center text-sm">
            <span className="text-muted-foreground">Don't have an account? </span>
            <button
              onClick={() => setLocation('/signup')}
              className="text-primary hover:underline font-medium"
              data-testid="link-signup"
            >
              Sign up
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
