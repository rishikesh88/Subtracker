import { useState } from "react";
import { COUNTRIES, currencyForCountry } from "@/lib/currencies";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FormField } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Building2, User, MapPin } from "lucide-react";


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
      const preferredCurrency = currencyForCountry(data.countryCode);

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
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="surface-card w-full max-w-[520px]" style={{ padding: "24px" }} data-testid="org-setup-page">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 flex-none rounded-logo bg-accent-soft flex items-center justify-center">
            <Building2 size={17} strokeWidth={2} className="text-accent" />
          </span>
          <h1 className="t-section">Welcome to Verloq</h1>
        </div>
        <p className="t-body text-ink-body mt-2 mb-6">
          Let's set up your organization to track subscriptions effectively
        </p>

        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormField
            control={form.control}
            name="organizationName"
            render={({ field, fieldState }) => (
              <div className="flex flex-col gap-1.5">
                <label className="t-label flex items-center gap-1.5">
                  <Building2 size={15} strokeWidth={2} className="text-muted-foreground" />
                  Organization name
                </label>
                <input
                  placeholder="Acme Inc."
                  data-testid="input-organization-name"
                  className="field w-full"
                  {...field}
                />
                {fieldState.error && (
                  <p className="t-caption text-destructive">{fieldState.error.message}</p>
                )}
              </div>
            )}
          />

          <FormField
            control={form.control}
            name="countryCode"
            render={({ field, fieldState }) => (
              <div className="flex flex-col gap-1.5">
                <label className="t-label flex items-center gap-1.5">
                  <MapPin size={15} strokeWidth={2} className="text-muted-foreground" />
                  Country
                </label>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <SelectTrigger
                    data-testid="select-country"
                    className="field h-8 w-full justify-between rounded-[8px] border-line-firm bg-surface px-[11px] py-0 text-[13px] text-foreground focus:ring-2 focus:ring-accent-soft focus:ring-offset-0 data-[placeholder]:text-muted-foreground"
                  >
                    <SelectValue placeholder="Select your country" />
                  </SelectTrigger>
                  <SelectContent className="rounded-[8px] border-line bg-surface text-foreground">
                    {COUNTRIES.map((country) => (
                      <SelectItem
                        key={country.code}
                        value={country.code}
                        data-testid={`option-country-${country.code}`}
                        className="rounded-[6px] text-[13px] focus:bg-line-soft focus:text-ink"
                      >
                        {country.name} ({country.currency})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldState.error && (
                  <p className="t-caption text-destructive">{fieldState.error.message}</p>
                )}
              </div>
            )}
          />

          <FormField
            control={form.control}
            name="accountHolderName"
            render={({ field, fieldState }) => (
              <div className="flex flex-col gap-1.5">
                <label className="t-label flex items-center gap-1.5">
                  <User size={15} strokeWidth={2} className="text-muted-foreground" />
                  Account holder name
                </label>
                <input
                  placeholder="John Doe"
                  data-testid="input-account-holder-name"
                  className="field w-full"
                  {...field}
                />
                {fieldState.error && (
                  <p className="t-caption text-destructive">{fieldState.error.message}</p>
                )}
              </div>
            )}
          />

          <button
            type="submit"
            disabled={isSubmitting}
            data-testid="button-continue"
            className="btn-base btn-accent w-full justify-center mt-1"
          >
            {isSubmitting ? "Saving..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
