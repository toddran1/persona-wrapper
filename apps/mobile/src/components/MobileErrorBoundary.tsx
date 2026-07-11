import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type MobileErrorBoundaryProps = {
  children: ReactNode;
};

type MobileErrorBoundaryState = {
  error: Error | null;
  resetKey: number;
};

export class MobileErrorBoundary extends Component<MobileErrorBoundaryProps, MobileErrorBoundaryState> {
  state: MobileErrorBoundaryState = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<MobileErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Mobile application render failed", { error, componentStack: info.componentStack });
  }

  private retry = (): void => {
    this.setState((state) => ({ error: null, resetKey: state.resetKey + 1 }));
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <View accessibilityRole="alert" style={styles.screen}>
          <View style={styles.card}>
            <Text style={styles.eyebrow}>APPLICATION ERROR</Text>
            <Text style={styles.title}>Something went wrong.</Text>
            <Text style={styles.message}>The app hit an unexpected error. Try restoring the screen. If it happens again, close and reopen the app.</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Try loading the app again" onPress={this.retry} style={styles.button}>
              <Text style={styles.buttonText}>Try again</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    return <View key={this.state.resetKey} style={styles.content}>{this.props.children}</View>;
  }
}

const styles = StyleSheet.create({
  content: {
    flex: 1
  },
  screen: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#09060f"
  },
  card: {
    padding: 24,
    borderWidth: 1,
    borderColor: "rgba(214,181,94,0.28)",
    borderRadius: 8,
    backgroundColor: "#151020"
  },
  eyebrow: {
    color: "#d6b55e",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.4
  },
  title: {
    marginTop: 10,
    color: "#f7efe8",
    fontSize: 28,
    fontWeight: "800"
  },
  message: {
    marginTop: 12,
    color: "#c8bdd8",
    fontSize: 16,
    lineHeight: 24
  },
  button: {
    alignSelf: "flex-start",
    marginTop: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "#8a5cf6"
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800"
  }
});
