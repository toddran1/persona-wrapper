import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { onlineManager } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";

export type NetworkStatus = "checking" | "online" | "offline";

type NetworkContextValue = {
  status: NetworkStatus;
  isOnline: boolean;
  recentlyRestored: boolean;
  retry: () => Promise<boolean>;
};

const NetworkContext = createContext<NetworkContextValue | undefined>(undefined);

function statusFromState(state: NetInfoState): NetworkStatus {
  if (state.isConnected === false || state.isInternetReachable === false) return "offline";
  if (state.isConnected === true) return "online";
  return "checking";
}

export function NetworkProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<NetworkStatus>("checking");
  const [recentlyRestored, setRecentlyRestored] = useState(false);
  const previousStatusRef = useRef<NetworkStatus>("checking");
  const restoredTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const markOffline = useCallback(() => {
    previousStatusRef.current = "offline";
    setStatus("offline");
  }, []);

  const applyState = useCallback((state: NetInfoState) => {
    const nextStatus = statusFromState(state);
    if (previousStatusRef.current === "offline" && nextStatus === "online") {
      setRecentlyRestored(true);
      if (restoredTimerRef.current) clearTimeout(restoredTimerRef.current);
      restoredTimerRef.current = setTimeout(() => setRecentlyRestored(false), 3000);
    }
    previousStatusRef.current = nextStatus;
    setStatus(nextStatus);
    onlineManager.setOnline(nextStatus === "online");
  }, []);

  useEffect(() => {
    let active = true;
    const handleState = (state: NetInfoState) => {
      if (active) applyState(state);
    };
    const unsubscribe = NetInfo.addEventListener(handleState);
    void NetInfo.fetch().then(handleState).catch(() => {
      if (active) markOffline();
    });
    return () => {
      active = false;
      unsubscribe();
      if (restoredTimerRef.current) clearTimeout(restoredTimerRef.current);
    };
  }, [applyState, markOffline]);

  const retry = useCallback(async () => {
    setStatus("checking");
    try {
      const nextState = await NetInfo.refresh();
      applyState(nextState);
      return statusFromState(nextState) === "online";
    } catch {
      markOffline();
      return false;
    }
  }, [applyState, markOffline]);

  const value = useMemo<NetworkContextValue>(() => ({
    status,
    isOnline: status === "online",
    recentlyRestored,
    retry
  }), [recentlyRestored, retry, status]);

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkContextValue {
  const value = useContext(NetworkContext);
  if (!value) throw new Error("useNetwork must be used within NetworkProvider.");
  return value;
}
