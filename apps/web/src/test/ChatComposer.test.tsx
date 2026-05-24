import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatComposer } from "../components/ChatComposer";

const defaultProps = {
  provider: "openai" as const,
  audioEnabled: false,
  loading: false,
  locationEnabled: false,
  locationError: undefined,
  onResetConversation: vi.fn(),
  onProviderChange: vi.fn(),
  onAudioChange: vi.fn(),
  onRequestLocation: vi.fn()
};

describe("ChatComposer", () => {
  it("submits the current message", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ChatComposer
        {...defaultProps}
        onSubmit={onSubmit}
      />
    );

    const textarea = screen.getByPlaceholderText("Ask anything");
    await user.clear(textarea);
    await user.type(textarea, "Test the reunion energy.");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSubmit).toHaveBeenCalledWith("Test the reunion energy.");
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

    const textarea = screen.getByPlaceholderText("Ask anything");
    await user.clear(textarea);
    await user.type(textarea, "Send this with enter.");
    await user.keyboard("{Enter}");

    expect(onSubmit).toHaveBeenCalledWith("Send this with enter.");
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

    const textarea = screen.getByPlaceholderText("Ask anything");
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

    const textarea = screen.getByPlaceholderText("Ask anything");
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

  it("loads a sample prompt into the textarea", async () => {
    const user = userEvent.setup();

    render(
      <ChatComposer
        {...defaultProps}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const samplePrompt = "Search the web for current tea and tell me what tool you would call.";
    await user.click(screen.getByRole("button", { name: samplePrompt }));

    expect(screen.getByPlaceholderText("Ask anything")).toHaveValue(samplePrompt);
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
});
