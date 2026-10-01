/* Run: npm run test:invoices */
import { planDuplicateInvoiceRemoval, invoiceIdentity, type InvoiceRowForDuplicates } from "./invoiceDuplicates";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}

let n = 0;
const row = (o: Partial<InvoiceRowForDuplicates> & { fileName: string }): InvoiceRowForDuplicates => {
  n++;
  return {
    id: `id-${String(n).padStart(5, "0")}`,
    subscriptionId: "sub-claude",
    fileSize: 1000,
    fileUrl: `/objects/uploads/${n}`,
    source: "gmail",
    uploadedAt: "2026-06-01T08:00:00Z",
    ...o,
  };
};

/* --- Claude Pro: 4 emails x 2 files, filed in 4 runs = 32 rows ------------- */
{
  const rows: InvoiceRowForDuplicates[] = [];
  for (let run = 0; run < 4; run++) {
    for (let m = 1; m <= 4; m++) {
      const at = `2026-0${m + 2}-05T10:00:00Z`;
      rows.push(row({ fileName: `Invoice-EHOSHJ96-000${m}.pdf`, fileSize: 40000 + m, uploadedAt: at }));
      rows.push(row({ fileName: `Receipt-1234-5678-000${m}.pdf`, fileSize: 30000 + m, uploadedAt: at }));
    }
  }
  const plan = planDuplicateInvoiceRemoval(rows);
  check("claude: 32 rows -> keep 8", plan.kept, 8);
  check("claude: 24 removed", plan.removeIds.length, 24);
  check("claude: earliest ids kept", plan.removeIds.includes(rows[0].id), false);
  check("claude: its 24 files deleted", plan.deletePaths.length, 24);
}

/* --- Same name, different day or size: separate documents ------------------ */
{
  const rows = [
    row({ fileName: "Invoice.pdf", uploadedAt: "2026-05-01T08:00:00Z" }),
    row({ fileName: "Invoice.pdf", uploadedAt: "2026-06-01T08:00:00Z" }),
    row({ fileName: "Invoice.pdf", uploadedAt: "2026-06-01T08:00:00Z", fileSize: 2000 }),
  ];
  const plan = planDuplicateInvoiceRemoval(rows);
  check("different date or size kept", [plan.removeIds, plan.kept], [[], 3]);
}

/* --- Airtel: same receipt in two same-day emails, x 4 runs ----------------- */
{
  const rows: InvoiceRowForDuplicates[] = [];
  for (let run = 0; run < 4; run++) {
    rows.push(row({ fileName: "AirtelReceipt_PRDSL1.pdf", fileSize: 55555, uploadedAt: "2026-09-29T06:30:00Z" }));
    rows.push(row({ fileName: "AirtelReceipt_PRDSL1.pdf", fileSize: 55555, uploadedAt: "2026-09-29T11:01:00Z" }));
  }
  const plan = planDuplicateInvoiceRemoval(rows);
  check("airtel: 8 rows same day -> keep 1", [plan.kept, plan.removeIds.length], [1, 7]);
  const other = planDuplicateInvoiceRemoval([
    ...rows,
    row({ fileName: "AirtelReceipt_PRDSL1.pdf", fileSize: 55556, uploadedAt: "2026-09-29T11:01:00Z" }),
    row({ fileName: "AirtelReceipt_PRDSL1.pdf", fileSize: 55555, uploadedAt: "2026-09-30T01:00:00Z" }),
  ]);
  check("airtel: other size / other day kept apart", other.kept, 3);
}

/* --- Manual rows untouched; other subscription untouched ------------------- */
{
  const a = row({ fileName: "x.pdf" });
  const b = row({ fileName: "x.pdf" });
  const manual1 = row({ fileName: "x.pdf", source: "manual" });
  const manual2 = row({ fileName: "x.pdf", source: "manual" });
  const otherSub = row({ fileName: "x.pdf", subscriptionId: "sub-other" });
  const plan = planDuplicateInvoiceRemoval([a, b, manual1, manual2, otherSub]);
  check("only the extra gmail row removed", plan.removeIds, [b.id]);
}

/* --- A path a kept row still uses is never deleted ------------------------- */
{
  const a = row({ fileName: "x.pdf", fileUrl: "/objects/same" });
  const b = row({ fileName: "x.pdf", fileUrl: "/objects/same" });
  const manual = row({ fileName: "y.pdf", source: "manual", fileUrl: "/objects/m" });
  const c = row({ fileName: "z.pdf", fileUrl: "/objects/m" });
  const d = row({ fileName: "z.pdf", fileUrl: "/objects/m2" });
  const plan = planDuplicateInvoiceRemoval([a, b, manual, c, d]);
  check("shared path not deleted", plan.deletePaths, ["/objects/m2"]);
}

/* --- Undated rows are never grouped ---------------------------------------- */
{
  const plan = planDuplicateInvoiceRemoval([row({ fileName: "x.pdf", uploadedAt: null }), row({ fileName: "x.pdf", uploadedAt: null })]);
  check("undated kept", [plan.removeIds.length, plan.kept], [0, 2]);
  check("identity null without a date", invoiceIdentity({ subscriptionId: "s", fileName: "a", fileSize: 1, uploadedAt: null }), null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
