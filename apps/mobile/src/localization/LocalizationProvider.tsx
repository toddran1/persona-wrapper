import { getLocales } from "expo-localization";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { AppState } from "react-native";
import { englishMessages, type MessageKey, type MessageParameters } from "./messages";

type SupportedLocale = "en";
type LocalizationContextValue = {
  locale: SupportedLocale;
  languageTag: string;
  t: (key: MessageKey, parameters?: MessageParameters) => string;
};

const LocalizationContext = createContext<LocalizationContextValue | undefined>(undefined);

function resolveLocale(): { locale: SupportedLocale; languageTag: string } {
  const preferred = getLocales()[0];
  return {
    locale: "en",
    languageTag: preferred?.languageTag || "en-US"
  };
}

function interpolate(message: string, parameters?: MessageParameters): string {
  if (!parameters) return message;
  return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (placeholder, name: string) => {
    const value = parameters[name];
    return value === undefined ? placeholder : String(value);
  });
}

export function LocalizationProvider({ children }: PropsWithChildren) {
  const [resolvedLocale, setResolvedLocale] = useState(resolveLocale);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setResolvedLocale(resolveLocale());
    });
    return () => subscription.remove();
  }, []);

  const t = useCallback((key: MessageKey, parameters?: MessageParameters) => (
    interpolate(englishMessages[key], parameters)
  ), []);

  const value = useMemo<LocalizationContextValue>(() => ({
    ...resolvedLocale,
    t
  }), [resolvedLocale, t]);

  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

export function useLocalization(): LocalizationContextValue {
  const value = useContext(LocalizationContext);
  if (!value) throw new Error("useLocalization must be used within LocalizationProvider.");
  return value;
}
