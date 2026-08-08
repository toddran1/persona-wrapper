import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PASSWORD_MIN_LENGTH } from "@persona/shared";
import { api } from "../lib/api.js";
import { PasswordInput } from "./PasswordInput.js";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const invalidToken = searchParams.get("error") === "INVALID_TOKEN" || !token;
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const canSubmit = useMemo(
    () => !invalidToken && password.length >= PASSWORD_MIN_LENGTH && password === confirmation && !busy,
    [busy, confirmation, invalidToken, password]
  );

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.resetPassword(token, password);
      setComplete(true);
      setPassword("");
      setConfirmation("");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Could not reset your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-lifecycle-page">
      <section className="auth-lifecycle-card" aria-labelledby="reset-password-title">
        <img src="/FTB_logo/For_the_Baddiez_logo_transparent.png" alt="For the Baddiez" />
        <h1 id="reset-password-title">{complete ? "Password updated" : "Reset your password"}</h1>
        {complete ? (
          <>
            <p>Your password is ready. Other signed-in devices have been logged out for security.</p>
            <Link className="auth-lifecycle-primary" to="/">Return to sign in</Link>
          </>
        ) : invalidToken ? (
          <>
            <p role="alert">This reset link is invalid or has expired. Request a new one from the sign-in screen.</p>
            <Link className="auth-lifecycle-primary" to="/">Return to sign in</Link>
          </>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <p>Choose a new password with at least {PASSWORD_MIN_LENGTH} characters.</p>
            <label>
              New password
              <PasswordInput ariaLabel="New password" autoComplete="new-password" value={password} onChange={setPassword} disabled={busy} showStrength />
            </label>
            <label>
              Confirm new password
              <PasswordInput ariaLabel="Confirm new password" autoComplete="new-password" value={confirmation} onChange={setConfirmation} disabled={busy} />
            </label>
            {confirmation && password !== confirmation ? <p className="auth-lifecycle-error" role="alert">Passwords do not match.</p> : null}
            {error ? <p className="auth-lifecycle-error" role="alert">{error}</p> : null}
            <button className="auth-lifecycle-primary" type="submit" disabled={!canSubmit}>{busy ? "Updating..." : "Update password"}</button>
          </form>
        )}
      </section>
    </main>
  );
}
