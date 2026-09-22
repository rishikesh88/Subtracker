import { randomUUID } from "crypto";
import { ObjectStorageService } from "../objectStorage";

/**
 * Put a receipt's file somewhere the invoice can point at it.
 *
 * The Gmail sync has done this inline since the beginning; the Outlook sync
 * never did, so an Outlook receipt arrived with its filename recorded and no
 * file behind it, and every Outlook invoice read "no file attached". This is
 * that step, written once so the two cannot drift again.
 *
 * Never throws. A receipt whose file could not be stored is still worth
 * recording -- the subscription, the date and the sender are the valuable
 * part, and failing the whole sync over one upload would be a poor trade.
 */
export async function storeInvoiceAttachment(opts: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  userId: string;
}): Promise<string | undefined> {
  const { buffer, filename, mimeType, userId } = opts;

  try {
    const objectStorage = new ObjectStorageService();
    const privateObjectDir = objectStorage.getPrivateObjectDir();
    // The name is only a label; a uuid directory keeps two receipts called
    // invoice.pdf from landing on each other.
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const fullPath = `${privateObjectDir}/invoices/${randomUUID()}/${safeName}`;

    const path = await objectStorage.uploadBufferWithAcl(fullPath, buffer, mimeType, {
      owner: userId,
      visibility: "private",
    });
    console.log(`📎 Stored attachment during sync: ${safeName} → ${path}`);
    return path;
  } catch (error) {
    console.error(`⚠️  Could not store attachment ${filename}:`, error);
    return undefined;
  }
}
