import { useQuery } from "@tanstack/react-query";
import { SubscriptionList } from "@/components/SubscriptionList";
import type { Subscription } from "@shared/schema";

export default function Subscriptions() {
  const { data: subscriptions } = useQuery<Subscription[]>({ 
    queryKey: ['/api/subscriptions'] 
  });

  return (
    <div className="container mx-auto px-6 py-8" data-testid="subscriptions-page">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">Your Subscriptions</h1>
        <p className="text-muted-foreground mt-2">
          Manage and track all your recurring subscriptions
        </p>
      </div>

      <SubscriptionList subscriptions={subscriptions || []} />
    </div>
  );
}