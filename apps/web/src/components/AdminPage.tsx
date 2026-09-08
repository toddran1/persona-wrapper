import { useEffect, useState, type FormEvent } from "react";
import type { AdminAccountInvestigation, AdminOperationsOverview, AdminPlanOverrideLookup, AdminReviewSubmission } from "@persona/shared";
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

function formatUsd(microUsd: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(microUsd / 1_000_000);
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
  const [reviewSubmissions, setReviewSubmissions] = useState<AdminReviewSubmission[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | undefined>();
  const [operations, setOperations] = useState<AdminOperationsOverview | undefined>();
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [operationsError, setOperationsError] = useState<string | undefined>();
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});
  const [resolvingId, setResolvingId] = useState<string | undefined>();
  const [account, setAccount] = useState<AdminAccountInvestigation | undefined>();
  const [accountReason, setAccountReason] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getCurrentUser()
      .then((me) => { if (!cancelled) setSignedIn(Boolean(me.user)); })
      .catch(() => { if (!cancelled) setSignedIn(false); })
      .finally(() => { if (!cancelled) setSessionChecked(true); });
    return () => { cancelled = true; };
  }, []);

  async function refreshReviewSubmissions(): Promise<void> {
    setReviewLoading(true);
    setReviewError(undefined);
    try {
      setReviewSubmissions(await api.adminReviewSubmissions());
    } catch (reviewFailure) {
      setReviewError(reviewFailure instanceof Error ? reviewFailure.message : "Could not load review submissions.");
    } finally {
      setReviewLoading(false);
    }
  }

  async function refreshOperations(): Promise<void> {
    setOperationsLoading(true);
    setOperationsError(undefined);
    try {
      setOperations(await api.adminOperationsOverview(30));
    } catch (failure) {
      setOperationsError(failure instanceof Error ? failure.message : "Could not load operations monitoring.");
    } finally {
      setOperationsLoading(false);
    }
  }

  useEffect(() => {
    if (sessionChecked && signedIn) {
      void refreshReviewSubmissions();
      void refreshOperations();
    }
  }, [sessionChecked, signedIn]);

  async function handleSafetyResolution(reportId: string, status: "resolved" | "dismissed"): Promise<void> {
    const resolution = resolutionNotes[reportId]?.trim();
    if (!resolution || resolvingId) return;
    setResolvingId(reportId);
    setReviewError(undefined);
    try {
      await api.adminResolveSafetyReport({ reportId, status, resolution });
      setResolutionNotes((current) => ({ ...current, [reportId]: "" }));
      await Promise.all([refreshReviewSubmissions(), refreshOperations()]);
    } catch (failure) {
      setReviewError(failure instanceof Error ? failure.message : "Could not resolve the safety report.");
    } finally {
      setResolvingId(undefined);
    }
  }

  async function handleAccountLookup(): Promise<void> {
    const user = identifier.trim();
    if (!user || accountBusy) return;
    setAccountBusy(true);
    setError(undefined);
    try { setAccount(await api.adminInvestigateAccount(user)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not investigate the account."); }
    finally { setAccountBusy(false); }
  }

  async function handleAccountStatus(status: "active" | "suspended"): Promise<void> {
    if (!account || !accountReason.trim() || accountBusy) return;
    setAccountBusy(true);
    setError(undefined);
    try {
      setAccount(await api.adminUpdateAccountStatus({ user: account.user.id, status, reason: accountReason.trim() }));
      setAccountReason("");
      setNotice(status === "suspended" ? "Account suspended and active sessions revoked." : "Account reinstated.");
      await refreshOperations();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update the account."); }
    finally { setAccountBusy(false); }
  }

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
        <h1>Admin</h1>
        <p>Monitor ad economics and operations, review safety reports, investigate accounts, and manage access.</p>
      </header>

      <section className="admin-review-queue" aria-labelledby="admin-operations-heading">
        <div className="admin-review-heading">
          <div><p className="admin-review-eyebrow">LAST 30 DAYS</p><h2 id="admin-operations-heading">Operations overview</h2></div>
          <button type="button" disabled={operationsLoading} onClick={() => void refreshOperations()}>{operationsLoading ? "Refreshing…" : "Refresh"}</button>
        </div>
        {operationsError ? <div className="composer-attachment-error" role="alert">{operationsError}</div> : null}
        {operations ? (
          <>
            <div className="admin-metric-grid">
              <article><span>Rewarded ads watched</span><strong>{operations.metrics.rewardedAdsWatched.toLocaleString()}</strong></article>
              <article><span>Ad revenue (USD)</span><strong>{formatUsd(operations.metrics.adRevenueMicroUsd)}</strong></article>
              <article><span>Credits granted</span><strong>{operations.metrics.creditsGranted.toLocaleString()}</strong></article>
              <article><span>Actual Bronze AI cost</span><strong>{formatUsd(operations.metrics.actualAiCostMicroUsd)}</strong></article>
              <article><span>Rewarded-ad gross margin</span><strong>{formatUsd(operations.metrics.grossMarginMicroUsd)}</strong></article>
              <article><span>Open safety reports</span><strong>{operations.metrics.openSafetyReports}</strong></article>
              <article><span>Failed background jobs</span><strong>{operations.metrics.failedJobs}</strong></article>
              <article><span>Spend anomalies</span><strong>{operations.metrics.usageAnomalies}</strong></article>
              <article><span>Cleanup failures</span><strong>{operations.metrics.storageCleanupFailures}</strong></article>
            </div>
            <p className="admin-page-note">iLAR is client-reported, deduplicated by reward session, and counted only after Google’s signed reward verification succeeds. “Ad revenue less AI cost” subtracts all settled Bronze-plan AI cost in this period; it is a conservative operating indicator, not accounting profit.</p>
            {operations.metrics.otherRevenueCurrencies.length ? <p className="admin-page-note">Revenue excluded from USD total: {operations.metrics.otherRevenueCurrencies.map((item) => `${item.currency} ${(item.valueMicro / 1_000_000).toFixed(2)}`).join(", ")}.</p> : null}
            <div className="admin-operations-columns">
              <section><h3>Failed jobs</h3>{operations.failedJobs.length ? <ul>{operations.failedJobs.map((job) => <li key={job.id}><strong>{job.kind}</strong> · {job.failureReason ?? "provider failure"}<small>{formatDate(job.updatedAt)} · {job.ownerId ?? "system"}<br />{job.error?.slice(0, 240)}</small></li>)}</ul> : <p className="admin-page-note">No failed jobs in this period.</p>}</section>
              <section><h3>Usage/spend anomalies</h3>{operations.usageAnomalies.length ? <ul>{operations.usageAnomalies.map((item) => <li key={item.userId}><strong>{formatUsd(item.costMicroUsd)}</strong> · {item.eventCount} events<small>{item.userId}</small></li>)}</ul> : <p className="admin-page-note">No user reached the $5 review threshold.</p>}</section>
              <section><h3>Storage cleanup failures</h3>{operations.storageCleanupFailures.length ? <ul>{operations.storageCleanupFailures.map((item) => <li key={item.id}><strong>{item.component}</strong><small>{formatDate(item.createdAt)} · {item.message}</small></li>)}</ul> : <p className="admin-page-note">No unresolved cleanup failures.</p>}</section>
              <section><h3>Subscriptions</h3><p className="admin-page-note">Read-only monitoring. Refund actions will be added with a provider-backed workflow.</p>{operations.subscriptions.length ? <ul>{operations.subscriptions.map((item) => <li key={item.id}><strong>{item.planId} · {item.status}</strong><small>{item.store ?? "unknown store"} · period ends {formatDate(item.currentPeriodEndsAt)}<br />{item.userId}</small></li>)}</ul> : <p className="admin-page-note">No subscriptions recorded.</p>}</section>
              <section><h3>Operator audit history</h3>{operations.auditHistory.length ? <ul>{operations.auditHistory.map((item) => <li key={item.id}><strong>{item.action}</strong> · {item.targetType}<small>{formatDate(item.createdAt)} · {item.targetId ?? "—"}<br />{item.reason ?? "No reason recorded"}</small></li>)}</ul> : <p className="admin-page-note">No operator actions recorded.</p>}</section>
            </div>
          </>
        ) : null}
      </section>

      <section className="admin-review-queue" aria-labelledby="admin-review-heading">
        <div className="admin-review-heading">
          <div>
            <p className="admin-review-eyebrow">USER SUBMISSIONS</p>
            <h2 id="admin-review-heading">Safety reports &amp; feedback</h2>
            <p className="admin-page-note">The newest 50 safety reports and general response-feedback submissions.</p>
          </div>
          <button type="button" disabled={reviewLoading} onClick={() => void refreshReviewSubmissions()}>{reviewLoading ? "Refreshing…" : "Refresh"}</button>
        </div>
        {reviewError ? <div className="composer-attachment-error" role="alert">{reviewError}</div> : null}
        {!reviewLoading && !reviewError && reviewSubmissions.length === 0 ? <p className="admin-page-note">No submissions yet.</p> : null}
        {reviewSubmissions.length > 0 ? (
          <ul className="admin-review-list">
            {reviewSubmissions.map((submission) => (
              <li key={`${submission.kind}-${submission.id}`} className="admin-review-row">
                <div className="admin-review-meta">
                  <span className={`admin-review-kind admin-review-kind-${submission.kind}`}>{submission.kind === "unsafe_output" ? "Safety report" : "Feedback"}</span>
                  <strong>{submission.category.replaceAll("_", " ")}</strong>
                  <small>{formatDate(submission.createdAt)} · {submission.userEmail ?? submission.username ?? submission.userId ?? "Unknown user"}{submission.clientType ? ` · ${submission.clientType}` : ""}</small>
                </div>
                <blockquote>{submission.outputExcerpt}</blockquote>
                {submission.details ? <p className="admin-review-details">{submission.details}</p> : null}
                <small className="admin-review-conversation">Conversation: {submission.conversationId ?? "unavailable"}</small>
                {submission.kind === "unsafe_output" ? (
                  submission.status === "open" ? <div className="admin-resolution-form">
                    <input value={resolutionNotes[submission.id] ?? ""} onChange={(event) => setResolutionNotes((current) => ({ ...current, [submission.id]: event.target.value }))} placeholder="Required resolution note" />
                    <button type="button" disabled={resolvingId === submission.id || !(resolutionNotes[submission.id]?.trim())} onClick={() => void handleSafetyResolution(submission.id, "resolved")}>Resolve</button>
                    <button type="button" disabled={resolvingId === submission.id || !(resolutionNotes[submission.id]?.trim())} onClick={() => void handleSafetyResolution(submission.id, "dismissed")}>Dismiss</button>
                  </div> : <small className="admin-review-conversation">{submission.status}: {submission.resolution} · {formatDate(submission.resolvedAt)}</small>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="admin-plan-section" aria-labelledby="admin-plan-heading">
        <h2 id="admin-plan-heading">Account investigation &amp; access</h2>
        <p className="admin-page-note">Overrides never downgrade a paid subscription.</p>

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
        <button type="button" disabled={accountBusy || !identifier.trim()} onClick={() => void handleAccountLookup()}>Investigate</button>
      </form>

      {error ? <div className="composer-attachment-error" role="alert">{error}</div> : null}
      {notice ? <div className="settings-notice" role="status">{notice}</div> : null}

      {account ? <section className="admin-account-result">
        <h3>{account.user.email ?? account.user.username ?? account.user.id} <span className="admin-badge">{account.user.status}</span></h3>
        <p>Plan: <strong>{account.effectivePlanId}</strong> · Joined {formatDate(account.user.createdAt)} · Open safety reports: {account.openSafetyReports} · Failed jobs: {account.failedJobs} · Lifetime settled AI cost: {formatUsd(account.usageCostMicroUsd)}</p>
        <p>Deletion requested: {formatDate(account.user.deletionRequestedAt)} · Scheduled: {formatDate(account.user.deletionScheduledFor)}</p>
        <p>Subscription: {account.subscription ? `${account.subscription.planId} · ${account.subscription.status} · ${account.subscription.store ?? "unknown store"}` : "none"}</p>
        <div className="admin-resolution-form"><input value={accountReason} onChange={(event) => setAccountReason(event.target.value)} placeholder="Required operator reason" />{account.user.status === "active" ? <button type="button" disabled={accountBusy || !accountReason.trim()} onClick={() => void handleAccountStatus("suspended")}>Suspend user</button> : account.user.status === "suspended" ? <button type="button" disabled={accountBusy || !accountReason.trim()} onClick={() => void handleAccountStatus("active")}>Reinstate user</button> : <span>Pending-deletion accounts must use the existing restore/purge workflow.</span>}</div>
      </section> : null}

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
      </section>
    </main>
  );
}
