import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function OAuthCallbackScreen() {
  const router = useRouter();
  const { code, provider, error } = useLocalSearchParams<{
    code?: string | string[];
    provider?: string | string[];
    error?: string | string[];
  }>();

  useEffect(() => {
    const params = new URLSearchParams();
    const oauthCode = firstValue(code);
    const oauthProvider = firstValue(provider);
    const oauthError = firstValue(error);
    if (oauthCode) params.set("oauthCode", oauthCode);
    if (oauthProvider) params.set("oauthProvider", oauthProvider);
    if (oauthError) params.set("oauthError", oauthError);
    router.replace(params.size > 0 ? `/?${params.toString()}` : "/");
  }, [code, error, provider, router]);

  return (
    <View style={styles.screen}>
      <ActivityIndicator color="#d6b55e" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: "#09060f",
    flex: 1,
    justifyContent: "center"
  }
});
