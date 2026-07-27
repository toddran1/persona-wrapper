import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { Alert, AppState } from "react-native";
import { createAudioPlayer, setAudioModeAsync, setIsAudioActiveAsync, type AudioPlayer } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "../../api/client";
import type { RenderedTurn } from "./types";

type AudioOutput = Extract<RenderedTurn["outputs"][number], { type: "audio" }>;
type AudioPlaybackSubscription = { remove: () => void };

function audioFileExtension(mimeType: string): string {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("mp4")) return "m4a";
  return "audio";
}

function isManagedAudioCacheUri(uri: string | undefined): uri is string {
  const cacheDirectory = FileSystem.cacheDirectory;
  return Boolean(uri && cacheDirectory && uri.startsWith(cacheDirectory));
}

export function usePersonaAudio() {
  const [audioEnabled, setAudioEnabled] = useState(false);
  const audioEnabledRef = useRef(false);
  const playerRef = useRef<AudioPlayer | undefined>(undefined);
  const uriRef = useRef<string | undefined>(undefined);
  const subscriptionRef = useRef<AudioPlaybackSubscription | undefined>(undefined);
  const generationRef = useRef(0);

  const release = useCallback(async (): Promise<void> => {
    generationRef.current += 1;
    const player = playerRef.current;
    const uri = uriRef.current;
    const subscription = subscriptionRef.current;
    playerRef.current = undefined;
    uriRef.current = undefined;
    subscriptionRef.current = undefined;
    subscription?.remove();
    try {
      player?.pause();
      player?.remove();
    } catch {
      // The native player may already have released itself after an interruption.
    }
    if (isManagedAudioCacheUri(uri)) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    }
    // Audio activation can succeed before player construction does. Always
    // deactivate the native session, even when there is no player to release.
    await setIsAudioActiveAsync(false).catch(() => undefined);
  }, []);

  const prepareAudioUri = useCallback(async (output: AudioOutput): Promise<string> => {
    const audioUrl = api.resolveUrl(output.url);
    if (!FileSystem.cacheDirectory) return audioUrl;

    const destination = `${FileSystem.cacheDirectory}persona-audio-${Date.now()}.${audioFileExtension(output.mimeType)}`;
    const downloadOptions = api.isProtectedMediaUrl(output.url) ? { headers: await api.mediaHeaders() } : undefined;
    const result = await FileSystem.downloadAsync(audioUrl, destination, downloadOptions);
    if (result.status < 200 || result.status >= 300) {
      await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
      throw new Error(`Audio download failed with status ${result.status}.`);
    }
    const info = await FileSystem.getInfoAsync(result.uri);
    if (!info.exists || info.size === 0) {
      await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
      throw new Error("Downloaded audio file was empty.");
    }
    return result.uri;
  }, []);

  const replay = useCallback(async (output: AudioOutput): Promise<void> => {
    let pendingAudioUri: string | undefined;
    try {
      await release();
      const playbackGeneration = generationRef.current;
      pendingAudioUri = await prepareAudioUri(output);
      if (playbackGeneration !== generationRef.current || AppState.currentState !== "active") {
        if (isManagedAudioCacheUri(pendingAudioUri)) {
          await FileSystem.deleteAsync(pendingAudioUri, { idempotent: true }).catch(() => undefined);
        }
        return;
      }
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: "duckOthers",
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false
      });
      await setIsAudioActiveAsync(true);
      if (playbackGeneration !== generationRef.current || AppState.currentState !== "active") {
        await setIsAudioActiveAsync(false).catch(() => undefined);
        if (isManagedAudioCacheUri(pendingAudioUri)) {
          await FileSystem.deleteAsync(pendingAudioUri, { idempotent: true }).catch(() => undefined);
        }
        return;
      }
      const audioUri = pendingAudioUri;
      const player = createAudioPlayer({ uri: audioUri }, {
        keepAudioSessionActive: false,
        updateInterval: 250
      });
      playerRef.current = player;
      uriRef.current = audioUri;
      subscriptionRef.current = player.addListener("playbackStatusUpdate", (status) => {
        if (status.didJustFinish && playerRef.current === player) void release();
      });
      pendingAudioUri = undefined;
      player.play();
    } catch (playbackError) {
      await release();
      if (isManagedAudioCacheUri(pendingAudioUri)) {
        await FileSystem.deleteAsync(pendingAudioUri, { idempotent: true }).catch(() => undefined);
      }
      Alert.alert("Audio playback failed", playbackError instanceof Error ? playbackError.message : "Could not play this audio response.");
    }
  }, [prepareAudioUri, release]);

  const playGenerated = useCallback((outputs: RenderedTurn["outputs"]): void => {
    if (!audioEnabledRef.current) return;
    const audio = outputs.find((output): output is AudioOutput => output.type === "audio");
    if (audio) void replay(audio);
  }, [replay]);

  const setEnabled = useCallback((value: SetStateAction<boolean>): void => {
    const enabled = typeof value === "function" ? value(audioEnabledRef.current) : value;
    audioEnabledRef.current = enabled;
    setAudioEnabled(enabled);
    if (!enabled) void release();
  }, [release]);

  useEffect(() => () => {
    void release();
  }, [release]);

  return {
    audioEnabled,
    setAudioEnabled: setEnabled,
    releaseCurrentAudioPlayback: release,
    replayAudioOutput: replay,
    playGeneratedPersonaAudio: playGenerated
  };
}
