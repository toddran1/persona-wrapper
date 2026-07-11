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

export const defaultPersonaTheme: MobileTheme = {
  mode: "dark",
  name: "Persona",
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
  if (!theme?.background) return defaultPersonaTheme.background;
  const hex = theme.background.match(/#[0-9a-f]{6}/i)?.[0];
  return hex ?? defaultPersonaTheme.background;
}

export function themeFromPersona(persona?: PersonaSummary): MobileTheme {
  const theme = persona?.theme;
  return {
    mode: theme?.mode ?? defaultPersonaTheme.mode,
    name: theme?.themeName ?? defaultPersonaTheme.name,
    background: backgroundFromPersona(theme),
    backgroundAlt: "#170f21",
    surface: normalizeColor(theme?.surface, defaultPersonaTheme.surface),
    surfaceStrong: normalizeColor(theme?.surfaceStrong, defaultPersonaTheme.surfaceStrong),
    rail: normalizeColor(theme?.accent2, defaultPersonaTheme.rail),
    accent: normalizeColor(theme?.accent, defaultPersonaTheme.accent),
    accent2: normalizeColor(theme?.accent2, defaultPersonaTheme.accent2),
    border: normalizeColor(theme?.border, defaultPersonaTheme.border),
    text: normalizeColor(theme?.text, defaultPersonaTheme.text),
    muted: normalizeColor(theme?.muted, defaultPersonaTheme.muted),
    danger: defaultPersonaTheme.danger
  };
}
