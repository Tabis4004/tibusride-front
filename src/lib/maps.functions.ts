import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const PLACES_URL = "https://places.googleapis.com/v1";

function getServerApiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY manquante — créez une clé serveur dans Google Cloud Console (Geocoding, Routes, Places API New)",
    );
  }
  return key;
}

function googleJsonHeaders(fieldMask?: string): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": getServerApiKey(),
  };
  if (fieldMask) headers["X-Goog-FieldMask"] = fieldMask;
  return headers;
}

/** Geocode a free-form address to { lat, lng }. */
export const geocodeAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ address: z.string().trim().min(2).max(300) }).parse(d))
  .handler(async ({ data }) => {
    const key = getServerApiKey();
    const url = `${GEOCODE_URL}?address=${encodeURIComponent(data.address)}&key=${key}`;
    const res = await fetch(url);
    const json: any = await res.json();
    if (!res.ok || json.status !== "OK" || !json.results?.[0]) {
      return { ok: false as const, error: json.error_message ?? json.status ?? `HTTP ${res.status}` };
    }
    const loc = json.results[0].geometry.location;
    return {
      ok: true as const,
      lat: loc.lat as number,
      lng: loc.lng as number,
      formatted: json.results[0].formatted_address as string,
    };
  });

/** Compute a route between two points using the Routes API (v2). */
export const computeRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      origin: z.object({ lat: z.number(), lng: z.number() }),
      destination: z.object({ lat: z.number(), lng: z.number() }),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const body = {
      origin: { location: { latLng: { latitude: data.origin.lat, longitude: data.origin.lng } } },
      destination: { location: { latLng: { latitude: data.destination.lat, longitude: data.destination.lng } } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
    };
    const res = await fetch(ROUTES_URL, {
      method: "POST",
      headers: googleJsonHeaders("routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline"),
      body: JSON.stringify(body),
    });
    const json: any = await res.json();
    if (!res.ok || !json.routes?.[0]) {
      return { ok: false as const, error: json.error?.message ?? `HTTP ${res.status}` };
    }
    const r = json.routes[0];
    const durationStr: string = r.duration ?? "0s";
    const staticStr: string = r.staticDuration ?? durationStr;
    const seconds = parseInt(durationStr.replace("s", ""), 10) || 0;
    const staticSeconds = parseInt(staticStr.replace("s", ""), 10) || seconds;
    return {
      ok: true as const,
      seconds,
      staticSeconds,
      distanceMeters: r.distanceMeters as number,
      polyline: r.polyline?.encodedPolyline as string | undefined,
    };
  });

/** Météo locale (Open-Meteo, sans clé) pour ajuster le tarif. */
export const getWeatherAtPoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ lat: z.number(), lng: z.number() }).parse(d))
  .handler(async ({ data }) => {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(data.lat));
    url.searchParams.set("longitude", String(data.lng));
    url.searchParams.set("current", "precipitation,weather_code");
    url.searchParams.set("timezone", "auto");
    const res = await fetch(url.toString());
    const json: any = await res.json();
    if (!res.ok || !json.current) {
      return { ok: false as const, weather: "sunny" as const };
    }
    const precip: number = json.current.precipitation ?? 0;
    const code: number = json.current.weather_code ?? 0;
    const rainyCodes = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]);
    const cloudyCodes = new Set([2, 3, 45, 48]);
    let weather: "sunny" | "rainy" | "cloudy" = "sunny";
    if (precip > 0.2 || rainyCodes.has(code)) weather = "rainy";
    else if (cloudyCodes.has(code)) weather = "cloudy";
    return { ok: true as const, weather, precipitation: precip, weatherCode: code };
  });

/** Reverse geocode lat/lng → formatted address. */
export const reverseGeocode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ lat: z.number(), lng: z.number() }).parse(d))
  .handler(async ({ data }) => {
    const key = getServerApiKey();
    const url = `${GEOCODE_URL}?latlng=${data.lat},${data.lng}&key=${key}`;
    const res = await fetch(url);
    const json: any = await res.json();
    if (!res.ok || json.status !== "OK" || !json.results?.[0]) {
      return { ok: false as const, error: json.error_message ?? json.status ?? `HTTP ${res.status}` };
    }
    return { ok: true as const, formatted: json.results[0].formatted_address as string };
  });

/** Places API (New) — Autocomplete suggestions, ranked by relevance & distance. */
export const placesAutocomplete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      input: z.string().trim().min(2).max(200),
      bias: z.object({ lat: z.number(), lng: z.number(), radiusMeters: z.number().max(50000).optional() }).optional(),
      regionCode: z.string().length(2).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const body: any = {
      input: data.input,
      languageCode: "fr",
    };
    if (data.regionCode) {
      body.includedRegionCodes = [data.regionCode.toLowerCase()];
    }
    if (data.bias) {
      body.locationBias = {
        circle: {
          center: { latitude: data.bias.lat, longitude: data.bias.lng },
          radius: data.bias.radiusMeters ?? 30000,
        },
      };
    }
    const res = await fetch(`${PLACES_URL}/places:autocomplete`, {
      method: "POST",
      headers: googleJsonHeaders(),
      body: JSON.stringify(body),
    });
    const json: any = await res.json();
    if (!res.ok) {
      return { ok: false as const, error: json.error?.message ?? `HTTP ${res.status}`, suggestions: [] as any[] };
    }
    const suggestions = (json.suggestions ?? [])
      .map((s: any) => s.placePrediction)
      .filter(Boolean)
      .map((p: any) => ({
        placeId: p.placeId as string,
        primary: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
        secondary: p.structuredFormat?.secondaryText?.text ?? "",
        full: p.text?.text ?? "",
        distanceMeters: p.distanceMeters ?? null,
      }));
    return { ok: true as const, suggestions };
  });

/** Places API (New) — Resolve a placeId to { lat, lng, formatted }. */
export const placeDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ placeId: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const res = await fetch(`${PLACES_URL}/places/${encodeURIComponent(data.placeId)}`, {
      headers: googleJsonHeaders("id,displayName,formattedAddress,location"),
    });
    const json: any = await res.json();
    if (!res.ok || !json.location) {
      return { ok: false as const, error: json.error?.message ?? `HTTP ${res.status}` };
    }
    return {
      ok: true as const,
      lat: json.location.latitude as number,
      lng: json.location.longitude as number,
      formatted: (json.formattedAddress as string) ?? (json.displayName?.text as string) ?? "",
    };
  });
