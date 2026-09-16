/**
 * Turns a password you choose into the hash the admin console checks against.
 *
 *     npm run admin:password
 *
 * It asks for the password twice with the typing hidden, prints a bcrypt hash,
 * and forgets the password. The hash is what goes into Railway as
 * ADMIN_PASSWORD_HASH; the password itself never leaves this terminal, is
 * never written to a file, and is never stored anywhere -- which is why this
 * script exists rather than someone handing you a password to use.
 *
 * Nothing here touches the database.
 */

import bcrypt from "bcrypt";
import { createInterface } from "readline";
import { randomBytes } from "crypto";

/** Matches the cost the app uses for ordinary user passwords. */
const ROUNDS = 12;
const MIN_LENGTH = 12;

function prompt(question: string, hidden: boolean): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    if (hidden) {
      // readline echoes what is typed. Swapping the output's write for one
      // that drops everything after the question has been printed keeps the
      // password off the screen, and out of a screenshot.
      const output: any = (rl as any).output;
      let questionShown = false;
      const originalWrite = output.write.bind(output);
      output.write = (chunk: any, ...rest: any[]) => {
        if (!questionShown) {
          questionShown = true;
          return originalWrite(chunk, ...rest);
        }
        return true;
      };
      rl.question(question, (answer) => {
        output.write = originalWrite;
        process.stdout.write("\n");
        rl.close();
        resolve(answer);
      });
      return;
    }

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  console.log("\nSet the admin console password\n");
  console.log("  Nothing you type is shown, saved, or sent anywhere.");
  console.log(`  At least ${MIN_LENGTH} characters. A passphrase is easier to`);
  console.log("  remember and harder to guess than a short mangled word.\n");
  console.log(`  If you would rather not invent one: ${randomBytes(12).toString("base64url")}\n`);

  const password = await prompt("Password: ", true);
  if (password.length < MIN_LENGTH) {
    console.error(`\nToo short. It needs at least ${MIN_LENGTH} characters. Nothing was generated.`);
    process.exit(1);
  }

  const again = await prompt("Again:    ", true);
  if (password !== again) {
    console.error("\nThose did not match. Nothing was generated.");
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, ROUNDS);

  console.log("\n" + "=".repeat(72));
  console.log("COPY THE LINE BELOW into Railway as ADMIN_PASSWORD_HASH.");
  console.log("Do NOT put your password there. The password stays in your head.");
  console.log("=".repeat(72) + "\n");
  console.log(hash + "\n");
  console.log("=".repeat(72) + "\n");
  console.log("Two variables in total:\n");
  console.log(`  ADMIN_EMAIL          ${process.env.ADMIN_EMAIL ?? "your@email.address"}`);
  console.log("  ADMIN_PASSWORD_HASH  the line above, all 60 characters, starting $2b$\n");
  console.log("The hash is safe to paste and safe in a screenshot -- it cannot be");
  console.log("turned back into your password. Redeploy, then sign in at /admin.\n");
  console.log("If the hash is wrong the console will not start, and the server log");
  console.log("will say so in a line beginning [Admin]. It will not show you a");
  console.log("sign-in form that quietly refuses every password.\n");
  console.log("Changing the hash later signs the console out everywhere at once.\n");
}

main().catch((error) => {
  console.error("Failed:", error);
  process.exit(1);
});
