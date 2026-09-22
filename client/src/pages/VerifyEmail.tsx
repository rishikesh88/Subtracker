import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Mail, CheckCircle2, Loader2 } from "lucide-react";
import { Logo } from "@/components/Logo";

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

      // Keep loading state during navigation (don't reset isVerifying here)
      // Redirect to onboarding (App.tsx routing will handle final destination)
      setLocation('/onboarding/org-setup');
    } catch (err: any) {
      // Only clear loading state on error
      setIsVerifying(false);
      toast({
        title: "Verification Failed",
        description: err.message || "Invalid or expired code. Please try again.",
        variant: "destructive",
      });
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
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4 relative">
      {/* Loading overlay during verification */}
      {isVerifying && (
        <div className="absolute inset-0 bg-canvas/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-ink" />
            <p className="t-body font-medium text-ink">Verifying your email...</p>
          </div>
        </div>
      )}

      <div className="max-w-[400px] w-full">

        <div className="flex items-center justify-center gap-2.5 mb-5">

          <Logo />

          <span className="font-serif text-[21px] leading-none tracking-[-0.02em] text-ink">Verloq</span>

        </div>

        <div className="max-w-[400px] w-full surface-card" style={{ padding: "24px" }}>

        <div className="flex flex-col items-center gap-1 mb-5 text-center">
          <div className="w-11 h-11 rounded-full bg-accent-soft flex items-center justify-center mb-3">
            <Mail size={20} strokeWidth={2} className="text-accent-deep" />
          </div>
          <h1 className="t-section text-ink" data-testid="verify-email-title">Verify your email</h1>
          <p className="t-body text-muted-foreground">
            We sent a 6-digit code to <span className="font-semibold text-ink">{user?.email}</span>
          </p>
        </div>

        <form onSubmit={handleVerify} className="flex flex-col gap-3">
          <div className="field h-12 justify-center">
            <input
              type="text"
              placeholder="Enter 6-digit code"
              value={code}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                setCode(value);
              }}
              maxLength={6}
              className="text-center text-xl tracking-[0.4em]"
              data-testid="input-verification-code"
              autoFocus
            />
          </div>

          <button
            type="submit"
            disabled={code.length !== 6 || isVerifying}
            className="btn-base btn-accent w-full"
            data-testid="button-verify"
          >
            {isVerifying ? (
              <>
                <Loader2 size={15} strokeWidth={2} className="animate-spin" />
                Verifying…
              </>
            ) : (
              <>
                <CheckCircle2 size={15} strokeWidth={2} />
                Verify
              </>
            )}
          </button>

          <div className="text-center mt-1">
            <p className="t-caption mb-2">
              Didn't receive the code?
            </p>
            <button
              type="button"
              onClick={handleResend}
              disabled={isResending}
              className="btn-base btn-secondary"
              data-testid="button-resend"
            >
              {isResending ? (
                <>
                  <Loader2 size={15} strokeWidth={2} className="animate-spin" />
                  Sending…
                </>
              ) : (
                "Resend code"
              )}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
}
