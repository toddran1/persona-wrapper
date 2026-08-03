import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { personaSummarySchema } from "@persona/shared";
import { ConversationSidebar } from "../components/ConversationSidebar.js";

const now = "2026-07-24T05:00:00.000Z";
const planUsage = {
  plan: {
    id: "bronze" as const,
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

function renderSidebar(options: { showPersona?: boolean; onSelectPersona?: (id: string) => void } = {}) {
  const onUpdateProfile = vi.fn().mockResolvedValue(undefined);
  const onGetMemorySettings = vi.fn().mockResolvedValue(true);
  const onUpdateMemorySettings = vi.fn().mockResolvedValue(undefined);
  const onClearAllMemory = vi.fn().mockResolvedValue(undefined);
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
      ]}
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
      onGetPlanUsage={vi.fn().mockResolvedValue(planUsage)}
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
  return { onUpdateProfile, onGetMemorySettings, onUpdateMemorySettings, onClearAllMemory, ...view };
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

  it("renders persona profiles as selectable themed options", async () => {
    const user = userEvent.setup();
    const onSelectPersona = vi.fn();
    renderSidebar({ showPersona: true, onSelectPersona });

    const option = screen.getByRole("button", { name: "Use LaRae, Silk Noir" });
    expect(option).toHaveAttribute("aria-current", "true");
    await user.click(option);
    expect(onSelectPersona).toHaveBeenCalledWith("larae");
  });

  it("keeps the account menu compact and moves account controls into the settings modal", async () => {
    const user = userEvent.setup();
    const { onUpdateProfile, onGetMemorySettings, onUpdateMemorySettings, onClearAllMemory } = renderSidebar();

    await user.click(screen.getByTestId("account-menu-toggle"));
    const menu = screen.getByRole("menu", { name: "Account menu" });
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(3);
    expect(within(menu).getByRole("menuitem", { name: "Upgrade plan Soon" })).toBeDisabled();

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
    expect(await within(dialog).findByText("Coming soon")).toBeInTheDocument();
    expect(within(dialog).getByText("94% left")).toBeInTheDocument();
    expect(within(dialog).getByRole("progressbar", { name: "Total monthly usage remaining" })).toHaveAttribute(
      "aria-valuenow",
      "94"
    );

    await user.click(within(dialog).getByRole("button", { name: "Security & sign-in" }));
    expect(await within(dialog).findByRole("heading", { name: "Connected accounts" })).toBeInTheDocument();
    expect(within(dialog).getByText("Email & password")).toBeInTheDocument();

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
    await user.click(within(dialog).getByRole("radio", { name: /Gemini/ }));
    await waitFor(() => expect(onUpdateProfile).toHaveBeenCalledWith({ modelProvider: "gemini" }));

    await user.click(within(dialog).getByRole("button", { name: "Your data" }));
    expect(within(dialog).getByRole("button", { name: /Export account data/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Import conversations/ })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "About" }));
    expect(within(dialog).getByRole("link", { name: /Privacy Policy/ })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Delete account" }));
    expect(within(dialog).getByRole("button", { name: "Continue to deletion" })).toBeInTheDocument();
  });
});
