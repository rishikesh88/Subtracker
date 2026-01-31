import { useQuery } from "@tanstack/react-query";
import { SubscriptionList } from "@/components/SubscriptionList";
import type { Subscription } from "@shared/schema";

export default function Subscriptions() {
  const { data: subscriptions } = useQuery<Subscription[]>({ 
    queryKey: ['/api/subscriptions'] 
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden" data-testid="subscriptions-page">
      <div className="flex-shrink-0 px-6 py-8">
        <h1 className="text-3xl font-bold text-foreground">Your Subscriptions</h1>
        <p className="text-muted-foreground mt-2">
          Manage and track all your recurring subscriptions
        </p>
      </div>

      <div className="flex-1 px-6 pb-8 min-h-0 overflow-hidden">
        <SubscriptionList subscriptions={subscriptions || []} />
      </div>
    </div>
  );
}