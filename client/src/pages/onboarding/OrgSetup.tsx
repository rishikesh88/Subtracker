import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Building2, User, MapPin } from "lucide-react";

const COUNTRY_CURRENCY_MAP: Record<string, string> = {
  US: "USD",
  GB: "GBP",
  EU: "EUR",
  IN: "INR",
  CA: "CAD",
  AU: "AUD",
  JP: "JPY",
  CN: "CNY",
  SG: "SGD",
  AE: "AED",
};

const COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "EU", name: "European Union" },
  { code: "IN", name: "India" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "JP", name: "Japan" },
  { code: "CN", name: "China" },
  { code: "SG", name: "Singapore" },
  { code: "AE", name: "United Arab Emirates" },
];

const orgSetupSchema = z.object({
  organizationName: z.string().min(1, "Organization name is required"),
  countryCode: z.string().min(1, "Country is required"),
  accountHolderName: z.string().min(1, "Account holder name is required"),
});

type OrgSetupData = z.infer<typeof orgSetupSchema>;

export default function OrgSetup() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<OrgSetupData>({
    resolver: zodResolver(orgSetupSchema),
    defaultValues: {
      organizationName: "",
      countryCode: "",
      accountHolderName: "",
    },
  });

  const onSubmit = async (data: OrgSetupData) => {
    try {
      setIsSubmitting(true);
      console.log('[Event: org_setup_submitted]', { organizationName: data.organizationName, countryCode: data.countryCode });
      
      // Map country to currency
      const preferredCurrency = COUNTRY_CURRENCY_MAP[data.countryCode] || "USD";
      
      // Save organization data
      await apiRequest("POST", "/api/onboarding/org-setup", {
        organizationName: data.organizationName,
        countryCode: data.countryCode,
        accountHolderName: data.accountHolderName,
        preferredCurrency,
      });

      console.log('[Event: org_setup_completed]', { preferredCurrency });

      // Invalidate user query to refresh user data
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });

      toast({
        title: "Organization set up successfully",
        description: "Let's connect your email accounts",
      });

      // Redirect to connect accounts page
      setLocation("/onboarding/connect");
    } catch (error: any) {
      console.error('Error saving organization data:', error);
      toast({
        title: "Failed to save organization data",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <CardTitle className="text-2xl">Welcome to SubTracker</CardTitle>
          </div>
          <CardDescription>
            Let's set up your organization to track subscriptions effectively
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="organizationName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      Organization Name
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Acme Inc."
                        data-testid="input-organization-name"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="countryCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      Country
                    </FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-country">
                          <SelectValue placeholder="Select your country" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {COUNTRIES.map((country) => (
                          <SelectItem 
                            key={country.code} 
                            value={country.code}
                            data-testid={`option-country-${country.code}`}
                          >
                            {country.name} ({COUNTRY_CURRENCY_MAP[country.code]})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="accountHolderName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      Account Holder Name
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="John Doe"
                        data-testid="input-account-holder-name"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
                data-testid="button-continue"
              >
                {isSubmitting ? "Saving..." : "Continue"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
