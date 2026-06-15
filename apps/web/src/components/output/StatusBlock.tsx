export function StatusBlock({ status, message, progress }: { status: string; message: string; progress?: number | undefined }) {
  return (
    <div className="status-output" role="status" aria-live="polite">
      <strong>{status.replace("_", " ")}</strong>
      <span>{message}</span>
      {progress !== undefined ? <progress value={progress} max={100}>{progress}%</progress> : null}
    </div>
  );
}
