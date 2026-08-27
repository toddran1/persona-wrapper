import type { PlanId } from "@persona/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import {
  clearPendingBillingCheckout,
  readPendingBillingCheckout,
  type PendingBillingCheckout
} from "../lib/pendingBillingCheckout.js";

type ConfirmationState = "checking" | "confirmed" | "waiting" | "signed-out" | "error";

const MAX_AUTOMATIC_CHECKS = 40;
const CHECK_INTERVAL_MS = 3_000;

function titleCasePlan(planId: PlanId | undefined): string {
  if (!planId) return "membership";
  return `${planId[0]?.toUpperCase()}${planId.slice(1)}`;
}

function ConfirmationMark({ state }: { state: ConfirmationState }) {
  if (state === "confirmed") {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="m8.5 16.4 4.8 4.8L24 10.5" />
      </svg>
    );
  }
  return <span aria-hidden="true" />;
}

export function BillingReturnPage() {
  const pendingRef = useRef<PendingBillingCheckout | undefined>(readPendingBillingCheckout());
  const checksRef = useRef(0);
  const requestPendingRef = useRef(false);
  const [state, setState] = useState<ConfirmationState>("checking");
  const [activePlan, setActivePlan] = useState<PlanId>();
  const [message, setMessage] = useState("We’re matching your purchase to your For the Baddiez account.");

  const checkMembership = useCallback(async () => {
    if (requestPendingRef.current) return;
    requestPendingRef.current = true;
    checksRef.current += 1;
    if (checksRef.current === 1) setState("checking");
    try {
      const me = await api.getCurrentUser();
      const pending = pendingRef.current;
      if (pending && pending.accountId !== me.user.id) {
        clearPendingBillingCheckout();
        pendingRef.current = undefined;
        setState("error");
        setMessage("This checkout was started for a different account. Sign in with the account used at checkout, then check again.");
        return;
      }

      const [usage, catalog] = await Promise.all([api.getPlanUsage(), api.getBillingCatalog()]);
      const confirmedPlan = catalog.currentPlanId ?? usage.plan.id;
      setActivePlan(confirmedPlan);

      if (pending?.planId === confirmedPlan || (!pending && confirmedPlan !== "bronze")) {
        clearPendingBillingCheckout();
        pendingRef.current = undefined;
        setState("confirmed");
        setMessage(`${titleCasePlan(confirmedPlan)} is active. Your new limits and persona access are ready.`);
        return;
      }

      if (pending && pending.currentPlanId !== "bronze" && pending.planId !== confirmedPlan) {
        setState("waiting");
        setMessage(
          `Your ${titleCasePlan(confirmedPlan)} access remains active while RevenueCat finishes processing the change to ${titleCasePlan(pending.planId)}.`
        );
        return;
      }

      setState("waiting");
      setMessage(
        checksRef.current >= MAX_AUTOMATIC_CHECKS
          ? "The store accepted the checkout, but your membership has not reached us yet. You can continue and check Plan & usage again shortly."
          : `RevenueCat is still confirming your ${titleCasePlan(pending?.planId)} membership. This usually takes only a few seconds.`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "We could not confirm your membership.";
      if (/not authenticated|authentication|sign in/i.test(errorMessage)) {
        setState("signed-out");
        setMessage("Sign in with the same account you used at checkout, then return here to confirm your membership.");
      } else {
        setState("error");
        setMessage(errorMessage);
      }
    } finally {
      requestPendingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void checkMembership();
    const intervalId = window.setInterval(() => {
      if (checksRef.current >= MAX_AUTOMATIC_CHECKS || state === "confirmed" || state === "signed-out") return;
      void checkMembership();
    }, CHECK_INTERVAL_MS);
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible" && state !== "confirmed") void checkMembership();
    };
    document.addEventListener("visibilitychange", checkWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, [checkMembership, state]);

  const planLabel = titleCasePlan(activePlan ?? pendingRef.current?.planId);
  const eyebrow = state === "confirmed" ? "Membership confirmed" : state === "signed-out" ? "Account needed" : "Secure checkout return";
  const heading = state === "confirmed" ? `Welcome to ${planLabel}` : state === "waiting" ? "Almost there" : state === "signed-out" ? "Finish with the right account" : state === "error" ? "We need another look" : "Confirming your plan";

  return (
    <main className="billing-return-page">
      <div className="billing-return-glow" aria-hidden="true" />
      <section className={`billing-return-shell billing-return-${state}`} aria-labelledby="billing-return-title">
        <aside className="billing-return-identity" aria-label="For the Baddiez membership">
          <img src="/FTB_logo/For_the_Baddiez_logo_transparent.png" alt="" />
          <div>
            <strong>FOR THE BADDIEZ</strong>
            <span>Membership desk</span>
          </div>
          <p>One account. Every conversation. Your access follows you across web and mobile.</p>
          <div className="billing-return-pass" aria-hidden="true">
            <span>{planLabel}</span>
            <b>FTB / MEMBER</b>
          </div>
        </aside>

        <div className="billing-return-content">
          <div className="billing-return-status-mark"><ConfirmationMark state={state} /></div>
          <p className="billing-return-eyebrow">{eyebrow}</p>
          <h1 id="billing-return-title">{heading}</h1>
          <p className="billing-return-message" role={state === "error" ? "alert" : "status"} aria-live="polite">{message}</p>

          <ol className="billing-return-steps" aria-label="Purchase confirmation progress">
            <li className="complete"><span>1</span><div><b>Checkout</b><small>Payment submitted securely</small></div></li>
            <li className={state === "confirmed" ? "complete" : "active"}><span>2</span><div><b>Account sync</b><small>{state === "confirmed" ? "Entitlement received" : "Waiting for confirmation"}</small></div></li>
            <li className={state === "confirmed" ? "complete" : ""}><span>3</span><div><b>Access</b><small>{state === "confirmed" ? "Ready across your devices" : "Unlocks automatically"}</small></div></li>
          </ol>

          <div className="billing-return-actions">
            {state === "confirmed" ? (
              <Link className="billing-return-primary" to="/">Continue to For the Baddiez</Link>
            ) : state === "signed-out" ? (
              <Link className="billing-return-primary" to="/">Go to sign in</Link>
            ) : (
              <button className="billing-return-primary" type="button" onClick={() => void checkMembership()} disabled={state === "checking"}>
                {state === "checking" ? "Checking…" : "Check again"}
              </button>
            )}
            {state !== "confirmed" && state !== "signed-out" ? <Link className="billing-return-secondary" to="/">Continue while we confirm</Link> : null}
          </div>
          <p className="billing-return-footnote">Your plan is activated only after our server receives a verified RevenueCat entitlement.</p>
        </div>
      </section>
    </main>
  );
}
