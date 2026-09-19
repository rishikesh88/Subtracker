import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import type { Subscription, Invoice, GmailAccount, OutlookAccount } from "@shared/schema";
import type { UploadResult } from "@uppy/core";
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
import { Edit, Save, X, Upload, Download, Trash2, FileText, Mail, Eye } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ObjectUploader } from "@/components/ObjectUploader";
import { InvoicePreview, previewKind, downloadUrl } from "@/components/InvoicePreview";
import { cn } from "@/lib/utils";
import { displayCategory, statusBadge, formatDate, formatCurrency, FREQUENCY_LABEL } from "@/lib/format";

/**
 * The subscription detail, rendered inside the drawer on the subscriptions
 * page rather than as a page of its own.
 *
 * The id comes in as a prop instead of being read from the route, because the
 * drawer and the list share one URL: /subscriptions/:id renders the list with
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
  const [isEditMode, setIsEditMode] = useState(false);
  const [formData, setFormData] = useState<Partial<Subscription>>({});
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  // The invoice currently being looked at, or null when nothing is open.
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);

  const subscriptionId = idFromProps ?? params?.id;

  // Closing falls back to navigation when no handler is supplied, so the
  // component still works if it is ever rendered on its own again.
  const close = onClose ?? (() => setLocation("/subscriptions"));

  // Fetch subscription details
  const { data: subscription, isLoading: loadingSubscription } = useQuery<Subscription>({
    queryKey: ['/api/subscriptions', subscriptionId],
    enabled: !!subscriptionId,
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
      setLocation('/subscriptions');
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete subscription",
        variant: "destructive",
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
  const handleUploadComplete = async (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    if (result.successful && result.successful.length > 0) {
      for (const file of result.successful) {
        const fileUrl = file.uploadURL;
        const fileName = file.name;
        const fileType = file.type || 'application/octet-stream';
        const fileSize = file.size || 0;

        try {
          await apiRequest('POST', `/api/subscriptions/${subscriptionId}/invoices`, {
            fileUrl,
            fileName,
            fileType,
            fileSize,
            source: 'manual',
          });
        } catch (error) {
          console.error('Failed to save invoice:', error);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions', subscriptionId, 'invoices'] });
      toast({
        title: "Success",
        description: `${result.successful.length} invoice(s) uploaded successfully`,
      });
    }
  };

  const handleSave = () => {
    updateMutation.mutate(formData);
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

  const initial = (subscription.serviceName?.[0] ?? "?").toUpperCase();
  const badge = statusBadge(subscription.status);
  const frequencyLabel = FREQUENCY_LABEL[subscription.frequency] ?? subscription.frequency;
  const category = displayCategory(subscription.category);

  const amount = parseFloat(subscription.amount) || 0;
  const monthlyEquivalent = monthlyEquivalentAmount(amount, subscription.frequency);
  const nextBillingDate = parseValidDate(subscription.nextBillingDate);
  const billingCycle = billingCycleLabel(subscription.frequency, frequencyLabel, nextBillingDate);
  const startedDate = earliestKnownDate(subscription, invoices);

  const hasSourceAccount = !!(gmailAccount || outlookAccount);

  return (
    <div className="flex flex-col gap-5" style={{ padding: "20px 24px 32px" }} data-testid="subscription-detail-page">
      {/* 1. Header */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-start gap-3">
          <span className="w-[34px] h-[34px] flex-none rounded-logo bg-line-soft flex items-center justify-center text-[14px] font-bold text-ink-body">
            {initial}
          </span>
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
          <span className={cn("badge-status", badge.cls)}>{badge.label}</span>
        </div>
      </div>

      {/* 2. Summary strip */}
      <div className="surface-card flex flex-wrap">
        <div className="flex-1 min-w-[140px]" style={{ padding: "13px 16px" }}>
          <div className="t-label">Next renewal</div>
          <div className="text-[14.5px] font-semibold text-ink mt-1">
            {nextBillingDate ? formatDate(nextBillingDate) : "—"}
          </div>
          {nextBillingDate && (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {relativeFromNow(nextBillingDate)}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-[140px] border-l border-line-soft" style={{ padding: "13px 16px" }}>
          <div className="t-label">Amount</div>
          <div className="t-price mt-1">{formatCurrency(amount, subscription.currency)}</div>
          {monthlyEquivalent !== null && (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {formatCurrency(monthlyEquivalent, subscription.currency)} / month equivalent
            </div>
          )}
        </div>
      </div>

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
          <DetailRow label="Owner email" noBorder>
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
        </div>
      </div>

      {/* 4. Invoices */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="t-label">
            Invoices
            {invoices.length > 0 && (
              <span className="text-muted-foreground font-normal"> · {invoices.length}</span>
            )}
          </h3>
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
        </div>

        <div className="surface-card overflow-hidden" data-testid="invoices-section">
          {invoices.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-muted-foreground">
              Nothing found for this subscription yet.
            </p>
          ) : (
            invoices.map((invoice, idx) => (
              <div
                key={invoice.id}
                className={cn(
                  "flex items-center gap-3 p-3",
                  idx !== invoices.length - 1 && "border-b border-line-soft",
                  previewKind(invoice) !== "none" && "cursor-pointer hover:bg-line-soft"
                )}
                data-testid={`invoice-${invoice.id}`}
                onClick={() => previewKind(invoice) !== "none" && setPreviewInvoice(invoice)}
                role={previewKind(invoice) !== "none" ? "button" : undefined}
              >
                {invoice.fileUrl ? (
                  <FileText size={15} strokeWidth={2} className="text-muted-foreground flex-none" />
                ) : (
                  <Mail size={15} strokeWidth={2} className="text-muted-foreground flex-none" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-ink truncate">{invoice.fileName}</p>
                  <p className="text-[11.5px] text-muted-foreground mt-0.5">
                    {formatDate(invoice.uploadedAt)}
                    {!invoice.fileUrl && " · From the email — no file attached"}
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
            ))
          )}
        </div>
      </div>

      {/* 5. Actions -- Delete alone, right aligned like every other CTA.
           Edit moved into the Details card it acts on. */}
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
 * Both columns are left aligned and the label column is only as wide as the
 * longest label needs, so the value starts close to the word it answers
 * rather than across a gutter -- which is what a wide panel turned it into.
 * Below 420px the pair stacks, because a fixed label column plus a long
 * value has nowhere left to go.
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
        "flex flex-col gap-0.5 py-2 min-[420px]:flex-row min-[420px]:items-baseline min-[420px]:gap-3",
        !noBorder && "border-b border-line-soft"
      )}
    >
      <span className="text-[12px] text-muted-foreground min-[420px]:w-[92px] min-[420px]:flex-none">
        {label}
      </span>
      <div className="min-w-0 text-left min-[420px]:flex-1">{children}</div>
    </div>
  );
}

/** Parses a date field into a valid Date, or null if missing/unparseable. */
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
function relativeFromNow(date: Date): string {
  const diffDays = Math.round((date.getTime() - Date.now()) / 86400000);
  if (diffDays === 0) return "today";

  const past = diffDays < 0;
  const days = Math.abs(diffDays);
  if (days < 30) {
    return past ? `${days} day${days === 1 ? "" : "s"} ago` : `in ${days} day${days === 1 ? "" : "s"}`;
  }
  const months = Math.round(days / 30);
  return past ? `${months} month${months === 1 ? "" : "s"} ago` : `in ${months} month${months === 1 ? "" : "s"}`;
}

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
