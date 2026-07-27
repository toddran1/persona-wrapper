import type { CurrentPoliciesResponse } from "@persona/shared";
import { useState } from "react";

export function PolicyConsentGate({
  policies,
  loading,
  error,
  onAccept,
  onRetry,
  onLogout
}: {
  policies?: CurrentPoliciesResponse | undefined;
  loading: boolean;
  error?: string | undefined;
  onAccept: () => Promise<void>;
  onRetry: () => void;
  onLogout: () => Promise<void>;
}) {
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  async function submit(): Promise<void> {
    if (!accepted || !policies || saving) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await onAccept();
    } catch (acceptError) {
      setSaveError(acceptError instanceof Error ? acceptError.message : "Could not save your acceptance.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="policy-consent-shell">
      <section className="policy-consent-card" aria-labelledby="policy-consent-title">
        <p className="policy-consent-eyebrow">Before you continue</p>
        <h1 id="policy-consent-title">Review our current policies</h1>
        <p>We updated the policies that govern your account. Review them and confirm your acceptance to continue using For the Baddiez.</p>
        {loading ? <p role="status">Loading the current policies…</p> : null}
        {error || saveError ? (
          <div className="policy-consent-error" role="alert">
            <span>{saveError ?? error}</span>
            {error ? <button type="button" onClick={onRetry}>Try again</button> : null}
          </div>
        ) : null}
        {policies ? (
          <>
            <div className="policy-consent-links" aria-label="Policies to review">
              <a href={policies.termsPath} target="_blank" rel="noreferrer">Terms of Use <span aria-hidden="true">↗</span></a>
              <a href={policies.privacyPath} target="_blank" rel="noreferrer">Privacy Policy <span aria-hidden="true">↗</span></a>
            </div>
            <button
              type="button"
              className="policy-consent-check"
              role="checkbox"
              aria-checked={accepted}
              onClick={() => setAccepted((value) => !value)}
            >
              <span className="policy-consent-checkmark" aria-hidden="true">{accepted ? "✓" : ""}</span>
              <span>I accept the Terms of Use and Privacy Policy.</span>
            </button>
            <button type="button" className="policy-consent-primary" disabled={!accepted || saving} onClick={() => void submit()}>
              {saving ? "Saving…" : "Accept and continue"}
            </button>
          </>
        ) : null}
        <button type="button" className="policy-consent-logout" disabled={saving} onClick={() => void onLogout()}>
          Log out
        </button>
      </section>
    </main>
  );
}
