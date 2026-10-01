/**
 * Duplicate invoices, as a pure function.
 *
 * Every history search uploads each attached PDF again to a NEW object-storage
 * path, so (subscription, file_url) never matches and each run filed the same
 * document again. The stable identity of a document is its file name, its size
 * and the calendar day the email arrived (uploaded_at is the email's
 * receivedAt, UTC day). Two emails on the same day carrying the same file
 * name and size are one document.
 */

export interface InvoiceRowForDuplicates {
  id: string;
  subscriptionId: string;
  fileName: string;
  fileSize: number;
  fileUrl: string;
  source: string;
  uploadedAt: Date | string | null;
}

/** UTC calendar day of a date, or null when there is none. */
export function invoiceDay(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** The identity of a document within one subscription; null when it has no date. */
export function invoiceIdentity(
  row: Pick<InvoiceRowForDuplicates, "subscriptionId" | "fileName" | "fileSize" | "uploadedAt">,
): string | null {
  const day = invoiceDay(row.uploadedAt);
  if (!day) return null;
  return JSON.stringify([row.subscriptionId, row.fileName, row.fileSize, day]);
}

export interface DuplicatePlan {
  /** Rows to delete. */
  removeIds: string[];
  /** Gmail-sourced rows kept (one per identity, plus undated ones). */
  kept: number;
  /** Object-storage paths that can be deleted: removed rows' files no kept row still points at. */
  deletePaths: string[];
}

/**
 * Only 'gmail' rows are ever grouped; manual uploads are never touched. In
 * each group the earliest id is kept.
 */
export function planDuplicateInvoiceRemoval(rows: InvoiceRowForDuplicates[]): DuplicatePlan {
  const groups = new Map<string, InvoiceRowForDuplicates[]>();
  let kept = 0;
  const keptPaths = new Set<string>();
  for (const row of rows) {
    const key = row.source === "gmail" ? invoiceIdentity(row) : null;
    if (key === null) {
      keptPaths.add(row.fileUrl);
      if (row.source === "gmail") kept++;
      continue;
    }
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const removed: InvoiceRowForDuplicates[] = [];
  Array.from(groups.values()).forEach((group) => {
    const sorted = group.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    kept++;
    keptPaths.add(sorted[0].fileUrl);
    removed.push(...sorted.slice(1));
  });

  const deletePaths = Array.from(new Set(removed.map((r) => r.fileUrl).filter((p) => p && !keptPaths.has(p))));
  return { removeIds: removed.map((r) => r.id), kept, deletePaths };
}
