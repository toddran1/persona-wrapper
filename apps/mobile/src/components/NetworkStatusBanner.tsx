import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalization } from "../localization/LocalizationProvider";
import { useNetwork } from "../network/NetworkProvider";
import type { MobileTheme } from "../theme/personaTheme";

type NetworkStatusBannerProps = {
  theme: MobileTheme;
  onRetry?: () => void;
};

export function NetworkStatusBanner({ theme, onRetry }: NetworkStatusBannerProps) {
  const { status, recentlyRestored, retry } = useNetwork();
  const { t } = useLocalization();
  const visible = status === "offline" || status === "checking" || recentlyRestored;
  if (!visible) return null;

  const restored = status === "online" && recentlyRestored;
  const checking = status === "checking";
  const title = restored ? t("network.restored") : checking ? t("network.checking") : t("network.offlineTitle");

  const handleRetry = async (): Promise<void> => {
    if (await retry()) onRetry?.();
  };

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        styles.banner,
        {
          backgroundColor: restored ? "rgba(67,171,122,0.16)" : "rgba(214,181,94,0.12)",
          borderColor: restored ? "rgba(91,210,151,0.48)" : theme.border
        }
      ]}
    >
      <Ionicons name={restored ? "checkmark-circle-outline" : "cloud-offline-outline"} size={20} color={restored ? "#72d9a7" : theme.accent2} />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
        {!restored && !checking ? <Text style={[styles.body, { color: theme.muted }]}>{t("network.offlineBody")}</Text> : null}
      </View>
      {!restored ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("network.retry")}
          disabled={checking}
          onPress={() => void handleRetry()}
          style={[styles.retry, { borderColor: theme.border, opacity: checking ? 0.55 : 1 }]}
        >
          <Text style={[styles.retryText, { color: theme.text }]}>{t("network.retry")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginHorizontal: 12,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  body: {
    fontSize: 12,
    lineHeight: 16
  },
  copy: {
    flex: 1,
    gap: 2
  },
  retry: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12
  },
  retryText: {
    fontSize: 12,
    fontWeight: "800"
  },
  title: {
    fontSize: 13,
    fontWeight: "900"
  }
});
