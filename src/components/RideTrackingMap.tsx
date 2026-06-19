import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    google: any;
    __initGmaps?: () => void;
    __gmapsLoadingPromise?: Promise<void>;
  }
}

function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.google?.maps) return Promise.resolve();
  if (window.__gmapsLoadingPromise) return window.__gmapsLoadingPromise;

  window.__gmapsLoadingPromise = new Promise((resolve, reject) => {
    const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY;
    const channel = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID;
    if (!key) return reject(new Error("Google Maps browser key missing"));
    window.__initGmaps = () => resolve();
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&loading=async&callback=__initGmaps&channel=${channel ?? ""}`;
    s.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(s);
  });
  return window.__gmapsLoadingPromise;
}

function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

export type LatLng = { lat: number; lng: number };

interface Props {
  pickup: LatLng | null;
  dropoff: LatLng | null;
  driver?: LatLng | null;
  polyline?: string;
  height?: number;
  center?: LatLng;
  /** Allow clicking on the map / dragging markers to change pickup/dropoff. */
  interactive?: boolean;
  onPickupChange?: (p: LatLng) => void;
  onDropoffChange?: (p: LatLng) => void;
}

export function RideTrackingMap({
  pickup, dropoff, driver, polyline, height = 320,
  center, interactive = false, onPickupChange, onDropoffChange,
}: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapObj = useRef<any>(null);
  const markers = useRef<{ pickup?: any; dropoff?: any; driver?: any; route?: any }>({});
  const [error, setError] = useState<string | null>(null);
  // Keep latest callbacks without re-running init effect
  const cbRef = useRef({ onPickupChange, onDropoffChange });
  cbRef.current = { onPickupChange, onDropoffChange };

  // init map once
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (cancelled || !mapRef.current) return;
        const g = window.google.maps;
        const initialCenter = pickup ?? dropoff ?? center ?? { lat: 14.7167, lng: -17.4677 };
        const map = new g.Map(mapRef.current, {
          center: initialCenter,
          zoom: pickup && dropoff ? 13 : 12,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
        });
        mapObj.current = map;

        if (interactive) {
          map.addListener("click", (e: any) => {
            const ll = { lat: e.latLng.lat(), lng: e.latLng.lng() };
            // Set the missing one first; otherwise update dropoff
            if (!markers.current.pickup) cbRef.current.onPickupChange?.(ll);
            else if (!markers.current.dropoff) cbRef.current.onDropoffChange?.(ll);
            else cbRef.current.onDropoffChange?.(ll);
          });
        }
      })
      .catch((e) => setError(e.message));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // pickup marker
  useEffect(() => {
    if (!mapObj.current || !window.google?.maps) return;
    const g = window.google.maps;
    if (!pickup) {
      if (markers.current.pickup) { markers.current.pickup.setMap(null); markers.current.pickup = null; }
      return;
    }
    if (!markers.current.pickup) {
      markers.current.pickup = new g.Marker({
        position: pickup, map: mapObj.current, label: "A", title: "Départ", draggable: interactive,
      });
      if (interactive) {
        markers.current.pickup.addListener("dragend", (e: any) =>
          cbRef.current.onPickupChange?.({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
      }
    } else {
      markers.current.pickup.setPosition(pickup);
    }
  }, [pickup?.lat, pickup?.lng, interactive]);

  // dropoff marker
  useEffect(() => {
    if (!mapObj.current || !window.google?.maps) return;
    const g = window.google.maps;
    if (!dropoff) {
      if (markers.current.dropoff) { markers.current.dropoff.setMap(null); markers.current.dropoff = null; }
      return;
    }
    if (!markers.current.dropoff) {
      markers.current.dropoff = new g.Marker({
        position: dropoff, map: mapObj.current, label: "B", title: "Arrivée", draggable: interactive,
      });
      if (interactive) {
        markers.current.dropoff.addListener("dragend", (e: any) =>
          cbRef.current.onDropoffChange?.({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
      }
    } else {
      markers.current.dropoff.setPosition(dropoff);
    }
  }, [dropoff?.lat, dropoff?.lng, interactive]);

  // Auto-fit when both points exist
  useEffect(() => {
    if (!mapObj.current || !window.google?.maps || !pickup || !dropoff) return;
    const bounds = new window.google.maps.LatLngBounds();
    bounds.extend(pickup); bounds.extend(dropoff);
    mapObj.current.fitBounds(bounds, 60);
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  // route polyline
  useEffect(() => {
    if (!mapObj.current || !window.google?.maps) return;
    if (markers.current.route) { markers.current.route.setMap(null); markers.current.route = null; }
    if (polyline) {
      const path = decodePolyline(polyline);
      markers.current.route = new window.google.maps.Polyline({
        path, map: mapObj.current, strokeColor: "#3b82f6", strokeOpacity: 0.85, strokeWeight: 5,
      });
    }
  }, [polyline]);

  // driver marker — animate between positions
  const animRef = useRef<number | null>(null);
  useEffect(() => {
    if (!mapObj.current || !window.google?.maps) return;
    const g = window.google.maps;
    if (!driver) {
      if (markers.current.driver) { markers.current.driver.setMap(null); markers.current.driver = null; }
      return;
    }
    if (!markers.current.driver) {
      markers.current.driver = new g.Marker({
        position: driver, map: mapObj.current, title: "Chauffeur",
        icon: { path: g.SymbolPath.CIRCLE, scale: 9, fillColor: "#16a34a", fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 3 },
      });
      return;
    }
    const start = markers.current.driver.getPosition();
    if (!start) { markers.current.driver.setPosition(driver); return; }
    const startLat = start.lat(); const startLng = start.lng();
    const dLat = driver.lat - startLat; const dLng = driver.lng - startLng;
    if (Math.abs(dLat) > 0.05 || Math.abs(dLng) > 0.05) {
      markers.current.driver.setPosition(driver);
      return;
    }
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const t0 = performance.now();
    const DURATION = 1500;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / DURATION);
      const e = 1 - (1 - p) * (1 - p);
      markers.current.driver.setPosition({ lat: startLat + dLat * e, lng: startLng + dLng * e });
      if (p < 1) animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [driver?.lat, driver?.lng]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-muted">
      <div ref={mapRef} style={{ height }} className="w-full" />
      {interactive && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-background/90 px-2 py-1 text-xs shadow">
          {!pickup ? "Cliquez sur la carte pour définir le départ" :
           !dropoff ? "Cliquez sur la carte pour définir l'arrivée" :
           "Glissez A ou B pour ajuster"}
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 p-4 text-center text-sm text-muted-foreground">
          Carte indisponible : {error}
        </div>
      )}
    </div>
  );
}
