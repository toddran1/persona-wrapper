import type { ContentBlock } from "@persona/shared";
import { OutputRenderer } from "./OutputRenderer.js";

export type RenderedTurn = {
  userMessage: string;
  assistantText: string;
  outputs: ContentBlock[];
};

export function ConversationHistory({
  turns,
  pendingPrompt,
  thinking
}: {
  turns: RenderedTurn[];
  pendingPrompt?: string | undefined;
  thinking?: boolean | undefined;
}) {
  const messageCount = turns.length * 2 + (pendingPrompt ? 1 : 0) + (thinking ? 1 : 0);

  return (
    <section className="history-card">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Conversation</div>
        </div>
        <span className="provider-pill">{messageCount} messages</span>
      </div>
      {messageCount === 0 ? (
        <p className="empty-state">No conversation state yet. Send a message to create a tracked thread.</p>
      ) : (
        <div className="chat-thread">
          {turns.map((turn, turnIndex) => {
            const inlineOutputs = turn.outputs.filter((output) => output.type !== "text" && output.type !== "json");

            return (
              <div key={`turn-${turnIndex}`} className="chat-turn">
                <article className="chat-row chat-row-user">
                  <div className="chat-avatar chat-avatar-user">You</div>
                  <div className="chat-bubble chat-bubble-user">
                    <span className="history-role">Prompt</span>
                    <p className="message-text">{turn.userMessage}</p>
                  </div>
                </article>
                <article className="chat-row chat-row-assistant">
                  <div className="chat-avatar chat-avatar-assistant">LaRae</div>
                  <div className="chat-bubble chat-bubble-assistant">
                    <span className="history-role">Reply</span>
                    {turn.assistantText ? <p className="message-text">{turn.assistantText}</p> : null}
                    {inlineOutputs.length > 0 ? (
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
              </div>
            );
          })}
          {pendingPrompt ? (
            <article className="chat-row chat-row-user">
              <div className="chat-avatar chat-avatar-user">You</div>
              <div className="chat-bubble chat-bubble-user">
                <span className="history-role">Prompt</span>
                <p className="message-text">{pendingPrompt}</p>
              </div>
            </article>
          ) : null}
          {thinking ? (
            <article className="chat-row chat-row-assistant">
              <div className="chat-avatar chat-avatar-assistant">LaRae</div>
              <div className="chat-bubble chat-bubble-assistant">
                <span className="history-role">Reply</span>
                <div className="thinking-indicator" aria-live="polite" aria-label="LaRae is thinking">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </article>
          ) : null}
        </div>
      )}
    </section>
  );
}
