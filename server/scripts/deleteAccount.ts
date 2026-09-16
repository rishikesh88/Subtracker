/**
 * Deletes a user and everything belonging to them.
 *
 * privacy.html section 7 says that during the beta account closure is done by
 * hand. This is that hand.
 *
 *   npx tsx server/scripts/deleteAccount.ts someone@example.com          # dry run
 *   npx tsx server/scripts/deleteAccount.ts someone@example.com --confirm
 *
 * Without --confirm it only reports what would go. Nothing is reversible once
 * confirmed: the invoice PDFs are removed from object storage as well as the
 * database, and the Google grant is revoked.
 */
import { storage } from "../storage";

async function main() {
  const [identifier, ...flags] = process.argv.slice(2);
  const confirmed = flags.includes("--confirm");

  if (!identifier) {
    console.error("Usage: npx tsx server/scripts/deleteAccount.ts <email|userId> [--confirm]");
    process.exit(1);
  }

  const user = identifier.includes("@")
    ? await storage.getUserByEmail(identifier)
    : await storage.getUser(identifier);

  if (!user) {
    console.error(`No account found for "${identifier}".`);
    process.exit(1);
  }

  console.log(`\n  account   ${user.email ?? "(no email)"}`);
  console.log(`  id        ${user.id}`);
  console.log(`  created   ${user.createdAt ?? "unknown"}`);

  if (!confirmed) {
    console.log(
      "\n  Dry run. Nothing has been deleted.\n" +
        "  Re-run with --confirm to delete this account, every subscription,\n" +
        "  suggestion, email and invoice record belonging to it, the invoice\n" +
        "  files in object storage, and any active session. The Google grant\n" +
        "  is revoked too. None of it can be undone.\n"
    );
    process.exit(0);
  }

  console.log("\n  Deleting...\n");
  const result = await storage.deleteUserAccount(user.id);

  console.log(`  object storage   ${result.filesDeleted} file(s) deleted`);
  console.log(`  google grants    ${result.grantsRevoked} revoked`);
  for (const [table, count] of Object.entries(result.rowsDeleted)) {
    console.log(`  ${table.padEnd(16)} ${count} row(s)`);
  }
  console.log("\n  Done. Confirm to the user that their account is closed.\n");
  process.exit(0);
}

main().catch((error) => {
  console.error("\nDeletion failed:", error instanceof Error ? error.message : error);
  console.error("\nIf this aborted before deleting rows, nothing was changed and it is safe to retry.\n");
  process.exit(1);
});
