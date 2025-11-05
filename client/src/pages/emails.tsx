import { useQuery } from "@tanstack/react-query";
import { EmailAnalysis } from "@/components/EmailAnalysis";
import { Sidebar } from "@/components/Sidebar";
import type { SafeUser } from "@shared/schema";

export default function Emails() {
  const { data: user } = useQuery<SafeUser>({ 
    queryKey: ['/api/auth/user']
  });

  const { data: emailAccounts = [] } = useQuery({
    queryKey: ['/api/email-accounts'],
  });

  const { data: emails, isLoading } = useQuery({ 
    queryKey: ['/api/emails'] 
  });

  return (
    <div className="min-h-screen flex bg-background">
      <Sidebar user={user} isGmailConnected={emailAccounts && emailAccounts.length > 0} />
      
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Email Analysis</h2>
              <p className="text-sm text-muted-foreground">
                Review processed transaction emails and detection results
              </p>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 p-6 bg-background overflow-auto">
          <div className="max-w-6xl mx-auto" data-testid="emails-page">
            <EmailAnalysis emails={emails || []} isLoading={isLoading} />
          </div>
        </main>
      </div>
    </div>
  );
}