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
import { useMoney } from "@/hooks/useMoney";
import { useFeature } from "@/hooks/useFeature";
import { STATUS_FEATURE, LIFECYCLE_BADGE, lifecycleOf, cardWhen, formatDay } from "@/lib/lifecycle";

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
  const { display } = useMoney();
  const money = display(sub.amount, sub.currency);
  /* Behind the subscription_status switch the card shows the three statuses
     (Active, Needs review, Inactive) and the date that goes with each. Without
     it, this is the card it always was. */
  const statusOn = useFeature(STATUS_FEATURE);
  const life = lifecycleOf(sub);
  const badge = statusOn ? LIFECYCLE_BADGE[life] : statusBadge(sub.status);
  const bucket = filterBucket(sub.status);
  const when = statusOn ? cardWhen(sub) : null;
  // An inactive card is dimmed; its status tag is not, so it still reads.
  const dim = statusOn && life === "inactive" ? "opacity-60" : "";
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
        <ServiceLogo name={sub.serviceName} merchantEmail={sub.merchantEmail} size={34} className={dim} />
        <span
          className={cn("t-card-title flex-1 min-w-0 line-clamp-2 [text-wrap:pretty]", dim)}
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

      <div className={cn("flex flex-wrap gap-[5px]", dim)}>
        <span className="badge-cadence">{frequencyLabel}</span>
        {displayCategory(sub.category) && (
          <span className="badge-category">{displayCategory(sub.category)}</span>
        )}
      </div>

      <div className={cn("border-t border-line-soft pt-[13px] flex items-end justify-between", dim)}>
        <div>
          <div className="text-[10.5px] font-semibold text-muted-foreground" data-testid={`subscription-when-label-${sub.id}`}>
            {when ? when.label : bucket === "expired" ? "Ended" : "Renews"}
          </div>
          <div className="text-[12px] text-ink-strong mt-0.5">
            {when ? formatDay(when.date) || "—" : formatDate(sub.nextBillingDate)}
          </div>
        </div>
        <div className="text-right">
          <div className="t-price" data-testid={`subscription-amount-${sub.id}`}>
            {money.primary}
            <span className="text-[11.5px] font-medium text-muted-foreground">{frequencySuffix}</span>
          </div>
          {/* What the merchant actually charged. Shown only when it differs,
              so a dollar subscription on a dollar account stays one number. */}
          {money.secondary && (
            <div className="text-[10.5px] text-muted-foreground tabular-nums mt-0.5">
              billed {money.secondary}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
