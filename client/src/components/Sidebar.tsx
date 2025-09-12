import { Link, useLocation } from "wouter";
import { BarChart3, List, Mail, Settings, RefreshCw, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarProps {
  user?: any;
  isGmailConnected?: boolean;
}

export function Sidebar({ user, isGmailConnected }: SidebarProps) {
  const [location] = useLocation();

  const navigation = [
    { name: "Dashboard", href: "/", icon: BarChart3 },
    { name: "Subscriptions", href: "/subscriptions", icon: List },
    { name: "Email Analysis", href: "/emails", icon: Mail },
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  return (
    <div className="w-64 bg-card border-r border-border flex flex-col" data-testid="sidebar">
      {/* Logo and Brand */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <RefreshCw className="text-primary-foreground w-4 h-4" />
          </div>
          <h1 className="text-xl font-bold text-foreground">SubTracker</h1>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {navigation.map((item) => {
            const isActive = location === item.href;
            return (
              <li key={item.name}>
                <Link href={item.href}>
                  <a
                    className={cn(
                      "flex items-center space-x-3 px-3 py-2 text-sm font-medium rounded-md transition-colors",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    )}
                    data-testid={`nav-${item.name.toLowerCase()}`}
                  >
                    <item.icon className="w-4 h-4" />
                    <span>{item.name}</span>
                  </a>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Gmail Connection Status */}
      <div className="p-4 border-t border-border">
        <div
          className={cn(
            "flex items-center space-x-3 p-3 rounded-lg border",
            isGmailConnected
              ? "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800"
              : "bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800"
          )}
          data-testid="gmail-status"
        >
          <div
            className={cn(
              "w-2 h-2 rounded-full",
              isGmailConnected ? "bg-green-500" : "bg-red-500"
            )}
          />
          <div className="flex-1">
            <p
              className={cn(
                "text-sm font-medium",
                isGmailConnected ? "text-green-800 dark:text-green-200" : "text-red-800 dark:text-red-200"
              )}
            >
              {isGmailConnected ? "Gmail Connected" : "Gmail Disconnected"}
            </p>
            {user?.username && (
              <p
                className={cn(
                  "text-xs",
                  isGmailConnected ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                )}
                data-testid="user-email"
              >
                {user.username}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
