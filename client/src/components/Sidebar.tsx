/**
 * The app shell's navigation rail.
 *
 * 212px expanded, 56px collapsed, per the design system. The collapse state is
 * remembered per browser -- it is a per-viewer convenience, not account data,
 * so localStorage is the right place for it and a failure to read it just
 * means the rail opens expanded.
 *
 * Violet appears here exactly twice: the brand tile, and the icon on the
 * active row. That is the whole of its job in navigation.
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutGrid,
  CreditCard,
  Inbox,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  AlertTriangle,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  /** Any mailbox, of any provider. Undefined while that is still loading. */
  hasMailbox?: boolean;
}

const COLLAPSE_KEY = "verloq.nav.collapsed";

/** Lucide, 15px inside rows, 2px stroke -- the design's icon rule. */
const NAVIGATION = [
  { name: "Dashboard", href: "/", icon: LayoutGrid },
  { name: "Subscriptions", href: "/subscriptions", icon: CreditCard },
  { name: "Review inbox", href: "/review", icon: Inbox },
  { name: "Settings", href: "/settings", icon: Settings },
] as const;

export function Sidebar({ user, hasMailbox }: SidebarProps) {
  const [location] = useLocation();
  const { toast } = useToast();

  const [collapsed, setCollapsed] = useState(false);

  /*
   * Below 768px the rail is always the icon strip, whatever the stored
   * preference says. The design's artboards are desktop only, and at 390px an
   * expanded 212px rail takes more than half the screen and pushes the content
   * off the edge -- which is what it was doing.
   *
   * An icon rail is not a finished phone navigation; a drawer behind a
   * hamburger would be. This is the honest minimum until that is designed.
   */
  const [isNarrow, setIsNarrow] = useState(false);

  // Read after mount rather than during render: storage can throw in a private
  // window, and the rail must still draw.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* no stored preference is the same as not collapsed */
    }
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const showCollapsed = collapsed || isNarrow;

  function toggle() {
    setCollapsed((was) => {
      const next = !was;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* the rail still collapses; it just will not be remembered */
      }
      return next;
    });
  }

  const { data: suggestionsData } = useQuery<{ suggestions: any[]; total: number }>({
    queryKey: [`/api/suggestions?userId=${user?.id}`],
    enabled: !!user?.id,
  });
  const pendingSuggestionsCount = suggestionsData?.total ?? 0;

  const handleLogout = () => {
    queryClient.clear();
    toast({
      title: "Signing out…",
      description: "You'll be redirected to sign in with a different account.",
    });
    setTimeout(() => {
      window.location.href = "/api/logout";
    }, 500);
  };

  const displayName =
    user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`
      : user?.email || "Your account";

  const initials = (user?.firstName?.[0] ?? user?.email?.[0] ?? "?").toUpperCase();

  return (
    <div
      className={cn(
        "flex flex-col h-screen flex-none overflow-hidden border-r",
        showCollapsed ? "w-14 px-2" : "w-[212px] px-3",
        "bg-rail border-line py-3.5 gap-0.5 transition-[width] duration-150"
      )}
      data-testid="sidebar"
    >
      {/* --- Brand ------------------------------------------------------- */}
      <div className={cn("flex items-center gap-2.5 pb-4", showCollapsed ? "flex-col px-0" : "px-1")}>
        <span
          className="w-[22px] h-[22px] flex-none rounded-logo bg-accent"
          aria-hidden="true"
        />
        {!showCollapsed && (
          <span className="font-serif text-[21px] leading-none tracking-[-0.02em] text-ink">
            Verloq
          </span>
        )}
        {/* Hidden on a phone: the rail has no expanded state to toggle to there. */}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          className={cn(
            "w-[22px] h-[22px] flex-none inline-flex items-center justify-center",
            "rounded-md border border-line bg-surface text-muted-foreground",
            "hover:bg-line-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed ? "mt-2.5" : "ml-auto",
            isNarrow && "hidden"
          )}
          data-testid="nav-toggle"
        >
          {showCollapsed ? <ChevronRight size={14} strokeWidth={2} /> : <ChevronLeft size={14} strokeWidth={2} />}
        </button>
      </div>

      {/* --- Navigation -------------------------------------------------- */}
      <nav className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5">
        {NAVIGATION.map((item) => {
          const isActive = location === item.href;
          const showBadge = item.name === "Review inbox" && pendingSuggestionsCount > 0;
          return (
            <Link
              key={item.name}
              href={item.href}
              title={showCollapsed ? item.name : undefined}
              className={cn(
                "flex items-center h-8 rounded-lg text-[13.5px] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                showCollapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
                isActive
                  ? "bg-rail-active font-semibold text-ink"
                  : "text-ink-body hover:bg-rail-hover hover:text-ink"
              )}
              data-testid={`nav-${item.name.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <item.icon
                size={15}
                strokeWidth={2}
                className={cn("flex-none", isActive ? "text-accent" : "text-muted-foreground")}
              />
              {!showCollapsed && <span className="flex-1 truncate">{item.name}</span>}
              {showBadge && !showCollapsed && (
                <span className="badge-status status-review flex-none" data-testid="review-count">
                  {pendingSuggestionsCount}
                </span>
              )}
              {showBadge && showCollapsed && (
                <span className="absolute w-1.5 h-1.5 rounded-full bg-warning translate-x-3 -translate-y-2.5" />
              )}
            </Link>
          );
        })}
      </nav>

      {/*
        Shown only when a mailbox is disconnected. The design's rail carries no
        status block, and it is right that a healthy state adds no clutter --
        but a mailbox that has stopped syncing is the one thing a user needs to
        find, and silence is how it goes unnoticed for a week.
      */}
      {hasMailbox === false && !showCollapsed && (
        <Link
          href="/settings"
          className="mt-2 flex items-start gap-2 rounded-lg border border-warning-line bg-warning-bg px-2.5 py-2 text-[11.5px] text-warning hover:bg-warning-soft"
          data-testid="mailbox-warning"
        >
          <AlertTriangle size={14} strokeWidth={2} className="flex-none mt-px" />
          <span>
            <span className="font-semibold">No mailbox connected.</span> Nothing new will be found.
          </span>
        </Link>
      )}

      {/* --- Account ----------------------------------------------------- */}
      <div className={cn("mt-2 pt-2 border-t border-line", showCollapsed && "flex justify-center")}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex items-center rounded-lg text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                showCollapsed ? "justify-center p-1" : "w-full gap-2.5 p-1.5 hover:bg-rail-hover"
              )}
              data-testid="user-menu"
            >
              <Avatar className="h-7 w-7 flex-none">
                <AvatarImage src={user?.profileImageUrl || undefined} alt="" />
                <AvatarFallback className="bg-line-soft text-[11px] font-semibold text-ink-body">
                  {initials}
                </AvatarFallback>
              </Avatar>
              {!showCollapsed && (
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[12.5px] font-semibold text-ink" data-testid="user-name">
                    {displayName}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground" data-testid="user-email">
                    {user?.email}
                  </span>
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-52">
            <DropdownMenuItem asChild>
              <Link href="/settings" className="flex items-center cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              className="flex items-center cursor-pointer text-destructive focus:text-destructive"
              data-testid="logout-button"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
