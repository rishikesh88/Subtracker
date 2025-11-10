import { Sidebar } from "@/components/Sidebar";
import { useAuth } from "@/hooks/useAuth";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { user } = useAuth();

  return (
    <div className="min-h-screen flex bg-background">
      <Sidebar user={user || undefined} isGmailConnected={user?.gmailConnected || false} />
      <div className="flex-1 flex flex-col">
        {children}
      </div>
    </div>
  );
}
