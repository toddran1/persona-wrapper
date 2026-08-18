import { useEffect, useState, type FormEvent } from "react";
import type { AdminPlanOverrideLookup } from "@persona/shared";
import { api } from "../lib/api.js";

const PLAN_OPTIONS = [
  ["gold", "Gold"],
  ["silver", "Silver"],
  ["bronze", "Bronze"]
] as const;

const SOURCE_OPTIONS = [
  ["promotion", "Promotion"],
  ["tester", "Tester"],
  ["customer_support", "Customer support"],
  ["grandfathered", "Grandfathered"]
] as const;

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function AdminPage() {
  const [sessionChecked, setSessionChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [lookup, setLookup] = useState<AdminPlanOverrideLookup | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [planId, setPlanId] = useState<"bronze" | "silver" | "gold">("gold");
  const [source, setSource] = useState<"promotion" | "tester" | "customer_support" | "grandfathered">("tester");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [revokingId, setRevokingId] = useState<string | undefined>();
  const [revokeReason, setRevokeReason] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.getCurrentUser()
      .then((me) => { if (!cancelled) setSignedIn(Boolean(me.user)); })
      .catch(() => { if (!cancelled) setSignedIn(false); })
      .finally(() => { if (!cancelled) setSessionChecked(true); });
    return () => { cancelled = true; };
  }, []);

  async function run(action: () => Promise<AdminPlanOverrideLookup>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      setLookup(await action());
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The admin request failed.");
    } finally {
      setBusy(false);
    }
  }

  function handleLookup(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const user = identifier.trim();
    if (!user) return;
    void run(() => api.adminLookupPlanOverrides(user));
  }

  function handleGrant(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const user = identifier.trim();
    if (!user || !reason.trim()) return;
    void run(async () => {
      const result = await api.adminGrantPlanOverride({
        user,
        planId,
        source,
        reason: reason.trim(),
        ...(expiresAt ? { expiresAt: new Date(`${expiresAt}T23:59:59Z`).toISOString() } : {})
      });
      setNotice(`Granted ${planId} (${source}) to ${result.user.email ?? result.user.username ?? result.user.id}.`);
      setReason("");
      setExpiresAt("");
      return result;
    });
  }

  function handleRevoke(assignmentId: string): void {
    const user = identifier.trim();
    if (!user || !revokeReason.trim()) return;
    void run(async () => {
      const result = await api.adminRevokePlanOverride({ user, assignmentId, reason: revokeReason.trim() });
      setNotice("Plan override revoked.");
      setRevokingId(undefined);
      setRevokeReason("");
      return result;
    });
  }

  if (!sessionChecked) {
    return <main className="admin-page"><p className="admin-page-note">Checking your session…</p></main>;
  }
  if (!signedIn) {
    return <main className="admin-page"><p className="admin-page-note">Sign in with an admin account to manage plan overrides.</p></main>;
  }

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <h1>Plan overrides</h1>
        <p>Grant promotional, tester, customer-support, or grandfathered plan access. Overrides never downgrade a paid subscription.</p>
      </header>

      <form className="admin-lookup-form" onSubmit={handleLookup}>
        <label>
          <span>User id, email, or username</span>
          <input
            data-testid="admin-user-lookup"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="tester@example.com"
          />
        </label>
        <button type="submit" disabled={busy || !identifier.trim()}>Look up</button>
      </form>

      {error ? <div className="composer-attachment-error" role="alert">{error}</div> : null}
      {notice ? <div className="settings-notice" role="status">{notice}</div> : null}

      {lookup ? (
        <section className="admin-lookup-result">
          <h2>
            {lookup.user.email ?? lookup.user.username ?? lookup.user.id}
            {lookup.isAdmin ? <span className="admin-badge">admin</span> : null}
          </h2>
          <p>Effective plan: <strong>{lookup.effectivePlanDisplayName}</strong></p>

          {lookup.assignments.length === 0 ? (
            <p className="admin-page-note">No plan assignments — this user resolves to the free Bronze plan.</p>
          ) : (
            <ul className="admin-assignment-list">
              {lookup.assignments.map((assignment) => (
                <li key={assignment.id} className="admin-assignment-row">
                  <div>
                    <strong>{assignment.planId}</strong> · {assignment.source} · {assignment.status}
                    <small>
                      Effective {formatDate(assignment.effectiveAt)} · Expires {formatDate(assignment.expiresAt)}
                      {assignment.reason ? ` · ${assignment.reason}` : ""}
                    </small>
                  </div>
                  {assignment.status === "active" && assignment.source !== "subscription" ? (
                    revokingId === assignment.id ? (
                      <div className="admin-revoke-form">
                        <input
                          data-testid="admin-revoke-reason"
                          value={revokeReason}
                          onChange={(event) => setRevokeReason(event.target.value)}
                          placeholder="Revoke reason"
                        />
                        <button type="button" disabled={busy || !revokeReason.trim()} onClick={() => handleRevoke(assignment.id)}>Confirm</button>
                        <button type="button" onClick={() => { setRevokingId(undefined); setRevokeReason(""); }}>Cancel</button>
                      </div>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => setRevokingId(assignment.id)}>Revoke</button>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <form className="admin-grant-form" onSubmit={handleGrant}>
            <h3>Grant an override</h3>
            <label>
              <span>Plan</span>
              <select data-testid="admin-grant-plan" value={planId} onChange={(event) => setPlanId(event.target.value as typeof planId)}>
                {PLAN_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>Source</span>
              <select data-testid="admin-grant-source" value={source} onChange={(event) => setSource(event.target.value as typeof source)}>
                {SOURCE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>Reason</span>
              <input
                data-testid="admin-grant-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="QA access, launch promo…"
              />
            </label>
            <label>
              <span>Expires (optional)</span>
              <input
                data-testid="admin-grant-expires"
                type="date"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </label>
            <button type="submit" disabled={busy || !reason.trim()}>Grant override</button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
