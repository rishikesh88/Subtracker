import { useEffect } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function AuthCallback() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    const handleCallback = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get("code");
      const error = urlParams.get("error");
      
      if (error) {
        toast({
          title: "Authentication Failed",
          description: error,
          variant: "destructive",
        });
        setLocation("/");
        return;
      }

      if (!code) {
        toast({
          title: "Authentication Failed",
          description: "No authorization code received",
          variant: "destructive",
        });
        setLocation("/");
        return;
      }

      try {
        // Get userId from localStorage or session
        const userId = localStorage.getItem("currentUserId");
        if (!userId) {
          throw new Error("No user session found");
        }

        await apiRequest("POST", "/api/auth/google/callback", {
          code,
          userId,
        });

        toast({
          title: "Gmail Connected",
          description: "Successfully connected your Gmail account",
        });

        setLocation("/");
      } catch (error: any) {
        toast({
          title: "Authentication Failed",
          description: error.message || "Failed to complete authentication",
          variant: "destructive",
        });
        setLocation("/");
      }
    };

    handleCallback();
  }, [setLocation, toast]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
        <p className="text-muted-foreground">Completing Gmail authentication...</p>
      </div>
    </div>
  );
}
