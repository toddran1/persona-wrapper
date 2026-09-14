import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { authClient } from "../lib/authClient.js";
import { isPlanAdSupported } from "./adEligibility.js";
import { initializeAdsenseSlot } from "./adsense.js";

const ADSENSE_PUBLISHER_ID = "ca-pub-1555286261518615";

export function PublisherContentAd() {
  const slotRef = useRef<HTMLModElement>(null);
  const [eligible, setEligible] = useState(false);
  const slotId = (import.meta.env.VITE_ADSENSE_BRONZE_AD_SLOT as string | undefined)?.trim();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const session = await authClient.getSession();
        if (!active || session.error) return;
        if (!session.data?.user) {
          setEligible(true);
          return;
        }
        const catalog = await api.getBillingCatalog();
        if (active) setEligible(isPlanAdSupported(catalog.currentPlanId));
      } catch {
        // Fail closed when plan eligibility cannot be established.
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (eligible && slotId && slotRef.current) {
      initializeAdsenseSlot(slotRef.current, ADSENSE_PUBLISHER_ID);
    }
  }, [eligible, slotId]);

  if (!eligible || !slotId) return null;

  return <aside className="learn-ad" aria-label="Advertisement">
    <span>Advertisement</span>
    <ins
      ref={slotRef}
      className="adsbygoogle"
      style={{ display: "block" }}
      data-ad-client={ADSENSE_PUBLISHER_ID}
      data-ad-slot={slotId}
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  </aside>;
}
