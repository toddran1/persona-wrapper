import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { Alert, AppState } from "react-native";
import { createAudioPlayer, setAudioModeAsync, setIsAudioActiveAsync, type AudioPlayer } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "../../api/client";
import type { RenderedTurn } from "./types";

type AudioOutput = Extract<RenderedTurn["outputs"][number], { type: "audio" }>;
type AudioPlaybackSubscription = { remove: () => void };
type PlaybackOwner = { id: string; kind: "live" | "saved" };
export type LiveAudioPlaybackResult = "started" | "failed" | "superseded";
type PendingLivePlayback = {
  ownerId: string;
  settle: (result: LiveAudioPlaybackResult) => void;
};

function audioFileExtension(mimeType: string): string {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("opus")) return "opus";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("basic")) return "ulaw";
  return "audio";
}

function playbackErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Could not play this audio response.";
  if (/status\s+(401|403|404|410)\b/i.test(message)) {
    return "This saved audio is no longer available. Retry the response to generate new audio with the current voice provider.";
  }
  return message;
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
  const savedPlaybackSequenceRef = useRef(0);
  const ownerRef = useRef<PlaybackOwner | undefined>(undefined);
  const pendingLivePlaybackRef = useRef<PendingLivePlayback | undefined>(undefined);
  const cancelledLiveStreamsRef = useRef<Set<string>>(new Set());

  const releaseOwned = useCallback(async (
    result: LiveAudioPlaybackResult,
    expectedOwnerId?: string
  ): Promise<number | undefined> => {
    const owner = ownerRef.current;
    const pending = pendingLivePlaybackRef.current;
    if (
      expectedOwnerId
      && owner?.id !== expectedOwnerId
      && pending?.ownerId !== expectedOwnerId
    ) {
      return undefined;
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    if (!expectedOwnerId || pending?.ownerId === expectedOwnerId) {
      pendingLivePlaybackRef.current = undefined;
      pending?.settle(result);
    }
    if (!expectedOwnerId || owner?.id === expectedOwnerId) ownerRef.current = undefined;

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
    return generation;
  }, []);

  const release = useCallback(async (): Promise<void> => {
    await releaseOwned("superseded");
  }, [releaseOwned]);

  const beginPlayback = useCallback(async (owner: PlaybackOwner): Promise<number | undefined> => {
    const generation = await releaseOwned("superseded");
    if (generation === undefined || generation !== generationRef.current) return undefined;
    ownerRef.current = owner;
    return generation;
  }, [releaseOwned]);

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
    const ownerId = `saved:${savedPlaybackSequenceRef.current + 1}`;
    savedPlaybackSequenceRef.current += 1;
    let pendingAudioUri: string | undefined;
    try {
      const playbackGeneration = await beginPlayback({ id: ownerId, kind: "saved" });
      if (playbackGeneration === undefined) return;
      pendingAudioUri = await prepareAudioUri(output);
      if (
        playbackGeneration !== generationRef.current
        || ownerRef.current?.id !== ownerId
        || AppState.currentState !== "active"
      ) {
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
      if (
        playbackGeneration !== generationRef.current
        || ownerRef.current?.id !== ownerId
        || AppState.currentState !== "active"
      ) {
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
        if (status.didJustFinish && playerRef.current === player) {
          void releaseOwned("started", ownerId);
        }
      });
      pendingAudioUri = undefined;
      player.play();
    } catch (playbackError) {
      const stillOwned = ownerRef.current?.id === ownerId;
      await releaseOwned("failed", ownerId);
      if (isManagedAudioCacheUri(pendingAudioUri)) {
        await FileSystem.deleteAsync(pendingAudioUri, { idempotent: true }).catch(() => undefined);
      }
      // A stale replay must not report an error after a newer playback has
      // intentionally superseded it.
      if (stillOwned) Alert.alert("Audio playback failed", playbackErrorMessage(playbackError));
    }
  }, [beginPlayback, prepareAudioUri, releaseOwned]);

  const playLiveStream = useCallback(async (
    url: string,
    streamId: string
  ): Promise<LiveAudioPlaybackResult> => {
    const ownerId = `live:${streamId}`;
    try {
      if (cancelledLiveStreamsRef.current.delete(streamId)) return "failed";
      const playbackGeneration = await beginPlayback({ id: ownerId, kind: "live" });
      if (playbackGeneration === undefined) return "superseded";
      if (cancelledLiveStreamsRef.current.delete(streamId)) {
        await releaseOwned("failed", ownerId);
        return "failed";
      }
      if (!audioEnabledRef.current || AppState.currentState !== "active") {
        await releaseOwned("failed", ownerId);
        return "failed";
      }

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: "duckOthers",
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false
      });
      await setIsAudioActiveAsync(true);
      if (
        playbackGeneration !== generationRef.current
        || ownerRef.current?.id !== ownerId
        || !audioEnabledRef.current
        || AppState.currentState !== "active"
      ) {
        await releaseOwned("superseded", ownerId);
        return "superseded";
      }

      const player = createAudioPlayer({ uri: api.resolveUrl(url) }, {
        keepAudioSessionActive: false,
        updateInterval: 250
      });
      playerRef.current = player;
      const playbackStarted = new Promise<LiveAudioPlaybackResult>((resolve) => {
        let settled = false;
        let startTimeout: ReturnType<typeof setTimeout> | undefined;
        const settle = (result: LiveAudioPlaybackResult) => {
          if (settled) return;
          settled = true;
          if (startTimeout) clearTimeout(startTimeout);
          if (pendingLivePlaybackRef.current?.ownerId === ownerId) {
            pendingLivePlaybackRef.current = undefined;
          }
          resolve(result);
        };
        pendingLivePlaybackRef.current = { ownerId, settle };
        const fail = () => {
          if (settled) return;
          if (ownerRef.current?.id !== ownerId || playerRef.current !== player) {
            settle("superseded");
            return;
          }
          void releaseOwned("failed", ownerId);
        };
        startTimeout = setTimeout(fail, 8_000);
        subscriptionRef.current = player.addListener("playbackStatusUpdate", (status) => {
          if (ownerRef.current?.id !== ownerId || playerRef.current !== player) return;
          if (status.error || status.playbackState === "failed") {
            fail();
            return;
          }
          if (status.playing || status.currentTime > 0) settle("started");
          if (status.didJustFinish) {
            settle("started");
            void releaseOwned("started", ownerId);
          }
        });
      });
      try {
        player.play();
      } catch {
        await releaseOwned("failed", ownerId);
      }
      return await playbackStarted;
    } catch {
      // The final persisted audio output remains the fallback when a device or
      // network cannot progressively play the live HTTP response. Ownership
      // prevents this cleanup from stopping a saved replay started afterward.
      const released = await releaseOwned("failed", ownerId);
      return released === undefined ? "superseded" : "failed";
    }
  }, [beginPlayback, releaseOwned]);

  const stopLiveStream = useCallback(async (streamId: string): Promise<void> => {
    const ownerId = `live:${streamId}`;
    const liveStreamOwnsPlayback = ownerRef.current?.id === ownerId
      || pendingLivePlaybackRef.current?.ownerId === ownerId;
    if (!liveStreamOwnsPlayback) cancelledLiveStreamsRef.current.add(streamId);
    const released = await releaseOwned("failed", ownerId);
    if (released !== undefined) cancelledLiveStreamsRef.current.delete(streamId);
  }, [releaseOwned]);

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
    playLivePersonaAudioStream: playLiveStream,
    stopLivePersonaAudioStream: stopLiveStream,
    playGeneratedPersonaAudio: playGenerated
  };
}
