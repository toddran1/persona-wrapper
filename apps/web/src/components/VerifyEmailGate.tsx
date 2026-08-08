import { useState } from "react";

export function VerifyEmailGate({
  email,
  onResend,
  onCheckStatus,
  onLogout
}: {
  email: string;
  onResend: () => Promise<void>;
  onCheckStatus: () => Promise<boolean>;
  onLogout: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"resend" | "check" | "logout" | undefined>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  async function resend(): Promise<void> {
    if (busy) return;
    setBusy("resend");
    setNotice(undefined);
    setError(undefined);
    try {
      await onResend();
      setNotice("Verification email sent — check your inbox and spam folder.");
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : "Could not send the verification email.");
    } finally {
      setBusy(undefined);
    }
  }

  async function checkStatus(): Promise<void> {
    if (busy) return;
    setBusy("check");
    setNotice(undefined);
    setError(undefined);
    try {
      const verified = await onCheckStatus();
      if (!verified) setNotice("Not verified yet — open the link in the email, then check again.");
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : "Could not check your verification status.");
    } finally {
      setBusy(undefined);
    }
  }

  async function logout(): Promise<void> {
    if (busy) return;
    setBusy("logout");
    try {
      await onLogout();
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <main className="policy-consent-shell">
      <section className="policy-consent-card" aria-labelledby="verify-email-title">
        <p className="policy-consent-eyebrow">One more step</p>
        <h1 id="verify-email-title">Verify your email</h1>
        <p>
          We sent a verification link to <strong>{email}</strong>. Open it to activate your account and jump back in.
        </p>
        {notice ? <div className="settings-notice" role="status">{notice}</div> : null}
        {error ? (
          <div className="policy-consent-error" role="alert">
            <span>{error}</span>
          </div>
        ) : null}
        <button
          type="button"
          className="policy-consent-primary"
          disabled={Boolean(busy)}
          onClick={() => void checkStatus()}
        >
          {busy === "check" ? "Checking…" : "I've verified — continue"}
        </button>
        <button
          type="button"
          className="policy-consent-logout"
          disabled={Boolean(busy)}
          onClick={() => void resend()}
        >
          {busy === "resend" ? "Sending…" : "Resend verification email"}
        </button>
        <button type="button" className="policy-consent-logout" disabled={Boolean(busy)} onClick={() => void logout()}>
          Log out
        </button>
      </section>
    </main>
  );
}
