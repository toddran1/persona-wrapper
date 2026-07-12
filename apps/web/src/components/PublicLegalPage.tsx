import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api.js";

const EFFECTIVE_DATE = "July 12, 2026";
const SUPPORT_EMAIL = (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined)?.trim() || "support@forthebaddiez.com";

type LegalSection = { title: string; content: ReactNode };

const MOBILE_RETURN_PROTOCOLS = new Set(["personawrapper:", "exp:", "exps:"]);

export function legalMobileReturnHref(search: string): string | undefined {
  const returnTo = new URLSearchParams(search).get("returnTo");
  if (!returnTo) return undefined;
  try {
    const parsed = new URL(returnTo);
    return MOBILE_RETURN_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

const privacySections: LegalSection[] = [
  { title: "1. Scope", content: <p>This Privacy Policy explains how For the Baddiez collects, uses, discloses, retains, and protects information when you use our websites, mobile applications, APIs, persona-based chat experiences, and related support services (collectively, the “Service”). It applies to registered users, visitors, and people who contact support.</p> },
  { title: "2. Information you provide", content: <><p>We collect information you choose to provide, including:</p><ul><li>Account details such as email address, username, display name, profile image, password credential, and connected Google or Facebook account identifiers.</li><li>Conversation content, prompts, message history, feedback, persona selections, and feature preferences.</li><li>Files, images, documents, audio, microphone input converted to text, and other content you upload or generate.</li><li>Support communications, deletion requests, reports, and information needed to verify account ownership.</li></ul><p>Passwords are stored as one-way password hashes. OAuth provider access tokens are not exposed to other users.</p></> },
  { title: "3. Information collected automatically", content: <><p>We may automatically collect device and service information such as IP address, browser or app type, operating system, device identifier, language, time zone, request timestamps, authentication events, crash information, diagnostic logs, feature usage, token usage, and approximate location inferred from network information. Precise device location is used only when you grant permission and invoke a feature that needs it.</p></> },
  { title: "4. AI processing", content: <><p>Your prompts and selected conversation context may be sent to AI, speech, search, storage, and media-generation providers to produce requested responses. Depending on the feature, this can include OpenAI, ElevenLabs, cloud infrastructure providers, web-search providers, and OAuth providers. Files may be temporarily uploaded to provider systems for analysis, retrieval, code execution, image generation, or other tools you request.</p><p>AI output may be inaccurate, incomplete, offensive, or unsuitable for your circumstances. Do not submit secrets, highly sensitive personal data, protected health information, financial credentials, or information you do not have permission to process.</p></> },
  { title: "5. How we use information", content: <><ul><li>Provide, personalize, secure, and maintain the Service.</li><li>Authenticate users and synchronize chats across devices.</li><li>Generate persona responses, images, audio, files, analyses, and cited search results.</li><li>Detect abuse, fraud, security incidents, and violations of our Terms.</li><li>Debug failures, monitor reliability, enforce usage limits, and improve product quality.</li><li>Respond to support, privacy, and legal requests.</li><li>Comply with law and protect users, the public, and our rights.</li></ul><p>We do not sell personal information for money. We do not use your private conversation content for third-party advertising.</p></> },
  { title: "6. When information is shared", content: <><p>We may disclose information to service providers that process data for hosting, storage, authentication, AI inference, speech, analytics, security, and support; to authorities when legally required; to protect safety or investigate abuse; or as part of a merger, financing, acquisition, or asset transfer subject to appropriate protections. We may share information at your direction, such as when you open a reference, share generated content, or connect a third-party account.</p></> },
  { title: "7. Retention", content: <><p>Account and conversation data is retained while your account is active or as needed to provide the Service. Generated files and provider-side processing artifacts may have shorter technical expiration periods. Security logs, rate-limit records, backup copies, and records required for fraud prevention, dispute resolution, or legal compliance may be retained for a limited period after other data is deleted.</p><p>When account deletion is requested, access is disabled immediately and permanent deletion is scheduled after the recovery period described in our Delete Account Policy. Deletion from active systems and service providers is initiated as part of the purge process. Residual encrypted backups may age out according to backup rotation schedules and are not restored except for disaster recovery.</p></> },
  { title: "8. Your choices and rights", content: <><p>You may access and update certain account information, delete individual chats, manage audio and device permissions, disconnect OAuth access through the provider, request account deletion, or restore a pending account before its deadline. Depending on where you live, you may also have rights to request access, correction, portability, restriction, objection, or deletion of personal data, and to appeal or complain to a regulator.</p><p>Submit requests through <a href="/support">Support</a>. We may verify your identity before acting and may deny or limit requests where permitted by law.</p></> },
  { title: "9. Security", content: <p>We use administrative, technical, and organizational safeguards designed to protect information, including hashed credentials, scoped authentication tokens, access controls, encrypted network transport in production, owner-based media authorization, and deletion workflows. No system is completely secure. You are responsible for protecting your credentials and promptly reporting suspected unauthorized access.</p> },
  { title: "10. Age requirement and children", content: <><p>You must be at least 16 years old to create an account or use the Service. Users who are 16 or 17 may use the Service only with permission from a parent or legal guardian.</p><p>The Service is not directed to children under 13, and we do not knowingly collect personal information from a child under 13. Contact Support if you believe a person under 16 has created an account or that a child has provided personal information. We may suspend the account and delete the associated information after appropriate verification.</p></> },
  { title: "11. International processing", content: <p>Information may be processed in the United States and other countries where our providers operate. Those locations may have different privacy laws. Where required, we use lawful transfer mechanisms and contractual protections.</p> },
  { title: "12. Policy changes and contact", content: <><p>We may update this policy as the Service changes. Material changes will be communicated through the Service or another appropriate channel, and the effective date will be updated.</p><p>Privacy questions and requests: <a href={`mailto:${SUPPORT_EMAIL}?subject=Privacy request`}>{SUPPORT_EMAIL}</a>.</p></> }
];

const termsSections: LegalSection[] = [
  { title: "1. Agreement", content: <p>These Terms of Use are a binding agreement between you and the operator of For the Baddiez. By creating an account, accessing, or using the Service, you confirm that you are at least 16 years old and agree to these Terms and the Privacy Policy. If you are under 16 or do not agree, you may not create an account or use the Service.</p> },
  { title: "2. Eligibility and accounts", content: <><p>You must be 16 years of age or older to create an account or use the Service. If you are 16 or 17, you may use the Service only with permission from a parent or legal guardian. By registering or using the Service, you represent and warrant that you satisfy these requirements and are legally capable of entering this agreement.</p><p>You must provide accurate account information, keep credentials confidential, and promptly notify us of unauthorized access. You are responsible for activity under your account unless caused by our breach. You may not create accounts through automated means, impersonate another person, transfer credentials, or evade a suspension or usage restriction. We may suspend or delete an account if we reasonably believe the user is under 16 or provided false eligibility information.</p></> },
  { title: "3. The Service and personas", content: <p>The Service provides fictional or stylized AI persona experiences. Personas, including names, voices, opinions, visual depictions, and responses, are generated or curated entertainment interfaces and are not real people, licensed professionals, or authoritative sources. We may add, modify, replace, or discontinue personas and features.</p> },
  { title: "4. AI limitations", content: <><p>AI responses can be incorrect, outdated, biased, fabricated, or inconsistent. Search references can be incomplete or point to third-party content we do not control. Generated media may not meet your expectations. You must independently verify important information.</p><p>The Service is not a substitute for medical, legal, financial, mental-health, emergency, or other professional advice. Do not rely on it for high-impact decisions or emergencies.</p></> },
  { title: "5. Acceptable use", content: <><p>You may not use the Service to:</p><ul><li>Break the law, violate another person’s rights, or facilitate fraud, harassment, exploitation, or violence.</li><li>Create or distribute child sexual abuse material, non-consensual intimate imagery, unlawful sexual content, or content that exploits minors.</li><li>Impersonate people deceptively, misrepresent generated content as authentic evidence, or interfere with elections or public safety.</li><li>Upload malware, steal credentials, bypass safeguards, probe systems without authorization, scrape at scale, or overload infrastructure.</li><li>Infringe copyrights, trademarks, privacy, publicity, confidentiality, or contractual rights.</li><li>Reverse engineer restricted components or resell access unless expressly authorized.</li></ul><p>We may investigate, restrict, remove content, suspend access, or preserve and disclose information where reasonably necessary to enforce these Terms or protect safety.</p></> },
  { title: "6. Your content", content: <><p>You retain rights you have in content you submit. You grant us a worldwide, non-exclusive, limited license to host, copy, process, transmit, transform, and display that content solely to operate, secure, support, and improve the Service and provide features you request. You represent that you have all rights and permissions needed for submitted content.</p><p>You are responsible for reviewing generated output before using or publishing it and for complying with laws and third-party rights. Outputs may not be unique, and other users may receive similar content.</p></> },
  { title: "7. Our intellectual property", content: <p>The Service, application design, branding, logos, software, persona configuration, and other materials we provide are owned by us or our licensors and protected by intellectual-property laws. Except for the limited right to use the Service under these Terms, no rights are transferred to you.</p> },
  { title: "8. Third-party services", content: <p>The Service may depend on or link to third-party platforms, models, websites, app stores, and OAuth providers. Their terms and privacy practices apply to their services. We are not responsible for third-party content, availability, or conduct.</p> },
  { title: "9. Availability, changes, and beta features", content: <p>We may change, limit, suspend, or discontinue all or part of the Service. Features may be experimental and may fail, lose state, or change without notice. We do not promise uninterrupted availability, preservation of every output, or compatibility with every device.</p> },
  { title: "10. Suspension and termination", content: <p>You may stop using the Service or request account deletion at any time. We may suspend or terminate access for violations, security risk, legal requirements, nonpayment where applicable, or material harm. Sections that by nature should survive termination remain effective, including ownership, disclaimers, limitations, and dispute terms.</p> },
  { title: "11. Disclaimers", content: <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE.” WE DISCLAIM IMPLIED WARRANTIES, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, ACCURACY, AND QUIET ENJOYMENT. SOME JURISDICTIONS DO NOT ALLOW CERTAIN DISCLAIMERS, SO THESE LIMITATIONS MAY NOT FULLY APPLY TO YOU.</p> },
  { title: "12. Limitation of liability", content: <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR LOST PROFITS, DATA, GOODWILL, OR OPPORTUNITIES ARISING FROM THE SERVICE. OUR AGGREGATE LIABILITY FOR CLAIMS RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF THE AMOUNT YOU PAID US FOR THE SERVICE DURING THE 12 MONTHS BEFORE THE CLAIM OR US$100. RIGHTS THAT CANNOT LAWFULLY BE LIMITED REMAIN UNAFFECTED.</p> },
  { title: "13. Indemnity", content: <p>To the extent permitted by law, you agree to defend, indemnify, and hold us harmless from claims, losses, and expenses arising from your unlawful use of the Service, your content, or your material breach of these Terms. This does not apply where prohibited or to losses caused by our own misconduct.</p> },
  { title: "14. Disputes and governing terms", content: <p>Before filing a formal claim, contact Support and allow 30 days for an informal resolution. Governing law, forum, arbitration, class-action waiver, and consumer-right provisions can depend on the operator’s legal entity and your location; mandatory local consumer protections continue to apply. The final production version of these Terms should identify the operator’s legal name, address, governing law, and dispute forum.</p> },
  { title: "15. General", content: <p>If a provision is unenforceable, the remaining provisions remain in effect. Failure to enforce a provision is not a waiver. You may not assign these Terms without consent; we may assign them in connection with a reorganization or transfer of the Service. These Terms, the Privacy Policy, and incorporated policies are the entire agreement concerning the Service.</p> },
  { title: "16. Contact", content: <p>Questions about these Terms: <a href={`mailto:${SUPPORT_EMAIL}?subject=Terms of Use question`}>{SUPPORT_EMAIL}</a>.</p> }
];

const deletionSections: LegalSection[] = [
  { title: "How to request deletion", content: <><p>Signed-in users can open <strong>Settings → Account → Delete account</strong> on web, iOS, or Android. Password accounts must enter their password and type <strong>DELETE</strong>. OAuth-only users confirm through their authenticated session. You may also use the secure request form below or contact <a href="/support">Support</a> if you cannot access your account.</p></> },
  { title: "What happens immediately", content: <ul><li>Your account status changes to pending deletion.</li><li>All active sessions and refresh tokens are revoked.</li><li>You are signed out and normal account access is blocked.</li><li>Your scheduled permanent-deletion date is shown after confirmation.</li></ul> },
  { title: "30-day recovery period", content: <p>Permanent deletion is scheduled 30 days after the request. Before that deadline, password users can choose <strong>Restore account</strong> and authenticate again. OAuth users can sign in with the same connected provider to restore. Restoration reactivates the account and cancels the pending purge. After the deadline, restoration is unavailable.</p> },
  { title: "Data permanently deleted", content: <><p>The purge is designed to delete the user record, password credential, OAuth identities, sessions, conversations, messages, uploads, generated images and files, generated audio, OpenAI artifacts and vector stores, background jobs, and account-linked usage records. Running jobs are cancelled first to prevent them from recreating data after deletion.</p><p>Deletion requests sent to storage and AI providers may be retried if a provider is temporarily unavailable. Limited records may be retained where legally required or reasonably necessary for security, fraud prevention, dispute resolution, or enforcement. Residual encrypted backups age out under backup rotation and are not returned to active service.</p></> },
  { title: "Subscriptions and third-party accounts", content: <p>Deleting your For the Baddiez account does not automatically cancel an Apple App Store, Google Play, or other third-party subscription unless the applicable store confirms otherwise. Cancel subscriptions through the store before deletion. Deleting your account also does not delete your Google or Facebook account; you can separately revoke For the Baddiez access in that provider’s settings.</p> },
  { title: "Identity verification and support requests", content: <p>To protect users, we may require authentication or reasonable proof of account ownership. Do not email your password. Support may ask for the account email, username, OAuth provider, approximate creation date, or other non-secret information. We will never ask for a password, access token, or one-time authentication code.</p> }
];

function PageFrame({ title, eyebrow, intro, sections, children }: { title: string; eyebrow: string; intro: string; sections: LegalSection[]; children?: ReactNode }) {
  const mobileReturnHref = legalMobileReturnHref(window.location.search);
  const mobileReturnQuery = mobileReturnHref ? `?returnTo=${encodeURIComponent(mobileReturnHref)}` : "";
  const publicPageHref = (path: string) => `${path}${mobileReturnQuery}`;

  function handleBack(event: React.MouseEvent<HTMLAnchorElement>): void {
    if (mobileReturnHref) return;
    let cameFromThisApp = false;
    try {
      cameFromThisApp = Boolean(document.referrer) && new URL(document.referrer).origin === window.location.origin;
    } catch {
      cameFromThisApp = false;
    }
    if (!cameFromThisApp || window.history.length <= 1) return;
    event.preventDefault();
    window.history.back();
  }

  return <main className="legal-shell">
    <header className="legal-header">
      <div className="legal-header-brand-group">
        <a className="legal-back-link" href={mobileReturnHref ?? "/"} onClick={handleBack} aria-label="Back to For the Baddiez">← Back</a>
        <a className="legal-brand" href={mobileReturnHref ?? "/"} aria-label="For the Baddiez home"><img src="/FTB_logo/For_the_Baddiez_logo_transparent.png" alt="" /><span>For the Baddiez</span></a>
      </div>
      <nav aria-label="Legal and support"><a href={publicPageHref("/privacy")}>Privacy</a><a href={publicPageHref("/terms")}>Terms</a><a href={publicPageHref("/delete-account")}>Delete account</a><a href={publicPageHref("/support")}>Support</a></nav>
    </header>
    <article className="legal-document">
      <div className="legal-hero"><p className="legal-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{intro}</p><span>Effective {EFFECTIVE_DATE}</span></div>
      {children}
      <div className="legal-sections">{sections.map((section) => <section key={section.title} id={section.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}><h2>{section.title}</h2>{section.content}</section>)}</div>
    </article>
    <footer className="legal-footer"><span>© {new Date().getFullYear()} For the Baddiez</span><a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></footer>
  </main>;
}

function DeleteAccountRequestForm() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [authenticated, setAuthenticated] = useState(false);

  async function authenticate() {
    setBusy(true); setMessage(undefined);
    try { await api.login({ identifier: identifier.trim(), password, clientType: "web" }); setAuthenticated(true); setMessage("Identity verified. Type DELETE to schedule permanent deletion."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not verify this account."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (confirmation !== "DELETE") return;
    setBusy(true); setMessage(undefined);
    try { const result = await api.deleteAccount({ confirmation: "DELETE", password }); setAuthenticated(false); setPassword(""); setConfirmation(""); setMessage(`Deletion scheduled for ${new Date(result.deletionScheduledFor).toLocaleDateString()}. Sign in and choose Restore account before that date to cancel.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not schedule deletion."); }
    finally { setBusy(false); }
  }
  return <section className="legal-action-panel" aria-labelledby="delete-request-title"><p className="legal-eyebrow">Secure request</p><h2 id="delete-request-title">Request account deletion</h2><p>Password accounts can complete the request here. OAuth-only users should use in-app Settings or contact Support from the email associated with the account.</p><label>Email or username<input value={identifier} onChange={(event) => setIdentifier(event.target.value)} disabled={busy || authenticated} autoComplete="username" /></label><label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy || authenticated} type="password" autoComplete="current-password" /></label>{authenticated ? <label>Confirmation<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} placeholder="Type DELETE" /></label> : null}{message ? <p className="legal-form-message" role="status">{message}</p> : null}<button type="button" disabled={busy || !identifier.trim() || !password || (authenticated && confirmation !== "DELETE")} onClick={() => void (authenticated ? remove() : authenticate())}>{busy ? "Please wait..." : authenticated ? "Schedule account deletion" : "Verify account"}</button></section>;
}

export function PublicLegalPage({ path }: { path: string }) {
  useEffect(() => {
    const titles: Record<string, string> = {
      "/privacy": "Privacy Policy",
      "/terms": "Terms of Use",
      "/delete-account": "Delete Account Policy",
      "/support": "Support"
    };
    document.title = `${titles[path] ?? "Legal"} | For the Baddiez`;
    return () => { document.title = "For the Baddiez"; };
  }, [path]);

  if (path === "/privacy") return <PageFrame eyebrow="Legal" title="Privacy Policy" intro="How information is handled across For the Baddiez chat, persona, media, voice, and support experiences." sections={privacySections} />;
  if (path === "/terms") return <PageFrame eyebrow="Legal" title="Terms of Use" intro="The rules, responsibilities, and limitations that apply when using For the Baddiez." sections={termsSections} />;
  if (path === "/delete-account") return <PageFrame eyebrow="Account control" title="Delete Account Policy" intro="How to request deletion, restore during the recovery window, and understand what is permanently removed." sections={deletionSections}><DeleteAccountRequestForm /></PageFrame>;
  return <PageFrame eyebrow="Help center" title="Support" intro="Get help with accounts, sign-in, privacy, deletion, chats, generated content, audio, and mobile app issues." sections={[
    { title: "Contact support", content: <><p>Email <a href={`mailto:${SUPPORT_EMAIL}?subject=For the Baddiez support request`}>{SUPPORT_EMAIL}</a>. Include the account email or username, platform (web, iOS, or Android), app version, what you expected, what occurred, and non-sensitive screenshots or error text.</p><p>Never send your password, access token, OAuth code, payment card details, or government identification unless support provides a verified secure process that specifically requires it.</p></> },
    { title: "Account and sign-in help", content: <p>For password issues, confirm the exact email or username and check capitalization. For Google or Facebook sign-in, use the same provider originally connected to the account. A pending-deletion account must be restored before normal sign-in. If the recovery deadline passed, the old account cannot be restored, but you may create a new account.</p> },
    { title: "Deletion and privacy requests", content: <p>Use the <a href="/delete-account">Delete Account page</a> for account deletion. For access, correction, portability, objection, or other privacy requests, email Support with “Privacy request” in the subject. We may verify account ownership before acting.</p> },
    { title: "AI output and safety reports", content: <p>AI can make mistakes. Report harmful, infringing, impersonating, unsafe, or clearly incorrect output with the conversation date, persona, prompt context, and a description of the concern. Do not forward unlawful content by email; describe it and wait for secure instructions.</p> },
    { title: "Generated media, audio, and downloads", content: <p>For missing images or audio, keep the conversation available and include the approximate request time. Mobile downloads require operating-system media permissions. Speech-to-text requires microphone and speech-recognition permissions. Simulator behavior can differ from a physical device.</p> },
    { title: "Security reports", content: <p>Report suspected account compromise or vulnerabilities promptly with reproducible steps and impact. Do not access other users’ data, disrupt production, or publish sensitive findings before we have a reasonable opportunity to investigate.</p> },
    { title: "Response expectations", content: <p>We prioritize account security, deletion, privacy, and safety reports. Response times vary by complexity and volume. Sending duplicate requests can delay investigation. Keep your support ticket and reply in the same email thread.</p> }
  ]} />;
}

export const PUBLIC_PAGE_PATHS = new Set(["/privacy", "/terms", "/delete-account", "/support"]);
