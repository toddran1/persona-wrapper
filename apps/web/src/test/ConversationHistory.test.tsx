import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ConversationHistory } from "../components/ConversationHistory";

describe("ConversationHistory pending state", () => {
  it("shows a thinking indicator and replaces it with the final reply", () => {
    const { rerender } = render(
      <ConversationHistory
        turns={[]}
        pendingPrompt="Tell me something useful."
        thinking
      />
    );

    expect(screen.getByText("Tell me something useful.")).toBeInTheDocument();
    expect(screen.getByLabelText("LaRae is thinking")).toBeInTheDocument();

    rerender(
      <ConversationHistory
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

  it("renders markdown text and exposes sources as response actions", async () => {
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

    await user.click(screen.getByRole("button", { name: "Sources" }));
    expect(screen.getByRole("dialog", { name: "Sources" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Billboard report" })).toHaveAttribute("href", "https://example.com/billboard");
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
      />
    );

    expect(screen.queryByText("Audio")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Audio settings" }));
    expect(screen.getByRole("menuitem", { name: "Replay audio" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Download audio" })).toHaveAttribute("href", "http://localhost:4000/api/generated-audio/audio-token");
  });
});
