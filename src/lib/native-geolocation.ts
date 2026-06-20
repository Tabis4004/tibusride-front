import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

export type GeoPoint = { lat: number; lng: number };

type GeoError = { code: "PERMISSION_DENIED" | "UNAVAILABLE" | "TIMEOUT"; message: string };

export async function getCurrentPosition(options?: {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}): Promise<{ coords: GeoPoint }> {
  if (Capacitor.isNativePlatform()) {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: options?.enableHighAccuracy ?? true,
      timeout: options?.timeout ?? 12000,
      maximumAge: options?.maximumAge ?? 30000,
    });
    return { coords: { lat: pos.coords.latitude, lng: pos.coords.longitude } };
  }

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw { code: "UNAVAILABLE", message: "Géolocalisation non disponible" } satisfies GeoError;
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ coords: { lat: pos.coords.latitude, lng: pos.coords.longitude } }),
      (err) => {
        const code =
          err.code === err.PERMISSION_DENIED ? "PERMISSION_DENIED"
          : err.code === err.TIMEOUT ? "TIMEOUT"
          : "UNAVAILABLE";
        reject({ code, message: err.message } satisfies GeoError);
      },
      {
        enableHighAccuracy: options?.enableHighAccuracy ?? true,
        timeout: options?.timeout ?? 12000,
        maximumAge: options?.maximumAge ?? 30000,
      },
    );
  });
}
