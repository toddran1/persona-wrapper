import { useEffect } from "react";

export function MobileOAuthReturnPage() {
  const emailVerified = new URLSearchParams(window.location.search).get("emailVerified") === "1";
  const appUrl = emailVerified ? "personawrapper:///?emailVerified=1" : "personawrapper:///";

  useEffect(() => {
    document.title = "Return to For the Baddiez";
    const mobileBrowser = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const returnTimer = mobileBrowser
      ? window.setTimeout(() => { window.location.assign(appUrl); }, 350)
      : undefined;
    return () => {
      if (returnTimer !== undefined) window.clearTimeout(returnTimer);
      document.title = "For the Baddiez";
    };
  }, [appUrl]);

  return <main className="mobile-oauth-return-shell">
    <section className="mobile-oauth-return-card" aria-labelledby="mobile-oauth-return-title">
      <img src="/FTB_logo/For_the_Baddiez_logo_transparent.png" alt="For the Baddiez" />
      <p className="mobile-oauth-return-eyebrow">{emailVerified ? "Email verified" : "Sign in complete"}</p>
      <h1 id="mobile-oauth-return-title">Return to the app</h1>
      <p>
        {emailVerified
          ? "Your email is verified. We’ll try to reopen For the Baddiez automatically."
          : "Your account is ready. Open For the Baddiez to continue chatting."}
      </p>
      <a href={appUrl}>Open For the Baddiez</a>
    </section>
  </main>;
}
