import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { SubscriptionCard } from "@/components/SubscriptionCard";
import { type Subscription } from "@shared/schema";

interface SubscriptionListProps {
  subscriptions: Subscription[];
  filteredSubscriptions: Subscription[];
  onAddSubscription?: () => void;
}

/**
 * The subscription grid for the Subscriptions page -- the same card grid as
 * the dashboard (five-per-row cap), plus its two empty states: no
 * subscriptions at all, and a filter/search with no matches.
 */
export function SubscriptionList({ subscriptions, filteredSubscriptions, onAddSubscription }: SubscriptionListProps) {
  if (subscriptions.length === 0) {
    const tile = (
      <div
        role="button"
        tabIndex={0}
        onClick={onAddSubscription}
        onKeyDown={(e) => {
          if (onAddSubscription && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onAddSubscription();
          }
        }}
        className={cn(
          "border border-dashed border-line-firm rounded-card min-h-[148px]",
          "flex flex-col items-center justify-center gap-1 cursor-pointer",
          "hover:border-accent hover:bg-accent-soft/40 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
        data-testid="add-subscription-tile"
      >
        <Plus size={20} strokeWidth={2} className="text-ink-body" />
        <span className="text-[13px] font-semibold text-ink-body">Add a subscription</span>
        <span className="text-[11.5px] text-muted-foreground">Or let the next sync find it</span>
      </div>
    );

    return (
      <div className="flex-1 flex items-center justify-center py-10">
        <div className="w-full max-w-xs">{tile}</div>
      </div>
    );
  }

  if (filteredSubscriptions.length === 0) {
    return (
      <div className="surface-card py-14 flex items-center justify-center">
        <p className="text-[13px] text-muted-foreground" data-testid="no-subscriptions">
          No subscriptions match that search.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(max(250px, calc((100% - 4 * 0.75rem) / 5)), 1fr))" }}>
      {filteredSubscriptions.map((sub) => (
        <SubscriptionCard key={sub.id} subscription={sub} />
      ))}
    </div>
  );
}
