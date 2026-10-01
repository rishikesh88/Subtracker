/* Run: npm run test:documents */
import { documentKind, splitDocuments, DOCUMENT_LIMIT } from "./documentKind";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}

/* --- Classifying by name ------------------------------------------------ */
check("Receipt-... is a receipt", documentKind("Receipt-2264-3052-3650.pdf"), "receipt");
check("AirtelReceipt_... is a receipt", documentKind("AirtelReceipt_PRDSL7510000.pdf"), "receipt");
check("a manual upload named 'My receipt copy'", documentKind("My receipt copy.pdf"), "receipt");
check("upper case RECEIPT", documentKind("PAYMENT_RECEIPT.PDF"), "receipt");
check("Invoice-... is an invoice", documentKind("Invoice-EHOSHJ96-0004.pdf"), "invoice");
check("a monthly bill PDF is an invoice", documentKind("10101012665222_Sep2026.pdf"), "invoice");
check("Tax_invoice is an invoice", documentKind("Tax_invoice.pdf"), "invoice");
check("a name that says nothing is an invoice", documentKind("scan0001.jpg"), "invoice");
check("empty name is an invoice", documentKind(""), "invoice");
check("missing name is an invoice", documentKind(null), "invoice");

/* --- Splitting and ordering --------------------------------------------- */
const f = (id: string, fileName: string, uploadedAt: Date | string | null) => ({ id, fileName, uploadedAt });
const docs = [
  f("a", "Invoice-1.pdf", "2026-07-01T00:00:00.000Z"),
  f("b", "Receipt-1.pdf", "2026-08-01T00:00:00.000Z"),
  f("c", "Invoice-2.pdf", new Date("2026-09-01T00:00:00.000Z")),
  f("d", "Receipt-2.pdf", "2026-06-01T00:00:00.000Z"),
  f("e", "Invoice-3.pdf", "2026-09-01T00:00:00.000Z"),
  f("g", "Invoice-4.pdf", null),
];
const out = splitDocuments(docs);
check("invoices newest first, ties keep input order, no date last", out.invoices.map((d) => d.id), ["c", "e", "a", "g"]);
check("receipts newest first", out.receipts.map((d) => d.id), ["b", "d"]);
check("input is not reordered", docs.map((d) => d.id), ["a", "b", "c", "d", "e", "g"]);
check("nothing in, nothing out", splitDocuments([]), { invoices: [], receipts: [] });
check("only receipts leaves invoices empty", splitDocuments([f("x", "receipt.pdf", null)]).invoices, []);
check("unparseable date sorts last", splitDocuments([f("x", "a.pdf", "nope"), f("y", "b.pdf", "2026-01-01")]).invoices.map((d) => d.id), ["y", "x"]);
check("limit is five", DOCUMENT_LIMIT, 5);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
