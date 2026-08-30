import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConversationHistory } from "../components/ConversationHistory";
import { MarkdownText } from "../components/MarkdownText";
import { api } from "../lib/api";

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

  it("keeps an in-flight response attributed to its submitted persona after selection changes", () => {
    render(
      <ConversationHistory
        personaShortName="Bam Bam"
        pendingPersonaShortName="LaRae"
        turns={[]}
        pendingPrompt="Finish the request LaRae started."
        thinking
      />
    );

    expect(screen.getByLabelText("LaRae is thinking")).toBeInTheDocument();
    expect(screen.queryByLabelText("Bam Bam is thinking")).not.toBeInTheDocument();
  });

  it("renders an attachment-only pending turn while the response is running", () => {
    render(
      <ConversationHistory
        personaShortName="LaRae"
        turns={[]}
        pendingPrompt=""
        pendingAssets={[{
          id: "asset_pending",
          kind: "image",
          fileName: "follow-up.png",
          mimeType: "image/png"
        }]}
        thinking
      />
    );

    expect(screen.getByText("follow-up.png")).toBeInTheDocument();
    expect(screen.getByLabelText("LaRae is thinking")).toBeInTheDocument();
    expect(screen.queryByText("Please review the attached file.")).not.toBeInTheDocument();
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

  it("keeps mixed-persona responses attributed to the persona that answered", () => {
    const { container } = render(
      <ConversationHistory
        personaId="current-persona"
        personaNamesById={{ larae: "LaRae" }}
        turns={[
          {
            personaId: "larae",
            userMessage: "First question",
            assistantText: "First answer",
            outputs: [{ type: "text", text: "First answer" }]
          },
          {
            personaId: "future-persona",
            userMessage: "Second question",
            assistantText: "Second answer",
            outputs: [{ type: "text", text: "Second answer" }]
          }
        ]}
      />
    );

    expect(Array.from(container.querySelectorAll(".chat-avatar-assistant")).map((node) => node.textContent))
      .toEqual(["LaRae", "Retired persona"]);
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

  it("only offers retry for the latest response in the active chat", async () => {
    const user = userEvent.setup();
    const onRetryAssistantTurn = vi.fn();
    const firstTurn = {
      userMessage: "First prompt.",
      assistantText: "First response.",
      outputs: [{ type: "text" as const, text: "First response." }]
    };
    const latestTurn = {
      userMessage: "Latest prompt.",
      assistantText: "Latest response.",
      outputs: [{ type: "text" as const, text: "Latest response." }]
    };

    render(<ConversationHistory turns={[firstTurn, latestTurn]} onRetryAssistantTurn={onRetryAssistantTurn} />);

    const actionButtons = screen.getAllByRole("button", { name: "More response actions" });
    await user.click(actionButtons[0]!);
    expect(screen.queryByRole("menuitem", { name: "Retry" })).not.toBeInTheDocument();

    await user.click(actionButtons[1]!);
    await user.click(screen.getByRole("menuitem", { name: "Retry" }));
    expect(onRetryAssistantTurn).toHaveBeenCalledWith(latestTurn);
  });

  it("retries the latest response without a persona from the response action menu", async () => {
    const user = userEvent.setup();
    const onRetryAssistantTurnWithoutPersona = vi.fn();
    const firstTurn = {
      userMessage: "First prompt.",
      assistantText: "First response.",
      outputs: [{ type: "text" as const, text: "First response." }]
    };
    const latestTurn = {
      userMessage: "Latest prompt.",
      assistantText: "Latest response.",
      outputs: [{ type: "text" as const, text: "Latest response." }]
    };

    render(
      <ConversationHistory
        turns={[firstTurn, latestTurn]}
        onRetryAssistantTurnWithoutPersona={onRetryAssistantTurnWithoutPersona}
      />
    );

    const actionButtons = screen.getAllByRole("button", { name: "More response actions" });
    await user.click(actionButtons[0]!);
    expect(screen.queryByRole("menuitem", { name: "Retry without persona" })).not.toBeInTheDocument();

    await user.click(actionButtons[1]!);
    await user.click(screen.getByRole("menuitem", { name: "Retry without persona" }));
    expect(onRetryAssistantTurnWithoutPersona).toHaveBeenCalledWith(latestTurn);
  });

  it("does not offer retry without persona for a response that is already neutral", async () => {
    const user = userEvent.setup();
    const onRetryAssistantTurn = vi.fn();
    const onRetryAssistantTurnWithoutPersona = vi.fn();
    const turn = {
      userMessage: "Plain prompt.",
      assistantText: "Plain response.",
      personaId: "neutral",
      outputs: [{ type: "text" as const, text: "Plain response." }]
    };

    render(
      <ConversationHistory
        turns={[turn]}
        onRetryAssistantTurn={onRetryAssistantTurn}
        onRetryAssistantTurnWithoutPersona={onRetryAssistantTurnWithoutPersona}
      />
    );

    await user.click(screen.getByRole("button", { name: "More response actions" }));
    expect(screen.getByRole("menuitem", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Retry without persona" })).not.toBeInTheDocument();
  });

  it("submits an unsafe-output report from the response action menu", async () => {
    const user = userEvent.setup();
    const onReportAssistantTurn = vi.fn().mockResolvedValue(undefined);
    const turn = {
      userMessage: "Answer this.",
      assistantText: "Unsafe response text.",
      outputs: [{ type: "text" as const, text: "Unsafe response text." }]
    };

    render(<ConversationHistory turns={[turn]} onReportAssistantTurn={onReportAssistantTurn} />);
    await user.click(screen.getByRole("button", { name: "More response actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Report unsafe output" }));
    expect(screen.getByRole("dialog", { name: "Report this response" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Other" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Dangerous or illegal advice" }));
    await user.type(screen.getByLabelText(/Anything else/), "This could cause harm.");
    await user.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() => expect(onReportAssistantTurn).toHaveBeenCalledWith(
      turn,
      "dangerous_or_illegal",
      "This could cause harm."
    ));
    expect(await screen.findByText("Report received")).toBeInTheDocument();
  });

  it("submits general feedback separately from an unsafe-output report", async () => {
    const user = userEvent.setup();
    const onFeedbackAssistantTurn = vi.fn().mockResolvedValue(undefined);
    const turn = {
      userMessage: "Answer this.",
      assistantText: "Useful response text.",
      outputs: [{ type: "text" as const, text: "Useful response text." }]
    };

    render(<ConversationHistory turns={[turn]} onFeedbackAssistantTurn={onFeedbackAssistantTurn} />);
    await user.click(screen.getByRole("button", { name: "More response actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Send feedback" }));
    expect(screen.getByRole("dialog", { name: "Feedback on this response" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Other" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Helpful" }));
    await user.type(screen.getByLabelText(/Anything else/), "The answer was clear.");
    await user.click(screen.getByRole("button", { name: "Send feedback" }));

    await waitFor(() => expect(onFeedbackAssistantTurn).toHaveBeenCalledWith(
      turn,
      "helpful",
      "The answer was clear."
    ));
    expect(await screen.findByText("Feedback received")).toBeInTheDocument();
  });

  it("closes an unfinished report when the user switches conversations", async () => {
    const user = userEvent.setup();
    const turn = {
      userMessage: "Answer this.",
      assistantText: "Response to report.",
      outputs: [{ type: "text" as const, text: "Response to report." }]
    };
    const { rerender } = render(
      <ConversationHistory conversationId="conv-a" turns={[turn]} onReportAssistantTurn={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: "More response actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Report unsafe output" }));
    expect(screen.getByRole("dialog", { name: "Report this response" })).toBeInTheDocument();

    rerender(<ConversationHistory conversationId="conv-b" turns={[]} onReportAssistantTurn={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Report this response" })).not.toBeInTheDocument());
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

  it("revokes a protected preview URL that finishes loading after unmount", async () => {
    let resolveBlob!: (blob: Blob) => void;
    vi.spyOn(api, "fetchUploadBlob").mockReturnValue(new Promise((resolve) => {
      resolveBlob = resolve;
    }));
    const createObjectURL = vi.fn(() => "blob:late-preview");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const { unmount } = render(
      <ConversationHistory
        turns={[{
          userMessage: "Use this protected image.",
          userAssets: [{
            id: "asset_protected",
            kind: "image",
            fileName: "protected.png",
            mimeType: "image/png",
            url: "/api/uploads/asset_protected"
          }],
          assistantText: "Done.",
          outputs: [{ type: "text", text: "Done." }]
        }]}
      />
    );

    unmount();
    resolveBlob(new Blob(["image"]));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:late-preview");
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

  it("renders a nonfatal audio generation failure alongside the text reply", () => {
    render(
      <ConversationHistory
        turns={[
          {
            userMessage: "Say this out loud.",
            assistantText: "The text reply is still available.",
            outputs: [
              { type: "text", text: "The text reply is still available." },
              {
                type: "status",
                status: "failed",
                message: "Audio could not be generated. You can retry this response or continue with the text reply."
              }
            ]
          }
        ]}
      />
    );

    expect(screen.getByText("The text reply is still available.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Audio could not be generated");
  });

  it("reports generated audio playback state changes", () => {
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const onAudioPlaybackRequest = vi.fn();
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
        onAudioPlaybackRequest={onAudioPlaybackRequest}
        onAudioPlaybackChange={onAudioPlaybackChange}
      />
    );

    const audio = container.querySelector("audio");
    expect(audio).toBeInstanceOf(HTMLAudioElement);

    fireEvent.click(screen.getByRole("button", { name: "Audio settings" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Replay audio" }));
    expect(onAudioPlaybackRequest).toHaveBeenLastCalledWith(audio, "persona");

    fireEvent.play(audio as HTMLAudioElement);
    expect(onAudioPlaybackChange).toHaveBeenLastCalledWith(true, "persona", audio);

    fireEvent.ended(audio as HTMLAudioElement);
    expect(onAudioPlaybackChange).toHaveBeenLastCalledWith(false, "persona", audio);

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
