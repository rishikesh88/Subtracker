import { Link, useLocation } from "wouter";
import { BarChart3, List, Mail, Settings, RefreshCw, User, LogOut, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import type { SafeUser } from "@shared/schema";

interface SidebarProps {
  user?: SafeUser;
  isGmailConnected?: boolean;
}

export function Sidebar({ user, isGmailConnected }: SidebarProps) {
  const [location] = useLocation();
  const { toast } = useToast();
  
  // Fetch suggestion count for the Review Inbox badge
  const { data: suggestionsData } = useQuery<{ suggestions: any[]; total: number }>({
    queryKey: [`/api/suggestions?userId=${user?.id}`],
    enabled: !!user?.id,
  });
  const pendingSuggestionsCount = suggestionsData?.total ?? 0;
  
  const handleLogout = () => {
    // Clear all cached data before logout for seamless account switching
    queryClient.clear();
    
    // Show signing out feedback
    toast({
      title: "Signing out...",
      description: "You'll be redirected to sign in with a different account.",
    });
    
    // Redirect to logout endpoint
    setTimeout(() => {
      window.location.href = '/api/logout';
    }, 500);
  };

  const navigation = [
    { name: "Dashboard", href: "/", icon: BarChart3 },
    { name: "Subscriptions", href: "/subscriptions", icon: List },
    { name: "Review Inbox", href: "/review", icon: ClipboardList },
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
          <h1 className="text-xl text-foreground font-black">Merloq</h1>
        </div>
      </div>
      {/* Navigation */}
      <nav className="flex-1 p-4 overflow-y-auto">
        <ul className="space-y-2">
          {navigation.map((item) => {
            const isActive = location === item.href;
            const showBadge = item.name === "Review Inbox";
            return (
              <li key={item.name}>
                <Link 
                  href={item.href}
                  className={cn(
                    "flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                  data-testid={`nav-${item.name.toLowerCase()}`}
                >
                  <div className="flex items-center space-x-3">
                    <item.icon className="w-4 h-4" />
                    <span>{item.name}</span>
                  </div>
                  {showBadge && (
                    <Badge 
                      variant={pendingSuggestionsCount > 0 ? "default" : "secondary"} 
                      className="ml-auto text-xs px-2 py-0.5"
                    >
                      {pendingSuggestionsCount}
                    </Badge>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {/* User Profile */}
      <div className="flex-shrink-0 p-4 border-t border-border">
        <div className="flex items-center space-x-3 mb-4">
          <Avatar className="h-10 w-10">
            <AvatarImage src={user?.profileImageUrl || undefined} alt={user?.firstName || 'User'} />
            <AvatarFallback className="bg-primary/10">
              <User className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate" data-testid="user-name">
              {user?.firstName && user?.lastName 
                ? `${user.firstName} ${user.lastName}` 
                : user?.email || 'User'
              }
            </p>
            <p className="text-xs text-muted-foreground truncate" data-testid="user-email">
              {user?.email}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" data-testid="user-menu">
                <Settings className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem asChild>
                <Link href="/settings" className="flex items-center cursor-pointer">
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={handleLogout}
                className="flex items-center cursor-pointer text-red-600 focus:text-red-600" 
                data-testid="logout-button"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* Gmail Connection Status */}
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
            {user?.gmailEmail && (
              <p
                className={cn(
                  "text-xs",
                  isGmailConnected ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                )}
                data-testid="gmail-email"
              >
                {user.gmailEmail}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
