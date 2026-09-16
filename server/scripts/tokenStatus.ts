/**
 * Reports how many stored OAuth tokens are still plaintext.
 *
 * Encryption rolled out lazily: rows written before it shipped keep their
 * plaintext until the token is next refreshed and written back. This says how
 * far through that is, without printing any token value.
 *
 *   npx tsx server/scripts/tokenStatus.ts
 */
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { gmailAccounts, outlookAccounts, users } from "@shared/schema";
import { isEncrypted } from "../lib/tokenCrypto";

// storage.ts builds its own handle the same way; there is no shared db module.
const db = drizzle(neon(process.env.DATABASE_URL!));

function tally(rows: Array<Record<string, any>>, fields: string[]) {
  let encrypted = 0, plaintext = 0, empty = 0;
  for (const row of rows) {
    for (const field of fields) {
      const value = row[field];
      if (typeof value !== "string" || value.length === 0) empty++;
      else if (isEncrypted(value)) encrypted++;
      else plaintext++;
    }
  }
  return { encrypted, plaintext, empty };
}

async function main() {
  const report = [
    ["gmail_accounts", tally(await db.select().from(gmailAccounts), ["accessToken", "refreshToken"])],
    ["outlook_accounts", tally(await db.select().from(outlookAccounts), ["accessToken", "refreshToken"])],
    ["users (legacy)", tally(await db.select().from(users), ["gmailAccessToken", "gmailRefreshToken"])],
  ] as const;

  let totalPlaintext = 0;
  console.log("\ntoken                encrypted   plaintext   empty");
  console.log("-------------------------------------------------");
  for (const [name, t] of report) {
    totalPlaintext += t.plaintext;
    console.log(`${name.padEnd(20)} ${String(t.encrypted).padStart(9)} ${String(t.plaintext).padStart(11)} ${String(t.empty).padStart(7)}`);
  }
  console.log(
    totalPlaintext === 0
      ? "\nAll stored tokens are encrypted.\n"
      : `\n${totalPlaintext} token(s) still plaintext. Each is replaced the next time that account's token is refreshed.\n`
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("token status failed:", error);
  process.exit(1);
});
