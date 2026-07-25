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
  chartColors: string[];
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
  chartColors: ["#d6b55e", "#8a5cf6", "#e06f9f", "#69c4b1", "#ef8d5b", "#7899e8"],
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
  // Persona themes can be restored from an older API response or a persisted
  // query cache. New fields must therefore remain optional at runtime even
  // when the current shared TypeScript type declares them as required.
  const configuredChartColors = Array.isArray(theme?.chartColors) && theme.chartColors.length > 0
    ? theme.chartColors
    : defaultPersonaTheme.chartColors;
  return {
    mode: theme?.mode ?? defaultPersonaTheme.mode,
    name: theme?.themeName ?? defaultPersonaTheme.name,
    background: backgroundFromPersona(theme),
    backgroundAlt: normalizeColor(theme?.backgroundAlt, defaultPersonaTheme.backgroundAlt),
    surface: normalizeColor(theme?.surface, defaultPersonaTheme.surface),
    surfaceStrong: normalizeColor(theme?.surfaceStrong, defaultPersonaTheme.surfaceStrong),
    rail: normalizeColor(theme?.rail, defaultPersonaTheme.rail),
    accent: normalizeColor(theme?.accent, defaultPersonaTheme.accent),
    accent2: normalizeColor(theme?.accent2, defaultPersonaTheme.accent2),
    chartColors: configuredChartColors.map((color, index) => normalizeColor(
      color,
      defaultPersonaTheme.chartColors[index % defaultPersonaTheme.chartColors.length] ?? defaultPersonaTheme.accent2
    )),
    border: normalizeColor(theme?.border, defaultPersonaTheme.border),
    text: normalizeColor(theme?.text, defaultPersonaTheme.text),
    muted: normalizeColor(theme?.muted, defaultPersonaTheme.muted),
    danger: normalizeColor(theme?.danger, defaultPersonaTheme.danger)
  };
}
