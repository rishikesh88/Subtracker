/**
 * "Verloq found 17 subscriptions in your inbox" -- sent when a sync finds
 * something, so a person who closed the tab mid-sync knows to come back.
 *
 * Sent through the same Resend setup and sender as the verification emails.
 * The list in it is built from email content, so every piece of it is
 * escaped: a merchant can name a subscription anything it likes.
 */
import { Resend } from "resend";
import { convertCurrency } from "../utils/currencyConverter";

const FROM = "Verloq <noreply@verloq.co>";
const LIST_LIMIT = 5;

export interface SummarySuggestion {
  serviceName: string;
  amount: string | number;
  currency: string | null;
  frequency: string;
}

export interface SummaryInput {
  /** Where the email goes: the address the account signed up with. */
  to: string;
  suggestions: SummarySuggestion[];
  /** The currency the account reads amounts in. */
  currency: string;
  /** The mailboxes that were read, to say whose inbox this was. */
  mailboxes: string[];
  syncDays: number;
  /** The app's own address, for the Review button and the logo. */
  appUrl: string;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const PER: Record<string, string> = { monthly: "/mo", yearly: "/yr", quarterly: "/qtr", weekly: "/wk" };
const PER_MONTH: Record<string, number> = { monthly: 1, yearly: 1 / 12, quarterly: 1 / 3, weekly: 4.33 };

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    // UNKNOWN, or a code Intl does not know: the number is still true.
    return amount.toFixed(2);
  }
}

interface Line {
  name: string;
  shown: string;
  per: string;
  monthly: number;
}

/**
 * Each suggestion in the account's currency where a rate exists, and as
 * billed where one does not -- never relabelled.
 */
function lines(suggestions: SummarySuggestion[], currency: string): { lines: Line[]; converted: boolean } {
  let converted = false;
  const out = suggestions.map((s) => {
    const billed = Number(s.amount) || 0;
    const from = (s.currency || "").toUpperCase();
    const inAccount = from && from !== "UNKNOWN" ? convertCurrency(billed, from, currency) : null;
    if (inAccount !== null && from !== currency.toUpperCase()) converted = true;
    const value = inAccount ?? billed;
    const unit = inAccount !== null ? currency : from || "UNKNOWN";
    return {
      name: s.serviceName,
      shown: money(value, unit),
      per: PER[s.frequency] ?? "",
      // Sorted by what it costs a month in the account's currency, so the
      // email leads with what matters. Unconvertible ones sort last.
      monthly: inAccount !== null ? inAccount * (PER_MONTH[s.frequency] ?? 1) : -1,
    };
  });
  out.sort((a, b) => b.monthly - a.monthly);
  return { lines: out, converted };
}

const CURRENCY_NAMES: Record<string, string> = {
  USD: "US dollars", EUR: "euros", GBP: "pounds sterling", INR: "rupees", AED: "UAE dirhams",
  CAD: "Canadian dollars", AUD: "Australian dollars", SGD: "Singapore dollars", JPY: "yen", CNY: "yuan",
};

export function buildSyncSummaryEmail(input: SummaryInput): BuiltEmail {
  const count = input.suggestions.length;
  const noun = count === 1 ? "subscription" : "subscriptions";
  const { lines: all, converted } = lines(input.suggestions, input.currency);
  const shown = all.slice(0, LIST_LIMIT);
  const more = count - shown.length;

  const where =
    input.mailboxes.length === 1
      ? input.mailboxes[0]
      : `your ${input.mailboxes.length} connected inboxes`;
  const reviewUrl = `${input.appUrl.replace(/\/$/, "")}/review`;
  const logoUrl = `${input.appUrl.replace(/\/$/, "")}/icon-192.png`;
  const cta = `Review ${count} ${noun}`;
  const currencyNote = converted
    ? `Amounts are shown in ${CURRENCY_NAMES[input.currency.toUpperCase()] ?? input.currency}, converted from what each receipt charged.`
    : "";

  const subject = `Verloq found ${count} ${noun} in your inbox`;

  const rows = shown
    .map(
      (l, i) => `
        <tr>
          <td style="padding:13px 16px;${i > 0 ? "border-top:1px solid #F0F0F0;" : ""}font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;color:#0A0A0A;">${escape(l.name)}</td>
          <td align="right" style="padding:13px 16px;${i > 0 ? "border-top:1px solid #F0F0F0;" : ""}font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;color:#0A0A0A;white-space:nowrap;">${escape(l.shown)}<span style="font-size:12px;font-weight:400;color:#666666;">${escape(l.per)}</span></td>
        </tr>`,
    )
    .join("");

  const moreRow = more > 0
    ? `<tr><td colspan="2" style="padding:12px 16px;border-top:1px solid #F0F0F0;background:#FAFAFA;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#525252;">and ${more} more</td></tr>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background:#F2F2F2;">
  <div style="display:none;max-height:0;overflow:hidden;">${escape(`${count} ${noun} are waiting for your review. Nothing is added until you approve it.`)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E4E4E4;border-radius:14px;">
        <tr><td style="padding:30px 36px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right:9px;"><img src="${escape(logoUrl)}" width="26" height="26" alt="" style="display:block;border-radius:6px;"></td>
            <td style="font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#0A0A0A;">Verloq</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:28px 36px 8px;">
          <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:400;line-height:1.15;color:#0A0A0A;">Your subscriptions are ready to review</h1>
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#333333;">We finished reading the last ${input.syncDays} days of ${escape(where)} and found <strong>${count} ${noun}</strong>. Nothing is added until you approve it.</p>
        </td></tr>
        <tr><td style="padding:18px 36px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ECECEC;border-radius:12px;border-collapse:separate;">${rows}${moreRow}</table>
        </td></tr>
        <tr><td style="padding:28px 36px ${currencyNote ? "10px" : "32px"};">
          <a href="${escape(reviewUrl)}" style="display:inline-block;padding:14px 24px;border-radius:9px;background:#4F46E5;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:600;text-decoration:none;">${escape(cta)}</a>
        </td></tr>
        ${currencyNote ? `<tr><td style="padding:0 36px 32px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#666666;">${escape(currencyNote)}</td></tr>` : ""}
        <tr><td style="padding:18px 36px;border-top:1px solid #ECECEC;background:#FAFAFA;border-radius:0 0 14px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#666666;">
          You're getting this because a sync finished on your Verloq account. Verloq only reads billing emails, and never sends, changes or deletes anything in your inbox.<br>
          <a href="https://verloq.co" style="color:#4F46E5;">verloq.co</a> &middot; <a href="https://verloq.co/privacy.html" style="color:#4F46E5;">Privacy</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    "Your subscriptions are ready to review",
    "",
    `We finished reading the last ${input.syncDays} days of ${where} and found ${count} ${noun}. Nothing is added until you approve it.`,
    "",
    ...shown.map((l) => `- ${l.name}: ${l.shown}${l.per}`),
    ...(more > 0 ? [`and ${more} more`] : []),
    "",
    `${cta}: ${reviewUrl}`,
    ...(currencyNote ? ["", currencyNote] : []),
    "",
    "You're getting this because a sync finished on your Verloq account.",
  ].join("\n");

  return { subject, html, text };
}

/**
 * Send it. Never throws: a sync that worked must not be reported as failed
 * because an email could not go out.
 */
export async function sendSyncSummaryEmail(input: SummaryInput): Promise<boolean> {
  if (input.suggestions.length === 0) return false;
  if (!process.env.RESEND_API_KEY) {
    console.warn("[sync-email] RESEND_API_KEY is not set; summary email not sent");
    return false;
  }
  try {
    const email = buildSyncSummaryEmail(input);
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({ from: FROM, to: input.to, subject: email.subject, html: email.html, text: email.text });
    if (error) {
      console.error("[sync-email] Resend refused the summary email:", error);
      return false;
    }
    console.log(`[sync-email] Summary sent: ${input.suggestions.length} subscription(s)`);
    return true;
  } catch (error) {
    console.error("[sync-email] Failed to send the summary email:", error);
    return false;
  }
}
