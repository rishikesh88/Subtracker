import { useQuery } from "@tanstack/react-query";
import { SubscriptionList } from "@/components/SubscriptionList";
import { Sidebar } from "@/components/Sidebar";
import type { SafeUser } from "@shared/schema";

export default function Subscriptions() {
  const { data: user } = useQuery<SafeUser>({ 
    queryKey: ['/api/auth/user']
  });

  const { data: emailAccounts = [] } = useQuery({
    queryKey: ['/api/email-accounts'],
  });

  const { data: subscriptions, isLoading } = useQuery({ 
    queryKey: ['/api/subscriptions'] 
  });

  return (
    <div className="min-h-screen flex bg-background">
      <Sidebar user={user} isGmailConnected={emailAccounts && emailAccounts.length > 0} />
      
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Your Subscriptions</h2>
              <p className="text-sm text-muted-foreground">
                Manage and track all your recurring subscriptions
              </p>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 p-6 bg-background overflow-auto">
          <div className="max-w-6xl mx-auto" data-testid="subscriptions-page">
            <SubscriptionList subscriptions={subscriptions || []} isLoading={isLoading} />
          </div>
        </main>
      </div>
    </div>
  );
}