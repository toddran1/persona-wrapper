type StatusStripProps = {
  conversationId: string | undefined;
  loading: boolean;
  error: string | undefined;
  generatedAt: string | undefined;
  onClearError: () => void;
};

export function StatusStrip(props: StatusStripProps) {
  return (
    <section className={`status-card${props.error ? " status-card-error" : ""}`}>
      <div className="status-item">
        <span>Status</span>
        <strong>{props.loading ? "Generating response..." : props.error ? "Needs attention" : "Ready for MVP testing"}</strong>
      </div>
      <div className="status-item">
        <span>Conversation</span>
        <strong>{props.conversationId ?? "Not started"}</strong>
      </div>
      <div className="status-item">
        <span>Last response</span>
        <strong>{props.generatedAt ? new Date(props.generatedAt).toLocaleTimeString() : "None yet"}</strong>
      </div>
      {props.error ? (
        <button type="button" className="ghost-button" onClick={props.onClearError}>
          Dismiss error
        </button>
      ) : null}
    </section>
  );
}
