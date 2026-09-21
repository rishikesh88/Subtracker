import { Sidebar } from "@/components/Sidebar";
import { useAuth } from "@/hooks/useAuth";
import { useMailboxes } from "@/hooks/useMailboxes";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { user } = useAuth();
  const mailboxes = useMailboxes();

  return (
    <div className="h-screen flex bg-canvas overflow-hidden">
      <Sidebar
        user={user || undefined}
        // Undefined while loading, so the warning is not shown before the
        // answer is known.
        hasMailbox={mailboxes.isLoading ? undefined : mailboxes.hasAny}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
