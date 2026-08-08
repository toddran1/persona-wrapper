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

export const authEmailEnabled = Boolean(env.GMAIL_SMTP_USER && env.GMAIL_SMTP_APP_PASSWORD);

async function deliverAuthEmail(input: {
  email: string;
  subject: string;
  text: string;
  html: string;
  logLabel: string;
  failureMessage: string;
}): Promise<void> {
  if (!env.GMAIL_SMTP_USER || !env.GMAIL_SMTP_APP_PASSWORD) {
    throw new Error(`${input.logLabel} delivery is not configured.`);
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
  try {
    await transporter.sendMail({
      from: `For the Baddiez <${env.GMAIL_SMTP_USER}>`,
      to: input.email,
      subject: input.subject,
      text: input.text,
      html: input.html
    });
  } catch (error) {
    logger.error(`${input.logLabel} delivery failed`, {
      error: error instanceof Error ? error.message : "Unknown SMTP error"
    });
    throw new Error(input.failureMessage);
  }
}

export async function sendPasswordResetEmail(input: {
  email: string;
  displayName: string;
  resetUrl: string;
}): Promise<void> {
  const safeName = escapeHtml(input.displayName || "there");
  const safeUrl = escapeHtml(input.resetUrl);
  await deliverAuthEmail({
    email: input.email,
    subject: "Reset your For the Baddiez password",
    text: `Reset your For the Baddiez password: ${input.resetUrl}\n\nThis link expires in one hour. If you did not request this, you can ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1d1425"><h1 style="font-size:24px">Reset your password</h1><p>Hey ${safeName},</p><p>Use the button below to choose a new For the Baddiez password.</p><p><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#7c3aed;color:#fff;text-decoration:none;font-weight:700">Reset password</a></p><p>This link expires in one hour. If you did not request this, you can safely ignore this email.</p></div>`,
    logLabel: "Password-reset email",
    failureMessage: "Password-reset email delivery failed."
  });
}

export async function sendVerificationEmail(input: {
  email: string;
  displayName: string;
  verificationUrl: string;
}): Promise<void> {
  const safeName = escapeHtml(input.displayName || "there");
  const safeUrl = escapeHtml(input.verificationUrl);
  await deliverAuthEmail({
    email: input.email,
    subject: "Verify your For the Baddiez email",
    text: `Verify your For the Baddiez email: ${input.verificationUrl}\n\nThis link expires in one hour. If you did not create this account, you can ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1d1425"><h1 style="font-size:24px">Verify your email</h1><p>Hey ${safeName},</p><p>Use the button below to verify the email on your For the Baddiez account. Verifying means you can always get back in with a password reset.</p><p><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#7c3aed;color:#fff;text-decoration:none;font-weight:700">Verify email</a></p><p>This link expires in one hour. If you did not create this account, you can safely ignore this email.</p></div>`,
    logLabel: "Verification email",
    failureMessage: "Verification email delivery failed."
  });
}

const SYNTHETIC_EMAIL_SUFFIX = "@users.invalid";

// Security notifications are best-effort: they are skipped when SMTP is not
// configured or the account uses a synthetic username-only address, and
// delivery failures (already logged by deliverAuthEmail) never fail the
// request that triggered them.
async function deliverNotificationEmail(input: {
  email: string;
  subject: string;
  text: string;
  html: string;
  logLabel: string;
}): Promise<void> {
  if (!env.GMAIL_SMTP_USER || !env.GMAIL_SMTP_APP_PASSWORD || input.email.endsWith(SYNTHETIC_EMAIL_SUFFIX)) return;
  await deliverAuthEmail({ ...input, failureMessage: `${input.logLabel} delivery failed.` })
    .catch(() => undefined);
}

export async function sendPasswordChangedEmail(input: {
  email: string;
  displayName: string;
}): Promise<void> {
  const safeName = escapeHtml(input.displayName || "there");
  await deliverNotificationEmail({
    email: input.email,
    subject: "Your For the Baddiez password was changed",
    text: `Hey ${input.displayName || "there"}, the password on your For the Baddiez account was just changed and other signed-in devices were logged out. If this was not you, use "Forgot password" on the sign-in screen right away to secure your account.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1d1425"><h1 style="font-size:24px">Password changed</h1><p>Hey ${safeName},</p><p>The password on your For the Baddiez account was just changed, and other signed-in devices were logged out.</p><p><strong>If this was not you</strong>, use &ldquo;Forgot password&rdquo; on the sign-in screen right away to secure your account.</p></div>`,
    logLabel: "Password-changed email"
  });
}

export async function sendAccountDeletionScheduledEmail(input: {
  email: string;
  displayName: string;
  deletionScheduledFor: Date;
}): Promise<void> {
  const safeName = escapeHtml(input.displayName || "there");
  const deletionDate = input.deletionScheduledFor.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
  await deliverNotificationEmail({
    email: input.email,
    subject: "Your For the Baddiez account is scheduled for deletion",
    text: `Hey ${input.displayName || "there"}, your For the Baddiez account is scheduled for permanent deletion on ${deletionDate}. Sign back in before then to keep your account. If you did not request this, reset your password immediately from the sign-in screen.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1d1425"><h1 style="font-size:24px">Account deletion scheduled</h1><p>Hey ${safeName},</p><p>Your For the Baddiez account is scheduled for permanent deletion on <strong>${deletionDate}</strong>. Everything stays restorable until then &mdash; just sign back in to keep your account.</p><p><strong>If you did not request this</strong>, reset your password immediately from the sign-in screen.</p></div>`,
    logLabel: "Account-deletion email"
  });
}

export async function sendAccountRestoredEmail(input: {
  email: string;
  displayName: string;
}): Promise<void> {
  const safeName = escapeHtml(input.displayName || "there");
  await deliverNotificationEmail({
    email: input.email,
    subject: "Your For the Baddiez account was restored",
    text: `Hey ${input.displayName || "there"}, your For the Baddiez account was restored and is fully active again. If you did not do this, reset your password immediately from the sign-in screen.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1d1425"><h1 style="font-size:24px">Welcome back</h1><p>Hey ${safeName},</p><p>Your For the Baddiez account was restored and is fully active again. Nothing was deleted.</p><p><strong>If you did not do this</strong>, reset your password immediately from the sign-in screen.</p></div>`,
    logLabel: "Account-restored email"
  });
}
