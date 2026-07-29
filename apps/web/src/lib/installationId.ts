const INSTALLATION_ID_KEY = "persona-wrapper-owner-id";
let fallbackInstallationId: string | undefined;

export function installationId(): string {
  try {
    const existing = localStorage.getItem(INSTALLATION_ID_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(INSTALLATION_ID_KEY, created);
    return created;
  } catch {
    fallbackInstallationId ??= crypto.randomUUID();
    return fallbackInstallationId;
  }
}
