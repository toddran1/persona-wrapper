import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConversationSidebar } from "../components/ConversationSidebar.js";

const now = "2026-07-24T05:00:00.000Z";

function renderSidebar() {
  return render(
    <ConversationSidebar
      personaName="LaRae the Baddest"
      authUser={{
        id: "user_settings",
        email: "settings@example.com",
        username: "settingsuser",
        displayName: "Settings User",
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
}

describe("ConversationSidebar settings", () => {
  it("keeps the account menu compact and moves account controls into the settings modal", async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByTestId("account-menu-toggle"));
    const menu = screen.getByRole("menu", { name: "Account menu" });
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(3);
    expect(within(menu).getByRole("menuitem", { name: "Upgrade plan Soon" })).toBeDisabled();

    await user.click(within(menu).getByRole("menuitem", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(within(dialog).getByText("settings@example.com")).toBeInTheDocument();
    expect(within(dialog).getByText("Coming soon")).toBeInTheDocument();

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
