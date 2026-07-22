import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Sharing from "expo-sharing";
import { stripGeneratedFileDownloadPrompt, type ContentBlock } from "@persona/shared";
import { Ionicons } from "@expo/vector-icons";
import { EnrichedMarkdownText, type MarkdownStyle } from "react-native-enriched-markdown";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BarChart, LineChart, PieChart } from "react-native-gifted-charts";
import { api } from "../../api/client";
import { saveFileToDevice } from "../../storage/downloadDirectory";
import type { MobileTheme } from "../../theme/personaTheme";

type OutputBlocksProps = {
  outputs: ContentBlock[];
  theme: MobileTheme;
  onAction?: ((action: Extract<ContentBlock, { type: "action" }>) => void | Promise<void>) | undefined;
};

function safeExternalUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

async function openExternalUrl(value: string): Promise<void> {
  const safeUrl = safeExternalUrl(value);
  if (!safeUrl) throw new Error("This link uses an unsupported URL scheme.");
  const canOpen = await Linking.canOpenURL(safeUrl);
  if (!canOpen) throw new Error("This link cannot be opened on this device.");
  await Linking.openURL(safeUrl);
}

function showOpenError(error: unknown): void {
  Alert.alert("Open failed", error instanceof Error ? error.message : "Could not open this link.");
}

function assertSuccessfulDownload(result: FileSystem.FileSystemDownloadResult): void {
  if (result.status < 200 || result.status >= 300) {
    void FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
    throw new Error(`The download failed with status ${result.status}.`);
  }
}

export function OutputBlocks({ outputs, theme, onAction }: OutputBlocksProps) {
  const hasFileOutput = outputs.some((output) => output.type === "file");
  const visible = outputs.filter((output) => {
    // These blocks support response actions and diagnostics. Rendering them
    // inline duplicates references and exposes provider-internal tool payloads.
    if (output.type === "source_list" || output.type === "tool_call" || output.type === "tool_result") return false;
    return output.type !== "text"
      || (hasFileOutput ? stripGeneratedFileDownloadPrompt(output.text) : output.text).trim().length > 0;
  });
  if (visible.length === 0) return null;
  return (
    <View style={styles.stack}>
      {visible.map((output, index) => (
        <OutputBlock
          key={`${output.type}-${index}`}
          output={output.type === "text" && hasFileOutput ? { ...output, text: stripGeneratedFileDownloadPrompt(output.text) } : output}
          theme={theme}
          onAction={onAction}
        />
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

function MobileCodeBlock({ code, language, theme }: { code: string; language: string; theme: MobileTheme }) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  const copy = async (): Promise<void> => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setCopied(false), 1800);
  };

  return (
    <View style={[styles.markdownCodeBlock, { borderColor: theme.border, backgroundColor: "rgba(5,4,10,0.78)" }]}>
      <View style={[styles.markdownCodeToolbar, { borderBottomColor: theme.border }]}>
        <Text style={[styles.markdownCodeLanguage, { color: theme.muted }]}>{language || "text"}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy code"
          onPress={() => void copy().catch((error) => Alert.alert("Copy failed", error instanceof Error ? error.message : "Could not copy the code."))}
          style={[styles.markdownCodeCopy, { borderColor: theme.border }]}
        >
          <Ionicons name={copied ? "checkmark" : "copy-outline"} size={14} color={copied ? theme.accent2 : theme.text} />
          <Text style={[styles.markdownCodeCopyText, { color: copied ? theme.accent2 : theme.text }]}>{copied ? "Copied" : "Copy"}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.markdownCodeScroll}>
        <Text selectable style={[styles.markdownCodeText, { color: theme.text }]}>{code}</Text>
      </ScrollView>
    </View>
  );
}

type MarkdownSegment =
  | { type: "markdown"; value: string }
  | { type: "code"; value: string; language: string };

function splitFencedCodeBlocks(markdown: string): MarkdownSegment[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const segments: MarkdownSegment[] = [];
  const pendingMarkdown: string[] = [];
  const flushMarkdown = () => {
    const value = pendingMarkdown.join("\n");
    if (value.trim()) segments.push({ type: "markdown", value });
    pendingMarkdown.length = 0;
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const opening = line.match(/^\s{0,3}(`{3,}|~{3,})\s*(.*)$/);
    if (!opening) {
      pendingMarkdown.push(line);
      index += 1;
      continue;
    }

    flushMarkdown();
    const marker = opening[1] ?? "```";
    const markerCharacter = marker[0] ?? "`";
    const closingPattern = new RegExp(`^\\s{0,3}\\${markerCharacter}{${marker.length},}\\s*$`);
    const language = (opening[2] ?? "").trim().split(/\s+/, 1)[0]?.toLowerCase() || "text";
    const code: string[] = [];
    index += 1;
    while (index < lines.length && !closingPattern.test(lines[index] ?? "")) {
      code.push(lines[index] ?? "");
      index += 1;
    }
    if (index < lines.length) index += 1;
    segments.push({ type: "code", value: code.join("\n"), language });
  }

  flushMarkdown();
  return segments;
}

function mobileMarkdownStyle(theme: MobileTheme): MarkdownStyle {
  const body = { color: theme.text, fontSize: 16, lineHeight: 23, marginBottom: 10 };
  return {
    paragraph: body,
    h1: { color: theme.text, fontSize: 24, lineHeight: 30, fontWeight: "800", marginTop: 12, marginBottom: 8 },
    h2: { color: theme.text, fontSize: 21, lineHeight: 27, fontWeight: "800", marginTop: 11, marginBottom: 7 },
    h3: { color: theme.text, fontSize: 18, lineHeight: 25, fontWeight: "800", marginTop: 10, marginBottom: 6 },
    h4: { color: theme.text, fontSize: 17, lineHeight: 24, fontWeight: "800", marginTop: 9, marginBottom: 5 },
    h5: { color: theme.text, fontSize: 16, lineHeight: 23, fontWeight: "800", marginTop: 8, marginBottom: 4 },
    h6: { color: theme.muted, fontSize: 15, lineHeight: 22, fontWeight: "800", marginTop: 8, marginBottom: 4 },
    strong: { color: theme.text, fontWeight: "bold" },
    em: { color: theme.text, fontStyle: "italic" },
    link: { color: theme.accent2, underline: true },
    code: { color: theme.accent2, backgroundColor: "rgba(0,0,0,0.32)", borderColor: theme.border, fontFamily: "Courier", fontSize: 13 },
    codeBlock: { color: theme.text, backgroundColor: "rgba(5,4,10,0.78)", borderColor: theme.border, borderRadius: 14, borderWidth: 1, padding: 13, fontFamily: "Courier", fontSize: 13, lineHeight: 20, marginBottom: 10 },
    blockquote: { color: theme.muted, fontSize: 16, lineHeight: 23, borderColor: theme.accent2, borderWidth: 3, gapWidth: 12, backgroundColor: "transparent", marginBottom: 10 },
    list: { color: theme.text, fontSize: 16, lineHeight: 23, bulletColor: theme.accent2, markerColor: theme.accent2, markerFontWeight: "bold", gapWidth: 8, marginBottom: 10 },
    thematicBreak: { color: theme.border, height: 1, marginTop: 8, marginBottom: 12 },
    table: { color: theme.muted, fontSize: 13, lineHeight: 19, headerBackgroundColor: "rgba(255,255,255,0.04)", headerTextColor: theme.text, borderColor: theme.border, borderWidth: 1, borderRadius: 12, cellPaddingHorizontal: 11, cellPaddingVertical: 9, marginBottom: 10 },
    taskList: { checkedColor: theme.accent2, borderColor: theme.border, checkmarkColor: theme.text, checkedTextColor: theme.muted }
  };
}

function MobileMarkdownText({ text, theme }: { text: string; theme: MobileTheme }) {
  const markdownStyle = mobileMarkdownStyle(theme);
  return (
    <View style={styles.markdownStack}>
      {splitFencedCodeBlocks(text).map((segment, index) => segment.type === "code" ? (
        <MobileCodeBlock key={`code-${index}`} code={segment.value} language={segment.language} theme={theme} />
      ) : (
        <EnrichedMarkdownText
          key={`markdown-${index}`}
          markdown={segment.value}
          flavor="github"
          markdownStyle={markdownStyle}
          containerStyle={styles.markdownNativeContainer}
          selectable
          selectionColor={theme.accent2}
          selectionHandleColor={theme.accent2}
          md4cFlags={{ latexMath: false }}
          selectionMenuConfig={{ copyAsMarkdown: { enabled: true }, copyImageUrl: { enabled: false } }}
          onLinkPress={({ url }) => void openExternalUrl(url).catch(showOpenError)}
        />
      ))}
    </View>
  );
}

function MobileChartBlock({ output, theme }: { output: Extract<ContentBlock, { type: "chart" }>; theme: MobileTheme }) {
  const colors = [theme.accent2, theme.accent, "#e06f9f", "#69c4b1", "#ef8d5b", "#7899e8"];
  const data = output.series.map((point, index) => ({
    value: point.value,
    label: point.label,
    text: point.label,
    color: colors[index % colors.length] ?? theme.accent2,
    frontColor: colors[index % colors.length] ?? theme.accent2
  }));
  const axisTextStyle = { color: theme.muted, fontSize: 10 };

  return (
    <View accessibilityLabel={`${output.title}, ${output.chartType} chart`} style={[styles.dataCard, { borderColor: theme.border }]}>
      <Text style={[styles.dataEyebrow, { color: theme.accent2 }]}>{output.chartType} chart</Text>
      <Text style={[styles.dataTitle, { color: theme.text }]}>{output.title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chartScroll}>
        {output.chartType === "pie" ? (
          <PieChart data={data} donut showText textColor={theme.text} radius={92} innerRadius={48} />
        ) : output.chartType === "line" ? (
          <LineChart data={data} color={theme.accent2} dataPointsColor={theme.accent} thickness={3} yAxisTextStyle={axisTextStyle} xAxisLabelTextStyle={axisTextStyle} rulesColor="rgba(255,255,255,0.08)" hideDataPoints={false} />
        ) : (
          <BarChart data={data} barWidth={28} spacing={24} yAxisTextStyle={axisTextStyle} xAxisLabelTextStyle={axisTextStyle} rulesColor="rgba(255,255,255,0.08)" />
        )}
      </ScrollView>
    </View>
  );
}

function JsonCard({ title, value, theme }: { title: string; value: unknown; theme: MobileTheme }) {
  const text = JSON.stringify(value, null, 2) ?? String(value);
  return (
    <View style={[styles.dataCard, { borderColor: theme.border }]}>
      <Text style={[styles.dataEyebrow, { color: theme.accent2 }]}>{title}</Text>
      <MobileCodeBlock code={text} language="json" theme={theme} />
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
    return <MobileMarkdownText text={output.text} theme={theme} />;
  }
  if (output.type === "json") {
    return <JsonCard title="JSON" value={output.data} theme={theme} />;
  }
  if (output.type === "chart") {
    return <MobileChartBlock output={output} theme={theme} />;
  }
  if (output.type === "table") {
    return (
      <View style={[styles.dataCard, { borderColor: theme.border }]}>
        {output.title ? <Text style={[styles.dataTitle, { color: theme.text }]}>{output.title}</Text> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            <View style={[styles.tableRow, styles.tableHeader, { borderColor: theme.border }]}>
              {output.columns.map((column) => <Text key={column} style={[styles.tableCell, styles.tableHeaderText, { color: theme.text }]}>{column}</Text>)}
            </View>
            {output.rows.map((row, rowIndex) => (
              <View key={`row-${rowIndex}`} style={[styles.tableRow, { borderColor: theme.border }]}>
                {row.map((cell, cellIndex) => <Text key={`${rowIndex}-${cellIndex}`} style={[styles.tableCell, { color: theme.muted }]}>{cell === null ? "—" : String(cell)}</Text>)}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }
  if (output.type === "tool_call") {
    return <JsonCard title={`${output.toolName.replace(/_/g, " ")} · ${output.status}`} value={output.arguments} theme={theme} />;
  }
  if (output.type === "tool_result") {
    return <JsonCard title={`${output.toolName.replace(/_/g, " ")} · ${output.status}`} value={output.result ?? {}} theme={theme} />;
  }
  if (output.type === "source_list") {
    return (
      <View style={[styles.dataCard, { borderColor: theme.border }]}>
        <Text style={[styles.dataTitle, { color: theme.text }]}>Sources</Text>
        {output.sources.map((source, index) => (
          <Pressable key={`${source.url}-${index}`} accessibilityRole="link" onPress={() => void openExternalUrl(source.url).catch(showOpenError)} style={styles.sourceRow}>
            <Text style={[styles.sourceIndex, { color: theme.accent2 }]}>{index + 1}</Text>
            <View style={styles.sourceCopy}>
              <Text style={[styles.sourceTitle, { color: theme.text }]}>{source.title}</Text>
              {source.snippet ? <Text numberOfLines={3} style={[styles.caption, { color: theme.muted }]}>{source.snippet}</Text> : null}
            </View>
            <Ionicons name="open-outline" size={15} color={theme.muted} />
          </Pressable>
        ))}
      </View>
    );
  }
  if (output.type === "image") {
    return <ImageOutputBlock output={output} theme={theme} />;
  }
  if (output.type === "file" || output.type === "video") {
    const title = output.type === "file" ? output.fileName : output.title ?? "Video";
    const downloadFile = async (): Promise<{ uri: string; mimeType: string; fileName: string }> => {
      if (output.type !== "file") throw new Error("Only files can be downloaded to this device.");
      if (!FileSystem.cacheDirectory) throw new Error("File downloads are unavailable on this device.");
      const safeFileName = output.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const destination = `${FileSystem.cacheDirectory}download-${Date.now().toString(36)}-${safeFileName}`;
      const result = await FileSystem.downloadAsync(
        api.resolveUrl(output.url),
        destination,
        api.isProtectedMediaUrl(output.url) ? { headers: await api.mediaHeaders() } : undefined
      );
      assertSuccessfulDownload(result);
      return { uri: result.uri, mimeType: output.mimeType, fileName: output.fileName };
    };
    const saveOutputToDevice = async (): Promise<void> => {
      const downloaded = await downloadFile();
      try {
        const saved = await saveFileToDevice(downloaded.uri, downloaded.fileName, downloaded.mimeType);
        if (saved === "saved") Alert.alert("Downloaded", `Saved ${downloaded.fileName} to your selected device folder.`);
      } finally {
        await FileSystem.deleteAsync(downloaded.uri, { idempotent: true }).catch(() => undefined);
      }
    };
    const shareOutput = async (): Promise<void> => {
      const downloaded = await downloadFile();
      try {
        if (!await Sharing.isAvailableAsync()) throw new Error("No compatible app is available to share this file.");
        await Sharing.shareAsync(downloaded.uri, { mimeType: downloaded.mimeType, dialogTitle: `Share ${downloaded.fileName}` });
      } finally {
        await FileSystem.deleteAsync(downloaded.uri, { idempotent: true }).catch(() => undefined);
      }
    };
    const openOutput = async (): Promise<void> => {
      if (output.type !== "file") {
        await openExternalUrl(api.resolveUrl(output.url));
        return;
      }
      if (Platform.OS !== "android") {
        await shareOutput();
        return;
      }
      Alert.alert("Download file", output.fileName, [
        { text: "Save to device", onPress: () => void saveOutputToDevice().catch((error) => Alert.alert("Download failed", error instanceof Error ? error.message : "Could not save this file.")) },
        { text: "Share", onPress: () => void shareOutput().catch((error) => Alert.alert("Share failed", error instanceof Error ? error.message : "Could not share this file.")) },
        { text: "Cancel", style: "cancel" }
      ]);
    };
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${output.type === "file" ? "Download" : "Open"} ${title}`}
        style={[styles.linkCard, { borderColor: theme.border, backgroundColor: "rgba(255,255,255,0.045)" }]}
        onPress={() => {
          void openOutput().catch((openError) => {
            Alert.alert("Open failed", openError instanceof Error ? openError.message : "Could not open this file.");
          });
        }}
      >
        <Ionicons name="document-text-outline" size={22} color={theme.accent2} />
        <View style={styles.linkCopy}>
          <Text style={[styles.linkTitle, { color: theme.text }]}>{title}</Text>
          <Text style={[styles.caption, { color: theme.muted }]}>{output.type === "file" ? "Tap to download" : "Tap to open"}</Text>
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
        onPress={() => {
          void Promise.resolve(onAction?.(output)).catch((actionError) => {
            Alert.alert("Action failed", actionError instanceof Error ? actionError.message : "Could not complete this action.");
          });
        }}
        style={[styles.actionButton, { borderColor: theme.border, backgroundColor: output.style === "primary" ? "rgba(214,181,94,0.12)" : "rgba(255,255,255,0.045)" }]}
      >
        <Text style={[styles.actionText, { color: theme.text }]}>{output.label}</Text>
      </Pressable>
    );
  }
  if (output.type === "code") {
    return <MobileCodeBlock code={output.code} language={output.language ?? output.title ?? "text"} theme={theme} />;
  }
  return null;
}

function ImageOutputBlock({
  output,
  theme
}: {
  output: Extract<ContentBlock, { type: "image" }>;
  theme: MobileTheme;
}) {
  const insets = useSafeAreaInsets();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [localImageUri, setLocalImageUri] = useState<string | undefined>();
  const [imageError, setImageError] = useState<string | undefined>();
  const cacheKeyRef = useRef(`persona-image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`);
  const imageUrl = api.resolveUrl(output.url);
  const promptText = output.prompt ?? output.alt;
  const usesProtectedFetch = api.isProtectedMediaUrl(output.url);
  const displayImageUri = usesProtectedFetch ? localImageUri : imageUrl;

  useEffect(() => {
    let cancelled = false;
    let downloadedUri: string | undefined;

    async function loadProtectedImage(): Promise<void> {
      setImageError(undefined);
      setLocalImageUri(undefined);
      if (!usesProtectedFetch || !FileSystem.cacheDirectory) return;

      try {
        const destination = `${FileSystem.cacheDirectory}${cacheKeyRef.current}-${fileNameFromUrl(imageUrl, output.mimeType)}`;
        const result = await FileSystem.downloadAsync(imageUrl, destination, {
          headers: await api.mediaHeaders()
        });
        assertSuccessfulDownload(result);
        if (cancelled) {
          await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
          return;
        }
        downloadedUri = result.uri;
        setLocalImageUri(result.uri);
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
  }, [imageUrl, output.mimeType, output.url, usesProtectedFetch]);

  function extensionForMimeType(mimeType?: string): string {
    if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
    if (mimeType === "image/webp") return "webp";
    if (mimeType === "image/gif") return "gif";
    return "png";
  }

  function fileNameFromUrl(url: string, mimeType?: string): string {
    const cleanPath = url.split("?")[0] ?? "";
    const lastSegment = cleanPath.split("/").pop();
    const extension = extensionForMimeType(mimeType);
    const rawName = lastSegment?.trim() || `persona-image-${Date.now()}`;
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, "-");
    return /\.[a-zA-Z0-9]{2,5}$/.test(safeName) ? safeName : `${safeName}.${extension}`;
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
      await openExternalUrl(imageUrl);
    } catch (openError) {
      Alert.alert("Open failed", openError instanceof Error ? openError.message : "Could not open the original image.");
    }
  }

  async function downloadImage(): Promise<void> {
    if (!FileSystem.cacheDirectory) {
      Alert.alert("Download unavailable", "Temporary storage is not available on this device.");
      return;
    }
    let temporaryUri: string | undefined;
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(false);
      if (!permission.granted) {
        Alert.alert("Photos unavailable", "Allow photo access to save generated images.");
        return;
      }
      if (localImageUri) {
        await MediaLibrary.saveToLibraryAsync(localImageUri);
      } else {
        const destination = `${FileSystem.cacheDirectory}download-${Date.now().toString(36)}-${fileNameFromUrl(imageUrl, output.mimeType)}`;
        const downloadOptions = api.isProtectedMediaUrl(output.url) ? { headers: await api.mediaHeaders() } : undefined;
        const result = await FileSystem.downloadAsync(imageUrl, destination, downloadOptions);
        assertSuccessfulDownload(result);
        temporaryUri = result.uri;
        await MediaLibrary.saveToLibraryAsync(result.uri);
      }
      Alert.alert("Downloaded", "Saved image to your photo library.");
    } catch (downloadError) {
      Alert.alert("Download failed", downloadError instanceof Error ? downloadError.message : "Could not download the image.");
    } finally {
      if (temporaryUri) {
        await FileSystem.deleteAsync(temporaryUri, { idempotent: true }).catch(() => undefined);
      }
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
            <Image accessible={false} source={{ uri: displayImageUri }} style={styles.image} resizeMode="cover" onError={() => setImageError("Could not load this image.")} />
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
      <Modal accessibilityViewIsModal visible={viewerOpen} animationType="fade" presentationStyle="fullScreen" onRequestClose={() => setViewerOpen(false)}>
        <View
          style={[
            styles.viewer,
            {
              backgroundColor: theme.background,
              paddingTop: Math.max(insets.top + 8, 20),
              paddingBottom: Math.max(insets.bottom + 12, 20)
            }
          ]}
        >
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
            <Image accessibilityLabel={output.alt} source={{ uri: displayImageUri }} style={styles.viewerImage} resizeMode="contain" />
          ) : (
            <View style={[styles.viewerImage, styles.viewerLoading]}>
              <ActivityIndicator color={theme.accent2} />
            </View>
          )}
          <View style={styles.viewerActions}>
            <Pressable accessibilityRole="button" onPress={() => void openOriginal()} style={[styles.viewerActionButton, { borderColor: theme.border }]}>
              <Ionicons name="open-outline" size={18} color={theme.text} />
              <Text style={[styles.viewerActionText, { color: theme.text }]}>Open original</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => void downloadImage()} style={[styles.viewerActionButton, { borderColor: theme.border }]}>
              <Ionicons name="download-outline" size={18} color={theme.text} />
              <Text style={[styles.viewerActionText, { color: theme.text }]}>Download</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => void copyPrompt()} style={[styles.viewerActionButton, { borderColor: theme.border }]}>
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
  chartScroll: {
    minHeight: 220,
    paddingHorizontal: 4,
    paddingVertical: 10
  },
  dataCard: {
    backgroundColor: "rgba(8,6,14,0.42)",
    borderRadius: 18,
    borderWidth: 1,
    gap: 9,
    overflow: "hidden",
    padding: 12
  },
  dataEyebrow: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase"
  },
  dataTitle: {
    fontSize: 16,
    fontWeight: "800"
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
  markdownCodeBlock: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden"
  },
  markdownCodeCopy: {
    alignItems: "center",
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    minHeight: 28,
    paddingHorizontal: 8
  },
  markdownCodeCopyText: {
    fontSize: 12,
    fontWeight: "800"
  },
  markdownCodeLanguage: {
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "lowercase"
  },
  markdownCodeScroll: {
    minWidth: "100%",
    padding: 13
  },
  markdownCodeText: {
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 20
  },
  markdownCodeToolbar: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 39,
    paddingHorizontal: 10
  },
  markdownNativeContainer: {
    width: "100%"
  },
  markdownStack: {
    gap: 10
  },
  stack: {
    gap: 10
  },
  sourceCopy: {
    flex: 1,
    gap: 3
  },
  sourceIndex: {
    fontSize: 12,
    fontWeight: "900",
    width: 18
  },
  sourceRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
    paddingVertical: 7
  },
  sourceTitle: {
    fontSize: 13,
    fontWeight: "800"
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
  tableCell: {
    fontSize: 12,
    lineHeight: 17,
    minWidth: 120,
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  tableHeader: {
    backgroundColor: "rgba(255,255,255,0.055)"
  },
  tableHeaderText: {
    fontWeight: "800"
  },
  tableRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row"
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
    paddingHorizontal: 14
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
