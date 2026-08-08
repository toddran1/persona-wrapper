import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMailMock = vi.fn();
  return {
    sendMail: sendMailMock,
    createTransport: vi.fn(() => ({ sendMail: sendMailMock }))
  };
});

vi.mock("nodemailer", () => ({
  default: { createTransport }
}));

import { env } from "../config/env.js";
import {
  sendAccountDeletionScheduledEmail,
  sendAccountRestoredEmail,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendVerificationEmail
} from "../services/authEmailService.js";

const originalSmtpUser = env.GMAIL_SMTP_USER;
const originalSmtpPassword = env.GMAIL_SMTP_APP_PASSWORD;

beforeEach(() => {
  env.GMAIL_SMTP_USER = "mailer@example.com";
  env.GMAIL_SMTP_APP_PASSWORD = "smtp-secret";
  sendMail.mockReset().mockResolvedValue(undefined);
  createTransport.mockClear();
});

afterEach(() => {
  env.GMAIL_SMTP_USER = originalSmtpUser;
  env.GMAIL_SMTP_APP_PASSWORD = originalSmtpPassword;
});

describe("authEmailService", () => {
  it("sends the password reset email with escaped content", async () => {
    await sendPasswordResetEmail({
      email: "user@example.com",
      displayName: "<b>Reggie</b>",
      resetUrl: "https://app.example.com/reset-password?token=abc"
    });

    expect(sendMail).toHaveBeenCalledOnce();
    const mail = sendMail.mock.calls[0]?.[0] as { to: string; subject: string; html: string };
    expect(mail.to).toBe("user@example.com");
    expect(mail.subject).toContain("Reset");
    expect(mail.html).toContain("&lt;b&gt;Reggie&lt;/b&gt;");
    expect(mail.html).not.toContain("<b>Reggie</b>");
  });

  it("sends the verification email with the verification link", async () => {
    await sendVerificationEmail({
      email: "user@example.com",
      displayName: "Reggie",
      verificationUrl: "https://api.example.com/api/auth/verify-email?token=abc&callbackURL=https%3A%2F%2Fapp.example.com"
    });

    expect(sendMail).toHaveBeenCalledOnce();
    const mail = sendMail.mock.calls[0]?.[0] as { to: string; subject: string; html: string; text: string };
    expect(mail.to).toBe("user@example.com");
    expect(mail.subject).toContain("Verify");
    expect(mail.text).toContain("verify-email?token=abc");
  });

  it("throws a public-safe error that hides SMTP details when delivery fails", async () => {
    sendMail.mockRejectedValueOnce(new Error("535 auth failed for smtp-secret"));

    const failure = await sendPasswordResetEmail({
      email: "user@example.com",
      displayName: "Reggie",
      resetUrl: "https://app.example.com/reset-password?token=abc"
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("Password-reset email delivery failed.");
    expect((failure as Error).message).not.toContain("smtp-secret");
  });

  it("fails fast when SMTP is not configured", async () => {
    env.GMAIL_SMTP_USER = undefined;
    env.GMAIL_SMTP_APP_PASSWORD = undefined;

    await expect(sendVerificationEmail({
      email: "user@example.com",
      displayName: "Reggie",
      verificationUrl: "https://api.example.com/api/auth/verify-email?token=abc"
    })).rejects.toThrow("not configured");
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("sends the security notification emails", async () => {
    await sendPasswordChangedEmail({ email: "user@example.com", displayName: "Reggie" });
    await sendAccountDeletionScheduledEmail({
      email: "user@example.com",
      displayName: "Reggie",
      deletionScheduledFor: new Date(Date.UTC(2026, 8, 15))
    });
    await sendAccountRestoredEmail({ email: "user@example.com", displayName: "Reggie" });

    const subjects = sendMail.mock.calls.map((call) => (call[0] as { subject: string }).subject);
    expect(subjects).toEqual([
      "Your For the Baddiez password was changed",
      "Your For the Baddiez account is scheduled for deletion",
      "Your For the Baddiez account was restored"
    ]);
    const deletionMail = sendMail.mock.calls[1]?.[0] as { text: string };
    expect(deletionMail.text).toContain("September 15, 2026");
  });

  it("skips notifications for synthetic username-only addresses and when SMTP is unconfigured", async () => {
    await sendPasswordChangedEmail({ email: "baddie42@users.invalid", displayName: "baddie42" });
    expect(sendMail).not.toHaveBeenCalled();

    env.GMAIL_SMTP_USER = undefined;
    env.GMAIL_SMTP_APP_PASSWORD = undefined;
    await sendAccountRestoredEmail({ email: "user@example.com", displayName: "Reggie" });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("swallows notification delivery failures instead of failing the caller", async () => {
    sendMail.mockRejectedValueOnce(new Error("smtp down"));

    await expect(sendPasswordChangedEmail({ email: "user@example.com", displayName: "Reggie" }))
      .resolves.toBeUndefined();
  });
});
