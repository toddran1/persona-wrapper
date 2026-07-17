import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConversationHistory } from "../components/ConversationHistory";
import { MarkdownText } from "../components/MarkdownText";

describe("ConversationHistory pending state", () => {
  it("renders fenced code in a copyable code block", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(<MarkdownText text={"```javascript\nconst hello = 'world';\n```"} />);

    expect(screen.getByLabelText("javascript code block")).toBeInTheDocument();
    expect(screen.getByText("const hello = 'world';")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy code" }));
    expect(writeText).toHaveBeenCalledWith("const hello = 'world';");
    expect(screen.getByRole("button", { name: "Copy code" })).toHaveTextContent("Copied");
  });

  it("shows a thinking indicator and replaces it with the final reply", () => {
    const { rerender } = render(
      <ConversationHistory
        personaShortName="LaRae"
        turns={[]}
        pendingPrompt="Tell me something useful."
        thinking
      />
    );

    expect(screen.getByText("Tell me something useful.")).toBeInTheDocument();
    expect(screen.getByLabelText("LaRae is thinking")).toBeInTheDocument();

    rerender(
      <ConversationHistory
        personaShortName="LaRae"
        turns={[
          {
            userMessage: "Tell me something useful.",
            assistantText: "The final styled answer.",
            outputs: [{ type: "text", text: "The final styled answer." }]
          }
        ]}
      />
    );

    expect(screen.queryByLabelText("LaRae is thinking")).not.toBeInTheDocument();
    expect(screen.getByText("The final styled answer.")).toBeInTheDocument();
  });

  it("keeps each turn's artifacts attached to its own response", () => {
    render(
      <ConversationHistory
        personaShortName="LaRae"
        turns={[
          {
            userMessage: "Make an image.",
            assistantText: "",
            outputs: [
              { type: "image", url: "data:image/png;base64,abc", alt: "Generated pirate image", mimeType: "image/png" }
            ]
          }
        ]}
        pendingPrompt="Make a pie chart."
        thinking
      />
    );

    expect(screen.getByText("Make an image.")).toBeInTheDocument();
    expect(screen.getByAltText("Generated pirate image")).toBeInTheDocument();
    expect(screen.getByText("Make a pie chart.")).toBeInTheDocument();
    expect(screen.getByLabelText("LaRae is thinking")).toBeInTheDocument();
  });

  it("renders markdown text and exposes references from the response action menu", async () => {
    const user = userEvent.setup();
    render(
      <ConversationHistory
        turns={[
          {
            userMessage: "What were Drake's new albums?",
            assistantText:
              "Okay, **ICEMAN** did 463,000 units.\n\n| Album | Sales |\n| --- | --- |\n| **ICEMAN** | 463,000 |",
            outputs: [
              {
                type: "text",
                text: "Okay, **ICEMAN** did 463,000 units."
              },
              {
                type: "source_list",
                sources: [
                  {
                    title: "Billboard report",
                    url: "https://example.com/billboard"
                  }
                ]
              },
              {
                type: "tool_result",
                toolName: "web_search",
                status: "completed",
                result: { query: "Drake albums" }
              },
              {
                type: "tool_call",
                toolName: "data_analysis",
                status: "completed",
                arguments: { task: "Compare albums" }
              },
              {
                type: "tool_result",
                toolName: "data_analysis",
                status: "completed",
                result: { rows: 2 }
              }
            ]
          }
        ]}
      />
    );

    expect(screen.queryByText("**ICEMAN**")).not.toBeInTheDocument();
    expect(screen.getAllByText("ICEMAN")[0]).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Album" })).toBeInTheDocument();
    expect(screen.queryByText("web_search · completed")).not.toBeInTheDocument();
    expect(screen.queryByText("data_analysis · completed")).not.toBeInTheDocument();

    expect(screen.queryByText("Billboard report")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More response actions" }));
    await user.click(screen.getByRole("menuitem", { name: "References" }));
    expect(screen.getByRole("dialog", { name: "References" })).toBeInTheDocument();
    const referenceLink = screen.getByRole("link", { name: /Billboard report/ });
    expect(referenceLink).toHaveAttribute("href", "https://example.com/billboard");
    expect(referenceLink).toHaveAttribute("target", "_blank");
    expect(referenceLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("retries the originating prompt from the response action menu", async () => {
    const user = userEvent.setup();
    const onRetryAssistantTurn = vi.fn();
    const turn = {
      userMessage: "Try this again.",
      assistantText: "The first answer.",
      outputs: [{ type: "text" as const, text: "The first answer." }]
    };

    render(<ConversationHistory turns={[turn]} onRetryAssistantTurn={onRetryAssistantTurn} />);

    await user.click(screen.getByRole("button", { name: "More response actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Retry" }));

    expect(onRetryAssistantTurn).toHaveBeenCalledWith(turn);
  });

  it("does not expose malformed reference URLs as actions", async () => {
    const user = userEvent.setup();
    render(
      <ConversationHistory
        turns={[{
          userMessage: "Show me sources.",
          assistantText: "Here is the answer.",
          outputs: [{
            type: "source_list",
            sources: [{ title: "Unsafe", url: "javascript:alert(1)" }]
          }]
        }]}
      />
    );

    await user.click(screen.getByRole("button", { name: "More response actions" }));
    expect(screen.queryByRole("menuitem", { name: "References" })).not.toBeInTheDocument();
  });

  it("preserves ordered markdown numbering when list items have paragraph details", () => {
    const { container } = render(
      <ConversationHistory
        turns={[
          {
            userMessage: "Give me a recipe.",
            assistantText:
              "### Instructions\n\n1. Heat the oven.\n\nGrease the pan.\n\n2. Cream the butter and sugar.\n\nKeep going until fluffy.\n\n3. Add the eggs.",
            outputs: [
              {
                type: "text",
                text: "### Instructions\n\n1. Heat the oven.\n\nGrease the pan.\n\n2. Cream the butter and sugar.\n\nKeep going until fluffy.\n\n3. Add the eggs."
              }
            ]
          }
        ]}
      />
    );

    const lists = Array.from(container.querySelectorAll("ol"));
    expect(lists).toHaveLength(3);
    expect(lists.map((list) => list.start)).toEqual([1, 2, 3]);
  });

  it("shows submitted asset previews in the user prompt bubble", () => {
    render(
      <ConversationHistory
        turns={[
          {
            userMessage: "Use this reference image.",
            userAssets: [
              {
                id: "asset_1",
                kind: "image",
                fileName: "reference.png",
                mimeType: "image/png",
                url: "data:image/png;base64,abc"
              },
              {
                id: "asset_2",
                kind: "file",
                fileName: "notes.pdf",
                mimeType: "application/pdf"
              }
            ],
            assistantText: "Done.",
            outputs: [{ type: "text", text: "Done." }]
          }
        ]}
      />
    );

    expect(screen.getByAltText("reference.png")).toBeInTheDocument();
    expect(screen.getByText("notes.pdf")).toBeInTheDocument();
  });

  it("renders generated files as a download card without provider metadata or a duplicate download prompt", () => {
    render(
      <ConversationHistory
        turns={[
          {
            userMessage: "Create a spreadsheet.",
            assistantText: "Your spreadsheet is ready.\n\nDownload it right here:\n\nCompare the looks.",
            outputs: [
              {
                type: "file",
                fileName: "summer_outfit_comparison.xlsx",
                url: "https://files.example.com/summer_outfit_comparison.xlsx",
                mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                description: "Generated by OpenAI Code Interpreter"
              }
            ]
          }
        ]}
      />
    );

    expect(screen.getByText("Your spreadsheet is ready.")).toBeInTheDocument();
    expect(screen.getByText("Compare the looks.")).toBeInTheDocument();
    expect(screen.queryByText("Download it right here:")).not.toBeInTheDocument();
    expect(screen.getByText("Spreadsheet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "summer_outfit_comparison.xlsx" })).toHaveAttribute(
      "href",
      "https://files.example.com/summer_outfit_comparison.xlsx"
    );
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(screen.queryByText(/application\/vnd\.openxmlformats/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Generated by OpenAI Code Interpreter")).not.toBeInTheDocument();
  });

  it("shows hover actions for user prompts and supports editing", async () => {
    const user = userEvent.setup();
    const onEditUserPrompt = vi.fn();
    const referenceFile = new File(["reference"], "reference.png", { type: "image/png" });

    render(
      <ConversationHistory
        turns={[
          {
            userMessage: "Make it again with the same skin tone.",
            userFiles: [referenceFile],
            assistantText: "On it.",
            outputs: [{ type: "text", text: "On it." }]
          }
        ]}
        onEditUserPrompt={onEditUserPrompt}
      />
    );

    await user.click(screen.getByRole("button", { name: "Edit prompt" }));
    expect(onEditUserPrompt).toHaveBeenCalledWith("Make it again with the same skin tone.", [referenceFile]);
  });

  it("shows a temporary copied state after copying a prompt", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(
      <ConversationHistory
        turns={[
          {
            userMessage: "Copy this prompt.",
            assistantText: "Done.",
            outputs: [{ type: "text", text: "Done." }]
          }
        ]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Copy prompt" }));
    expect(writeText).toHaveBeenCalledWith("Copy this prompt.");
    expect(screen.getByRole("button", { name: "Copied prompt" })).toBeInTheDocument();
  });

  it("shows token usage only in test mode", () => {
    const turn = {
      userMessage: "Token test",
      assistantText: "Token answer.",
      outputs: [{ type: "text" as const, text: "Token answer." }],
      usage: {
        inputTokens: 1234,
        outputTokens: 56,
        totalTokens: 1290
      }
    };

    const { rerender } = render(<ConversationHistory turns={[turn]} />);
    expect(screen.queryByLabelText("Token usage")).not.toBeInTheDocument();

    rerender(<ConversationHistory turns={[turn]} testMode />);
    expect(screen.getByLabelText("Token usage")).toHaveTextContent("Input tokens: 1,234");
    expect(screen.getByLabelText("Token usage")).toHaveTextContent("Output tokens: 56");
    expect(screen.getByLabelText("Token usage")).toHaveTextContent("Total tokens: 1,290");
  });

  it("moves generated audio into response actions", async () => {
    const user = userEvent.setup();
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    render(
      <ConversationHistory
        turns={[
          {
            userMessage: "Say this out loud.",
            assistantText: "Audio answer.",
            outputs: [
              { type: "text", text: "Audio answer." },
              { type: "audio", url: "/api/generated-audio/audio-token", mimeType: "audio/mpeg", transcript: "Audio answer." }
            ]
          }
        ]}
        autoPlayAudioTurnIndex={0}
      />
    );

    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Audio")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Audio settings" }));
    expect(screen.getByRole("menuitem", { name: "Replay audio" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Download audio" })).toBeInstanceOf(HTMLButtonElement);

    playSpy.mockRestore();
  });

  it("does not autoplay response audio when rendering existing history", async () => {
    const user = userEvent.setup();
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    render(
      <ConversationHistory
        turns={[
          {
            userMessage: "Open this old chat.",
            assistantText: "Saved audio answer.",
            outputs: [
              { type: "text", text: "Saved audio answer." },
              { type: "audio", url: "/api/generated-audio/audio-token", mimeType: "audio/mpeg", transcript: "Saved audio answer." }
            ]
          }
        ]}
      />
    );

    expect(playSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Audio settings" }));
    expect(screen.getByRole("menuitem", { name: "Replay audio" })).toBeInTheDocument();

    playSpy.mockRestore();
  });

  it("reports generated audio playback state changes", () => {
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const onAudioPlaybackChange = vi.fn();
    const { container } = render(
      <ConversationHistory
        turns={[
          {
            userMessage: "Say this out loud.",
            assistantText: "Audio answer.",
            outputs: [
              { type: "text", text: "Audio answer." },
              { type: "audio", url: "/api/generated-audio/audio-token", mimeType: "audio/mpeg", transcript: "Audio answer." }
            ]
          }
        ]}
        onAudioPlaybackChange={onAudioPlaybackChange}
      />
    );

    const audio = container.querySelector("audio");
    expect(audio).toBeInstanceOf(HTMLAudioElement);

    fireEvent.play(audio as HTMLAudioElement);
    expect(onAudioPlaybackChange).toHaveBeenLastCalledWith(true);

    fireEvent.ended(audio as HTMLAudioElement);
    expect(onAudioPlaybackChange).toHaveBeenLastCalledWith(false);

    playSpy.mockRestore();
  });

  it("shows a checking state while a background resume action is running", async () => {
    const user = userEvent.setup();
    let resolveAction: (() => void) | undefined;
    const onOutputAction = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAction = resolve;
        })
    );

    render(
      <ConversationHistory
        turns={[
          {
            userMessage: "Finish that image request.",
            assistantText: "This is still running in the background.",
            backgroundJobId: "chat_job_123",
            outputs: [
              {
                type: "status",
                status: "in_progress",
                message: "Still working on this request."
              },
              {
                type: "action",
                id: "resume-chat_job_123",
                label: "Check status",
                action: "resume_background_job",
                arguments: { jobId: "chat_job_123" },
                style: "primary"
              }
            ]
          }
        ]}
        onOutputAction={onOutputAction}
      />
    );

    await user.click(screen.getByRole("button", { name: "Check status" }));
    expect(onOutputAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Checking..." })).toBeDisabled();

    resolveAction?.();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Check status" })).toBeEnabled();
    });
  });
});
