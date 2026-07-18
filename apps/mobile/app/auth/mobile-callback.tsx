import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";

// Android App Links resolve this HTTPS callback into the installed app. OAuth
// Better Auth's Expo plugin completes OAuth inside its auth-session browser.
// This legacy App Link now only returns older links to the main app surface.
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
