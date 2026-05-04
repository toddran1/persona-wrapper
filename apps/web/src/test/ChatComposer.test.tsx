import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatComposer } from "../components/ChatComposer";

describe("ChatComposer", () => {
  it("submits the current message", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ChatComposer
        provider="openai"
        audioEnabled={false}
        loading={false}
        onResetConversation={vi.fn()}
        onProviderChange={vi.fn()}
        onAudioChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    const textarea = screen.getByPlaceholderText("Ask anything");
    await user.clear(textarea);
    await user.type(textarea, "Test the reunion energy.");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSubmit).toHaveBeenCalledWith("Test the reunion energy.");
  });

  it("loads a sample prompt into the textarea", async () => {
    const user = userEvent.setup();

    render(
      <ChatComposer
        provider="openai"
        audioEnabled={false}
        loading={false}
        onResetConversation={vi.fn()}
        onProviderChange={vi.fn()}
        onAudioChange={vi.fn()}
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
        provider="openai"
        audioEnabled={false}
        loading={false}
        onResetConversation={vi.fn()}
        onProviderChange={vi.fn()}
        onAudioChange={vi.fn()}
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
        provider="openai"
        audioEnabled={false}
        loading={false}
        onResetConversation={vi.fn()}
        onProviderChange={vi.fn()}
        onAudioChange={vi.fn()}
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
