import { render, screen } from "@testing-library/react";
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
});
