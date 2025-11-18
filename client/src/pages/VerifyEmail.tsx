import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Mail, CheckCircle2, Loader2 } from "lucide-react";

export default function VerifyEmail() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const { data: user } = useQuery<any>({
    queryKey: ['/api/auth/user'],
  });

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (code.length !== 6) {
      toast({
        title: "Invalid Code",
        description: "Please enter a 6-digit verification code",
        variant: "destructive",
      });
      return;
    }

    setIsVerifying(true);

    try {
      const response = await apiRequest("POST", "/api/auth/verify-email", { code });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Verification failed");
      }

      // Refetch user query to get fresh emailVerified status
      await queryClient.refetchQueries({ queryKey: ['/api/auth/user'] });

      toast({
        title: "Email Verified!",
        description: "Your email has been successfully verified.",
      });

      // Redirect to onboarding (App.tsx routing will handle final destination)
      setLocation('/onboarding/org-setup');
    } catch (err: any) {
      toast({
        title: "Verification Failed",
        description: err.message || "Invalid or expired code. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    setIsResending(true);

    try {
      const response = await apiRequest("POST", "/api/auth/resend-verification", {});

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to resend code");
      }

      toast({
        title: "Code Sent",
        description: "A new verification code has been sent to your email.",
      });

      setCode(""); // Clear the input
    } catch (err: any) {
      toast({
        title: "Resend Failed",
        description: err.message || "Failed to resend verification code.",
        variant: "destructive",
      });
    } finally {
      setIsResending(false);
    }
  };

  // If already verified, App.tsx routing will redirect automatically
  // No need to manually redirect here

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mb-4">
            <Mail className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
          <CardTitle className="text-2xl">Verify Your Email</CardTitle>
          <CardDescription>
            We sent a 6-digit code to <strong>{user?.email}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <Input
                type="text"
                placeholder="Enter 6-digit code"
                value={code}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setCode(value);
                }}
                maxLength={6}
                className="text-center text-2xl tracking-widest"
                data-testid="input-verification-code"
                autoFocus
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={code.length !== 6 || isVerifying}
              data-testid="button-verify"
            >
              {isVerifying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Verify Email
                </>
              )}
            </Button>

            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-2">
                Didn't receive the code?
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={handleResend}
                disabled={isResending}
                data-testid="button-resend"
              >
                {isResending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Resend Code"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
