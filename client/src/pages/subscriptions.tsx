import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useState } from "react";
import { Search, Plus, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { filterBucket, displayCategory } from "@/lib/format";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SubscriptionList } from "@/components/SubscriptionList";
import { AddSubscriptionModal } from "@/components/AddSubscriptionModal";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import SubscriptionDetail from "@/pages/subscription-detail";
import type { Subscription } from "@shared/schema";

export default function Subscriptions() {
  const { data: subscriptions = [] } = useQuery<Subscription[]>({
    queryKey: ['/api/subscriptions']
  });

  /*
   * The detail is a drawer over this list, not a page of its own -- you triage
   * several in a row, and losing the list between each one makes that worse.
   *
   * It keeps its own URL all the same. /subscriptions/:id renders this list
   * with the drawer open, so a shared link, a refresh and the back button all
   * behave, and a card can stay an ordinary link rather than a click handler.
   */
  const [detailMatches, detailParams] = useRoute("/subscriptions/:id");
  const [, setLocation] = useLocation();
  const openSubscriptionId = detailMatches ? detailParams?.id : undefined;

  // Presentation-only: search text and which filter segment is selected.
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "expired">("all");
  const [addSubscriptionModalOpen, setAddSubscriptionModalOpen] = useState(false);
  /*
   * Filtering by category existed on this page before the redesign and the
   * design keeps it ("All categories", beside the segments). It is restored
   * here because dropping it would have been a quiet feature removal dressed
   * up as a re-skin.
   *
   * The options are the categories actually present, normalised the same way
   * the badges are -- otherwise "streaming" and "Streaming" would be offered
   * as two separate choices and neither would match both.
   */
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const categories = Array.from(
    new Set(subscriptions.map((s) => displayCategory(s.category)).filter(Boolean) as string[])
  ).sort((a, b) => a.localeCompare(b));

  const filterCounts = {
    all: subscriptions.length,
    active: subscriptions.filter((s) => filterBucket(s.status) === "active").length,
    expired: subscriptions.filter((s) => filterBucket(s.status) === "expired").length,
  };

  const filteredSubscriptions = subscriptions.filter((s) => {
    const matchesFilter = statusFilter === "all" || filterBucket(s.status) === statusFilter;
    const matchesSearch = s.serviceName.toLowerCase().includes(searchQuery.trim().toLowerCase());
    const matchesCategory =
      categoryFilter === "all" || displayCategory(s.category) === categoryFilter;
    return matchesFilter && matchesSearch && matchesCategory;
  });

  const segments: { key: typeof statusFilter; label: string; count: number; testId: string }[] = [
    { key: "all", label: "All", count: filterCounts.all, testId: "filter-all" },
    { key: "active", label: "Active", count: filterCounts.active, testId: "filter-active" },
    { key: "expired", label: "Expired", count: filterCounts.expired, testId: "filter-expired" },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-canvas" data-testid="subscriptions-page">
      {/* --- Page header ---------------------------------------------------- */}
      <header
        className="flex-shrink-0 bg-surface border-b border-line flex items-end justify-between gap-4 flex-wrap"
        style={{ padding: "20px 24px 16px" }}
      >
        <div className="min-w-0">
          <h1 className="t-page">Subscriptions</h1>
          <p className="text-[12.5px] text-muted-foreground mt-1">
            {filterCounts.all} tracked · {filterCounts.active} active
          </p>
        </div>

        {/* The one forward action on this page. */}
        <button
          type="button"
          onClick={() => setAddSubscriptionModalOpen(true)}
          data-testid="add-subscription"
          className="btn-base btn-accent"
        >
          <Plus size={15} strokeWidth={2} />
          Add subscription
        </button>
      </header>

      {/* --- Body ------------------------------------------------------------ */}
      <main
        className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-[18px]"
        style={{ padding: "20px 24px 40px" }}
      >
        {/* Filter bar: search + segmented control */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="field w-full max-w-[240px]">
            <Search size={15} strokeWidth={2} className="text-muted-foreground flex-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search subscriptions"
              data-testid="search-subscriptions"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
          {categories.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="btn-base btn-secondary" data-testid="filter-category">
                  {categoryFilter === "all" ? "All categories" : categoryFilter}
                  <ChevronDown size={13} strokeWidth={2} className="text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => setCategoryFilter("all")}>
                  All categories
                </DropdownMenuItem>
                {categories.map((category) => (
                  <DropdownMenuItem key={category} onClick={() => setCategoryFilter(category)}>
                    {category}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <div className="inline-flex gap-0.5 p-0.5 rounded-lg bg-line-soft">
            {segments.map((segment) => {
              const selected = statusFilter === segment.key;
              return (
                <button
                  key={segment.key}
                  type="button"
                  onClick={() => setStatusFilter(segment.key)}
                  data-testid={segment.testId}
                  className={cn(
                    "h-7 rounded-button px-[11px] text-[12.5px] transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "bg-surface font-semibold text-ink" : "bg-transparent font-medium text-ink-body"
                  )}
                >
                  {segment.label}{" "}
                  <span className="text-muted-foreground">
                    {segment.count}
                  </span>
                </button>
              );
            })}
          </div>
          </div>
        </div>

        {/* Subscription grid / empty states */}
        <SubscriptionList
          subscriptions={subscriptions}
          filteredSubscriptions={filteredSubscriptions}
          onAddSubscription={() => setAddSubscriptionModalOpen(true)}
        />
      </main>

      {/* Add Subscription Modal */}
      <Sheet
        open={Boolean(openSubscriptionId)}
        onOpenChange={(open) => {
          if (!open) setLocation("/subscriptions");
        }}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-[560px] p-0 overflow-y-auto bg-canvas"
          data-testid="subscription-drawer"
        >
          {openSubscriptionId && (
            <SubscriptionDetail
              subscriptionId={openSubscriptionId}
              onClose={() => setLocation("/subscriptions")}
            />
          )}
        </SheetContent>
      </Sheet>

      <AddSubscriptionModal
        open={addSubscriptionModalOpen}
        onOpenChange={setAddSubscriptionModalOpen}
      />
    </div>
  );
}
