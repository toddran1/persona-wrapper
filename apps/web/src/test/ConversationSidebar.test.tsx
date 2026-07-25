import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { personaSummarySchema } from "@persona/shared";
import { ConversationSidebar } from "../components/ConversationSidebar.js";

const now = "2026-07-24T05:00:00.000Z";
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
  return { onUpdateProfile, ...view };
}

describe("ConversationSidebar settings", () => {
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
    const { onUpdateProfile } = renderSidebar();

    await user.click(screen.getByTestId("account-menu-toggle"));
    const menu = screen.getByRole("menu", { name: "Account menu" });
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(3);
    expect(within(menu).getByRole("menuitem", { name: "Upgrade plan Soon" })).toBeDisabled();

    await user.click(within(menu).getByRole("menuitem", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(within(dialog).getByText("settings@example.com")).toBeInTheDocument();
    expect(within(dialog).getByText("Coming soon")).toBeInTheDocument();
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

    await user.click(within(dialog).getByRole("button", { name: "Security & sign-in" }));
    expect(await within(dialog).findByRole("heading", { name: "Connected accounts" })).toBeInTheDocument();
    expect(within(dialog).getByText("Email & password")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Your data" }));
    expect(within(dialog).getByRole("button", { name: /Export account data/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Import conversations/ })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "About" }));
    expect(within(dialog).getByRole("link", { name: /Privacy Policy/ })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Delete account" }));
    expect(within(dialog).getByRole("button", { name: "Continue to deletion" })).toBeInTheDocument();
  });
});
