import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, FileText } from "lucide-react";
import type { Invoice } from "@shared/schema";
import { formatDate } from "@/lib/format";

/**
 * Shows an invoice without leaving the app.
 *
 * The file is served from our own origin behind the session cookie, so an
 * iframe or an img can render it directly -- no second tab, no download just
 * to look at something. Word files are the exception: browsers cannot render
 * them, so that case says so and offers the download instead of showing an
 * empty frame.
 */

/** What the browser can render in place, decided from the file name. */
export function previewKind(invoice: Invoice): "pdf" | "image" | "none" {
  if (!invoice.fileUrl) return "none";
  const type = (invoice.fileType || "").toLowerCase();
  const name = (invoice.fileName || "").toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/.test(name)) return "image";
  return "none";
}

/** The same file, asked for as a save rather than as something to render. */
export function downloadUrl(fileUrl: string): string {
  return `${fileUrl}${fileUrl.includes("?") ? "&" : "?"}download=1`;
}

export function InvoicePreview({
  invoice,
  open,
  onOpenChange,
}: {
  invoice: Invoice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const kind = invoice ? previewKind(invoice) : "none";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[820px] p-0 gap-0 overflow-hidden"
        data-testid="invoice-preview"
      >
        {invoice && (
          <>
            <DialogHeader className="border-b border-line" style={{ padding: "14px 16px" }}>
              <DialogTitle className="t-card-title truncate pr-8">{invoice.fileName}</DialogTitle>
              <p className="t-caption text-left">{formatDate(invoice.uploadedAt)}</p>
            </DialogHeader>

            <div className="bg-canvas relative" style={{ height: "min(70vh, 640px)" }}>
              {kind === "pdf" && (
                <>
                  {/* Sits behind the frame. A PDF that renders covers it; one
                      the browser cannot render leaves it showing, rather than
                      leaving an unexplained blank rectangle. */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                    <FileText size={28} strokeWidth={1.5} className="text-muted-foreground" />
                    <p className="t-body text-ink-body">
                      This file couldn't be shown here. Download it to open it.
                    </p>
                  </div>
                  <iframe
                    src={invoice.fileUrl}
                    title={invoice.fileName}
                    className="absolute inset-0 w-full h-full border-none"
                    data-testid="invoice-preview-pdf"
                  />
                </>
              )}
              {kind === "image" && (
                <div className="w-full h-full overflow-auto flex items-center justify-center p-4">
                  <img
                    src={invoice.fileUrl}
                    alt={invoice.fileName}
                    className="max-w-full"
                    data-testid="invoice-preview-image"
                  />
                </div>
              )}
              {kind === "none" && (
                <div className="w-full h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
                  <FileText size={28} strokeWidth={1.5} className="text-muted-foreground" />
                  <p className="t-body text-ink-body">
                    This kind of file can't be shown here. Download it to open it.
                  </p>
                </div>
              )}
            </div>

            <div
              className="border-t border-line flex justify-end"
              style={{ padding: "12px 16px" }}
            >
              <a
                href={downloadUrl(invoice.fileUrl)}
                download={invoice.fileName}
                className="btn-base btn-secondary"
                data-testid="invoice-preview-download"
              >
                <Download size={15} strokeWidth={2} />
                Download
              </a>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
