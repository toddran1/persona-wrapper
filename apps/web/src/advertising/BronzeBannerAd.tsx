import type { BillingCatalogResponse } from "@persona/shared";
import { useEffect, useRef } from "react";
import { isPlanAdSupported } from "./adEligibility.js";
import { initializeAdsenseSlot } from "./adsense.js";

const ADSENSE_PUBLISHER_ID = "ca-pub-1555286261518615";

export type BronzeBannerAdProps = {
  authenticated: boolean;
  billingCatalog?: BillingCatalogResponse;
  className?: string;
};

export function BronzeBannerAd({ authenticated, billingCatalog, className }: BronzeBannerAdProps) {
  const slotRef = useRef<HTMLModElement>(null);
  const slotId = (import.meta.env.VITE_ADSENSE_BRONZE_AD_SLOT as string | undefined)?.trim();
  const eligible = authenticated
    && billingCatalog !== undefined
    && isPlanAdSupported(billingCatalog.currentPlanId)
    && Boolean(slotId);

  useEffect(() => {
    if (eligible && slotRef.current) initializeAdsenseSlot(slotRef.current);
  }, [eligible]);

  if (!eligible || !slotId) return null;

  return (
    <aside className={className} aria-label="Sponsored content">
      <ins
        ref={slotRef}
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={ADSENSE_PUBLISHER_ID}
        data-ad-slot={slotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
