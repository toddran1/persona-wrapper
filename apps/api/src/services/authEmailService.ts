import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export const passwordResetEmailEnabled = Boolean(env.GMAIL_SMTP_USER && env.GMAIL_SMTP_APP_PASSWORD);

export async function sendPasswordResetEmail(input: {
  email: string;
  displayName: string;
  resetUrl: string;
}): Promise<void> {
  if (!env.GMAIL_SMTP_USER || !env.GMAIL_SMTP_APP_PASSWORD) {
    throw new Error("Password-reset email delivery is not configured.");
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: env.GMAIL_SMTP_USER,
      pass: env.GMAIL_SMTP_APP_PASSWORD
    },
    connectionTimeout: 10_000,
    socketTimeout: 20_000
  });
  const safeName = escapeHtml(input.displayName || "there");
  const safeUrl = escapeHtml(input.resetUrl);
  try {
    await transporter.sendMail({
    from: `For the Baddiez <${env.GMAIL_SMTP_USER}>`,
    to: input.email,
    subject: "Reset your For the Baddiez password",
    text: `Reset your For the Baddiez password: ${input.resetUrl}\n\nThis link expires in one hour. If you did not request this, you can ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1d1425"><h1 style="font-size:24px">Reset your password</h1><p>Hey ${safeName},</p><p>Use the button below to choose a new For the Baddiez password.</p><p><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#7c3aed;color:#fff;text-decoration:none;font-weight:700">Reset password</a></p><p>This link expires in one hour. If you did not request this, you can safely ignore this email.</p></div>`
    });
  } catch (error) {
    logger.error("Password-reset email delivery failed", {
      error: error instanceof Error ? error.message : "Unknown SMTP error"
    });
    throw new Error("Password-reset email delivery failed.");
  }
}
