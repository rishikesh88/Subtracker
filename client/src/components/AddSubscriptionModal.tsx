import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { UploadResult } from "@uppy/core";
import { ArrowLeft, Check, Plus, Search, Upload, X } from "lucide-react";

import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  browseServices,
  SERVICE_CATEGORIES,
  type CatalogueService,
} from "@/lib/serviceCatalogue";
import { ServiceLogo } from "@/components/ServiceLogo";
import { ObjectUploader } from "@/components/ObjectUploader";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/* -------------------------------------------------------------------------
 * A subscription is added in three passes: which service, what it costs, and
 * who owns it. The old form asked all of it at once, including the two
 * optional fields, and offered no help naming the service.
 *
 * The receipt is the reason the last step is last. An invoice row needs a
 * subscription id, so nothing can be filed until the subscription exists.
 * Files chosen on step three go to object storage straight away -- that part
 * needs no id -- and are attached once the subscription has been created.
 * ------------------------------------------------------------------------- */

type Frequency = "monthly" | "quarterly" | "yearly" | "weekly";

interface PendingInvoice {
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

interface AddSubscriptionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CURRENCIES = [
  { code: "INR", label: "INR (₹)" },
  { code: "USD", label: "USD ($)" },
  { code: "EUR", label: "EUR (€)" },
  { code: "GBP", label: "GBP (£)" },
];

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
  { value: "weekly", label: "Weekly" },
];

const STEPS = [
  { title: "Service", hint: "What you pay for" },
  { title: "Cost", hint: "How much, how often" },
  { title: "Details", hint: "Owner and receipt" },
];

export function AddSubscriptionModal({ open, onOpenChange }: AddSubscriptionModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState(1);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(SERVICE_CATEGORIES[0]);
  const [service, setService] = useState<CatalogueService | null>(null);
  const [customName, setCustomName] = useState("");

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [nextBillingDate, setNextBillingDate] = useState("");
  /* The subscription's own category, distinct from the tab above: choosing
     Slack fills this with "Collaboration", but it stays editable. */
  const [categoryField, setCategoryField] = useState("");

  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [invoices, setInvoices] = useState<PendingInvoice[]>([]);

  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const serviceName = service?.name ?? customName.trim();
  const results = useMemo(() => browseServices(query, category), [query, category]);

  /* A closed dialog keeps its state in React, so a second open would show the
     last attempt half-filled. Reset on open rather than on close, so the
     fields do not visibly empty themselves during the closing animation. */
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setQuery("");
    setCategory(SERVICE_CATEGORIES[0]);
    setService(null);
    setCustomName("");
    setAmount("");
    setCurrency("INR");
    setFrequency("monthly");
    setNextBillingDate("");
    setCategoryField("");
    setOwnerName("");
    setOwnerEmail("");
    setInvoices([]);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (open && step === 1) searchRef.current?.focus();
  }, [open, step]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const serviceKey = `${serviceName.toLowerCase().replace(/\s+/g, "-")}-${frequency}`;
      const res = await apiRequest("POST", "/api/subscriptions", {
        serviceName,
        serviceKey,
        amount: Number(amount).toString(),
        currency,
        frequency,
        category: categoryField.trim() || null,
        ownerName: ownerName.trim() || null,
        ownerEmail: ownerEmail.trim() || null,
        nextBillingDate: nextBillingDate || null,
        status: "active",
      });
      const created = await res.json();

      /* The subscription is the thing being added; a receipt that fails to
         attach must not fail the whole step. Each is reported on its own. */
      let attached = 0;
      for (const invoice of invoices) {
        try {
          await apiRequest("POST", `/api/subscriptions/${created.id}/invoices`, {
            ...invoice,
            source: "manual",
          });
          attached += 1;
        } catch (err) {
          console.error("Failed to attach invoice:", err);
        }
      }
      return { created, attached };
    },
    onSuccess: ({ attached }) => {
      const missed = invoices.length - attached;
      toast({
        title: `${serviceName} added`,
        description: missed
          ? `${missed} of ${invoices.length} receipts could not be attached. You can upload them from the subscription.`
          : undefined,
        variant: missed ? "destructive" : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions"] });
      queryClient.invalidateQueries({ queryKey: [`/api/stats?userId=${user?.id}`] });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({
        title: "That subscription wasn't added",
        description: err?.message || "Something went wrong. Try again.",
        variant: "destructive",
      });
    },
  });

  function chooseService(next: CatalogueService) {
    setService(next);
    setCustomName("");
    setCategoryField(next.category);
    setError(null);
    setStep(2);
  }

  function chooseCustom() {
    const name = query.trim();
    if (!name) return;
    setService(null);
    setCustomName(name);
    setCategoryField("");
    setError(null);
    setStep(2);
  }

  function goToStepThree() {
    const value = Number(amount);
    if (!amount.trim() || Number.isNaN(value) || value <= 0) {
      setError("Enter how much this costs, as a number above zero.");
      return;
    }
    setError(null);
    setStep(3);
  }

  async function handleGetUploadParameters() {
    const res = await apiRequest("POST", "/api/objects/upload");
    const { uploadURL } = await res.json();
    return { method: "PUT" as const, url: uploadURL };
  }

  function handleUploadComplete(
    result: UploadResult<Record<string, unknown>, Record<string, unknown>>
  ) {
    const added = (result.successful ?? []).map((file) => ({
      fileUrl: String(file.uploadURL),
      fileName: file.name ?? "receipt",
      fileType: file.type || "application/octet-stream",
      fileSize: file.size || 0,
    }));
    if (added.length) setInvoices((prev) => [...prev, ...added]);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[720px] p-0 gap-0 overflow-hidden"
        data-testid="add-subscription-modal"
      >
        {/* --- Header and stepper ------------------------------------- */}
        <div className="px-6 pt-5 pb-4 border-b border-line-soft">
          <h2 className="t-section" data-testid="modal-title">Add subscription</h2>
          <Stepper
            step={step}
            onGoTo={(n) => { setError(null); setStep(n); }}
          />
        </div>

        {/* --- Body --------------------------------------------------- */}
        <div className="px-6 py-5 max-h-[52vh] overflow-y-auto">
          {step === 1 && (
            <ChooseService
              query={query}
              onQuery={setQuery}
              category={category}
              onCategory={setCategory}
              results={results}
              onChoose={chooseService}
              onCustom={chooseCustom}
              searchRef={searchRef}
            />
          )}

          {step > 1 && (
            <>
              {/* Which subscription this is about, restated where the
                  fields are -- the stepper above says where you are, not
                  what you are filling in. */}
              <div className="flex items-center gap-2.5 pb-4 mb-4 border-b border-line-soft">
                <ServiceLogo name={serviceName} size={34} />
                <div className="min-w-0">
                  <p className="t-card-title truncate" data-testid="chosen-service">{serviceName}</p>
                  <p className="t-caption">{service?.category ?? "Added by name"}</p>
                </div>
              </div>

              {step === 2 && (
                <CostAndRenewal
                  amount={amount} onAmount={setAmount}
                  currency={currency} onCurrency={setCurrency}
                  frequency={frequency} onFrequency={setFrequency}
                  nextBillingDate={nextBillingDate} onNextBillingDate={setNextBillingDate}
                  category={categoryField} onCategory={setCategoryField}
                />
              )}

              {step === 3 && (
                <OwnerAndReceipt
                  ownerName={ownerName} onOwnerName={setOwnerName}
                  ownerEmail={ownerEmail} onOwnerEmail={setOwnerEmail}
                  invoices={invoices}
                  onRemoveInvoice={(i) => setInvoices((prev) => prev.filter((_, n) => n !== i))}
                  onGetUploadParameters={handleGetUploadParameters}
                  onUploadComplete={handleUploadComplete}
                  onUploadError={(message) =>
                    toast({ title: "That file wasn't uploaded", description: message, variant: "destructive" })
                  }
                />
              )}
            </>
          )}
        </div>

        {/* --- Footer -------------------------------------------------
            Pinned, with the two actions at opposite ends rather than
            bunched in one corner. The list above runs underneath it. */}
        <div className="border-t border-line-soft bg-rail">
          {error && (
            <p className="px-6 pt-3 t-caption text-destructive" role="alert" data-testid="step-error">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-3 px-6 py-4">
            {step === 1 ? (
              <button
                type="button"
                className="btn-base btn-secondary"
                onClick={() => onOpenChange(false)}
                data-testid="button-cancel-add"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className="btn-base btn-secondary"
                onClick={() => { setError(null); setStep(step - 1); }}
                data-testid="button-back"
              >
                <ArrowLeft size={15} strokeWidth={2} />
                Back
              </button>
            )}

            {step === 2 && (
              <button
                type="button"
                className="btn-base btn-primary"
                onClick={goToStepThree}
                data-testid="button-next"
              >
                Next
              </button>
            )}

            {step === 3 && (
              <button
                type="button"
                className="btn-base btn-primary"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate()}
                data-testid="button-add-subscription"
              >
                {createMutation.isPending ? "Adding\u2026" : "Add subscription"}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- stepper */

/**
 * Three numbered steps across the top, joined by a rule.
 *
 * A step already completed is a tick and stays clickable, so going back two
 * steps is one click rather than two. A step not yet reached is inert --
 * offering it would promise a jump the form cannot honour, since step two
 * needs an amount before step three means anything.
 */
function Stepper({ step, onGoTo }: { step: number; onGoTo: (n: number) => void }) {
  return (
    <ol className="flex items-stretch gap-1 mt-4" data-testid="stepper">
      {STEPS.map((s, i) => {
        const n = i + 1;
        const state = n < step ? "done" : n === step ? "current" : "todo";
        const reachable = state === "done";

        return (
          <li key={s.title} className="flex-1 flex items-center gap-2 min-w-0">
            <button
              type="button"
              disabled={!reachable}
              onClick={() => reachable && onGoTo(n)}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 min-w-0 rounded-[8px] py-1 pr-2 -ml-1 pl-1 text-left",
                reachable && "hover:bg-line-soft cursor-pointer",
                !reachable && "cursor-default",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
              data-testid={`stepper-step-${n}`}
              data-state={state}
            >
              <span
                className={cn(
                  "w-[22px] h-[22px] flex-none rounded-full flex items-center justify-center",
                  "text-[11px] font-semibold tabular-nums",
                  state === "done" && "bg-accent text-white",
                  state === "current" && "bg-ink text-white",
                  state === "todo" && "border border-line-firm text-muted-foreground"
                )}
                aria-hidden="true"
              >
                {state === "done" ? <Check size={13} strokeWidth={2.5} /> : n}
              </span>
              <span className="min-w-0 hidden sm:block">
                <span
                  className={cn(
                    "block text-[12px] font-semibold leading-tight truncate",
                    state === "todo" ? "text-muted-foreground" : "text-ink"
                  )}
                >
                  {s.title}
                </span>
                <span className="block text-[11px] text-muted-foreground leading-tight truncate">
                  {s.hint}
                </span>
              </span>
            </button>

            {i < STEPS.length - 1 && (
              <span
                className={cn(
                  "flex-1 h-px min-w-[12px]",
                  n < step ? "bg-accent" : "bg-line-firm"
                )}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------------------------------------------------------- step 1 */

/* Slug the display name, not the icon slug: nine catalogue rows have no icon
   slug, so keying off it produced ids like "service-option-Microsoft 365". */
function testId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function ChooseService({
  query, onQuery, category, onCategory, results, onChoose, onCustom, searchRef,
}: {
  query: string;
  onQuery: (v: string) => void;
  category: string | null;
  onCategory: (v: string) => void;
  results: CatalogueService[];
  onChoose: (s: CatalogueService) => void;
  onCustom: () => void;
  searchRef: React.RefObject<HTMLInputElement>;
}) {
  const typed = query.trim();
  const searching = typed.length > 0;
  /* An exact hit is already in the grid, so offering to add it again as a
     custom name would be two routes to the same subscription. */
  const exact = results.some((s) => s.name.toLowerCase() === typed.toLowerCase());

  return (
    <div className="flex flex-col gap-4">
      <div className="field flex items-center gap-2">
        <Search size={15} strokeWidth={2} className="flex-none text-muted-foreground" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && typed && !exact) { e.preventDefault(); onCustom(); }
          }}
          placeholder="Search, or type any service name"
          aria-label="Search services"
          data-testid="input-service-search"
        />
      </div>

      {/* Tabs step aside while searching: a search reaches every category,
          so leaving one highlighted would say otherwise. */}
      {!searching && (
        <div
          className="flex items-center gap-1 overflow-x-auto -mx-1 px-1 pb-0.5"
          role="tablist"
          aria-label="Service categories"
        >
          {SERVICE_CATEGORIES.map((c) => {
            const active = c === category;
            return (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onCategory(c)}
                className={cn(
                  "flex-none rounded-[8px] px-2.5 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-ink text-white"
                    : "text-ink-body hover:bg-line-soft"
                )}
                data-testid={`category-tab-${testId(c)}`}
              >
                {c}
              </button>
            );
          })}
        </div>
      )}

      {results.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {results.map((s) => (
            <button
              key={s.name}
              type="button"
              onClick={() => onChoose(s)}
              className={cn(
                // A fixed height rather than h-full: grid rows size themselves,
                // so a two-line description made one row taller than the next.
                "surface-card p-3 flex flex-col gap-2 text-left min-h-[112px]",
                "hover:border-line-firm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
              data-testid={`service-option-${testId(s.name)}`}
            >
              <ServiceLogo name={s.name} size={30} />
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className="t-card-title [text-wrap:pretty]">{s.name}</span>
                <span className="t-caption leading-snug line-clamp-2 [text-wrap:pretty]">
                  {s.description}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {searching && !exact && (
        <button
          type="button"
          onClick={onCustom}
          className={cn(
            "surface-card p-3 flex items-center gap-2.5 text-left w-full",
            "hover:border-line-firm transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
          data-testid="button-add-custom-service"
        >
          <span className="w-[30px] h-[30px] flex-none rounded-logo bg-line-soft flex items-center justify-center text-ink-body">
            <Plus size={16} strokeWidth={2} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="t-card-title block truncate">Add “{typed}”</span>
            <span className="t-caption">Not in the list — track it by name</span>
          </span>
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- step 2 */

function CostAndRenewal({
  amount, onAmount, currency, onCurrency, frequency, onFrequency,
  nextBillingDate, onNextBillingDate, category, onCategory,
}: {
  amount: string; onAmount: (v: string) => void;
  currency: string; onCurrency: (v: string) => void;
  frequency: Frequency; onFrequency: (v: Frequency) => void;
  nextBillingDate: string; onNextBillingDate: (v: string) => void;
  category: string; onCategory: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Labelled label="Amount">
          <div className="field">
            <input
              type="number" inputMode="decimal" step="0.01" min="0"
              value={amount}
              onChange={(e) => onAmount(e.target.value)}
              placeholder="0.00"
              autoFocus
              data-testid="input-amount"
            />
          </div>
        </Labelled>

        <Labelled label="Currency">
          <NativeSelect value={currency} onChange={onCurrency} testId="select-currency">
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </NativeSelect>
        </Labelled>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Labelled label="Billing frequency">
          <NativeSelect
            value={frequency}
            onChange={(v) => onFrequency(v as Frequency)}
            testId="select-frequency"
          >
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </NativeSelect>
        </Labelled>

        <Labelled label="Next renewal" hint="Optional">
          <div className="field">
            <input
              type="date"
              value={nextBillingDate}
              onChange={(e) => onNextBillingDate(e.target.value)}
              data-testid="input-next-billing-date"
            />
          </div>
        </Labelled>
      </div>

      <Labelled label="Category" hint="Optional">
        <div className="field">
          <input
            value={category}
            onChange={(e) => onCategory(e.target.value)}
            placeholder="Collaboration, Design, Developer…"
            data-testid="input-category"
          />
        </div>
      </Labelled>
    </div>
  );
}

/* ---------------------------------------------------------------- step 3 */

function OwnerAndReceipt({
  ownerName, onOwnerName, ownerEmail, onOwnerEmail,
  invoices, onRemoveInvoice,
  onGetUploadParameters, onUploadComplete, onUploadError,
}: {
  ownerName: string; onOwnerName: (v: string) => void;
  ownerEmail: string; onOwnerEmail: (v: string) => void;
  invoices: PendingInvoice[];
  onRemoveInvoice: (index: number) => void;
  onGetUploadParameters: () => Promise<{ method: "PUT"; url: string }>;
  onUploadComplete: (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => void;
  onUploadError: (message: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Labelled label="Owner" hint="Optional">
          <div className="field">
            <input
              value={ownerName}
              onChange={(e) => onOwnerName(e.target.value)}
              placeholder="Who pays for this"
              autoFocus
              data-testid="input-owner-name"
            />
          </div>
        </Labelled>

        <Labelled label="Owner email" hint="Optional">
          <div className="field">
            <input
              type="email"
              value={ownerEmail}
              onChange={(e) => onOwnerEmail(e.target.value)}
              placeholder="owner@example.com"
              data-testid="input-owner-email"
            />
          </div>
        </Labelled>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="t-label">
            Recent invoice
            <span className="text-muted-foreground font-normal"> · Optional</span>
          </span>
          <ObjectUploader
            maxNumberOfFiles={10}
            maxFileSize={10485760}
            allowedFileTypes={[".pdf", ".png", ".jpg", ".jpeg", ".docx", ".doc"]}
            onGetUploadParameters={onGetUploadParameters}
            onComplete={onUploadComplete}
            onError={onUploadError}
            buttonClassName="btn-base btn-secondary"
          >
            <Upload size={15} strokeWidth={2} />
            Upload
          </ObjectUploader>
        </div>

        {invoices.length === 0 ? (
          <p className="surface-card py-6 text-center t-caption" data-testid="no-pending-invoices">
            Nothing attached. You can add receipts later from the subscription.
          </p>
        ) : (
          <div className="surface-card overflow-hidden" data-testid="pending-invoices">
            {invoices.map((invoice, i) => (
              <div
                key={invoice.fileUrl}
                className={cn(
                  "flex items-center gap-2.5 p-3",
                  i !== invoices.length - 1 && "border-b border-line-soft"
                )}
              >
                <Check size={15} strokeWidth={2} className="flex-none text-accent" />
                <span className="t-body flex-1 min-w-0 truncate">{invoice.fileName}</span>
                <button
                  type="button"
                  onClick={() => onRemoveInvoice(i)}
                  className="btn-base btn-ghost px-2"
                  aria-label={`Remove ${invoice.fileName}`}
                  data-testid={`button-remove-invoice-${i}`}
                >
                  <X size={15} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- bits */

function Labelled({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="t-label">
        {label}
        {hint && <span className="text-muted-foreground font-normal"> · {hint}</span>}
      </span>
      {children}
    </label>
  );
}

/* The design system's `.field` wraps a bare control, so a native select
   inherits the same border, focus ring and height as every text input
   without a second set of rules to keep in step. */
function NativeSelect({
  value, onChange, children, testId,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="field">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent border-none outline-none font-[inherit] text-[inherit] cursor-pointer"
        data-testid={testId}
      >
        {children}
      </select>
    </div>
  );
}
