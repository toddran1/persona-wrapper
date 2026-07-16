import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";

// Android App Links resolve this HTTPS callback into the installed app. OAuth
// completion is finalized by the in-flight one-time-code poll in the chat
// screen, so this route only restores the normal application surface.
export default function MobileOAuthAppLinkCallbackScreen() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/");
  }, [router]);

  return <View style={styles.screen}><ActivityIndicator color="#d6b55e" /></View>;
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: "#09060f",
    flex: 1,
    justifyContent: "center"
  }
});
