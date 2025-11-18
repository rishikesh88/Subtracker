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

export default function Signup() {
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
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center" data-testid="signup-title">
            Create your account
          </CardTitle>
          <CardDescription className="text-center">
            Start tracking your subscriptions in minutes
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(error || urlError) && (
            <Alert variant="destructive" data-testid="signup-error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {getErrorMessage(urlError) || error}
              </AlertDescription>
            </Alert>
          )}

          {/* OAuth Buttons - No Replit for Signup */}
          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full"
              onClick={handleGoogleSignup}
              type="button"
              data-testid="button-google-signup"
            >
              <FcGoogle className="mr-2 h-5 w-5" />
              Sign up with Google
            </Button>

            <Button
              variant="outline"
              className="w-full"
              onClick={handleMicrosoftSignup}
              type="button"
              data-testid="button-microsoft-signup"
            >
              <FaMicrosoft className="mr-2 h-4 w-4 text-blue-600" />
              Sign up with Microsoft
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or create account with email</span>
            </div>
          </div>

          {/* Email/Password Form */}
          <form onSubmit={handleEmailSignup} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  type="text"
                  placeholder="John"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  data-testid="input-firstName"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  type="text"
                  placeholder="Doe"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  data-testid="input-lastName"
                />
              </div>
            </div>

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
                minLength={6}
                data-testid="input-password"
              />
              <p className="text-xs text-muted-foreground">
                At least 6 characters
              </p>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading}
              data-testid="button-email-signup"
            >
              {isLoading ? "Creating account..." : "Create account"}
            </Button>
          </form>

          <div className="text-center text-sm">
            <span className="text-muted-foreground">Already have an account? </span>
            <button
              onClick={() => setLocation('/login')}
              className="text-primary hover:underline font-medium"
              data-testid="link-login"
            >
              Sign in
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
