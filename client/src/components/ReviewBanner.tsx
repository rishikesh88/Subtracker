import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, Inbox, X } from "lucide-react";

interface SyncStatus {
  running: boolean;
  pendingSuggestions: number;
}

const DISMISSED_KEY = "reviewBannerDismissedAt";

/**
 * "Your sync found 17 subscriptions" on the dashboard, for whoever comes back
 * after a sync finished without them watching it.
 *
 * Hidden while a sync is running -- the sync window has that -- and once
 * dismissed, until the number waiting grows again.
 */
export function ReviewBanner() {
  const { data } = useQuery<SyncStatus>({ queryKey: ["/api/sync/status"], staleTime: 0 });
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DISMISSED_KEY);
      setDismissedAt(saved === null ? null : Number(saved));
    } catch {
      /* Storage blocked: the banner just shows. */
    }
  }, []);

  const count = data?.pendingSuggestions ?? 0;
  if (!data || data.running || count === 0) return null;
  if (dismissedAt !== null && count <= dismissedAt) return null;

  const dismiss = () => {
    setDismissedAt(count);
    try {
      localStorage.setItem(DISMISSED_KEY, String(count));
    } catch {
      /* Hidden for this visit only. */
    }
  };

  return (
    <div
      role="region"
      aria-label="Subscriptions to review"
      data-testid="review-banner"
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[14px] border border-[#DCD9FB] bg-accent-soft px-4 py-4 sm:flex-nowrap sm:px-5"
    >
      <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] bg-accent">
        <Inbox size={20} strokeWidth={2} className="text-white" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 basis-[200px] flex-col gap-0.5">
        <span className="text-[15px] font-semibold text-ink">
          Your sync found {count} {count === 1 ? "subscription" : "subscriptions"}
        </span>
        <span className="text-[13px] text-accent-deep">
          Review them to start tracking what you pay for. Nothing is added until you approve it.
        </span>
      </div>
      <div className="ml-auto flex flex-none items-center gap-1">
        <Link href="/review" className="btn-base btn-accent h-10 gap-2 px-[18px] text-[13.5px]" data-testid="button-review-banner">
          Review subscriptions
          <ArrowRight size={15} strokeWidth={2.2} aria-hidden="true" />
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="btn-base btn-ghost h-8 w-8 px-0 text-accent-deep hover:!bg-[#DCD9FB]"
        >
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
