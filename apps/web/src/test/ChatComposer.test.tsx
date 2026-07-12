import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatComposer } from "../components/ChatComposer";

const defaultProps = {
  provider: "openai" as const,
  audioEnabled: false,
  loading: false,
  promptPlaceholder: "Talk to me nice...",
  suggestedPrompts: [
    "Hi LaRae, please introduce yourself.",
    "Tell me I am a baddie in 3 different languages.",
    "Search the web for the most current tea."
  ],
  onResetConversation: vi.fn(),
  onProviderChange: vi.fn(),
  onAudioChange: vi.fn(),
  onCancel: vi.fn()
};

describe("ChatComposer", () => {
  it("disables chat input until the user signs in", () => {
    render(
      <ChatComposer
        {...defaultProps}
        disabled
        promptPlaceholder="Please sign in or create an account to start chatting."
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByPlaceholderText("Please sign in or create an account to start chatting.")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("submits the current message", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ChatComposer
        {...defaultProps}
        onSubmit={onSubmit}
      />
    );

    const textarea = screen.getByPlaceholderText("Talk to me nice...");
    await user.clear(textarea);
    await user.type(textarea, "Test the reunion energy.");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSubmit).toHaveBeenCalledWith("Test the reunion energy.", [], expect.objectContaining({ appFunctions: true }));
    expect(textarea).toHaveValue("");
  });

  it("submits the current message when Enter is pressed", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ChatComposer
        {...defaultProps}
        onSubmit={onSubmit}
      />
    );

    const textarea = screen.getByPlaceholderText("Talk to me nice...");
    await user.clear(textarea);
    await user.type(textarea, "Send this with enter.");
    await user.keyboard("{Enter}");

    expect(onSubmit).toHaveBeenCalledWith("Send this with enter.", [], expect.objectContaining({ appFunctions: true }));
  });

  it("keeps Shift+Enter as a newline", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ChatComposer
        {...defaultProps}
        onSubmit={onSubmit}
      />
    );

    const textarea = screen.getByPlaceholderText("Talk to me nice...");
    await user.clear(textarea);
    await user.type(textarea, "Line one");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(textarea, "Line two");

    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("Line one\nLine two");
  });

  it("cycles through submitted prompts with arrow keys", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ChatComposer
        {...defaultProps}
        onSubmit={onSubmit}
      />
    );

    const textarea = screen.getByPlaceholderText("Talk to me nice...");
    await user.clear(textarea);
    await user.type(textarea, "First prompt");
    await user.keyboard("{Enter}");
    await user.clear(textarea);
    await user.type(textarea, "Second prompt");
    await user.keyboard("{Enter}");
    await user.clear(textarea);
    await user.type(textarea, "Draft prompt");

    await user.keyboard("{ArrowUp}");
    expect(textarea).toHaveValue("Second prompt");

    await user.keyboard("{ArrowUp}");
    expect(textarea).toHaveValue("First prompt");

    await user.keyboard("{ArrowDown}");
    expect(textarea).toHaveValue("Second prompt");

    await user.keyboard("{ArrowDown}");
    expect(textarea).toHaveValue("Draft prompt");
  });

  it("loads a suggested prompt into the textarea", async () => {
    const user = userEvent.setup();

    render(
      <ChatComposer
        {...defaultProps}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await user.click(screen.getByText("Suggested prompts"));
    const samplePrompt = "Search the web for the most current tea.";
    await user.click(screen.getByRole("button", { name: samplePrompt }));

    expect(screen.getByPlaceholderText("Talk to me nice...")).toHaveValue(samplePrompt);
  });

  it("keeps composer controls collapsed by default", async () => {
    const user = userEvent.setup();
    render(
      <ChatComposer
        {...defaultProps}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByPlaceholderText("Talk to me nice...")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Suggested prompts")).toBeInTheDocument();
    expect(screen.getByText("OpenAI tools")).not.toBeVisible();
    expect(screen.getByText("Search the web for the most current tea.")).not.toBeVisible();

    await user.click(screen.getByText("Settings"));
    expect(screen.getByText("OpenAI tools")).toBeVisible();
  });

  it("shows selected attachment names", async () => {
    const user = userEvent.setup();

    const { container } = render(
      <ChatComposer
        {...defaultProps}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();

    const file = new File(["look at this"], "receipts.pdf", { type: "application/pdf" });
    await user.upload(input as HTMLInputElement, file);

    expect(screen.getByText("receipts.pdf")).toBeInTheDocument();
  });

  it("rehydrates draft attachments back into the composer", async () => {
    render(
      <ChatComposer
        {...defaultProps}
        draftMessage="Use the same reference."
        draftAttachments={[new File(["ref"], "reference.png", { type: "image/png" })]}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText("reference.png")).toBeInTheDocument();
  });

  it("removes an attachment from the composer", async () => {
    const user = userEvent.setup();

    const { container } = render(
      <ChatComposer
        {...defaultProps}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();

    const file = new File(["look at this"], "receipts.pdf", { type: "application/pdf" });
    await user.upload(input as HTMLInputElement, file);
    await user.click(screen.getByRole("button", { name: "Remove receipts.pdf" }));

    expect(screen.queryByText("receipts.pdf")).not.toBeInTheDocument();
  });

  it("shows a stop control while a response is running", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ChatComposer {...defaultProps} loading onCancel={onCancel} onSubmit={vi.fn().mockResolvedValue(undefined)} />);
    await user.click(screen.getByRole("button", { name: "Stop response" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows a persona-card restore control when the card is hidden", async () => {
    const user = userEvent.setup();
    const onShowPersonaCard = vi.fn();

    render(
      <ChatComposer
        {...defaultProps}
        personaCardHidden
        onShowPersonaCard={onShowPersonaCard}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await user.click(screen.getByRole("button", { name: "Show persona card" }));
    expect(onShowPersonaCard).toHaveBeenCalledOnce();
  });
});
