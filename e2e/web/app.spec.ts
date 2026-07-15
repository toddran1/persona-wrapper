import { expect, test } from "@playwright/test";
import path from "node:path";

const fixture = (name: string) => path.resolve(process.cwd(), "e2e", "fixtures", name);

async function openAuth(page: import("@playwright/test").Page, mode: "login" | "register") {
  await page.getByTestId("auth-panel-toggle").click();
  await page.getByTestId(mode === "login" ? "auth-login-tab" : "auth-register-tab").click();
}

async function openAccountMenu(page: import("@playwright/test").Page) {
  const menu = page.getByRole("menu", { name: "Account menu" });
  if (!(await menu.isVisible())) await page.getByTestId("account-menu-toggle").click();
  await expect(menu).toBeVisible();
}

test.describe("For the Baddiez browser E2E", () => {
  test("test-mode OAuth completes for Google and Facebook", async ({ browser }) => {
    for (const provider of ["google", "facebook"] as const) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto("/");
      await openAuth(page, "login");
      await page.getByTestId(`oauth-${provider}`).click();
      await expect(page).toHaveURL(/127\.0\.0\.1:5173\/?$/);
      await expect(page.getByTestId("account-menu-toggle")).toBeVisible();
      await context.close();
    }
  });

  test("password login, chat, background work, upload, data transfer, deletion, and restoration", async ({ page }) => {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
    const email = `e2e-${suffix}@for-the-baddiez.test`;
    const password = "E2eSecurePassword!42";

    await page.goto("/");
    await openAuth(page, "register");
    await page.getByTestId("auth-register-email").fill(email);
    await page.getByTestId("auth-register-username").fill(`e2e_${suffix}`);
    await page.getByTestId("auth-register-password").fill(password);
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("account-menu-toggle")).toBeVisible();

    await page.getByTestId("chat-upload-input").setInputFiles(fixture("e2e-upload.txt"));
    await page.getByTestId("chat-composer").fill("Please summarize the attached E2E file.");
    const chatResponse = page.waitForResponse((response) => response.url().endsWith("/api/chat") && response.status() === 200);
    await page.getByTestId("send-message").click();
    await chatResponse;
    await expect(page.getByText("e2e-upload.txt", { exact: true })).toBeVisible();

    await page.getByTestId("chat-composer").fill("Run this long-running task in the background for the E2E test.");
    const backgroundStart = page.waitForResponse((response) => response.url().endsWith("/api/chat") && response.status() === 202);
    await page.getByTestId("send-message").click();
    await backgroundStart;
    await expect(page.getByText("Run this long-running task in the background for the E2E test.", { exact: true })).toBeVisible();
    await expect(page.locator(".chat-row-assistant").last()).toBeVisible({ timeout: 30_000 });

    await openAccountMenu(page);
    const accountDownload = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Export account data" }).click();
    const accountExport = await accountDownload;
    expect(accountExport.suggestedFilename()).toContain("for-the-baddiez-account-");

    await page.getByRole("menuitem", { name: "Import conversations" }).click();
    await page.getByTestId("conversation-import-input").setInputFiles(fixture("chatgpt-export.json"));
    await expect(page.getByText("Imported E2E ChatGPT conversation")).toBeVisible();

    const firstConversationActions = page.locator('[data-testid^="conversation-actions-"]').first();
    await firstConversationActions.click();
    const conversationDownload = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Export" }).click();
    const conversationExport = await conversationDownload;
    expect(conversationExport.suggestedFilename()).toContain("for-the-baddiez-conversation-");

    await openAccountMenu(page);
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await openAuth(page, "login");
    await page.getByTestId("auth-identifier").fill(email);
    await page.getByTestId("auth-password").fill(password);
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("account-menu-toggle")).toBeVisible();

    await openAccountMenu(page);
    await page.getByRole("menuitem", { name: "Delete account", exact: true }).click();
    await page.getByTestId("delete-confirmation").fill("DELETE");
    await page.getByTestId("delete-password").fill(password);
    await page.getByTestId("confirm-delete-account").click();
    await expect(page.getByText("Restore account")).toBeVisible();
    await page.getByTestId("auth-identifier").fill(email);
    await page.getByTestId("auth-password").fill(password);
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("account-menu-toggle")).toBeVisible();
  });
});
