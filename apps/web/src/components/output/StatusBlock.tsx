import { clampFiniteNumber } from "@persona/shared";

export function StatusBlock({ status, message, progress }: { status: string; message: string; progress?: number | undefined }) {
  const safeProgress = progress === undefined ? undefined : clampFiniteNumber(progress, 0, 100);
  return (
    <div className="status-output" role="status" aria-live="polite">
      <strong>{status.replace("_", " ")}</strong>
      <span>{message}</span>
      {safeProgress !== undefined ? <progress value={safeProgress} max={100}>{safeProgress}%</progress> : null}
    </div>
  );
}
