import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConversationHistory } from "../components/ConversationHistory";

describe("ConversationHistory streaming", () => {
  it("shows a streamed reply and silently replaces it with the final reply", () => {
    const { rerender } = render(
      <ConversationHistory
        history={[]}
        latestOutputs={[]}
        pendingPrompt="Tell me something useful."
        streamingText="The neutral answer is arriving"
      />
    );

    expect(screen.getByText("Tell me something useful.")).toBeInTheDocument();
    expect(screen.getByText("The neutral answer is arriving")).toBeInTheDocument();

    rerender(
      <ConversationHistory
        history={[
          { role: "user", content: "Tell me something useful." },
          { role: "assistant", content: "The final styled answer." }
        ]}
        latestOutputs={[{ type: "text", text: "The final styled answer." }]}
      />
    );

    expect(screen.queryByText("The neutral answer is arriving")).not.toBeInTheDocument();
    expect(screen.getByText("The final styled answer.")).toBeInTheDocument();
  });
});
