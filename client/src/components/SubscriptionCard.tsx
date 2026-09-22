import { Link } from "wouter";
import { cn } from "@/lib/utils";
import {
  displayCategory,
  filterBucket,
  statusBadge,
  formatDate,
  formatCurrency,
  FREQUENCY_LABEL,
  FREQUENCY_SUFFIX,
} from "@/lib/format";
import { type Subscription } from "@shared/schema";
import { ServiceLogo } from "@/components/ServiceLogo";

interface SubscriptionCardProps {
  subscription: Subscription;
}

/**
 * A single subscription card, per the design system: 34px logo tile,
 * two-line title, status/cadence/category badges, and a footer with the
 * renew/ended date on the left and the price on the right. Shared by the
 * dashboard and the subscriptions page so there is exactly one card.
 */
export function SubscriptionCard({ subscription: sub }: SubscriptionCardProps) {
  const badge = statusBadge(sub.status);
  const bucket = filterBucket(sub.status);
  const frequencyLabel = FREQUENCY_LABEL[sub.frequency] ?? sub.frequency;
  const frequencySuffix = FREQUENCY_SUFFIX[sub.frequency] ?? "";

  return (
    <Link
      href={`/subscriptions/${sub.id}`}
      className={cn(
        "surface-card p-[15px] flex flex-col gap-[13px] cursor-pointer",
        "hover:border-line-firm transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
      data-testid={`subscription-card-${sub.id}`}
    >
      <div className="flex items-center gap-2.5">
        <ServiceLogo name={sub.serviceName} size={34} />
        <span
          className="t-card-title flex-1 min-w-0 line-clamp-2 [text-wrap:pretty]"
          data-testid={`subscription-name-${sub.id}`}
        >
          {sub.serviceName}
        </span>
        <span
          className={cn("badge-status flex-none", badge.cls)}
          data-testid={`subscription-status-${sub.id}`}
        >
          {badge.label}
        </span>
      </div>

      <div className="flex flex-wrap gap-[5px]">
        <span className="badge-cadence">{frequencyLabel}</span>
        {displayCategory(sub.category) && (
          <span className="badge-category">{displayCategory(sub.category)}</span>
        )}
      </div>

      <div className="border-t border-line-soft pt-[13px] flex items-end justify-between">
        <div>
          <div className="text-[10.5px] font-semibold text-muted-foreground">
            {bucket === "expired" ? "Ended" : "Renews"}
          </div>
          <div className="text-[12px] text-ink-strong mt-0.5">{formatDate(sub.nextBillingDate)}</div>
        </div>
        <div className="t-price" data-testid={`subscription-amount-${sub.id}`}>
          {formatCurrency(parseFloat(sub.amount) || 0, sub.currency)}
          <span className="text-[11.5px] font-medium text-muted-foreground">{frequencySuffix}</span>
        </div>
      </div>
    </Link>
  );
}
