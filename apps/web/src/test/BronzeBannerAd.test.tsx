import type { BillingCatalogResponse } from "@persona/shared";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BronzeBannerAd } from "../advertising/BronzeBannerAd.js";

const bronzeCatalog = {
  currentPlanId: "bronze"
} as BillingCatalogResponse;
const adsWindow = window as Window & { adsbygoogle?: Array<Record<string, never>> };

describe("BronzeBannerAd", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_ADSENSE_BRONZE_AD_SLOT", "6015183891");
    Object.assign(window, { adsbygoogle: [] });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "adsbygoogle");
    Reflect.deleteProperty(window, "googlefc");
    document.getElementById("forthebaddiez-adsense-loader")?.remove();
    vi.unstubAllEnvs();
  });

  it("mounts the configured slot for an authenticated Bronze account", () => {
    render(<BronzeBannerAd authenticated billingCatalog={bronzeCatalog} />);

    const region = screen.getByRole("complementary", { name: "Sponsored content" });
    expect(region.querySelector("ins")).toHaveAttribute("data-ad-slot", "6015183891");
    expect(adsWindow.adsbygoogle).toHaveLength(1);
    expect(document.getElementById("forthebaddiez-adsense-loader")).toBeInstanceOf(HTMLScriptElement);
  });

  it.each(["silver", "gold"] as const)("does not mount for the %s plan", (currentPlanId) => {
    const { container } = render(
      <BronzeBannerAd
        authenticated
        billingCatalog={{ ...bronzeCatalog, currentPlanId }}
      />
    );

    expect(container).toBeEmptyDOMElement();
    expect(adsWindow.adsbygoogle).toHaveLength(0);
    expect(document.getElementById("forthebaddiez-adsense-loader")).toBeNull();
  });

  it("fails closed before the authoritative catalog is available", () => {
    const { container } = render(<BronzeBannerAd authenticated />);

    expect(container).toBeEmptyDOMElement();
    expect(adsWindow.adsbygoogle).toHaveLength(0);
    expect(document.getElementById("forthebaddiez-adsense-loader")).toBeNull();
  });
});
