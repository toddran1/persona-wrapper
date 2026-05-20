import type { ChatMessage, ContentBlock } from "@persona/shared";
import { OutputRenderer } from "./OutputRenderer.js";

export function ConversationHistory({
  history,
  latestOutputs
}: {
  history: ChatMessage[];
  latestOutputs: ContentBlock[];
}) {
  const visibleMessages = history.filter((message) => message.role === "user" || message.role === "assistant");
  const inlineOutputs = latestOutputs.filter((output) => output.type !== "text" && output.type !== "json");
  const lastAssistantIndex = [...visibleMessages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find((entry) => entry.message.role === "assistant")?.index;

  return (
    <section className="history-card">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Conversation</div>
        </div>
        <span className="provider-pill">{visibleMessages.length} messages</span>
      </div>
      {visibleMessages.length === 0 ? (
        <p className="empty-state">No conversation state yet. Send a message to create a tracked thread.</p>
      ) : (
        <div className="chat-thread">
          {visibleMessages.map((message, index) => (
            <article key={`${message.role}-${index}`} className={`chat-row chat-row-${message.role}`}>
              <div className={`chat-avatar chat-avatar-${message.role}`}>{message.role === "user" ? "You" : "LaRae"}</div>
              <div className={`chat-bubble chat-bubble-${message.role}`}>
                <span className="history-role">{message.role === "user" ? "Prompt" : "Reply"}</span>
                <p className="message-text">{message.content}</p>
                {message.role === "assistant" && index === lastAssistantIndex && inlineOutputs.length > 0 ? (
                  <div className="inline-artifact-stack">
                    {inlineOutputs.map((output, outputIndex) => (
                      <div key={`${output.type}-${outputIndex}`} className="inline-artifact-card">
                        <OutputRenderer output={output} />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
