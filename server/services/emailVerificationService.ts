import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export interface SendVerificationEmailParams {
  to: string;
  code: string;
  firstName?: string | null;
}

export async function sendVerificationEmail({ to, code, firstName }: SendVerificationEmailParams): Promise<void> {
  const name = firstName || 'there';
  
  try {
    await resend.emails.send({
      from: 'SubTracker <onboarding@resend.dev>', // Resend test domain
      to,
      subject: 'Verify your SubTracker account',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              text-align: center;
              padding: 20px 0;
              border-bottom: 2px solid #f0f0f0;
            }
            .content {
              padding: 30px 0;
            }
            .code-box {
              background: #f5f5f5;
              border: 2px dashed #ddd;
              border-radius: 8px;
              padding: 20px;
              text-align: center;
              margin: 20px 0;
            }
            .code {
              font-size: 32px;
              font-weight: bold;
              letter-spacing: 8px;
              color: #2563eb;
              font-family: 'Courier New', monospace;
            }
            .footer {
              text-align: center;
              padding-top: 20px;
              border-top: 1px solid #f0f0f0;
              color: #666;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1 style="margin: 0; color: #2563eb;">SubTracker</h1>
          </div>
          <div class="content">
            <p>Hi ${name},</p>
            <p>Welcome to SubTracker! Please verify your email address to complete your registration.</p>
            <p>Enter this verification code in the app:</p>
            <div class="code-box">
              <div class="code">${code}</div>
            </div>
            <p>This code will expire in 15 minutes.</p>
            <p>If you didn't create an account with SubTracker, you can safely ignore this email.</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} SubTracker. All rights reserved.</p>
          </div>
        </body>
        </html>
      `,
      text: `
Hi ${name},

Welcome to SubTracker! Please verify your email address to complete your registration.

Your verification code is: ${code}

This code will expire in 15 minutes.

If you didn't create an account with SubTracker, you can safely ignore this email.

&copy; ${new Date().getFullYear()} SubTracker. All rights reserved.
      `.trim(),
    });
    
    console.log(`Verification email sent to ${to}`);
  } catch (error) {
    console.error('Failed to send verification email:', error);
    throw new Error('Failed to send verification email');
  }
}

export function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function isVerificationCodeExpired(expiry: Date | null): boolean {
  if (!expiry) return true;
  return new Date() > expiry;
}
