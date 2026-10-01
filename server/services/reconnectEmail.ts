/**
 * "Verloq needs you to reconnect your inbox" -- sent when access to a
 * connected mailbox has expired and Verloq can no longer check it for new
 * payments. At most one per person per 7 days, covering every expired mailbox
 * in one email (the rate limit is applied by the daily job: see
 * server/lib/renewalJob.ts, remindIfNeeded).
 *
 * Built and sent like the sync summary email: the same Resend setup and
 * sender. Everything interpolated (mailbox addresses, subscription names) comes
 * from outside this file, so all of it is escaped. The email never carries an
 * amount, an email subject or any email text -- only subscription names and the
 * date of the last payment.
 */
import { Resend } from "resend";

const FROM = "Verloq <noreply@verloq.co>";
/** Subscriptions named in the email; the rest are "and K more". */
const LIST_LIMIT = 3;

// ===========================================================================
// COPY -- every word the email says is in this block. The owner may change it
// after review; nothing below this block contains wording, only layout.
// ===========================================================================
const COPY = {
  subject: "Reconnect your inbox so Verloq can keep checking your payments",
  preheader: "Your subscriptions are safe. We just can't see new payments until you reconnect.",
  heading: "Verloq needs you to reconnect your inbox",
  /** `where` is the mailbox address, or the addresses joined ("a, b and c"). */
  bodyOne: (where: string) =>
    `Access to ${where} has expired, so we could not check it for new payments. Your subscriptions and payment history are safe.`,
  bodyMany: (where: string) =>
    `Access to ${where} has expired, so we could not check those inboxes for new payments. Your subscriptions and payment history are safe.`,
  listIntroOne: "Until you reconnect, we cannot tell whether this subscription is still being paid:",
  listIntroMany: (n: number) => `Until you reconnect, we cannot tell whether these ${n} subscriptions are still being paid:`,
  lastPaid: (day: string) => `last paid ${day}`,
  more: (k: number) => `and ${k} more`,
  buttonOne: (mailbox: string) => `Reconnect ${mailbox}`,
  buttonMany: "Reconnect your inboxes",
  note: "It takes about 10 seconds. We will pick up where we left off.",
  footer:
    "You are getting this because Verloq lost access to a connected inbox. We will remind you at most once a week until it is reconnected. Verloq only reads billing emails, and never sends, changes or deletes anything in your inbox.",
} as const;
// ===========================================================================
// END OF COPY
// ===========================================================================

export interface ReconnectSubscription {
  name: string;
  /** 'YYYY-MM-DD' of the last payment seen; null when none was. */
  lastPaidOn: string | null;
}

export interface ReconnectInput {
  /** Where the email goes: the address the account signed up with. */
  to: string;
  /** Every expired mailbox, by address. */
  mailboxes: string[];
  /** Every subscription whose payments cannot be checked now, most recently paid first. */
  subscriptions: ReconnectSubscription[];
  /** The app's own address, for the button and the logo. */
  appUrl: string;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 'YYYY-MM-DD' as "Sep 12"; null when it is not a day. */
export function shortDay(day: string | null): string | null {
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})/.exec(day) : null;
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${MONTHS[month - 1]} ${Number(m[3])}`;
}

/** "a", "a and b", "a, b and c". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function buildReconnectEmail(input: ReconnectInput): BuiltEmail {
  const count = input.subscriptions.length;
  const shown = input.subscriptions.slice(0, LIST_LIMIT);
  const more = count - shown.length;
  const many = input.mailboxes.length > 1;
  const where = joinNames(input.mailboxes);
  const body = many ? COPY.bodyMany(where) : COPY.bodyOne(where);
  const intro = count === 1 ? COPY.listIntroOne : COPY.listIntroMany(count);
  const cta = many ? COPY.buttonMany : COPY.buttonOne(input.mailboxes[0] ?? "");
  const base = input.appUrl.replace(/\/$/, "");
  const settingsUrl = `${base}/settings`;
  const logoUrl = `${base}/icon-192.png`;

  const lineText = (s: ReconnectSubscription) => {
    const day = shortDay(s.lastPaidOn);
    return day ? `${s.name}: ${COPY.lastPaid(day)}` : s.name;
  };

  const rows = shown
    .map((s, i) => {
      const day = shortDay(s.lastPaidOn);
      const border = i > 0 ? "border-top:1px solid #F0F0F0;" : "";
      return `
        <tr>
          <td style="padding:13px 16px;${border}font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;color:#0A0A0A;">${escape(s.name)}</td>
          <td align="right" style="padding:13px 16px;${border}font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#666666;white-space:nowrap;">${day ? escape(COPY.lastPaid(day)) : ""}</td>
        </tr>`;
    })
    .join("");
  const moreRow = more > 0
    ? `<tr><td colspan="2" style="padding:12px 16px;border-top:1px solid #F0F0F0;background:#FAFAFA;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#525252;">${escape(COPY.more(more))}</td></tr>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(COPY.subject)}</title></head>
<body style="margin:0;padding:0;background:#F2F2F2;">
  <div style="display:none;max-height:0;overflow:hidden;">${escape(COPY.preheader)}</div>
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
          <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:400;line-height:1.15;color:#0A0A0A;">${escape(COPY.heading)}</h1>
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#333333;">${escape(body)}</p>
        </td></tr>
        <tr><td style="padding:18px 36px 10px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#333333;">${escape(intro)}</td></tr>
        <tr><td style="padding:0 36px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ECECEC;border-radius:12px;border-collapse:separate;">${rows}${moreRow}</table>
        </td></tr>
        <tr><td style="padding:28px 36px 10px;">
          <a href="${escape(settingsUrl)}" style="display:inline-block;padding:14px 24px;border-radius:9px;background:#4F46E5;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:600;text-decoration:none;">${escape(cta)}</a>
        </td></tr>
        <tr><td style="padding:0 36px 32px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#666666;">${escape(COPY.note)}</td></tr>
        <tr><td style="padding:18px 36px;border-top:1px solid #ECECEC;background:#FAFAFA;border-radius:0 0 14px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#666666;">
          ${escape(COPY.footer)}<br>
          <a href="https://verloq.co" style="color:#4F46E5;">verloq.co</a> &middot; <a href="https://verloq.co/privacy.html" style="color:#4F46E5;">Privacy</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    COPY.heading,
    "",
    body,
    "",
    intro,
    ...shown.map((s) => `- ${lineText(s)}`),
    ...(more > 0 ? [COPY.more(more)] : []),
    "",
    `${cta}: ${settingsUrl}`,
    COPY.note,
    "",
    COPY.footer,
    "verloq.co - https://verloq.co/privacy.html",
  ].join("\n");

  return { subject: COPY.subject, html, text };
}

/**
 * Send it. Never throws: a job that ran must not be reported as failed because
 * an email could not go out. True only when Resend accepted it.
 */
export async function sendReconnectEmail(input: ReconnectInput): Promise<boolean> {
  if (input.subscriptions.length === 0 || input.mailboxes.length === 0 || !input.to) return false;
  if (!process.env.RESEND_API_KEY) {
    console.warn("[reconnect-email] RESEND_API_KEY is not set; reconnect email not sent");
    return false;
  }
  try {
    const email = buildReconnectEmail(input);
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({ from: FROM, to: input.to, subject: email.subject, html: email.html, text: email.text });
    if (error) {
      console.error("[reconnect-email] Resend refused the reconnect email:", error);
      return false;
    }
    console.log(`[reconnect-email] Sent: ${input.mailboxes.length} mailbox(es), ${input.subscriptions.length} subscription(s)`);
    return true;
  } catch (error) {
    console.error("[reconnect-email] Failed to send the reconnect email:", error);
    return false;
  }
}
