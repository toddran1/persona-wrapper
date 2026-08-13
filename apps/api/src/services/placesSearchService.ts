import type { ClientContext } from "@persona/shared";
import { z } from "zod";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

const priceLevelSchema = z.enum([
  "PRICE_LEVEL_FREE",
  "PRICE_LEVEL_INEXPENSIVE",
  "PRICE_LEVEL_MODERATE",
  "PRICE_LEVEL_EXPENSIVE",
  "PRICE_LEVEL_VERY_EXPENSIVE"
]);

export const placesSearchArgumentsSchema = z.object({
  query: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).nullable(),
  maxResults: z.number().int().min(1).max(20).nullable(),
  openNow: z.boolean().nullable(),
  minimumRating: z.number().finite().min(0).max(5).nullable(),
  priceLevels: z.array(priceLevelSchema).max(5),
  languageCode: z.string().trim().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/).nullable(),
  regionCode: z.string().trim().regex(/^[A-Z]{2}$/).nullable()
});

type PlacesSearchArguments = z.infer<typeof placesSearchArgumentsSchema>;

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  primaryType?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  currentOpeningHours?: { openNow?: boolean };
  location?: { latitude?: number; longitude?: number };
};

type GooglePlacesResponse = { places?: GooglePlace[] };

export type PlacesSearchResult = {
  query: string;
  location?: string;
  attribution: "Google Maps";
  places: Array<{
    id: string;
    name: string;
    address?: string;
    primaryType?: string;
    mapsUrl: string;
    rating?: number;
    ratingCount?: number;
    priceLevel?: string;
    openNow?: boolean;
    latitude?: number;
    longitude?: number;
  }>;
  note: string;
};

export const placesSearchResultSchema = z.object({
  query: z.string(),
  location: z.string().optional(),
  attribution: z.literal("Google Maps"),
  places: z.array(z.object({
    id: z.string(),
    name: z.string(),
    address: z.string().optional(),
    primaryType: z.string().optional(),
    mapsUrl: z.string().url(),
    rating: z.number().finite().min(0).max(5).optional(),
    ratingCount: z.number().finite().int().nonnegative().optional(),
    priceLevel: z.string().optional(),
    openNow: z.boolean().optional(),
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional()
  })),
  note: z.string()
});

type FetchLike = typeof fetch;

function roundedMinimumRating(value: number): number {
  return Math.ceil(value * 2) / 2;
}

export async function searchPlaces(
  rawArguments: unknown,
  clientContext?: ClientContext,
  fetchImpl: FetchLike = fetch
): Promise<PlacesSearchResult> {
  const input: PlacesSearchArguments = placesSearchArgumentsSchema.parse(rawArguments);
  if (!env.PLACES_SEARCH_ENABLED) throw new Error("Local place search is disabled.");
  if (!env.GOOGLE_MAPS_API_KEY) throw new Error("Local place search is not configured.");

  const maxResults = Math.min(input.maxResults ?? env.PLACES_SEARCH_MAX_RESULTS, env.PLACES_SEARCH_MAX_RESULTS);
  const body: Record<string, unknown> = {
    textQuery: input.location ? `${input.query} near ${input.location}` : input.query,
    pageSize: maxResults
  };
  if (input.openNow !== null) body.openNow = input.openNow;
  if (input.minimumRating !== null) body.minRating = roundedMinimumRating(input.minimumRating);
  if (input.priceLevels.length > 0) body.priceLevels = input.priceLevels;
  if (input.languageCode) body.languageCode = input.languageCode;
  if (input.regionCode) body.regionCode = input.regionCode;
  if (!input.location && clientContext?.location) {
    body.locationBias = {
      circle: {
        center: {
          latitude: clientContext.location.latitude,
          longitude: clientContext.location.longitude
        },
        radius: 25_000
      }
    };
  }

  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.primaryType",
    "places.googleMapsUri",
    "places.rating",
    "places.userRatingCount",
    "places.priceLevel",
    "places.currentOpeningHours.openNow",
    "places.location"
  ].join(",");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.PLACES_SEARCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": fieldMask
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      logger.warn("Google Places search failed", { status: response.status });
      if (response.status === 429) throw new Error("Local place search is temporarily busy. Please try again shortly.");
      if (response.status === 403) throw new Error("Local place search is not available right now.");
      throw new Error("Local place search could not be completed.");
    }
    const payload = await response.json() as GooglePlacesResponse;
    const places = (payload.places ?? []).flatMap((place) => {
      const name = place.displayName?.text?.trim();
      if (!name || !place.id) return [];
      const mapsQuery = place.formattedAddress ?? name;
      const mapsUrl = place.googleMapsUri ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}&query_place_id=${encodeURIComponent(place.id)}`;
      return [{
        id: place.id,
        name,
        ...(place.formattedAddress ? { address: place.formattedAddress } : {}),
        ...(place.primaryType ? { primaryType: place.primaryType } : {}),
        mapsUrl,
        ...(typeof place.rating === "number" && Number.isFinite(place.rating) && place.rating >= 0 && place.rating <= 5
          ? { rating: place.rating }
          : {}),
        ...(typeof place.userRatingCount === "number" && Number.isSafeInteger(place.userRatingCount) && place.userRatingCount >= 0
          ? { ratingCount: place.userRatingCount }
          : {}),
        ...(place.priceLevel ? { priceLevel: place.priceLevel } : {}),
        ...(typeof place.currentOpeningHours?.openNow === "boolean" ? { openNow: place.currentOpeningHours.openNow } : {}),
        ...(typeof place.location?.latitude === "number" && Number.isFinite(place.location.latitude)
          && place.location.latitude >= -90 && place.location.latitude <= 90
          ? { latitude: place.location.latitude }
          : {}),
        ...(typeof place.location?.longitude === "number" && Number.isFinite(place.location.longitude)
          && place.location.longitude >= -180 && place.location.longitude <= 180
          ? { longitude: place.location.longitude }
          : {})
      }];
    });

    return {
      query: input.query,
      ...(input.location ? { location: input.location } : {}),
      attribution: "Google Maps",
      places,
      note: "Ratings, hours, prices, and availability can change. Open the Google Maps link to verify current details."
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Local place search timed out. Please try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
