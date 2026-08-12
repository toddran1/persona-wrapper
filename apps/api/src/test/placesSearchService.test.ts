import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({
  env: {
    GOOGLE_MAPS_API_KEY: "maps-test-key",
    PLACES_SEARCH_ENABLED: true,
    PLACES_SEARCH_TIMEOUT_MS: 1_000,
    PLACES_SEARCH_MAX_RESULTS: 8
  }
}));

import { searchPlaces } from "../services/placesSearchService.js";

describe("placesSearchService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses device coordinates as a bias and returns normalized Maps results", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      places: [{
        id: "place-1",
        displayName: { text: "Cafe Example" },
        formattedAddress: "123 Main St, Frisco, TX",
        primaryType: "cafe",
        googleMapsUri: "https://maps.google.com/?cid=1",
        rating: 4.7,
        userRatingCount: 215,
        priceLevel: "PRICE_LEVEL_MODERATE",
        currentOpeningHours: { openNow: true },
        location: { latitude: 33.15, longitude: -96.82 }
      }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await searchPlaces({
      query: "coffee",
      location: null,
      maxResults: 5,
      openNow: true,
      minimumRating: 4.2,
      priceLevels: ["PRICE_LEVEL_MODERATE"],
      languageCode: "en-US",
      regionCode: "US"
    }, {
      location: { latitude: 33.14, longitude: -96.81 }
    }, fetchMock);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, request] = fetchMock.mock.calls[0]!;
    expect(request?.headers).toMatchObject({
      "X-Goog-Api-Key": "maps-test-key"
    });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      textQuery: "coffee",
      pageSize: 5,
      openNow: true,
      minRating: 4.5,
      locationBias: {
        circle: {
          center: { latitude: 33.14, longitude: -96.81 },
          radius: 25_000
        }
      }
    });
    expect(result).toMatchObject({
      attribution: "Google Maps",
      places: [{
        id: "place-1",
        name: "Cafe Example",
        mapsUrl: "https://maps.google.com/?cid=1",
        rating: 4.7,
        openNow: true
      }]
    });
  });

  it("uses an explicit place name instead of device coordinates", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ places: [] }), { status: 200 }));

    await searchPlaces({
      query: "brunch",
      location: "Atlanta, GA",
      maxResults: null,
      openNow: null,
      minimumRating: null,
      priceLevels: [],
      languageCode: null,
      regionCode: null
    }, { location: { latitude: 1, longitude: 2 } }, fetchMock);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.textQuery).toBe("brunch near Atlanta, GA");
    expect(body.locationBias).toBeUndefined();
  });

  it("maps provider throttling to a safe retryable message", async () => {
    const fetchMock = vi.fn(async () => new Response("quota details", { status: 429 }));

    await expect(searchPlaces({
      query: "dinner",
      location: null,
      maxResults: null,
      openNow: null,
      minimumRating: null,
      priceLevels: [],
      languageCode: null,
      regionCode: null
    }, undefined, fetchMock)).rejects.toThrow("temporarily busy");
  });
});
