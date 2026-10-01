import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import type { Subscription, Invoice, GmailAccount, OutlookAccount } from "@shared/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Edit, Save, X, Upload, Download, Trash2, FileText, Mail, Eye,
  Archive, CircleCheck, CalendarDays, TriangleAlert, CreditCard, ChevronDown, ChevronRight, Loader2,
} from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { useState, useEffect, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ObjectUploader, type UploadResult } from "@/components/ObjectUploader";
import { InvoicePreview, previewKind, downloadUrl } from "@/components/InvoicePreview";
import { cn } from "@/lib/utils";
import { displayCategory, statusBadge, formatDate, formatCurrency, relativeFromNow, FREQUENCY_LABEL, FREQUENCY_SUFFIX } from "@/lib/format";
import { useMoney } from "@/hooks/useMoney";
import { ServiceLogo } from "@/components/ServiceLogo";
import { useFeature } from "@/hooks/useFeature";
import { splitDocuments, DOCUMENT_LIMIT } from "@/lib/documentKind";
import {
  STATUS_FEATURE,
  LIFECYCLE_BADGE,
  FLAT_LIMIT,
  ROWS_PER_YEAR,
  lifecycleOf,
  formatDay,
  formatDayLong,
  formatDayShort,
  formatMonthYear,
  relativeDay,
  isPast,
  groupByYear,
  paymentCount,
  type PaymentRow,
} from "@/lib/lifecycle";

/** What GET /api/subscriptions/:id/payments sends (only with the subscription_status switch). */
interface PaymentView {
  payments: PaymentRow[];
  some_bills_only: boolean;
  payment_failed_on: string | null;
  history_state: "searching" | "cant_update" | "manual" | "ok";
  searched_since: string | null;
}

/**
 * The subscription detail, rendered inside the drawer on the subscriptions
 * page rather than as a page of its own.
 *
 * The id comes in as a prop instead of being read from the route, because the
 * drawer and the dashboard share one URL: /subscriptions/:id renders the dashboard with
 * this panel open over it. Keeping the URL means a shared link, a refresh and
 * the back button all still land where they should.
 */
export default function SubscriptionDetail({
  subscriptionId: idFromProps,
  onClose,
}: {
  subscriptionId?: string;
  onClose?: () => void;
} = {}) {
  const [, params] = useRoute("/subscriptions/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { display } = useMoney();
  const [isEditMode, setIsEditMode] = useState(false);
  const [formData, setFormData] = useState<Partial<Subscription>>({});
  /* Held apart from formData because <input type="date"> speaks YYYY-MM-DD
     while the column is a timestamp. Converting on the way in and out keeps
     the input controlled without casting a string into a Date-typed field. */
  const [renewalInput, setRenewalInput] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  // The invoice currently being looked at, or null when nothing is open.
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  // Invoices and receipts show the newest few; these are the lists opened out.
  const [showAllInvoices, setShowAllInvoices] = useState(false);
  const [showAllReceipts, setShowAllReceipts] = useState(false);

  const subscriptionId = idFromProps ?? params?.id;

  // Closing falls back to navigation when no handler is supplied, so the
  // component still works if it is ever rendered on its own again.
  const close = onClose ?? (() => setLocation("/"));

  /* Behind the subscription_status switch the panel shows the status, the
     counted Payments list and a bottom action bar. Without it, nothing below
     changes. */
  const statusOn = useFeature(STATUS_FEATURE);

  // Fetch subscription details
  const { data: subscription, isLoading: loadingSubscription } = useQuery<Subscription>({
    queryKey: ['/api/subscriptions', subscriptionId],
    enabled: !!subscriptionId,
    // While its history is still being found, look again for the result.
    refetchInterval: (query) => {
      const state = query.state.data?.historyStatus;
      return statusOn && (state === 'pending' || state === 'running') ? 5000 : false;
    },
  });

  // The counted payments and the state of the history behind them.
  const { data: paymentView, isLoading: loadingPayments } = useQuery<PaymentView>({
    queryKey: ['/api/subscriptions', subscriptionId, 'payments'],
    enabled: statusOn && !!subscriptionId,
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.history_state === 'searching' ? 5000 : false),
  });

  // Fetch invoices
  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ['/api/subscriptions', subscriptionId, 'invoices'],
    enabled: !!subscriptionId,
  });

  // Determine provider and account ID to fetch
  const isOutlookSubscription = subscription?.emailProvider === 'outlook';
  const isGmailSubscription = subscription?.emailProvider === 'gmail' || subscription?.gmailAccountId; // Legacy fallback

  const gmailAccountIdToFetch = isGmailSubscription
    ? (subscription?.providerAccountId || subscription?.gmailAccountId)
    : null;

  const outlookAccountIdToFetch = isOutlookSubscription
    ? subscription?.providerAccountId
    : null;

  // Fetch Gmail account
  const { data: gmailAccount } = useQuery<GmailAccount>({
    queryKey: [`/api/gmail/accounts/${gmailAccountIdToFetch}`],
    enabled: !!gmailAccountIdToFetch,
  });

  // Fetch Outlook account
  const { data: outlookAccount } = useQuery<OutlookAccount>({
    queryKey: [`/api/outlook/accounts/${outlookAccountIdToFetch}`],
    enabled: !!outlookAccountIdToFetch,
  });

  // Initialize form data when subscription is loaded
  useEffect(() => {
    if (subscription) {
      setFormData({
        serviceName: subscription.serviceName,
        category: subscription.category,
        description: subscription.description || '',
        ownerName: subscription.ownerName || '',
        ownerEmail: subscription.ownerEmail || '',
        amount: subscription.amount,
        frequency: subscription.frequency,
        currency: subscription.currency,
      });
      setRenewalInput(toDateInput(parseValidDate(subscription.nextBillingDate)));
    }
  }, [subscription]);

  // Update subscription mutation
  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<Subscription>) => {
      const res = await apiRequest('PATCH', `/api/subscriptions/${subscriptionId}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions', subscriptionId] });
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions'] });
      setIsEditMode(false);
      toast({
        title: "Success",
        description: "Subscription updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update subscription",
        variant: "destructive",
      });
    },
  });

  // Delete subscription mutation
  const deleteSubscriptionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('DELETE', `/api/subscriptions/${subscriptionId}`);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Subscription and related invoices deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      setLocation('/');
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete subscription",
        variant: "destructive",
      });
    },
  });

  // The person's own answer: still active / mark inactive / mark active.
  const answerMutation = useMutation({
    mutationFn: async (answer: 'still-active' | 'mark-inactive' | 'mark-active') => {
      const res = await apiRequest('POST', `/api/subscriptions/${subscriptionId}/${answer}`);
      return { answer, subscription: (await res.json()) as Subscription };
    },
    onSuccess: ({ answer, subscription: updated }) => {
      for (const prefix of ['/api/subscriptions', '/api/stats', '/api/payment-reviews', '/api/sync/status']) {
        queryClient.invalidateQueries({
          predicate: (query) => query.queryKey[0]?.toString().startsWith(prefix) ?? false,
        });
      }
      const stillStopped = answer === 'mark-active' && updated?.lifecycleStatus === 'inactive';
      toast({
        title:
          answer === 'still-active'
            ? 'Kept as active'
            : answer === 'mark-inactive'
              ? 'Marked as inactive'
              : stillStopped
                ? 'Still inactive'
                : 'Marked as active',
        description:
          answer === 'still-active'
            ? "We won't ask again for a while."
            : answer === 'mark-inactive'
              ? "It's no longer counted in your totals."
              : stillStopped
                ? 'Your emails say it was cancelled. A new payment will make it active again.'
                : "It's counted in your totals again.",
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: "That didn't save. Nothing was changed.",
        variant: 'destructive',
      });
    },
  });

  // Delete invoice mutation
  const deleteInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await apiRequest('DELETE', `/api/invoices/${invoiceId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions', subscriptionId, 'invoices'] });
      toast({
        title: "Success",
        description: "Invoice deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete invoice",
        variant: "destructive",
      });
    },
  });

  // Get upload URL
  const handleGetUploadParameters = async () => {
    const res = await apiRequest('POST', '/api/objects/upload');
    const response = await res.json();
    return {
      method: 'PUT' as const,
      url: response.uploadURL,
    };
  };

  // Handle upload complete
  const handleUploadComplete = async (result: UploadResult) => {
    if (result.successful.length === 0) return;
    let saved = 0;
    for (const file of result.successful) {
      try {
        await apiRequest('POST', `/api/subscriptions/${subscriptionId}/invoices`, {
          fileUrl: file.uploadURL,
          fileName: file.name,
          fileType: file.type || 'application/octet-stream',
          fileSize: file.size || 0,
          source: 'manual',
        });
        saved += 1;
      } catch (error) {
        console.error('Failed to save invoice:', error);
        toast({
          title: "That file wasn't saved",
          description: file.name,
          variant: "destructive",
        });
      }
    }

    queryClient.invalidateQueries({ queryKey: ['/api/subscriptions', subscriptionId, 'invoices'] });
    if (saved > 0) {
      toast({
        title: "Uploaded",
        description: `${saved} file${saved === 1 ? '' : 's'} uploaded`,
      });
    }
  };

  const handleSave = () => {
    /* An empty input clears the date rather than leaving the old one, which
       is what someone deleting the field is asking for. */
    updateMutation.mutate({
      ...formData,
      nextBillingDate: renewalInput || null,
    } as Partial<Subscription>);
  };

  const handleCancel = () => {
    if (subscription) {
      setFormData({
        serviceName: subscription.serviceName,
        category: subscription.category,
        description: subscription.description || '',
        ownerName: subscription.ownerName || '',
        ownerEmail: subscription.ownerEmail || '',
      });
      setRenewalInput(toDateInput(parseValidDate(subscription.nextBillingDate)));
    }
    setIsEditMode(false);
  };

  if (loadingSubscription) {
    return (
      <div className="flex flex-col gap-3" style={{ padding: "20px 24px 32px" }}>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-line-soft rounded-card w-1/3" />
          <div className="h-40 bg-line-soft rounded-card" />
        </div>
      </div>
    );
  }

  if (!subscription) {
    return (
      <div className="flex flex-col" style={{ padding: "20px 24px 32px" }}>
        <div className="surface-card py-8">
          <p className="text-center text-[13px] text-muted-foreground">Subscription not found</p>
        </div>
      </div>
    );
  }

  const life = lifecycleOf(subscription);
  const badge = statusOn ? LIFECYCLE_BADGE[life] : statusBadge(subscription.status);
  const endsOnFuture = statusOn && life === 'active' && !!subscription.endsOn && !isPast(subscription.endsOn);
  const frequencyLabel = FREQUENCY_LABEL[subscription.frequency] ?? subscription.frequency;
  const category = displayCategory(subscription.category);

  const amount = parseFloat(subscription.amount) || 0;
  const monthlyEquivalent = monthlyEquivalentAmount(amount, subscription.frequency);
  const money = display(amount, subscription.currency);
  const monthlyMoney = monthlyEquivalent === null ? null : display(monthlyEquivalent, subscription.currency);
  // With the switch, the renewal is the last payment plus one period, worked
  // out once on the server, not a date that keeps rolling forward.
  const nextBillingDate = parseValidDate(
    statusOn ? subscription.expectedNextPaymentAt ?? subscription.nextBillingDate : subscription.nextBillingDate,
  );
  const billingCycle = billingCycleLabel(subscription.frequency, frequencyLabel, nextBillingDate);
  const startedDate = earliestKnownDate(subscription, invoices);

  const hasSourceAccount = !!(gmailAccount || outlookAccount);

  const documents = splitDocuments(invoices);

  const uploadButton = (
    <ObjectUploader
      maxNumberOfFiles={10}
      maxFileSize={10485760}
      allowedFileTypes={['.pdf', '.png', '.jpg', '.jpeg', '.docx', '.doc']}
      onGetUploadParameters={handleGetUploadParameters}
      onComplete={handleUploadComplete}
      onError={(message) =>
        toast({ title: "That file wasn't uploaded", description: message, variant: "destructive" })
      }
      buttonClassName="btn-base btn-secondary"
    >
      <Upload size={15} strokeWidth={2} />
      Upload
    </ObjectUploader>
  );

  /* One file in the Invoices or Receipts list. */
  const invoiceRow = (invoice: Invoice, isLast: boolean) => (
      <div
        key={invoice.id}
        className={cn(
          "flex items-center gap-3 p-3",
          !isLast && "border-b border-line-soft",
          previewKind(invoice) !== "none" && "cursor-pointer hover:bg-line-soft"
        )}
        data-testid={`invoice-${invoice.id}`}
        onClick={() => previewKind(invoice) !== "none" && setPreviewInvoice(invoice)}
        role={previewKind(invoice) !== "none" ? "button" : undefined}
      >
        <FileText size={15} strokeWidth={2} className="text-muted-foreground flex-none" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-ink truncate">{invoice.fileName}</p>
          <p className="text-[11.5px] text-muted-foreground mt-0.5">
            {formatDate(invoice.uploadedAt)}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-none">
          {/* Only shown when there is actually a file. Some merchants
              put the receipt in the email body and attach nothing,
              and those rows have no URL to open. */}
          {invoice.fileUrl && previewKind(invoice) !== "none" && (
            <button
              type="button"
              onClick={() => setPreviewInvoice(invoice)}
              aria-label={`Preview ${invoice.fileName}`}
              className="btn-base btn-ghost w-7 h-7 px-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={`preview-invoice-${invoice.id}`}
            >
              <Eye size={15} strokeWidth={2} />
            </button>
          )}
          {invoice.fileUrl && (
            <a
              href={downloadUrl(invoice.fileUrl)}
              download={invoice.fileName}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Download ${invoice.fileName}`}
              className="btn-base btn-ghost w-7 h-7 px-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={`download-invoice-${invoice.id}`}
            >
              <Download size={15} strokeWidth={2} />
            </a>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              deleteInvoiceMutation.mutate(invoice.id);
            }}
            disabled={deleteInvoiceMutation.isPending}
            className="btn-base btn-ghost w-7 h-7 px-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={`delete-invoice-${invoice.id}`}
          >
            <Trash2 size={15} strokeWidth={2} className="text-destructive" />
          </button>
        </div>
      </div>
  );

  return (
    <div
      className={cn("flex flex-col gap-5", statusOn && "min-h-full")}
      style={{ padding: statusOn ? "20px 24px 0" : "20px 24px 32px" }}
      data-testid="subscription-detail-page"
    >
      {/* 1. Header */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-start gap-3">
          <ServiceLogo name={subscription.serviceName} merchantEmail={subscription.merchantEmail} size={34} />
          <h2 className="t-object flex-1 min-w-0 [text-wrap:pretty]" data-testid="subscription-name">
            {subscription.serviceName}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="btn-base btn-ghost w-8 h-8 px-0 flex-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="back-to-list-btn"
          >
            <X size={17} strokeWidth={2} />
          </button>
        </div>

        <div className="flex flex-wrap gap-[5px] pl-[43px]">
          <span className="badge-cadence">{frequencyLabel}</span>
          {category && <span className="badge-category">{category}</span>}
          <span className={cn("badge-status", badge.cls)} data-testid="status-badge">{badge.label}</span>
          {endsOnFuture && (
            <span className="badge-cadence" data-testid="ends-on-tag">Ends {formatDayShort(subscription.endsOn)}</span>
          )}
        </div>
      </div>

      {statusOn && (
        <StatusNotice
          subscription={subscription}
          life={life}
          endsOnFuture={endsOnFuture}
          priceLabel={`${money.primary}${FREQUENCY_SUFFIX[subscription.frequency] ?? ''}`}
        />
      )}

      {/* 2. Summary strip. An inactive subscription has its notice instead. */}
      {!(statusOn && life === 'inactive') && (
      <div className="surface-card flex flex-wrap">
        <div className="flex-1 min-w-[140px]" style={{ padding: "13px 16px" }}>
          <div className="t-label">
            {statusOn
              ? endsOnFuture
                ? 'Paid until'
                : life === 'needs_review'
                  ? 'Last paid'
                  : subscription.expectedNextPaymentAt && isPast(subscription.expectedNextPaymentAt)
                    ? 'Payment due'
                    : 'Next renewal'
              : 'Next renewal'}
          </div>
          {statusOn ? (
            <>
              {(() => {
                const shown = endsOnFuture
                  ? subscription.endsOn
                  : life === 'needs_review'
                    ? subscription.lastPaymentAt
                    : subscription.expectedNextPaymentAt ?? subscription.nextBillingDate;
                return (
                  <>
                    <div className="text-[14.5px] font-semibold text-ink mt-1">{formatDay(shown) || "—"}</div>
                    {shown && <div className="text-[11px] text-muted-foreground mt-0.5">{relativeDay(shown)}</div>}
                  </>
                );
              })()}
            </>
          ) : (
            <>
              <div className="text-[14.5px] font-semibold text-ink mt-1">
                {nextBillingDate ? formatDate(nextBillingDate) : "—"}
              </div>
              {nextBillingDate && (
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {relativeFromNow(nextBillingDate)}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex-1 min-w-[140px] border-l border-line-soft" style={{ padding: "13px 16px" }}>
          <div className="t-label">Amount</div>
          <div className="t-price mt-1">{money.primary}</div>
          {/* The charge as the merchant issued it, when that is a different
              currency from the one this account is read in. */}
          {money.secondary && (
            <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
              billed {money.secondary}
            </div>
          )}
          {monthlyMoney && (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {monthlyMoney.primary} / month equivalent
            </div>
          )}
        </div>
      </div>
      )}

      {/* 3. Details */}
      <div className="surface-card flex flex-col" style={{ padding: "14px 16px" }}>
        {/*
          Edit sits in this card's own header rather than in the actions row
          at the foot of the panel: it edits these fields and nothing else,
          and a control reads as belonging to whatever it is next to.
        */}
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className="t-label">Details</h3>
          {!isEditMode ? (
            <button
              type="button"
              onClick={() => setIsEditMode(true)}
              className="btn-base btn-ghost h-7 px-2 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="edit-btn"
            >
              <Edit size={14} strokeWidth={2} />
              Edit
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCancel}
                className="btn-base btn-ghost h-7 px-2 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="cancel-edit-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="btn-base btn-primary h-7 px-2.5 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="save-btn"
              >
                <Save size={14} strokeWidth={2} />
                {updateMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>

        {/* Timeline: billing cycle + started */}
        <div className="contents" data-testid="timeline-section">
          <DetailRow label="Billing cycle">
            <span className="text-[13px] text-ink">{billingCycle}</span>
          </DetailRow>
          {isEditMode && (
            <DetailRow label="Next renewal">
              <div className="field">
                <input
                  type="date"
                  value={renewalInput}
                  onChange={(e) => setRenewalInput(e.target.value)}
                  data-testid="input-next-billing-date"
                />
              </div>
            </DetailRow>
          )}
          <DetailRow label="Started">
            <span className="text-[13px] text-ink">{startedDate ? formatDate(startedDate) : "—"}</span>
          </DetailRow>
        </div>

        {/* About: name (edit only), category, description, source account */}
        <div className="contents" data-testid="about-section">
          {isEditMode && (
            <DetailRow label="Name">
              <div className="field">
                <input
                  value={formData.serviceName || ''}
                  onChange={(e) => setFormData({ ...formData, serviceName: e.target.value })}
                  data-testid="input-service-name"
                />
              </div>
            </DetailRow>
          )}
          <DetailRow label="Category">
            {isEditMode ? (
              <div className="field">
                <input
                  value={formData.category || ''}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  placeholder="e.g., Entertainment, Software, Utilities"
                  data-testid="input-category"
                />
              </div>
            ) : (
              <span className="text-[13px] text-ink">{category || 'Not specified'}</span>
            )}
          </DetailRow>
          <DetailRow label="Description">
            {isEditMode ? (
              <textarea
                value={formData.description || ''}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Add notes about this subscription..."
                rows={3}
                data-testid="input-description"
                className="w-full px-[11px] py-[7px] border border-line-firm rounded-lg bg-surface text-[13px] text-ink placeholder:text-muted-foreground focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft resize-none"
              />
            ) : (
              <span className="text-[13px] text-ink whitespace-pre-wrap">
                {subscription.description || 'No description'}
              </span>
            )}
          </DetailRow>
          {hasSourceAccount && (
            <DetailRow label="Source email">
              <div className="flex items-center gap-1.5" data-testid="source-email-account">
                {gmailAccount && (
                  <>
                    <SiGoogle size={12} className="text-muted-foreground flex-none" />
                    <span className="text-[13px] text-ink truncate">{gmailAccount.gmailEmail}</span>
                  </>
                )}
                {outlookAccount && (
                  <>
                    <Mail size={13} strokeWidth={2} className="text-muted-foreground flex-none" />
                    <span className="text-[13px] text-ink truncate">{outlookAccount.outlookEmail}</span>
                  </>
                )}
              </div>
            </DetailRow>
          )}
        </div>

        {/* Ownership: owner name + email */}
        <div className="contents" data-testid="ownership-section">
          <DetailRow label="Owner">
            {isEditMode ? (
              <div className="field">
                <input
                  value={formData.ownerName || ''}
                  onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
                  placeholder="Enter owner name"
                  data-testid="input-owner-name"
                />
              </div>
            ) : (
              <span className="text-[13px] text-ink">{subscription.ownerName || 'Not specified'}</span>
            )}
          </DetailRow>
          <DetailRow label="Owner email">
            {isEditMode ? (
              <div className="field">
                <input
                  type="email"
                  value={formData.ownerEmail || ''}
                  onChange={(e) => setFormData({ ...formData, ownerEmail: e.target.value })}
                  placeholder="owner@example.com"
                  data-testid="input-owner-email"
                />
              </div>
            ) : (
              <span className="text-[13px] text-ink">{subscription.ownerEmail || 'Not specified'}</span>
            )}
          </DetailRow>
          {/* What the merchant actually charged, in its own currency. Taken
              from the receipt, so it is shown, never edited. */}
          <DetailRow label="Billed in" noBorder>
            <span className="text-[13px] text-ink tabular-nums" data-testid="billed-in">
              {formatCurrency(amount, subscription.currency)}
            </span>
          </DetailRow>
        </div>
      </div>

      {/* 3b. Payments: counted payments only, newest first (switch only). Nothing
           for a subscription added by hand: it has no inbox to find them in. */}
      {statusOn && paymentView?.history_state !== 'manual' && (
        <PaymentsSection
          view={paymentView}
          loading={loadingPayments}
          fallbackCurrency={subscription.currency}
        />
      )}

      {/* 4. Invoices. With the switch, bills and receipts sit in their own
           lists, five at a time. */}
      {statusOn ? (
        <>
          {invoices.length === 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="t-label">Invoices</h3>
                {uploadButton}
              </div>
              <div className="surface-card overflow-hidden" data-testid="invoices-section">
                <p className="py-8 text-center text-[13px] text-muted-foreground">
                  Nothing found for this subscription yet.
                </p>
              </div>
            </div>
          )}
          {([
            { key: "invoices", title: "Invoices", files: documents.invoices, all: showAllInvoices, setAll: setShowAllInvoices, upload: true },
            { key: "receipts", title: "Receipts", files: documents.receipts, all: showAllReceipts, setAll: setShowAllReceipts, upload: documents.invoices.length === 0 },
          ] as const).map((group) => {
            if (group.files.length === 0) return null;
            const shown = group.all ? group.files : group.files.slice(0, DOCUMENT_LIMIT);
            const rest = group.files.length - DOCUMENT_LIMIT;
            const listId = `${group.key}-list`;
            return (
              <div key={group.key} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="t-label">
                    {group.title}
                    <span className="text-muted-foreground font-normal"> · {group.files.length}</span>
                  </h3>
                  {group.upload && uploadButton}
                </div>
                <div className="surface-card overflow-hidden" data-testid={`${group.key}-section`}>
                  <div id={listId}>
                    {shown.map((invoice, idx) => invoiceRow(invoice, idx === shown.length - 1))}
                  </div>
                  {rest > 0 && (
                    <button
                      type="button"
                      onClick={() => group.setAll(!group.all)}
                      aria-expanded={group.all}
                      aria-controls={listId}
                      className="w-full h-[42px] border-t border-line-soft text-[13px] font-semibold text-accent hover:bg-line-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      data-testid={`${group.key}-toggle`}
                    >
                      {group.all ? "Show less" : `Show ${rest} more`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="t-label">
              Invoices
              {invoices.length > 0 && (
                <span className="text-muted-foreground font-normal"> · {invoices.length}</span>
              )}
            </h3>
            {uploadButton}
          </div>

          <div className="surface-card overflow-hidden" data-testid="invoices-section">
            {invoices.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-muted-foreground">
                Nothing found for this subscription yet.
              </p>
            ) : (
              invoices.map((invoice, idx) => invoiceRow(invoice, idx === invoices.length - 1))
            )}
          </div>
        </div>
      )}

      {/* 5. Actions. With the switch: a bar along the bottom, Delete on the
           left and the status answer on the right. */}
      {statusOn && (
        <div
          className="sticky bottom-0 z-10 mt-auto -mx-6 px-6 py-3.5 bg-surface border-t border-line flex items-center justify-between gap-2 flex-wrap"
          data-testid="action-bar"
        >
          <button
            type="button"
            onClick={() => setShowDeleteDialog(true)}
            className="btn-base h-8 px-3 text-[12.5px] font-semibold border border-destructive bg-destructive-soft text-destructive hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="delete-btn"
          >
            <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
            Delete
          </button>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {life !== 'inactive' && (
              <button
                type="button"
                onClick={() => answerMutation.mutate('mark-inactive')}
                disabled={answerMutation.isPending}
                className="btn-base btn-secondary h-8 px-3 text-[12.5px] font-semibold bg-rail"
                data-testid="mark-inactive-btn"
              >
                <Archive size={14} strokeWidth={2} aria-hidden="true" />
                Mark as inactive
              </button>
            )}
            {life === 'needs_review' && (
              <button
                type="button"
                onClick={() => answerMutation.mutate('still-active')}
                disabled={answerMutation.isPending}
                className="btn-base h-8 px-3 text-[12.5px] font-semibold border border-success bg-success-soft text-success hover:brightness-95"
                data-testid="still-active-btn"
              >
                <CircleCheck size={14} strokeWidth={2} aria-hidden="true" />
                Still active
              </button>
            )}
            {life === 'inactive' && subscription.inactiveSource !== 'email' && (
              <button
                type="button"
                onClick={() => answerMutation.mutate('mark-active')}
                disabled={answerMutation.isPending}
                className="btn-base h-8 px-3 text-[12.5px] font-semibold border border-success bg-success-soft text-success hover:brightness-95"
                data-testid="mark-active-btn"
              >
                <CircleCheck size={14} strokeWidth={2} aria-hidden="true" />
                Mark as active
              </button>
            )}
          </div>
        </div>
      )}
      {!statusOn && (
      <div className="border-t border-line pt-4 flex justify-end">
        <button
          type="button"
          onClick={() => setShowDeleteDialog(true)}
          className="btn-base bg-destructive text-destructive-foreground hover:bg-destructive/90 border-none font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="delete-btn"
        >
          <Trash2 size={15} strokeWidth={2} />
          Delete
        </button>
      </div>
      )}

      <InvoicePreview
        invoice={previewInvoice}
        open={Boolean(previewInvoice)}
        onOpenChange={(open) => { if (!open) setPreviewInvoice(null); }}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent data-testid="delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Subscription</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>Are you sure you want to delete this subscription?</p>
              <p className="font-semibold text-destructive">
                This action cannot be undone. This will permanently delete:
              </p>
              <ul className="list-disc list-inside pl-4 space-y-1">
                <li>The subscription details</li>
                <li>All {invoices.length} related invoice{invoices.length !== 1 ? 's' : ''}</li>
                <li>Invoice files from storage</li>
              </ul>
              <p className="mt-2">Your dashboard statistics will be updated automatically.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="btn-base btn-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="cancel-delete-btn"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deleteSubscriptionMutation.mutate();
                setShowDeleteDialog(false);
              }}
              disabled={deleteSubscriptionMutation.isPending}
              className="btn-base bg-destructive text-destructive-foreground hover:bg-destructive/90 border-none font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="confirm-delete-btn"
            >
              {deleteSubscriptionMutation.isPending ? 'Deleting...' : 'Delete Permanently'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * A label/value row in the Details card.
 *
 * Label left, value hard against the card's right edge. With the values
 * ragged in the middle of the row there was no edge for the eye to run down;
 * against the right edge they line up as a column whatever their length.
 * Below 420px the pair stacks and both go left, because a right-aligned
 * value under its own label reads as unrelated to it.
 */
function DetailRow({
  label,
  noBorder,
  children,
}: {
  label: string;
  noBorder?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 py-2 min-[420px]:flex-row min-[420px]:items-baseline min-[420px]:gap-4",
        !noBorder && "border-b border-line-soft"
      )}
    >
      <span className="text-[12px] text-muted-foreground min-[420px]:flex-none">
        {label}
      </span>
      {/*
        justify-end as well as text-right: some values are a flex row of their
        own (the source email's provider icon beside the address), and those
        ignore text-align.
      */}
      <div className="min-w-0 min-[420px]:flex-1 min-[420px]:text-right min-[420px]:flex min-[420px]:flex-col min-[420px]:items-end">
        {children}
      </div>
    </div>
  );
}

/** Parses a date field into a valid Date, or null if missing/unparseable. */
/**
 * A Date as `<input type="date">` wants it.
 *
 * Built from the local date parts rather than `toISOString().slice(0, 10)`,
 * which reports the UTC day -- so a renewal on the 1st, opened anywhere east
 * of UTC, would show as the 31st of the month before.
 */
function toDateInput(date: Date | null): string {
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseValidDate(date: string | Date | null | undefined): Date | null {
  if (!date) return null;
  const d = new Date(date);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * The earliest date this record knows about -- used for "Started". There is
 * no explicit start-date column, so this takes the earliest of the dates the
 * subscription and its invoices actually carry (when it was first detected,
 * the last email seen, and every invoice's upload time).
 */
function earliestKnownDate(subscription: Subscription, invoices: Invoice[]): Date | null {
  const candidates = [
    subscription.detectedAt,
    subscription.lastEmailDate,
    ...invoices.map((i) => i.uploadedAt),
  ]
    .map((d) => parseValidDate(d))
    .filter((d): d is Date => d !== null);

  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates.map((d) => d.getTime())));
}

/** "in 5 months" / "in 12 days" / "3 days ago", relative to now. */
/** 1st, 2nd, 3rd, 4th, ... */
function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]}`;
}

/** "Monthly, every 19th" / "Yearly, every 3 March" / "Weekly, every Tuesday" --
 *  the cadence plus, when a next billing date is known, the day it lands on. */
function billingCycleLabel(
  frequency: string,
  frequencyLabel: string,
  nextBillingDate: Date | null
): string {
  if (!nextBillingDate) return frequencyLabel;

  switch (frequency) {
    case 'monthly':
    case 'quarterly':
      return `${frequencyLabel}, every ${ordinal(nextBillingDate.getDate())}`;
    case 'yearly':
      return `${frequencyLabel}, every ${nextBillingDate.getDate()} ${nextBillingDate.toLocaleDateString('en-US', { month: 'long' })}`;
    case 'weekly':
      return `${frequencyLabel}, every ${nextBillingDate.toLocaleDateString('en-US', { weekday: 'long' })}`;
    default:
      return frequencyLabel;
  }
}

/** The monthly-equivalent figure for a non-monthly cadence, or null for a
 *  monthly subscription where it would just repeat the amount already shown. */
function monthlyEquivalentAmount(amount: number, frequency: string): number | null {
  switch (frequency) {
    case 'yearly':
      return amount / 12;
    case 'quarterly':
      return amount / 3;
    case 'weekly':
      return amount * (52 / 12);
    default:
      return null;
  }
}


/**
 * What the status means, in a line or two, above the figures. Words follow the
 * designs: it says what was seen ("no payment since"), never "cancelled" unless
 * an email said so.
 */
function StatusNotice({
  subscription: sub,
  life,
  endsOnFuture,
  priceLabel,
}: {
  subscription: Subscription;
  life: 'active' | 'needs_review' | 'inactive';
  endsOnFuture: boolean;
  priceLabel: string;
}) {
  if (life === 'inactive') {
    const how = sub.inactiveSource === 'user' ? 'you marked it' : 'cancelled';
    return (
      <div role="status" className="rounded-card border border-line bg-line-soft px-4 py-3 flex flex-col gap-0.5" data-testid="status-notice">
        <span className="text-[14px] font-semibold text-ink">
          {sub.inactiveSince ? `Inactive since ${formatDayLong(sub.inactiveSince)} · ${how}` : 'Inactive'}
        </span>
        <span className="text-[12.5px] text-ink-body">
          Not counted in your totals.
          {sub.lastPaymentAt ? ` Last paid ${formatDay(sub.lastPaymentAt)} · ${priceLabel}` : ''}
        </span>
      </div>
    );
  }
  if (endsOnFuture) {
    return (
      <div role="status" className="rounded-card border border-line bg-line-soft px-4 py-3.5 flex gap-3" data-testid="status-notice">
        <CalendarDays size={20} strokeWidth={2} className="flex-none mt-px text-ink-body" aria-hidden="true" />
        <span className="text-[13.5px] leading-normal text-ink-strong">
          <span className="font-semibold">
            {sub.cancelledAt ? `Cancelled on ${formatDayLong(sub.cancelledAt)}.` : 'Cancelled.'}
          </span>{' '}
          Paid until {formatDayLong(sub.endsOn)}, then it becomes inactive.
        </span>
      </div>
    );
  }
  if (life === 'needs_review') {
    return (
      <div role="status" className="rounded-card border border-warning-line bg-warning-bg px-4 py-3.5 flex gap-3" data-testid="status-notice">
        <TriangleAlert size={20} strokeWidth={2} className="flex-none mt-px text-warning" aria-hidden="true" />
        <span className="text-[13.5px] leading-normal text-warning">
          <span className="font-semibold">Still paying?</span>{' '}
          {sub.lastPaymentAt
            ? `We haven't seen a payment since ${formatDay(sub.lastPaymentAt)}.`
            : "We haven't seen a recent payment."}
        </span>
      </div>
    );
  }
  if (sub.lifecycleReason === 'paid_after_inactive' && sub.lastPaymentAt) {
    return (
      <div role="status" className="rounded-card border border-line bg-line-soft px-4 py-3 text-[13.5px] text-ink-strong" data-testid="status-notice">
        Paid again on {formatDay(sub.lastPaymentAt)}, so it is active again.
      </div>
    );
  }
  return null;
}

/**
 * The Payments list: counted payments only, newest first, grouped by year with
 * "Show more" when there are many. States of the history behind it come from
 * the server: still being found, or can't be updated right now (plain words,
 * no buttons).
 */
function PaymentsSection({
  view,
  loading,
  fallbackCurrency,
}: {
  view: PaymentView | undefined;
  loading: boolean;
  fallbackCurrency: string;
}) {
  const payments = view?.payments ?? [];
  const grouped = payments.length > FLAT_LIMIT;
  const groups = useMemo(() => groupByYear(payments), [payments]);
  // The newest year starts open, the rest closed; "Show more" opens a year in full.
  const [closedYears, setClosedYears] = useState<Record<string, boolean>>({});
  const [fullYears, setFullYears] = useState<Record<string, boolean>>({});
  const yearOpen = (year: string, index: number) => closedYears[year] === undefined ? index === 0 : !closedYears[year];

  const heading = payments.length > 0 ? (
    <>Payments <span className="text-muted-foreground font-normal">· {payments.length}</span></>
  ) : (
    <>Payment history</>
  );

  const money = (p: PaymentRow) =>
    p.amount === null ? null : formatCurrency(Number(p.amount), p.currency ?? fallbackCurrency);

  const row = (p: PaymentRow, key: string, divider: boolean) => (
    <li
      key={key}
      className={cn("flex items-center gap-3 px-4 py-3", divider && "border-t border-line-soft")}
      data-testid="payment-row"
    >
      <span className="flex flex-col gap-0.5 flex-1 min-w-0">
        <span className="text-[13.5px] font-semibold text-ink">{formatDay(p.date)}</span>
        <span className="text-[12px] text-muted-foreground">{p.source}</span>
      </span>
      {money(p) ? (
        <span className="text-[13.5px] tabular-nums text-ink">{money(p)}</span>
      ) : (
        <span className="text-[12.5px] text-muted-foreground">Amount not shown</span>
      )}
    </li>
  );

  return (
    <section className="flex flex-col gap-2.5" aria-labelledby="payments-heading" data-testid="payments-section">
      <h3 id="payments-heading" className="t-label">{heading}</h3>

      {loading && !view ? (
        <div className="surface-card h-16 animate-pulse" aria-busy="true" />
      ) : (
        <>
          {view?.history_state === 'searching' && (
            <div
              role="status"
              aria-live="polite"
              className="surface-card flex items-center gap-3 px-4 py-3.5 text-[13.5px] text-ink-body"
              data-testid="history-searching"
            >
              <Loader2 size={16} strokeWidth={2} className="animate-spin flex-none" aria-hidden="true" />
              Finding payment history in your inbox…
            </div>
          )}

          {view?.history_state === 'cant_update' && (
            <div
              role="alert"
              className="rounded-[10px] border border-warning-line bg-warning-bg px-4 py-3.5 flex gap-3"
              data-testid="history-cant-update"
            >
              <TriangleAlert size={20} strokeWidth={2} className="flex-none mt-px text-warning" aria-hidden="true" />
              <span className="text-[13.5px] leading-normal text-warning">
                Payment history can't be updated right now. What was found earlier is kept.
              </span>
            </div>
          )}

          {view?.payment_failed_on && (
            <div
              role="status"
              className="rounded-[10px] bg-destructive-soft border border-destructive/20 px-4 py-3 flex items-center gap-2.5 text-[13.5px] text-destructive"
              data-testid="payment-failed"
            >
              <CreditCard size={16} strokeWidth={2} className="flex-none" aria-hidden="true" />
              <span>
                <span className="font-semibold">Payment failed {formatDay(view.payment_failed_on).replace(/, \d{4}$/, '')}</span> · update your card
              </span>
            </div>
          )}

          {payments.length > 0 ? (
            grouped ? (
              <div className="surface-card overflow-hidden">
                {groups.map((group, gi) => {
                  const open = yearOpen(group.year, gi);
                  const full = fullYears[group.year];
                  const shown = open ? (full ? group.rows : group.rows.slice(0, ROWS_PER_YEAR)) : [];
                  const rest = group.rows.length - shown.length;
                  const listId = `payments-year-${group.year}`;
                  return (
                    <div key={group.year} className={cn(gi > 0 && "border-t border-line")}>
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={listId}
                        onClick={() => setClosedYears((prev) => ({ ...prev, [group.year]: open }))}
                        className="w-full h-11 px-4 flex items-center gap-2 bg-canvas text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        data-testid={`payments-year-${group.year}`}
                      >
                        {open ? <ChevronDown size={14} strokeWidth={2} aria-hidden="true" /> : <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />}
                        <span className="flex-1 text-[13px] font-semibold text-ink">{group.year}</span>
                        <span className="text-[12.5px] text-muted-foreground tabular-nums">
                          {paymentCount(group.rows.length)}
                          {group.total ? ` · ${formatCurrency(group.total.amount, group.total.currency).replace(/\.00$/, '')}` : ''}
                        </span>
                      </button>
                      {open && (
                        <ul id={listId} aria-label={`Payments in ${group.year}`}>
                          {shown.map((p, i) => row(p, `${p.date}-${p.source}-${i}`, true))}
                        </ul>
                      )}
                      {open && rest > 0 && (
                        <button
                          type="button"
                          onClick={() => setFullYears((prev) => ({ ...prev, [group.year]: true }))}
                          className="w-full h-[42px] border-t border-line-soft text-[13px] font-semibold text-accent hover:bg-line-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                          data-testid={`payments-more-${group.year}`}
                        >
                          Show {rest} more from {group.year}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <ul className="surface-card overflow-hidden" aria-label="Payments">
                {payments.map((p, i) => row(p, `${p.date}-${p.source}-${i}`, i > 0))}
              </ul>
            )
          ) : (
            view?.history_state === 'ok' && (
              <p className="surface-card py-6 text-center text-[13px] text-muted-foreground" data-testid="payments-empty">
                No payments found yet.
              </p>
            )
          )}

          {payments.length > 0 && (
            <p className="text-[12px] text-muted-foreground">
              Newest first.
              {view?.searched_since ? ` From your emails since ${formatMonthYear(view.searched_since)}.` : ''}
            </p>
          )}
          {view?.some_bills_only && (
            <p className="text-[12px] text-muted-foreground" data-testid="bills-only-note">
              Some months only have a bill, so they are not listed.
            </p>
          )}
        </>
      )}
    </section>
  );
}
