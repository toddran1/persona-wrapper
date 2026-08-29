import { type BillingCatalogResponse, type PlanUsageSummary, personaSummarySchema } from "@persona/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConversationSidebar } from "../components/ConversationSidebar.js";

const now = "2026-07-24T05:00:00.000Z";
const planUsage = {
  plan: {
    id: "bronze" as "bronze" | "silver" | "gold",
    version: 1,
    displayName: "Bronze",
    description: "Core chat access with a small monthly media allowance.",
    monthlyPriceCents: null,
    adsEnabled: true,
    priorityQueue: false,
    maxConcurrentMediaJobs: 1,
    personaIds: ["larae"]
  },
  totalUsage: {
    limitMicroUsd: 3_000_000,
    usedMicroUsd: 180_000,
    reservedMicroUsd: 0,
    remainingMicroUsd: 2_820_000,
    percentRemaining: 94,
    periodStart: "2026-07-01T00:00:00.000Z",
    periodEnd: "2026-08-01T00:00:00.000Z"
  },
  meters: [],
  enforcementEnabled: false
};
const billingCatalog: BillingCatalogResponse = {
  enabled: true,
  provider: "revenuecat",
  offeringId: "default",
  currentPlanId: "bronze",
  subscription: null,
  products: [
    {
      iosProductId: "com.forthebaddiez.silver.monthly",
      androidProductId: "com.forthebaddiez.silver",
      androidBasePlanId: "silver-monthly",
      entitlementId: "silver",
      planId: "silver",
      displayName: "Silver",
      description: "More media usage, most personas, and no ads.",
      monthlyPriceCents: 799,
      webCheckoutUrl: "https://pay.rev.cat/test-link/user_1?package_id=silver_monthly"
    },
    {
      iosProductId: "com.forthebaddiez.gold.monthly",
      androidProductId: "com.forthebaddiez.gold",
      androidBasePlanId: "gold-monthly",
      entitlementId: "gold",
      planId: "gold",
      displayName: "Gold",
      description: "The full persona library and the most generous media limits.",
      monthlyPriceCents: 1199,
      webCheckoutUrl: "https://pay.rev.cat/test-link/user_1?package_id=gold_monthly"
    }
  ]
};
const activeSessions = [
  {
    id: "session-current",
    clientType: "unknown" as const,
    deviceId: null,
    userAgent: null,
    createdAt: now,
    lastActiveAt: now,
    refreshExpiresAt: now,
    current: true
  },
  {
    id: "session-other",
    clientType: "unknown" as const,
    deviceId: null,
    userAgent: "Chrome on macOS",
    createdAt: now,
    lastActiveAt: now,
    refreshExpiresAt: now,
    current: false
  }
];
const persona = personaSummarySchema.parse({
  id: "larae",
  name: "LaRae the Baddest",
  shortName: "LaRae",
  tagline: "Clock it",
  description: "Persona",
  avatarColor: "#8a5cf6",
  theme: {
    mode: "dark",
    themeName: "Silk Noir",
    background: "#09060f",
    backgroundAccent: "#8a5cf6",
    backgroundAccentSecondary: "#d6b55e",
    surface: "#110b1c",
    surfaceStrong: "#211433",
    border: "#d6b55e",
    accent: "#8a5cf6",
    accent2: "#d6b55e",
    text: "#f7efe8",
    muted: "#c8bdd8"
  },
  supportedProviders: ["openai"]
});

function renderSidebar(options: {
  showPersona?: boolean;
  onSelectPersona?: (id: string) => void;
  planUsageOverride?: PlanUsageSummary;
  billingCatalogOverride?: BillingCatalogResponse;
  onGetBillingManagementUrl?: () => Promise<string>;
  oauthReturnAction?: "link" | "sign-in";
  oauthReturnNotice?: string;
} = {}) {
  const onUpdateProfile = vi.fn().mockResolvedValue(undefined);
  const onGetMemorySettings = vi.fn().mockResolvedValue(true);
  const onUpdateMemorySettings = vi.fn().mockResolvedValue(undefined);
  const onClearAllMemory = vi.fn().mockResolvedValue(undefined);
  const onGetBillingManagementUrl = options.onGetBillingManagementUrl ?? vi.fn().mockResolvedValue(
    "https://billing.revenuecat.com/app_test/sub_test?token=test"
  );
  const view = render(
    <ConversationSidebar
      personaName="LaRae the Baddest"
      personas={options.showPersona ? [persona] : []}
      activePersonaId={options.showPersona ? persona.id : undefined}
      onSelectPersona={options.onSelectPersona ?? vi.fn()}
      authUser={{
        id: "user_settings",
        email: "settings@example.com",
        username: "settingsuser",
        displayName: "Settings User",
        birthday: { month: 12, day: 19 },
        status: "active",
        createdAt: now,
        updatedAt: now,
      }}
      oauthProviders={[
        { provider: "google", enabled: true },
        { provider: "facebook", enabled: true },
        { provider: "apple", enabled: true },
      ]}
      oauthReturnAction={options.oauthReturnAction}
      oauthReturnNotice={options.oauthReturnNotice}
      conversations={[]}
      onLogin={vi.fn()}
      onRegister={vi.fn()}
      onRestoreAccount={vi.fn()}
      onRequestPasswordReset={vi.fn()}
      onChangePassword={vi.fn()}
      onUpdateProfile={onUpdateProfile}
      onGetMemorySettings={onGetMemorySettings}
      onUpdateMemorySettings={onUpdateMemorySettings}
      onClearConversationMemory={vi.fn().mockResolvedValue(undefined)}
      onClearAllMemory={onClearAllMemory}
      onGetPlanUsage={vi.fn().mockResolvedValue(options.planUsageOverride ?? planUsage)}
      onGetBillingCatalog={vi.fn().mockResolvedValue(options.billingCatalogOverride ?? billingCatalog)}
      onGetBillingManagementUrl={onGetBillingManagementUrl}
      onListActiveSessions={vi.fn().mockResolvedValue(activeSessions)}
      onRevokeActiveSession={vi.fn().mockResolvedValue(undefined)}
      onRevokeOtherSessions={vi.fn().mockResolvedValue({ revoked: 1 })}
      onListConnectedAccounts={vi.fn().mockResolvedValue([
        {
          id: "account_credential",
          providerId: "credential",
          accountId: "settings@example.com",
          createdAt: now,
          updatedAt: now,
        },
      ])}
      onLinkConnectedAccount={vi.fn()}
      onUnlinkConnectedAccount={vi.fn()}
      onDeleteAccount={vi.fn()}
      onExportAccount={vi.fn()}
      onExportConversation={vi.fn()}
      onImportConversations={vi.fn()}
      onLogout={vi.fn()}
      onOAuthLogin={vi.fn()}
      onNewConversation={vi.fn()}
      onSelectConversation={vi.fn()}
      onDeleteConversation={vi.fn()}
      onRenameConversation={vi.fn()}
      onPinConversation={vi.fn()}
    />,
  );
  return { onUpdateProfile, onGetMemorySettings, onUpdateMemorySettings, onClearAllMemory, onGetBillingManagementUrl, ...view };
}

describe("ConversationSidebar settings", () => {
  it("requires current policy consent before registration", async () => {
    const user = userEvent.setup();
    const onRegister = vi.fn().mockResolvedValue(undefined);
    render(
      <ConversationSidebar
        personaName="LaRae the Baddest"
        personas={[]}
        onSelectPersona={vi.fn()}
        currentPolicies={{
          termsVersion: "2026-07-29",
          privacyVersion: "2026-07-29",
          termsPath: "/terms",
          privacyPath: "/privacy"
        }}
        conversations={[]}
        onLogin={vi.fn()}
        onRegister={onRegister}
        onRestoreAccount={vi.fn()}
        onRequestPasswordReset={vi.fn()}
        onChangePassword={vi.fn()}
        onUpdateProfile={vi.fn()}
        onGetMemorySettings={vi.fn()}
        onUpdateMemorySettings={vi.fn()}
        onClearConversationMemory={vi.fn()}
        onClearAllMemory={vi.fn()}
        onGetPlanUsage={vi.fn().mockResolvedValue(planUsage)}
        onGetBillingCatalog={vi.fn().mockResolvedValue(billingCatalog)}
        onGetBillingManagementUrl={vi.fn().mockResolvedValue("https://billing.revenuecat.com/app_test/sub_test?token=test")}
        onListActiveSessions={vi.fn()}
        onRevokeActiveSession={vi.fn()}
        onRevokeOtherSessions={vi.fn()}
        onListConnectedAccounts={vi.fn()}
        onLinkConnectedAccount={vi.fn()}
        onUnlinkConnectedAccount={vi.fn()}
        onDeleteAccount={vi.fn()}
        onExportAccount={vi.fn()}
        onExportConversation={vi.fn()}
        onImportConversations={vi.fn()}
        onLogout={vi.fn()}
        onOAuthLogin={vi.fn()}
        onNewConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onDeleteConversation={vi.fn()}
        onRenameConversation={vi.fn()}
        onPinConversation={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Log in \| Create account/i }));
    await user.click(screen.getByTestId("auth-register-tab"));
    await user.type(screen.getByTestId("auth-register-email"), "new@example.com");
    await user.type(screen.getByTestId("auth-register-password"), "password123");
    await user.type(screen.getByTestId("auth-register-password-confirmation"), "password123");
    expect(screen.getByTestId("auth-submit")).toBeDisabled();
    expect(screen.getByRole("link", { name: "Terms of Use" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    await user.click(screen.getByTestId("auth-register-consent"));
    expect(screen.getByTestId("auth-submit")).toBeEnabled();
    await user.click(screen.getByTestId("auth-submit"));
    await waitFor(() => expect(onRegister).toHaveBeenCalledWith(expect.objectContaining({
      email: "new@example.com",
      policyConsent: expect.objectContaining({
        termsVersion: "2026-07-29",
        privacyVersion: "2026-07-29"
      })
    })));
  });

  it("requires an email address to create an account", async () => {
    const user = userEvent.setup();
    const onRegister = vi.fn().mockResolvedValue(undefined);
    render(
      <ConversationSidebar
        personaName="LaRae the Baddest"
        personas={[]}
        onSelectPersona={vi.fn()}
        currentPolicies={{
          termsVersion: "2026-07-29",
          privacyVersion: "2026-07-29",
          termsPath: "/terms",
          privacyPath: "/privacy"
        }}
        conversations={[]}
        onLogin={vi.fn()}
        onRegister={onRegister}
        onRestoreAccount={vi.fn()}
        onRequestPasswordReset={vi.fn()}
        onChangePassword={vi.fn()}
        onUpdateProfile={vi.fn()}
        onGetMemorySettings={vi.fn()}
        onUpdateMemorySettings={vi.fn()}
        onClearConversationMemory={vi.fn()}
        onClearAllMemory={vi.fn()}
        onGetPlanUsage={vi.fn().mockResolvedValue(planUsage)}
        onGetBillingCatalog={vi.fn().mockResolvedValue(billingCatalog)}
        onGetBillingManagementUrl={vi.fn().mockResolvedValue("https://billing.revenuecat.com/app_test/sub_test?token=test")}
        onListActiveSessions={vi.fn()}
        onRevokeActiveSession={vi.fn()}
        onRevokeOtherSessions={vi.fn()}
        onListConnectedAccounts={vi.fn()}
        onLinkConnectedAccount={vi.fn()}
        onUnlinkConnectedAccount={vi.fn()}
        onDeleteAccount={vi.fn()}
        onExportAccount={vi.fn()}
        onExportConversation={vi.fn()}
        onImportConversations={vi.fn()}
        onLogout={vi.fn()}
        onOAuthLogin={vi.fn()}
        onNewConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onDeleteConversation={vi.fn()}
        onRenameConversation={vi.fn()}
        onPinConversation={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Log in \| Create account/i }));
    await user.click(screen.getByTestId("auth-register-tab"));
    await user.type(screen.getByTestId("auth-register-username"), "baddie42");
    await user.type(screen.getByTestId("auth-register-password"), "longenough1");
    await user.type(screen.getByTestId("auth-register-password-confirmation"), "longenough1");
    await user.click(screen.getByTestId("auth-register-consent"));
    await user.click(screen.getByTestId("auth-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter an email address to create your account.");
    expect(onRegister).not.toHaveBeenCalled();
  });

  it("renders persona profiles as selectable themed options", async () => {
    const user = userEvent.setup();
    const onSelectPersona = vi.fn();
    renderSidebar({ showPersona: true, onSelectPersona });

    const option = screen.getByRole("button", { name: "Use LaRae, Silk Noir" });
    expect(option).toHaveAttribute("aria-current", "true");
    await user.click(option);
    expect(onSelectPersona).toHaveBeenCalledWith("larae");
  });

  it("lets paid plans switch model providers from provider settings", async () => {
    const user = userEvent.setup();
    const silverPlanUsage = {
      ...planUsage,
      plan: { ...planUsage.plan, id: "silver" as const, displayName: "Silver" }
    };
    const { onUpdateProfile } = renderSidebar({ planUsageOverride: silverPlanUsage });

    await user.click(screen.getByTestId("account-menu-toggle"));
    await user.click(within(screen.getByRole("menu", { name: "Account menu" })).getByRole("menuitem", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("button", { name: "Provider settings" }));
    const geminiOption = await within(dialog).findByRole("radio", { name: /Gemini/ });
    await user.click(geminiOption);
    await waitFor(() => expect(onUpdateProfile).toHaveBeenCalledWith({ modelProvider: "gemini" }));
  });

  it("switches the image provider from provider settings", async () => {
    const user = userEvent.setup();
    const goldPlanUsage = {
      ...planUsage,
      plan: { ...planUsage.plan, id: "gold" as const, displayName: "Gold" }
    };
    const { onUpdateProfile } = renderSidebar({ planUsageOverride: goldPlanUsage });

    await user.click(screen.getByTestId("account-menu-toggle"));
    await user.click(within(screen.getByRole("menu", { name: "Account menu" })).getByRole("menuitem", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("button", { name: "Provider settings" }));

    const fluxOption = await within(dialog).findByRole("radio", { name: /FLUX\.2 Pro/ });
    expect(within(dialog).getByRole("radio", { name: /OpenAI Image 2/ })).toHaveAttribute("aria-checked", "true");
    await user.click(fluxOption);
    await waitFor(() => expect(onUpdateProfile).toHaveBeenCalledWith({ imageProvider: "flux" }));
  });

  it("hides FLUX.2 Pro for bronze and locks it for silver", async () => {
    const user = userEvent.setup();

    const bronze = renderSidebar({
      planUsageOverride: { ...planUsage, plan: { ...planUsage.plan, id: "bronze" as const, displayName: "Bronze" } }
    });
    await user.click(screen.getByTestId("account-menu-toggle"));
    await user.click(within(screen.getByRole("menu", { name: "Account menu" })).getByRole("menuitem", { name: "Settings" }));
    const bronzeDialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(bronzeDialog).getByRole("button", { name: "Provider settings" }));
    expect(await within(bronzeDialog).findByRole("radio", { name: /OpenAI Image 2/ })).toBeInTheDocument();
    expect(within(bronzeDialog).queryByRole("radio", { name: /FLUX\.2 Pro/ })).not.toBeInTheDocument();
    bronze.unmount();

    renderSidebar({
      planUsageOverride: { ...planUsage, plan: { ...planUsage.plan, id: "silver" as const, displayName: "Silver" } }
    });
    await user.click(screen.getByTestId("account-menu-toggle"));
    await user.click(within(screen.getByRole("menu", { name: "Account menu" })).getByRole("menuitem", { name: "Settings" }));
    const silverDialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(silverDialog).getByRole("button", { name: "Provider settings" }));
    const fluxOption = await within(silverDialog).findByRole("radio", { name: /FLUX\.2 Pro/ });
    expect(fluxOption).toBeDisabled();
    expect(fluxOption).toHaveTextContent("Included with the Gold plan.");
  });

  it("switches the persona influence level from settings", async () => {
    const user = userEvent.setup();
    const { onUpdateProfile } = renderSidebar();

    await user.click(screen.getByTestId("account-menu-toggle"));
    await user.click(within(screen.getByRole("menu", { name: "Account menu" })).getByRole("menuitem", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("button", { name: "Persona influence" }));
    expect(within(dialog).getByRole("radio", { name: /Uncensored/ })).toHaveAttribute("aria-checked", "true");
    await user.click(within(dialog).getByRole("radio", { name: /Professional/ }));
    await waitFor(() => expect(onUpdateProfile).toHaveBeenCalledWith({ personaInfluenceLevel: "professional" }));
  });

  it("keeps the account menu compact and moves account controls into the settings modal", async () => {
    const user = userEvent.setup();
    const checkoutWindow = { opener: window };
    const windowOpen = vi.spyOn(window, "open").mockReturnValue(checkoutWindow as unknown as Window);
    const { onUpdateProfile, onGetMemorySettings, onUpdateMemorySettings, onClearAllMemory } = renderSidebar();

    await user.click(screen.getByTestId("account-menu-toggle"));
    const menu = screen.getByRole("menu", { name: "Account menu" });
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(3);
    expect(within(menu).getByRole("menuitem", { name: "Upgrade plan View" })).toBeEnabled();

    await user.click(within(menu).getByRole("menuitem", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(within(dialog).getByText("settings@example.com")).toBeInTheDocument();
    expect(within(dialog).getByText("Bronze")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Edit username" }));
    expect(within(dialog).getByLabelText("Username")).toHaveValue("settingsuser");
    expect(within(dialog).getByRole("button", { name: "Save username" })).toBeDisabled();
    await user.clear(within(dialog).getByLabelText("Username"));
    await user.type(within(dialog).getByLabelText("Username"), "settingsuser2");
    await user.click(within(dialog).getByRole("button", { name: "Save username" }));
    await waitFor(() => expect(onUpdateProfile).toHaveBeenCalledWith({ username: "settingsuser2" }));
    await user.click(within(dialog).getByRole("button", { name: "Remove birthday" }));
    await waitFor(() => expect(onUpdateProfile).toHaveBeenCalledWith({ birthday: null }));
    await user.selectOptions(within(dialog).getByLabelText("Birthday month"), "2");
    expect(within(dialog).getByRole("option", { name: "29" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("option", { name: "30" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(within(dialog).getByText("Choose both a birthday month and day, or clear both fields.")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Plan & usage" }));
    expect(await within(dialog).findByRole("heading", { name: "Membership passes" })).toBeInTheDocument();
    expect(within(dialog).getByText("$7.99")).toBeInTheDocument();
    expect(within(dialog).getByText("$11.99")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Your plan" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Choose silver" }));
    await waitFor(() => expect(windowOpen).toHaveBeenCalledWith(
      "https://pay.rev.cat/test-link/user_1?package_id=silver_monthly",
      "_blank"
    ));
    expect(checkoutWindow.opener).toBeNull();
    expect(within(dialog).getByText(/RevenueCat checkout opened for silver/i)).toBeInTheDocument();
    expect(within(dialog).getByText("94% left")).toBeInTheDocument();
    expect(within(dialog).getByRole("progressbar", { name: "Total monthly usage remaining" })).toHaveAttribute(
      "aria-valuenow",
      "94"
    );

    await user.click(within(dialog).getByRole("button", { name: "Security & sign-in" }));
    expect(await within(dialog).findByRole("heading", { name: "Connected accounts" })).toBeInTheDocument();
    expect(within(dialog).getByText("Email & password")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Continue with Apple" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Signed-in devices" })).toBeInTheDocument();
    expect(within(dialog).getByText(/This device/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Chrome on macOS/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Sign out other devices" }));
    await waitFor(() => expect(within(dialog).queryByText(/Chrome on macOS/)).not.toBeInTheDocument());

    await user.click(within(dialog).getByRole("button", { name: "Memory" }));
    await waitFor(() => expect(onGetMemorySettings).toHaveBeenCalledOnce());
    const memorySwitch = within(dialog).getByRole("switch", { name: "Use chat memory" });
    expect(memorySwitch).toHaveAttribute("aria-checked", "true");
    await user.click(memorySwitch);
    await waitFor(() => expect(onUpdateMemorySettings).toHaveBeenCalledWith(false));
    await user.click(within(dialog).getByRole("button", { name: /Clear all memory/ }));
    await user.click(within(dialog).getByRole("button", { name: /Confirm clear all memory/ }));
    await waitFor(() => expect(onClearAllMemory).toHaveBeenCalledOnce());

    await user.click(within(dialog).getByRole("button", { name: "Provider settings" }));
    expect(within(dialog).getByRole("radio", { name: /ChatGPT/ })).toHaveAttribute("aria-checked", "true");
    // Free (bronze) accounts are ChatGPT-only — Gemini is not offered.
    expect(within(dialog).queryByRole("radio", { name: /Gemini/ })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Your data" }));
    expect(within(dialog).getByRole("button", { name: /Export account data/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Import conversations/ })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "About" }));
    expect(within(dialog).getByRole("link", { name: /Privacy Policy/ })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("For the Baddiez web version 0.1.0")).toHaveTextContent("v0.1.0");

    await user.click(within(dialog).getByRole("button", { name: "Delete account" }));
    expect(within(dialog).getByRole("button", { name: "Continue to deletion" })).toBeInTheDocument();
  });

  it("requires confirmation before an existing member upgrades or schedules a downgrade", async () => {
    const user = userEvent.setup();
    const managementWindow = { opener: window, location: { replace: vi.fn() }, close: vi.fn() };
    const windowOpen = vi.spyOn(window, "open").mockReturnValue(managementWindow as unknown as Window);
    const silverUsage = {
      ...planUsage,
      plan: { ...planUsage.plan, id: "silver" as const, displayName: "Silver", monthlyPriceCents: 799 }
    };
    const silverCatalog = { ...billingCatalog, currentPlanId: "silver" as const };
    const { onGetBillingManagementUrl } = renderSidebar({ planUsageOverride: silverUsage, billingCatalogOverride: silverCatalog });

    await user.click(screen.getByTestId("account-menu-toggle"));
    await user.click(within(screen.getByRole("menu", { name: "Account menu" })).getByRole("menuitem", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("button", { name: "Plan & usage" }));
    await user.click(within(dialog).getByRole("button", { name: "Upgrade to gold" }));
    const review = await screen.findByRole("alertdialog", { name: "Upgrade your access?" });
    expect(within(review).getByText(/final price and any prorated charge/i)).toBeInTheDocument();
    expect(onGetBillingManagementUrl).not.toHaveBeenCalled();
    await user.click(within(review).getByRole("button", { name: "Continue to upgrade" }));
    expect(windowOpen).toHaveBeenCalledWith("about:blank", "_blank");
    await waitFor(() => expect(managementWindow.location.replace).toHaveBeenCalledWith(
      "https://billing.revenuecat.com/app_test/sub_test?token=test"
    ));
    expect(onGetBillingManagementUrl).toHaveBeenCalledOnce();
    expect(await within(dialog).findByText(/customer portal opened.*change subscription.*gold/i)).toBeInTheDocument();

  });

  it("explains that an existing member's downgrade begins at renewal", async () => {
    const user = userEvent.setup();
    const goldUsage = {
      ...planUsage,
      plan: { ...planUsage.plan, id: "gold" as const, displayName: "Gold", monthlyPriceCents: 1199 }
    };
    const goldCatalog = { ...billingCatalog, currentPlanId: "gold" as const };
    renderSidebar({ planUsageOverride: goldUsage, billingCatalogOverride: goldCatalog });

    await user.click(screen.getByTestId("account-menu-toggle"));
    await user.click(within(screen.getByRole("menu", { name: "Account menu" })).getByRole("menuitem", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("button", { name: "Plan & usage" }));
    await user.click(within(dialog).getByRole("button", { name: "Downgrade to silver" }));
    const review = await screen.findByRole("alertdialog", { name: "Schedule your downgrade?" });
    expect(within(review).getByText(/stays active until the next renewal/i)).toBeInTheDocument();
  });

  it("makes canceled paid access and its ending date explicit", async () => {
    const user = userEvent.setup();
    const silverUsage = {
      ...planUsage,
      plan: { ...planUsage.plan, id: "silver" as const, displayName: "Silver", monthlyPriceCents: 799 }
    };
    const silverCatalog: BillingCatalogResponse = {
      ...billingCatalog,
      currentPlanId: "silver",
      subscription: {
        state: "canceled",
        planId: "silver",
        store: "revenuecat_web",
        currentPeriodEndsAt: "2026-09-01T00:00:00.000Z",
        pendingPlanId: null,
        gracePeriodEndsAt: null,
        cancellationReason: "user",
        endedReason: null
      }
    };
    renderSidebar({ planUsageOverride: silverUsage, billingCatalogOverride: silverCatalog });

    await user.click(screen.getByTestId("account-menu-toggle"));
    await user.click(within(screen.getByRole("menu", { name: "Account menu" })).getByRole("menuitem", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("button", { name: "Plan & usage" }));

    expect(await within(dialog).findByRole("status", { name: /plan canceled/i })).toHaveAccessibleName(
      /Silver access ends September 1/i
    );
    expect(within(dialog).getByText(/Afterward, your account moves to Bronze/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Paid access ends September 1/i)).toBeInTheDocument();
    expect(within(dialog).getByText("Ends Sep 1")).toBeInTheDocument();
  });

  it("distinguishes payment recovery from voluntary cancellation", async () => {
    const user = userEvent.setup();
    const silverUsage = {
      ...planUsage,
      plan: { ...planUsage.plan, id: "silver" as const, displayName: "Silver", monthlyPriceCents: 799 }
    };
    const silverCatalog: BillingCatalogResponse = {
      ...billingCatalog,
      currentPlanId: "silver",
      subscription: {
        state: "payment_issue",
        planId: "silver",
        store: "app_store",
        currentPeriodEndsAt: "2026-09-01T00:00:00.000Z",
        pendingPlanId: null,
        gracePeriodEndsAt: "2026-09-04T00:00:00.000Z",
        cancellationReason: null,
        endedReason: null
      }
    };
    renderSidebar({ planUsageOverride: silverUsage, billingCatalogOverride: silverCatalog });

    await user.click(screen.getByTestId("account-menu-toggle"));
    await user.click(within(screen.getByRole("menu", { name: "Account menu" })).getByRole("menuitem", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("button", { name: "Plan & usage" }));

    expect(await within(dialog).findByRole("status", { name: /Payment needs attention/i })).toHaveAccessibleName(/Update payment by September 4/i);
    expect(within(dialog).getByText(/managed through Apple App Store/i)).toBeInTheDocument();
    expect(within(dialog).getAllByRole("button", { name: "Manage in mobile app" })).toHaveLength(2);
    for (const button of within(dialog).getAllByRole("button", { name: "Manage in mobile app" })) expect(button).toBeDisabled();
    expect(within(dialog).queryByText(/you won’t be charged again/i)).not.toBeInTheDocument();
  });

  it("keeps a scheduled downgrade visible after the checkout notice is gone", async () => {
    const user = userEvent.setup();
    const goldUsage = {
      ...planUsage,
      plan: { ...planUsage.plan, id: "gold" as const, displayName: "Gold", monthlyPriceCents: 1199 }
    };
    const goldCatalog: BillingCatalogResponse = {
      ...billingCatalog,
      currentPlanId: "gold",
      subscription: {
        state: "change_scheduled",
        planId: "gold",
        store: "revenuecat_web",
        currentPeriodEndsAt: "2026-09-01T00:00:00.000Z",
        pendingPlanId: "silver",
        gracePeriodEndsAt: null,
        cancellationReason: null,
        endedReason: null
      }
    };
    renderSidebar({ planUsageOverride: goldUsage, billingCatalogOverride: goldCatalog });

    await user.click(screen.getByTestId("account-menu-toggle"));
    await user.click(within(screen.getByRole("menu", { name: "Account menu" })).getByRole("menuitem", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("button", { name: "Plan & usage" }));

    expect(await within(dialog).findByRole("status", { name: /Plan change scheduled/i })).toHaveAccessibleName(/Gold until September 1/i);
    expect(within(dialog).getByText(/Silver begins on September 1/i)).toBeInTheDocument();
    expect(within(dialog).getByText("Changes Sep 1")).toBeInTheDocument();
  });

  it("shows the next renewal for an active paid plan", async () => {
    const user = userEvent.setup();
    const silverUsage = {
      ...planUsage,
      plan: { ...planUsage.plan, id: "silver" as const, displayName: "Silver", monthlyPriceCents: 799 }
    };
    const silverCatalog: BillingCatalogResponse = {
      ...billingCatalog,
      currentPlanId: "silver",
      subscription: {
        state: "active",
        planId: "silver",
        store: "revenuecat_web",
        currentPeriodEndsAt: "2026-09-01T00:00:00.000Z",
        pendingPlanId: null,
        gracePeriodEndsAt: null,
        cancellationReason: null,
        endedReason: null
      }
    };
    renderSidebar({ planUsageOverride: silverUsage, billingCatalogOverride: silverCatalog });

    await user.click(screen.getByTestId("account-menu-toggle"));
    await user.click(within(screen.getByRole("menu", { name: "Account menu" })).getByRole("menuitem", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("button", { name: "Plan & usage" }));

    expect(await within(dialog).findByRole("status", { name: /Renews automatically/i })).toHaveAccessibleName(/Silver renews September 1/i);
    expect(within(dialog).getByText(/managed through RevenueCat Web/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Manage billing" })).toBeEnabled();
  });

  it("explains a recently ended paid plan after the account returns to Bronze", async () => {
    const user = userEvent.setup();
    const endedCatalog: BillingCatalogResponse = {
      ...billingCatalog,
      subscription: {
        state: "ended",
        planId: "silver",
        store: "app_store",
        currentPeriodEndsAt: "2026-09-01T00:00:00.000Z",
        pendingPlanId: null,
        gracePeriodEndsAt: null,
        cancellationReason: null,
        endedReason: "non_renewing"
      }
    };
    renderSidebar({ billingCatalogOverride: endedCatalog });

    await user.click(screen.getByTestId("account-menu-toggle"));
    await user.click(within(screen.getByRole("menu", { name: "Account menu" })).getByRole("menuitem", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("button", { name: "Plan & usage" }));

    expect(await within(dialog).findByRole("status", { name: /Paid plan ended/i })).toHaveAccessibleName(/Silver ended September 1/i);
    expect(within(dialog).getByText(/account is now on Bronze/i)).toBeInTheDocument();
  });

  it("requires the DOWNGRADE confirmation before returning a paid member to Bronze", async () => {
    const user = userEvent.setup();
    const managementWindow = { opener: window, location: { replace: vi.fn() }, close: vi.fn() };
    const windowOpen = vi.spyOn(window, "open").mockReturnValue(managementWindow as unknown as Window);
    const goldUsage = {
      ...planUsage,
      plan: { ...planUsage.plan, id: "gold" as const, displayName: "Gold", monthlyPriceCents: 1199 }
    };
    const goldCatalog = { ...billingCatalog, currentPlanId: "gold" as const };
    renderSidebar({ planUsageOverride: goldUsage, billingCatalogOverride: goldCatalog });

    await user.click(screen.getByTestId("account-menu-toggle"));
    await user.click(within(screen.getByRole("menu", { name: "Account menu" })).getByRole("menuitem", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("button", { name: "Plan & usage" }));
    await user.click(within(dialog).getByRole("button", { name: "Downgrade to Bronze" }));

    const review = await screen.findByRole("alertdialog", { name: "Return to Bronze?" });
    const confirm = within(review).getByRole("button", { name: "Open cancellation portal" });
    expect(confirm).toBeDisabled();
    await user.type(within(review).getByLabelText("Type DOWNGRADE to confirm"), "DOWNGRADE");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(windowOpen).toHaveBeenCalledWith("about:blank", "_blank");
    await waitFor(() => expect(managementWindow.location.replace).toHaveBeenCalledWith(
      "https://billing.revenuecat.com/app_test/sub_test?token=test"
    ));
    expect(await within(dialog).findByText(/cancel the subscription there to return to Bronze/i)).toBeInTheDocument();
  });

  it("closes the placeholder tab and keeps the review available when portal creation fails", async () => {
    const user = userEvent.setup();
    const managementWindow = { opener: window, location: { replace: vi.fn() }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(managementWindow as unknown as Window);
    const silverUsage = {
      ...planUsage,
      plan: { ...planUsage.plan, id: "silver" as const, displayName: "Silver", monthlyPriceCents: 799 }
    };
    const silverCatalog = { ...billingCatalog, currentPlanId: "silver" as const };
    renderSidebar({
      planUsageOverride: silverUsage,
      billingCatalogOverride: silverCatalog,
      onGetBillingManagementUrl: vi.fn().mockRejectedValue(new Error("Subscription portal is unavailable."))
    });

    await user.click(screen.getByTestId("account-menu-toggle"));
    await user.click(within(screen.getByRole("menu", { name: "Account menu" })).getByRole("menuitem", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("button", { name: "Plan & usage" }));
    await user.click(within(dialog).getByRole("button", { name: "Upgrade to gold" }));
    const review = await screen.findByRole("alertdialog", { name: "Upgrade your access?" });
    await user.click(within(review).getByRole("button", { name: "Continue to upgrade" }));

    await waitFor(() => expect(managementWindow.close).toHaveBeenCalledOnce());
    expect(managementWindow.location.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Upgrade your access?" })).toBeInTheDocument();
    expect(within(dialog).getByText("Subscription portal is unavailable.")).toBeInTheDocument();
  });

  it("reopens Security and confirms a successful provider link", async () => {
    renderSidebar({ oauthReturnAction: "link", oauthReturnNotice: "Apple connected." });
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(within(dialog).getByRole("heading", { name: "Security & sign-in" })).toBeInTheDocument();
    expect(within(dialog).getByRole("status")).toHaveTextContent("Apple connected.");
  });
});
