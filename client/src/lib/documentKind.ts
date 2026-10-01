/* Which of the two lists on a subscription a stored file belongs in.

   Files arrive from email attachments and from the Upload button, and the
   only thing every one of them has is a name. A name that says "receipt" is
   a proof of payment; everything else (Invoice-*.pdf, a monthly bill PDF, a
   name that says nothing) is a bill and stays with the invoices. */

export type DocumentKind = "invoice" | "receipt";

/** How many of each kind show before the "Show more" button. */
export const DOCUMENT_LIMIT = 5;

export function documentKind(fileName: string | null | undefined): DocumentKind {
  return /receipt/i.test(fileName ?? "") ? "receipt" : "invoice";
}

type Dated = { fileName: string | null; uploadedAt: Date | string | null };

function time(value: Date | string | null): number {
  if (value == null) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Split into invoices and receipts, each newest upload first. Files with
    the same upload time keep the order they came in. */
export function splitDocuments<T extends Dated>(docs: readonly T[]): { invoices: T[]; receipts: T[] } {
  const sorted = [...docs].sort((a, b) => time(b.uploadedAt) - time(a.uploadedAt));
  return {
    invoices: sorted.filter((d) => documentKind(d.fileName) === "invoice"),
    receipts: sorted.filter((d) => documentKind(d.fileName) === "receipt"),
  };
}
