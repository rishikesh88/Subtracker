/**
 * Invoices for people's work: out of scope.
 *
 * A consultant, freelancer, agency or contractor on a monthly retainer sends
 * a recurring invoice, often through an invoicing tool (Zoho Invoice, Zoho
 * Books, QuickBooks, Xero, FreshBooks ...) and sometimes from their own
 * address. It repeats like a subscription but it is not one, so the sync
 * drops it, the same way it drops private mail (privateMail.ts).
 *
 * Software is never dropped, whoever sends it: an email that reads like a
 * software subscription (subscription, licence, seats, a named plan,
 * auto-renewal, hosting, a domain renewal) is kept even from an invoicing
 * tool. That keeps a small software company that bills through Zoho Books,
 * and the invoicing tools' own subscription bills (Zoho, QuickBooks, Xero
 * charging you), which in any case come from the company's own domain.
 *
 * Everything here is pure, so it is tested by server/lib/serviceInvoice.test.ts.
 */

export type ServiceInvoiceKind = "invoicing_tool" | "service_work";

export interface InvoiceFacts {
  sender?: string | null;
  fromName?: string | null;
  subject?: string | null;
  text?: string | null;
}

/**
 * Where invoicing tools send their customers' invoices from. Matched as a
 * whole part of the domain, or as the domain itself.
 */
const INVOICING_LABELS = [
  "zohoinvoice", "zohobooks", "freshbooks", "waveapps", "invoiceninja", "harvestapp", "refrens", "vyaparapp",
  "mybillbook", "invoicesimple", "invoice2go", "honeybook", "hellobonsai", "dubsado", "invoicehome", "zipbooks",
];
const INVOICING_DOMAINS = ["notification.intuit.com", "post.xero.com", "bill.com", "invoiced.com", "quickbooks.com"];

/** The domains above, for code that keeps a list of billing intermediaries. */
export const INVOICING_SENDER_DOMAINS = [
  "zohoinvoice.com", "zohoinvoice.in", "zohoinvoice.eu", "zohobooks.com", "zohobooks.in", "zohobooks.eu",
  "freshbooks.com", "waveapps.com", "invoiceninja.com", "harvestapp.com", "refrens.com", "vyaparapp.in",
  "mybillbook.in", "invoicesimple.com", "invoice2go.com", "honeybook.com", "hellobonsai.com", "dubsado.com",
  ...INVOICING_DOMAINS,
];

/** Reads like software. Any of these keeps the email, whoever sent it. */
const SOFTWARE = new RegExp(
  [
    String.raw`\bsubscriptions?\b`,
    String.raw`\blicen[cs]es?\b`,
    String.raw`\bseats?\b`,
    String.raw`\bper\s+(user|seat|member|license|licence)\b`,
    String.raw`\bsaas\b`,
    String.raw`\b(free|pro|plus|basic|premium|business|enterprise|starter|team|teams|standard|growth|professional|annual|monthly|yearly)\s+plan\b`,
    String.raw`\bplan\s+(renewal|renewed|upgrade|upgraded)\b`,
    String.raw`\bauto[-\s]?renew(al|s|ed)?\b`,
    String.raw`\brenews?\s+(on|automatically)\b`,
    String.raw`\b(hosting|domain|ssl|cloud\s+storage|storage)\s+(plan|renewal|subscription)\b`,
    String.raw`\bapi\s+(usage|credits)\b`,
  ].join("|"),
  "i",
);

/** Reads like an invoice for someone's work. */
const SERVICE_WORK = new RegExp(
  [
    String.raw`\bprofessional\s+(fees?|charges|services)\b`,
    String.raw`\bconsult(ing|ancy|ant|ation)\s+(fees?|charges|services|invoice|hours|retainer)\b`,
    String.raw`\bconsultancy\b`,
    String.raw`\bretainer\b`,
    String.raw`\btime\s*sheets?\b`,
    String.raw`\bbillable\s+hours\b`,
    String.raw`\bhours\s+worked\b`,
    String.raw`\bman[-\s]?(hours|days)\b`,
    String.raw`\b\d+(\.\d+)?\s*(hrs?|hours)\s*(@|x|×|at)\s*`,
    String.raw`\bmilestone\s+(payment|invoice|\d+)\b`,
    String.raw`\bservices\s+rendered\b`,
    String.raw`\bfreelanc\w*`,
    String.raw`\bcontractors?\b`,
    String.raw`\bagency\s+(fees?|retainer|charges)\b`,
    String.raw`\b(design|development|marketing|legal|accounting|bookkeeping|audit|seo|content\s+writing|recruitment|staffing)\s+services\b`,
    String.raw`\b(payslip|pay\s+slip|salary\s+slip)\b`,
    String.raw`\b(rent\s+(invoice|receipt)|office\s+rent|house\s+rent)\b`,
  ].join("|"),
  "i",
);

function domainOf(address: string | null | undefined): string {
  const a = (address ?? "").trim().toLowerCase();
  const m = a.match(/<([^>]+)>/);
  const email = m ? m[1] : a;
  const at = email.lastIndexOf("@");
  return (at >= 0 ? email.slice(at + 1) : email).replace(/[>\s]/g, "");
}

/** An invoicing tool sending someone else's invoice. */
export function isInvoicingToolSender(address: string | null | undefined): boolean {
  const domain = domainOf(address);
  if (!domain) return false;
  if (INVOICING_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  return domain.split(".").some((label) => INVOICING_LABELS.includes(label));
}

export function readsLikeSoftware(...texts: (string | null | undefined)[]): boolean {
  return SOFTWARE.test(texts.filter(Boolean).join(" \n ").slice(0, 4000));
}

export function readsLikeServiceWork(...texts: (string | null | undefined)[]): boolean {
  return SERVICE_WORK.test(texts.filter(Boolean).join(" \n ").slice(0, 4000));
}

/**
 * Why this email is an invoice for people's work, or null to keep it.
 *
 * With `previewOnly` (the subject and a short preview, before the email is
 * read), an invoicing tool alone is not enough: the preview may not show the
 * software words that would keep it, so it is read in full and judged again.
 */
export function serviceInvoiceKind(m: InvoiceFacts, opts: { previewOnly?: boolean } = {}): ServiceInvoiceKind | null {
  if (readsLikeSoftware(m.subject, m.text)) return null;
  if (!opts.previewOnly && isInvoicingToolSender(m.sender)) return "invoicing_tool";
  if (readsLikeServiceWork(m.fromName, m.subject, m.text)) return "service_work";
  return null;
}

/** A suggestion or subscription that is really someone's work (consulting, an agency, a contractor ...). */
export function isServiceWorkSubscription(s: { serviceName?: string | null; merchantName?: string | null; category?: string | null }): boolean {
  const category = (s.category ?? "").toLowerCase();
  if (/\b(consult\w*|freelanc\w*|contractors?|professional\s+services|agency|agencies|retainer|staffing|outsourc\w*|legal\s+services|accounting\s+services|payroll|salary|rent)\b/.test(category)) {
    return true;
  }
  if (readsLikeSoftware(s.serviceName, s.merchantName)) return false;
  return readsLikeServiceWork(s.serviceName, s.merchantName) || /\b(consulting|consultancy|consultants?|retainer)\b/i.test(`${s.serviceName ?? ""} ${s.merchantName ?? ""}`);
}
