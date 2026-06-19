import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

function gatewayHeaders(): HeadersInit {
  const lovKey = process.env.LOVABLE_API_KEY;
  const gmKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!lovKey || !gmKey) throw new Error("Google Maps credentials missing");
  return {
    Authorization: `Bearer ${lovKey}`,
    "X-Connection-Api-Key": gmKey,
    "Content-Type": "application/json",
  };
}

/** Geocode a free-form address to { lat, lng } via the connector gateway. */
export const geocodeAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ address: z.string().trim().min(2).max(300) }).parse(d))
  .handler(async ({ data }) => {
    const url = `${GATEWAY_URL}/maps/api/geocode/json?address=${encodeURIComponent(data.address)}`;
    const res = await fetch(url, { headers: gatewayHeaders() });
    const json: any = await res.json();
    if (!res.ok || json.status !== "OK" || !json.results?.[0]) {
      return { ok: false as const, error: json.status ?? `HTTP ${res.status}` };
    }
    const loc = json.results[0].geometry.location;
    return { ok: true as const, lat: loc.lat as number, lng: loc.lng as number, formatted: json.results[0].formatted_address as string };
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
    const res = await fetch(`${GATEWAY_URL}/routes/directions/v2:computeRoutes`, {
      method: "POST",
      headers: {
        ...gatewayHeaders(),
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify(body),
    });
    const json: any = await res.json();
    if (!res.ok || !json.routes?.[0]) {
      return { ok: false as const, error: json.error?.message ?? `HTTP ${res.status}` };
    }
    const r = json.routes[0];
    const durationStr: string = r.duration ?? "0s";
    const seconds = parseInt(durationStr.replace("s", ""), 10) || 0;
    return {
      ok: true as const,
      seconds,
      distanceMeters: r.distanceMeters as number,
      polyline: r.polyline?.encodedPolyline as string | undefined,
    };
  });

/** Reverse geocode lat/lng → formatted address via the connector gateway. */
export const reverseGeocode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ lat: z.number(), lng: z.number() }).parse(d))
  .handler(async ({ data }) => {
    const url = `${GATEWAY_URL}/maps/api/geocode/json?latlng=${data.lat},${data.lng}`;
    const res = await fetch(url, { headers: gatewayHeaders() });
    const json: any = await res.json();
    if (!res.ok || json.status !== "OK" || !json.results?.[0]) {
      return { ok: false as const, error: json.status ?? `HTTP ${res.status}` };
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
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const body: any = { input: data.input };
    if (data.bias) {
      body.locationBias = {
        circle: {
          center: { latitude: data.bias.lat, longitude: data.bias.lng },
          radius: data.bias.radiusMeters ?? 30000,
        },
      };
    }
    const res = await fetch(`${GATEWAY_URL}/places/v1/places:autocomplete`, {
      method: "POST",
      headers: gatewayHeaders(),
      body: JSON.stringify(body),
    });
    const json: any = await res.json();
    if (!res.ok) return { ok: false as const, error: json.error?.message ?? `HTTP ${res.status}`, suggestions: [] as any[] };
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
    const res = await fetch(`${GATEWAY_URL}/places/v1/places/${encodeURIComponent(data.placeId)}`, {
      headers: {
        ...gatewayHeaders(),
        "X-Goog-FieldMask": "id,displayName,formattedAddress,location",
      },
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
