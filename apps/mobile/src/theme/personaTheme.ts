import type { PersonaSummary, PersonaTheme } from "@persona/shared";

export type MobileTheme = {
  mode: "dark" | "light";
  name: string;
  background: string;
  backgroundAlt: string;
  surface: string;
  surfaceStrong: string;
  rail: string;
  accent: string;
  accent2: string;
  border: string;
  text: string;
  muted: string;
  danger: string;
};

export const silkNoirTheme: MobileTheme = {
  mode: "dark",
  name: "Silk Noir",
  background: "#09060f",
  backgroundAlt: "#170f21",
  surface: "rgba(17, 11, 28, 0.86)",
  surfaceStrong: "#211433",
  rail: "#d6b55e",
  accent: "#8a5cf6",
  accent2: "#d6b55e",
  border: "rgba(214, 181, 94, 0.18)",
  text: "#f7efe8",
  muted: "#c8bdd8",
  danger: "#ff6b7a"
};

function normalizeColor(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (trimmed.startsWith("#")) return trimmed;
  const rgbaMatch = trimmed.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbaMatch) return trimmed;
  return fallback;
}

function backgroundFromPersona(theme: PersonaTheme | undefined): string {
  if (!theme?.background) return silkNoirTheme.background;
  const hex = theme.background.match(/#[0-9a-f]{6}/i)?.[0];
  return hex ?? silkNoirTheme.background;
}

export function themeFromPersona(persona?: PersonaSummary): MobileTheme {
  const theme = persona?.theme;
  return {
    mode: theme?.mode ?? silkNoirTheme.mode,
    name: theme?.themeName ?? silkNoirTheme.name,
    background: backgroundFromPersona(theme),
    backgroundAlt: "#170f21",
    surface: normalizeColor(theme?.surface, silkNoirTheme.surface),
    surfaceStrong: normalizeColor(theme?.surfaceStrong, silkNoirTheme.surfaceStrong),
    rail: normalizeColor(theme?.accent2, silkNoirTheme.rail),
    accent: normalizeColor(theme?.accent, silkNoirTheme.accent),
    accent2: normalizeColor(theme?.accent2, silkNoirTheme.accent2),
    border: normalizeColor(theme?.border, silkNoirTheme.border),
    text: normalizeColor(theme?.text, silkNoirTheme.text),
    muted: normalizeColor(theme?.muted, silkNoirTheme.muted),
    danger: silkNoirTheme.danger
  };
}
