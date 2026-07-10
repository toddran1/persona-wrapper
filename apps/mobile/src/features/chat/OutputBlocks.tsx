import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import type { ContentBlock } from "@persona/shared";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../api/client";
import type { MobileTheme } from "../../theme/personaTheme";

type OutputBlocksProps = {
  outputs: ContentBlock[];
  theme: MobileTheme;
  onAction?: ((action: Extract<ContentBlock, { type: "action" }>) => void | Promise<void>) | undefined;
};

export function OutputBlocks({ outputs, theme, onAction }: OutputBlocksProps) {
  const visible = outputs.filter((output) => output.type !== "text" || output.text.trim().length > 0);
  if (visible.length === 0) return null;
  return (
    <View style={styles.stack}>
      {visible.map((output, index) => (
        <OutputBlock key={`${output.type}-${index}`} output={output} theme={theme} onAction={onAction} />
      ))}
    </View>
  );
}

function ThinkingDots({ theme }: { theme: MobileTheme }) {
  const [step, setStep] = useState(1);

  useEffect(() => {
    const interval = setInterval(() => {
      setStep((current) => current >= 3 ? 1 : current + 1);
    }, 420);
    return () => clearInterval(interval);
  }, []);

  return (
    <View style={[styles.thinkingBubble, { backgroundColor: "rgba(138,92,246,0.24)" }]}>
      <Text style={[styles.thinkingText, { color: theme.accent2 }]}>Thinking{".".repeat(step)}</Text>
    </View>
  );
}

function OutputBlock({
  output,
  theme,
  onAction
}: {
  output: ContentBlock;
  theme: MobileTheme;
  onAction?: ((action: Extract<ContentBlock, { type: "action" }>) => void | Promise<void>) | undefined;
}) {
  if (output.type === "text") {
    return <Text style={[styles.assistantText, { color: theme.text }]}>{output.text}</Text>;
  }
  if (output.type === "image") {
    return <ImageOutputBlock output={output} theme={theme} />;
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
    if (output.status === "in_progress" && /\bthinking\b/i.test(output.message)) {
      return <ThinkingDots theme={theme} />;
    }
    return (
      <View style={[styles.status, { borderColor: theme.border }]}>
        <Text style={[styles.statusText, { color: theme.muted }]}>{output.message}</Text>
      </View>
    );
  }
  if (output.type === "action") {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => void onAction?.(output)}
        style={[styles.actionButton, { borderColor: theme.border, backgroundColor: output.style === "primary" ? "rgba(214,181,94,0.12)" : "rgba(255,255,255,0.045)" }]}
      >
        <Text style={[styles.actionText, { color: theme.text }]}>{output.label}</Text>
      </Pressable>
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

function ImageOutputBlock({
  output,
  theme
}: {
  output: Extract<ContentBlock, { type: "image" }>;
  theme: MobileTheme;
}) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [localImageUri, setLocalImageUri] = useState<string | undefined>();
  const [imageError, setImageError] = useState<string | undefined>();
  const imageUrl = api.resolveUrl(output.url);
  const promptText = output.prompt ?? output.alt;
  const usesProtectedFetch = shouldFetchWithAuth(output.url);
  const displayImageUri = usesProtectedFetch ? localImageUri : imageUrl;

  useEffect(() => {
    let cancelled = false;
    let downloadedUri: string | undefined;

    async function loadProtectedImage(): Promise<void> {
      setImageError(undefined);
      setLocalImageUri(undefined);
      if (!usesProtectedFetch || !FileSystem.cacheDirectory) return;

      try {
        const destination = `${FileSystem.cacheDirectory}${fileNameFromUrl(imageUrl)}`;
        const result = await FileSystem.downloadAsync(imageUrl, destination, {
          headers: await api.mediaHeaders()
        });
        downloadedUri = result.uri;
        if (!cancelled) setLocalImageUri(result.uri);
      } catch (loadError) {
        if (!cancelled) {
          setImageError(loadError instanceof Error ? loadError.message : "Could not load this image.");
        }
      }
    }

    void loadProtectedImage();

    return () => {
      cancelled = true;
      if (downloadedUri) void FileSystem.deleteAsync(downloadedUri, { idempotent: true }).catch(() => undefined);
    };
  }, [imageUrl, output.url, usesProtectedFetch]);

  function shouldFetchWithAuth(url: string): boolean {
    return url.startsWith("/api/") || imageUrl.includes("/api/");
  }

  function fileNameFromUrl(url: string): string {
    const cleanPath = url.split("?")[0] ?? "";
    const lastSegment = cleanPath.split("/").pop();
    const fileName = lastSegment?.trim() || `persona-image-${Date.now()}.png`;
    return fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
  }

  async function copyPrompt(): Promise<void> {
    try {
      await Clipboard.setStringAsync(promptText);
      Alert.alert("Copied", "Image prompt copied.");
    } catch (copyError) {
      Alert.alert("Copy failed", copyError instanceof Error ? copyError.message : "Could not copy the image prompt.");
    }
  }

  async function openOriginal(): Promise<void> {
    try {
      const canOpen = await Linking.canOpenURL(imageUrl);
      if (!canOpen) throw new Error("This image URL cannot be opened on this device.");
      await Linking.openURL(imageUrl);
    } catch (openError) {
      Alert.alert("Open failed", openError instanceof Error ? openError.message : "Could not open the original image.");
    }
  }

  async function downloadImage(): Promise<void> {
    if (!FileSystem.documentDirectory) {
      Alert.alert("Download unavailable", "The app document directory is not available on this device.");
      return;
    }
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(false);
      if (!permission.granted) {
        Alert.alert("Photos unavailable", "Allow photo access to save generated images.");
        return;
      }
      if (localImageUri) {
        await MediaLibrary.saveToLibraryAsync(localImageUri);
      } else {
        const destination = `${FileSystem.documentDirectory}${fileNameFromUrl(imageUrl)}`;
        const downloadOptions = shouldFetchWithAuth(output.url) ? { headers: await api.mediaHeaders() } : undefined;
        const result = await FileSystem.downloadAsync(imageUrl, destination, downloadOptions);
        await MediaLibrary.saveToLibraryAsync(result.uri);
      }
      Alert.alert("Downloaded", "Saved image to your photo library.");
    } catch (downloadError) {
      Alert.alert("Download failed", downloadError instanceof Error ? downloadError.message : "Could not download the image.");
    }
  }

  function showImageMenu(): void {
    Alert.alert("Image actions", undefined, [
      { text: "Open original", onPress: () => void openOriginal() },
      { text: "Download", onPress: () => void downloadImage() },
      { text: "Copy prompt", onPress: () => void copyPrompt() },
      { text: "Cancel", style: "cancel" }
    ]);
  }

  return (
    <>
      <View style={[styles.mediaCard, { borderColor: theme.border, backgroundColor: "rgba(255,255,255,0.045)" }]}>
        <Pressable accessibilityRole="imagebutton" accessibilityLabel="Open generated image" onPress={() => setViewerOpen(true)} style={styles.imageButton}>
          {displayImageUri ? (
            <Image source={{ uri: displayImageUri }} style={styles.image} resizeMode="cover" onError={() => setImageError("Could not load this image.")} />
          ) : (
            <View style={styles.image} />
          )}
          {!displayImageUri && !imageError ? (
            <View style={styles.imageOverlay}>
              <ActivityIndicator color={theme.accent2} />
            </View>
          ) : null}
          {imageError ? (
            <View style={styles.imageOverlay}>
              <Ionicons name="image-outline" size={28} color={theme.muted} />
              <Text style={[styles.imageErrorText, { color: theme.muted }]}>Image failed to load</Text>
            </View>
          ) : null}
        </Pressable>
        <View style={styles.imageFooter}>
          <Pressable accessibilityRole="button" accessibilityLabel="More image actions" onPress={showImageMenu} style={styles.imageIconButton}>
            <Ionicons name="ellipsis-horizontal" size={17} color={theme.text} />
          </Pressable>
        </View>
      </View>
      <Modal visible={viewerOpen} animationType="fade" presentationStyle="fullScreen" onRequestClose={() => setViewerOpen(false)}>
        <View style={[styles.viewer, { backgroundColor: theme.background }]}>
          <View style={styles.viewerTopBar}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close image viewer" onPress={() => setViewerOpen(false)} style={styles.viewerIconButton}>
              <Ionicons name="close" size={22} color={theme.text} />
            </Pressable>
            <Text style={[styles.viewerTitle, { color: theme.text }]} numberOfLines={1}>{output.alt}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="More image actions" onPress={showImageMenu} style={styles.viewerIconButton}>
              <Ionicons name="ellipsis-horizontal" size={22} color={theme.text} />
            </Pressable>
          </View>
          {displayImageUri ? (
            <Image source={{ uri: displayImageUri }} style={styles.viewerImage} resizeMode="contain" />
          ) : (
            <View style={[styles.viewerImage, styles.viewerLoading]}>
              <ActivityIndicator color={theme.accent2} />
            </View>
          )}
          <View style={styles.viewerActions}>
            <Pressable onPress={() => void openOriginal()} style={[styles.viewerActionButton, { borderColor: theme.border }]}>
              <Ionicons name="open-outline" size={18} color={theme.text} />
              <Text style={[styles.viewerActionText, { color: theme.text }]}>Open original</Text>
            </Pressable>
            <Pressable onPress={() => void downloadImage()} style={[styles.viewerActionButton, { borderColor: theme.border }]}>
              <Ionicons name="download-outline" size={18} color={theme.text} />
              <Text style={[styles.viewerActionText, { color: theme.text }]}>Download</Text>
            </Pressable>
            <Pressable onPress={() => void copyPrompt()} style={[styles.viewerActionButton, { borderColor: theme.border }]}>
              <Ionicons name="copy-outline" size={18} color={theme.text} />
              <Text style={[styles.viewerActionText, { color: theme.text }]}>Copy prompt</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  assistantText: {
    fontSize: 16,
    lineHeight: 23
  },
  actionButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  actionText: {
    fontSize: 13,
    fontWeight: "800"
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
  imageButton: {
    position: "relative"
  },
  imageErrorText: {
    fontSize: 12,
    fontWeight: "800",
    marginTop: 8
  },
  imageFooter: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "flex-end"
  },
  imageIconButton: {
    alignItems: "center",
    borderRadius: 999,
    height: 32,
    justifyContent: "center",
    width: 32
  },
  imageOverlay: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
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
  },
  thinkingBubble: {
    alignSelf: "flex-start",
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingVertical: 12
  },
  thinkingText: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.9,
    textTransform: "uppercase"
  },
  viewer: {
    flex: 1,
    paddingBottom: 28,
    paddingHorizontal: 14,
    paddingTop: 56
  },
  viewerActionButton: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 13,
    paddingVertical: 10
  },
  viewerActionText: {
    fontSize: 13,
    fontWeight: "800"
  },
  viewerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    justifyContent: "center",
    paddingTop: 14
  },
  viewerIconButton: {
    alignItems: "center",
    borderRadius: 999,
    height: 42,
    justifyContent: "center",
    width: 42
  },
  viewerImage: {
    flex: 1,
    width: "100%"
  },
  viewerLoading: {
    alignItems: "center",
    justifyContent: "center"
  },
  viewerTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center"
  },
  viewerTopBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: 46
  }
});
