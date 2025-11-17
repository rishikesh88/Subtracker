import { useEffect } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function AuthCallback() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    const handleCallback = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const provider = urlParams.get("provider");
      const success = urlParams.get("success");
      const error = urlParams.get("error");
      
      if (error) {
        toast({
          title: "Authentication Failed",
          description: error,
          variant: "destructive",
        });
        setLocation("/onboarding/connect");
        return;
      }

      if (success === "true" && provider) {
        console.log('[Event: email_connected]', { provider });

        toast({
          title: `${provider === 'gmail' ? 'Gmail' : 'Outlook'} Connected`,
          description: `Successfully connected your ${provider === 'gmail' ? 'Gmail' : 'Outlook'} account`,
        });

        // Redirect to dashboard (onboarding complete)
        setLocation("/dashboard");
      } else {
        toast({
          title: "Authentication Failed",
          description: "Invalid callback parameters",
          variant: "destructive",
        });
        setLocation("/onboarding/connect");
      }
    };

    handleCallback();
  }, [setLocation, toast]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
        <p className="text-muted-foreground">Completing email authentication...</p>
      </div>
    </div>
  );
}
