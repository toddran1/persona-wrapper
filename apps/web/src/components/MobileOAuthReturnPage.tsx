import { useEffect } from "react";

export function MobileOAuthReturnPage() {
  useEffect(() => {
    document.title = "Return to For the Baddiez";
    return () => { document.title = "For the Baddiez"; };
  }, []);

  return <main className="mobile-oauth-return-shell">
    <section className="mobile-oauth-return-card" aria-labelledby="mobile-oauth-return-title">
      <img src="/FTB_logo/For_the_Baddiez_logo_transparent.png" alt="For the Baddiez" />
      <p className="mobile-oauth-return-eyebrow">Sign in complete</p>
      <h1 id="mobile-oauth-return-title">Return to the app</h1>
      <p>Your account is ready. Open For the Baddiez to continue chatting.</p>
      <a href="personawrapper://auth/callback">Open For the Baddiez</a>
    </section>
  </main>;
}
