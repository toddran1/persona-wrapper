import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { ContentBlock } from "@persona/shared";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../api/client";
import type { MobileTheme } from "../../theme/personaTheme";

type OutputBlocksProps = {
  outputs: ContentBlock[];
  theme: MobileTheme;
};

export function OutputBlocks({ outputs, theme }: OutputBlocksProps) {
  const visible = outputs.filter((output) => output.type !== "text" || output.text.trim().length > 0);
  if (visible.length === 0) return null;
  return (
    <View style={styles.stack}>
      {visible.map((output, index) => (
        <OutputBlock key={`${output.type}-${index}`} output={output} theme={theme} />
      ))}
    </View>
  );
}

function OutputBlock({ output, theme }: { output: ContentBlock; theme: MobileTheme }) {
  if (output.type === "text") {
    return <Text style={[styles.assistantText, { color: theme.text }]}>{output.text}</Text>;
  }
  if (output.type === "image") {
    return (
      <View style={[styles.mediaCard, { borderColor: theme.border, backgroundColor: "rgba(255,255,255,0.045)" }]}>
        <Image source={{ uri: api.resolveUrl(output.url) }} style={styles.image} resizeMode="cover" />
        <Text style={[styles.caption, { color: theme.muted }]} numberOfLines={2}>{output.alt}</Text>
      </View>
    );
  }
  if (output.type === "audio" || output.type === "file" || output.type === "video") {
    const title = output.type === "audio" ? "Audio response" : output.type === "file" ? output.fileName : output.title ?? "Video";
    return (
      <Pressable
        style={[styles.linkCard, { borderColor: theme.border, backgroundColor: "rgba(255,255,255,0.045)" }]}
        onPress={() => Linking.openURL(api.resolveUrl(output.url))}
      >
        <Ionicons name={output.type === "audio" ? "play-circle" : "document-text-outline"} size={22} color={theme.accent2} />
        <View style={styles.linkCopy}>
          <Text style={[styles.linkTitle, { color: theme.text }]}>{title}</Text>
          <Text style={[styles.caption, { color: theme.muted }]}>{output.mimeType}</Text>
        </View>
      </Pressable>
    );
  }
  if (output.type === "status") {
    return (
      <View style={[styles.status, { borderColor: theme.border }]}>
        <Text style={[styles.statusText, { color: theme.muted }]}>{output.message}</Text>
      </View>
    );
  }
  if (output.type === "code") {
    return (
      <View style={[styles.codeBlock, { borderColor: theme.border }]}>
        {output.title ? <Text style={[styles.codeTitle, { color: theme.accent2 }]}>{output.title}</Text> : null}
        <Text style={[styles.codeText, { color: theme.text }]}>{output.code}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.status, { borderColor: theme.border }]}>
      <Text style={[styles.statusText, { color: theme.muted }]}>{output.type.replace(/_/g, " ")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  assistantText: {
    fontSize: 16,
    lineHeight: 23
  },
  caption: {
    fontSize: 12,
    lineHeight: 17
  },
  codeBlock: {
    backgroundColor: "rgba(0,0,0,0.22)",
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 12
  },
  codeText: {
    fontFamily: "Courier",
    fontSize: 12,
    lineHeight: 17
  },
  codeTitle: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase"
  },
  image: {
    aspectRatio: 1,
    borderRadius: 16,
    width: "100%"
  },
  linkCard: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 12
  },
  linkCopy: {
    flex: 1,
    minWidth: 0
  },
  linkTitle: {
    fontSize: 14,
    fontWeight: "700"
  },
  mediaCard: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 9,
    padding: 8
  },
  stack: {
    gap: 10
  },
  status: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 10
  },
  statusText: {
    fontSize: 13,
    lineHeight: 18
  }
});
