import { isPlanAdSupported } from "@persona/shared";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BannerAd, BannerAdSize } from "react-native-google-mobile-ads";
import { getBannerAdUnitId } from "./config";
import { initializeMobileAds } from "./mobileAds";
import type { AdvertisingAccountContext } from "./types";

const BANNER_RETRY_DELAY_MS = 60_000;

export type BronzeBannerAdProps = AdvertisingAccountContext & {
  borderColor: string;
  labelColor: string;
  onHeightChange?: (height: number) => void;
  onLoadError?: (error: Error) => void;
};

export function BronzeBannerAd(props: BronzeBannerAdProps) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const eligible = props.authenticated
    && props.billingCatalog !== undefined
    && isPlanAdSupported(props.billingCatalog.currentPlanId);
  const adUnitId = eligible ? getBannerAdUnitId() : undefined;

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setFailed(false);
    if (!eligible || !adUnitId) return () => { cancelled = true; };
    void initializeMobileAds(props).then((initialized) => {
      if (!cancelled) setReady(initialized);
    });
    return () => { cancelled = true; };
  }, [adUnitId, eligible]);

  useEffect(() => {
    if (!failed || !eligible || !adUnitId) return;
    const retryTimer = setTimeout(() => setFailed(false), BANNER_RETRY_DELAY_MS);
    return () => clearTimeout(retryTimer);
  }, [adUnitId, eligible, failed]);

  useEffect(() => {
    if (!eligible || !adUnitId || !ready || failed) props.onHeightChange?.(0);
  }, [adUnitId, eligible, failed, props.onHeightChange, ready]);

  useEffect(() => () => props.onHeightChange?.(0), [props.onHeightChange]);

  if (!eligible || !adUnitId || !ready || failed) return null;

  return (
    <View style={[styles.container, { borderTopColor: props.borderColor }]} accessible={false}>
      <Text style={[styles.label, { color: props.labelColor }]}>SPONSORED</Text>
      <BannerAd
        unitId={adUnitId}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdLoaded={(dimensions) => props.onHeightChange?.(dimensions.height + 20)}
        onAdFailedToLoad={(error) => {
          setFailed(true);
          props.onHeightChange?.(0);
          props.onLoadError?.(error);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: 70,
    overflow: "hidden",
    paddingTop: 4
  },
  label: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginBottom: 2
  }
});
