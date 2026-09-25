import { Calendar, Check, FileText, Mail, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ServiceLogo } from "@/components/ServiceLogo";
import { useMoney } from "@/hooks/useMoney";
import {
  displayCategory,
  formatCurrency,
  formatDate,
  formatDateTime,
  isUnknownCurrency,
  relativeFromNow,
  FREQUENCY_LABEL,
  FREQUENCY_SUFFIX,
} from "@/lib/format";

export interface ReviewEvidence {
  id: string;
  subject: string;
  fromName: string;
  fromEmail?: string | null;
  receivedAt: Date | string;
  billedAmount?: string | number | null;
  billedCurrency?: string | null;
  attachments?: { filename: string; mimeType: string | null }[];
}

export interface ReviewSuggestion {
  id: string;
  serviceName: string;
  amount: string;
  currency: string;
  frequency: string;
  category: string | null;
  confidence: string;
  nextBillingDate: Date | string | null;
  occurrences?: number | null;
  emailEvidence?: ReviewEvidence[];
  possibleDuplicateOf?: { serviceName: string; reason: string } | null;
}

export type Decision = "approve" | "reject";

interface ReviewCardProps {
  suggestion: ReviewSuggestion;
  open: boolean;
  /** Set for the moment between pressing a button and the card leaving. */
  leaving?: Decision;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
  onSkip: () => void;
  busy?: boolean;
}

const CONFIDENCE: Record<string, { label: string; cls: string }> = {
  high: { label: "High confidence", cls: "status-active" },
  medium: { label: "Medium confidence", cls: "status-review" },
  low: { label: "Low confidence", cls: "status-cancelled" },
};

/**
 * One suggestion in the review inbox: a row when closed, the evidence and the
 * decision when open.
 *
 * The row is a real button, so the list can be worked through from the
 * keyboard, and the decision buttons carry words rather than icons alone --
 * the floating round buttons of the earlier design read well and could not be
 * told apart by anyone who does not know which colour means which.
 */
export function ReviewCard({ suggestion: s, open, leaving, onToggle, onApprove, onReject, onSkip, busy }: ReviewCardProps) {
  const { display, userCurrency } = useMoney();
  const money = display(s.amount, s.currency);
  const suffix = FREQUENCY_SUFFIX[s.frequency] ?? "";
  const cadence = FREQUENCY_LABEL[s.frequency] ?? s.frequency;
  const category = displayCategory(s.category);
  const confidence = CONFIDENCE[s.confidence] ?? { label: s.confidence, cls: "status-cancelled" };
  const evidence = s.emailEvidence ?? [];
  const merchantEmail = evidence.find((e) => e.fromEmail)?.fromEmail ?? null;
  const attachmentCount = evidence.reduce((n, e) => n + (e.attachments?.length ?? 0), 0);
  const panelId = `review-panel-${s.id}`;

  /* The original charge, receipt by receipt, lives in the evidence. Where no
     receipt carried an amount of its own, the suggestion's billed figure is
     stated once instead -- but only when it differs from the headline, or it
     would simply repeat it. */
  const anyBilled = evidence.some((e) => e.billedAmount !== null && e.billedAmount !== undefined && e.billedAmount !== "");
  const billedInOtherCurrency =
    !anyBilled && !isUnknownCurrency(s.currency) && s.currency?.toUpperCase() !== userCurrency.toUpperCase();

  const nextBilling = s.nextBillingDate ? new Date(s.nextBillingDate) : null;

  const header = (
    <>
      <ServiceLogo name={s.serviceName} merchantEmail={merchantEmail} size={open ? 44 : 40} />
      <span className="flex flex-col gap-1.5 flex-1 min-w-0 text-left">
        <span className={cn("font-semibold leading-tight text-ink line-clamp-2 sm:truncate", open ? "text-[15.5px]" : "text-[14.5px]")}>
          {s.serviceName}
        </span>
        <span className="flex flex-wrap items-center gap-[5px]">
          {category && <span className="badge-category">{category}</span>}
          <span className="badge-cadence">{cadence}</span>
          <span className={cn("badge-status", confidence.cls)}>{confidence.label}</span>
          {money.unknownCurrency && <span className="badge-status status-trial">Check currency</span>}
          {evidence.length === 0 && (
            <span className="badge-status status-review" data-testid={`no-evidence-${s.id}`}>No relevant email</span>
          )}
          {s.possibleDuplicateOf && <span className="badge-status status-review">Possible duplicate</span>}
        </span>
      </span>
      <span
        className={cn("flex-none font-semibold tracking-[-0.02em] tabular-nums text-ink", open ? "text-[22px]" : "text-[17px]")}
        data-testid={`review-amount-${s.id}`}
      >
        {money.primary}
        <span className="text-[12px] font-medium text-muted-foreground">{suffix}</span>
      </span>
    </>
  );

  return (
    <div
      className={cn(
        "transition-[background-color,border-color,box-shadow] duration-200",
        open
          ? "rounded-[20px] border border-line bg-[hsl(0,0%,97.5%)] p-1.5 shadow-[0_28px_56px_-18px_rgba(10,10,10,0.22),0_4px_12px_rgba(10,10,10,0.06)]"
          : "rounded-[16px] border border-line bg-surface hover:border-line-firm",
        leaving === "approve" && "!border-success !bg-success-soft",
        leaving === "reject" && "!border-destructive !bg-destructive-soft",
      )}
      data-testid={`review-card-${s.id}`}
    >
      <button
        type="button"
        id={`review-header-${s.id}`}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          "w-full flex items-center gap-3.5 rounded-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          open ? "px-[18px] pt-3 pb-3.5" : "px-6 min-h-[76px] py-3",
        )}
      >
        {header}
      </button>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={`review-header-${s.id}`}
          className="bg-surface rounded-[15px] border border-line-soft px-4 sm:px-7 pt-5 sm:pt-6 pb-5 sm:pb-6 flex flex-col gap-5"
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-ink-body">Evidence found</span>
              {evidence.length > 0 && (
              <span className="flex gap-1.5">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(0,0%,96%)] px-2.5 py-1 text-[12px] font-semibold text-ink-strong tabular-nums">
                  <Mail size={13} strokeWidth={2} className="text-ink-body" aria-hidden="true" />
                  {evidence.length} email{evidence.length === 1 ? "" : "s"}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(0,0%,96%)] px-2.5 py-1 text-[12px] font-semibold text-ink-strong tabular-nums">
                  <Paperclip size={13} strokeWidth={2} className="text-ink-body" aria-hidden="true" />
                  {attachmentCount} attachment{attachmentCount === 1 ? "" : "s"}
                </span>
              </span>
              )}
            </div>

            {evidence.length > 0 ? (
              <ul className="rounded-[12px] border border-line-soft overflow-hidden">
                {evidence.map((e, i) => {
                  const billed =
                    e.billedAmount !== null && e.billedAmount !== undefined && e.billedAmount !== ""
                      ? formatCurrency(Number(e.billedAmount), e.billedCurrency || s.currency)
                      : null;
                  return (
                    <li
                      key={e.id}
                      className={cn("flex items-center gap-3.5 px-4 py-3.5", i > 0 && "border-t border-line-soft")}
                    >
                      <Mail size={17} strokeWidth={1.8} className="flex-none text-muted-foreground" aria-hidden="true" />
                      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                        <span className="text-[13.5px] font-medium text-ink truncate">{e.subject || "(no subject)"}</span>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[12px] text-muted-foreground truncate">{e.fromEmail || e.fromName}</span>
                          {(e.attachments ?? []).map((a) => (
                            <span
                              key={a.filename}
                              className="inline-flex items-center gap-1.5 max-w-[260px] rounded-[5px] border border-line bg-surface px-[7px] py-[2px] text-[11.5px] font-medium text-ink-body"
                            >
                              <FileText size={12} strokeWidth={2} className="flex-none text-muted-foreground" aria-hidden="true" />
                              <span className="truncate">{a.filename}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-none">
                        {billed && <span className="text-[13.5px] font-semibold tabular-nums text-ink">{billed}</span>}
                        <span className="text-[12px] text-muted-foreground tabular-nums">{formatDateTime(e.receivedAt)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              /* Shown rather than hidden: the detector may know something the
                 kept emails do not. But nothing in the inbox reads like a bill
                 for it, so it arrives at low confidence and says so. */
              <p className="rounded-[10px] border border-warning-line bg-warning-bg px-3.5 py-2.5 text-[12.5px] text-warning">
                No receipt, invoice or renewal email was found for this. It was suggested with low
                confidence, so check it before approving.
              </p>
            )}

            {billedInOtherCurrency && (
              <p className="text-[12px] text-muted-foreground tabular-nums">
                Billed as {formatCurrency(parseFloat(s.amount) || 0, s.currency)}
                {suffix}
              </p>
            )}
          </div>

          {s.possibleDuplicateOf && (
            <p className="rounded-[10px] border border-warning-line bg-warning-bg px-3.5 py-2.5 text-[12.5px] text-warning">
              {s.possibleDuplicateOf.reason}
            </p>
          )}

          <div className="flex items-center justify-between gap-4 flex-wrap border-t border-line-soft pt-[18px]">
            {nextBilling ? (
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 flex-none rounded-[9px] bg-[hsl(0,0%,96%)] flex items-center justify-center">
                  <Calendar size={17} strokeWidth={1.8} className="text-ink-strong" aria-hidden="true" />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-ink-body">Next renewal</span>
                  <span className="text-[14.5px] font-semibold text-ink">
                    {formatDate(nextBilling)}{" "}
                    <span className="font-normal text-muted-foreground">· {relativeFromNow(nextBilling)}</span>
                  </span>
                </span>
              </div>
            ) : (
              <span />
            )}

            {/* Right to left: Approve, Reject, Skip -- the decision people make
                most sits where the eye ends up. */}
            <div className="flex items-center gap-2 w-full sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none">
              <button
                type="button"
                className="btn-base btn-ghost !h-10 !px-3 sm:!px-4 !text-[13.5px] font-semibold"
                onClick={onSkip}
                disabled={busy}
                data-testid={`review-skip-${s.id}`}
                aria-label="Skip for now"
              >
                <span className="sm:hidden">Skip</span>
                <span className="hidden sm:inline">Skip for now</span>
              </button>
              <button
                type="button"
                className="btn-base btn-reject !h-10 !px-3 sm:!px-4 !text-[13.5px]"
                onClick={onReject}
                disabled={busy}
                data-testid={`review-reject-${s.id}`}
              >
                <X size={15} strokeWidth={2.4} aria-hidden="true" />
                Reject
              </button>
              <button
                type="button"
                className="btn-base btn-approve !h-10 !px-3 sm:!px-[18px] !text-[13.5px]"
                onClick={onApprove}
                disabled={busy}
                data-testid={`review-approve-${s.id}`}
              >
                <Check size={15} strokeWidth={2.5} aria-hidden="true" />
                Approve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
