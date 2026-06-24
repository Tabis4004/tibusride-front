import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    google: any;
    __initGmaps?: () => void;
    __gmapsLoadingPromise?: Promise<void>;
    __gmapsAuthFailed?: boolean;
    gm_authFailure?: () => void;
  }
}

function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.google?.maps) return Promise.resolve();
  if (window.__gmapsLoadingPromise) return window.__gmapsLoadingPromise;

  window.__gmapsLoadingPromise = new Promise((resolve, reject) => {
    const key =
      import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY ||
      import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY;
    if (!key) return reject(new Error("Google Maps browser key missing (VITE_GOOGLE_MAPS_BROWSER_KEY)"));
    window.gm_authFailure = () => {
      window.__gmapsAuthFailed = true;
      reject(new Error(
        "Clé Google Maps refusée pour ce site. Google Cloud → Identifiants → clé navigateur → ajoutez http://localhost:8081/* (ou le port affiché dans l'URL)",
      ));
    };
    window.__initGmaps = () => {
      if (window.__gmapsAuthFailed) return;
      resolve();
    };
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&loading=async&callback=__initGmaps`;
    s.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(s);
  });
  return window.__gmapsLoadingPromise;
}

/** Carte SVG de secours quand Google Maps est bloqué (clé API / restrictions). */
function FallbackRideMap({
  pickup, dropoff, driver, polyline, height,
}: {
  pickup: LatLng | null;
  dropoff: LatLng | null;
  driver: LatLng | null;
  polyline?: string;
  height: number;
}) {
  const points: LatLng[] = [];
  if (polyline) points.push(...decodePolyline(polyline));
  else {
    if (pickup) points.push(pickup);
    if (driver) points.push(driver);
    if (dropoff && dropoff !== pickup) points.push(dropoff);
  }
  const all = [...points, ...(pickup ? [pickup] : []), ...(dropoff ? [dropoff] : []), ...(driver ? [driver] : [])];
  if (all.length === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center bg-muted text-sm text-muted-foreground">
        Aucune position à afficher
      </div>
    );
  }

  const lats = all.map((p) => p.lat);
  const lngs = all.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const pad = 0.15;
  const latSpan = Math.max(maxLat - minLat, 0.008);
  const lngSpan = Math.max(maxLng - minLng, 0.008);
  const w = 400;
  const h = 280;
  const project = (p: LatLng) => ({
    x: ((p.lng - minLng) / lngSpan) * (1 - 2 * pad) * w + pad * w,
    y: (1 - (p.lat - minLat) / latSpan) * (1 - 2 * pad) * h + pad * h,
  });

  const routePts = points.length >= 2 ? points : pickup && dropoff ? [pickup, dropoff] : [];
  const routeD = routePts.map((p) => project(p)).map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const pin = (p: LatLng, color: string, label: string) => {
    const { x, y } = project(p);
    return (
      <g key={`${label}-${p.lat}`}>
        <circle cx={x} cy={y} r={10} fill={color} stroke="#fff" strokeWidth={2} />
        <text x={x} y={y + 4} textAnchor="middle" fontSize={10} fontWeight="bold" fill="#fff">{label}</text>
      </g>
    );
  };

  return (
    <div style={{ height }} className="relative overflow-hidden bg-[#e8f0e8]">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
        {routeD && <path d={routeD} fill="none" stroke="#3b82f6" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />}
        {pickup && pin(pickup, "#16a34a", "A")}
        {dropoff && pin(dropoff, "#2563eb", "B")}
        {driver && (
          <g transform={`translate(${project(driver).x},${project(driver).y})`}>
            <text textAnchor="middle" fontSize={22} y={8}>🚗</text>
          </g>
        )}
      </svg>
      <div className="absolute bottom-2 left-2 rounded bg-background/90 px-2 py-1 text-[10px] text-muted-foreground">
        Carte de secours (Google Maps indisponible)
      </div>
    </div>
  );
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

/** Icône voiture visible (flèche verte). */
function driverCarIcon(g: any) {
  return {
    path: g.SymbolPath.FORWARD_CLOSED_ARROW,
    scale: 7,
    fillColor: "#16a34a",
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 2,
    rotation: 0,
  };
}

export type LatLng = { lat: number; lng: number };

interface Props {
  pickup: LatLng | null;
  dropoff: LatLng | null;
  driver?: LatLng | null;
  polyline?: string;
  height?: number;
  center?: LatLng;
  /** Recentre la carte sur le chauffeur pendant le suivi. */
  followDriver?: boolean;
  interactive?: boolean;
  onPickupChange?: (p: LatLng) => void;
  onDropoffChange?: (p: LatLng) => void;
}

export function RideTrackingMap({
  pickup, dropoff, driver, polyline, height = 320,
  center, followDriver = false, interactive = false, onPickupChange, onDropoffChange,
}: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapObj = useRef<any>(null);
  const markers = useRef<{ pickup?: any; dropoff?: any; driver?: any; route?: any }>({});
  const [error, setError] = useState<string | null>(null);
  const [useFallback, setUseFallback] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const cbRef = useRef({ onPickupChange, onDropoffChange });
  cbRef.current = { onPickupChange, onDropoffChange };

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (cancelled || !mapRef.current) return;
        const g = window.google.maps;
        const initialCenter = driver ?? pickup ?? dropoff ?? center ?? { lat: 14.7167, lng: -17.4677 };
        const map = new g.Map(mapRef.current, {
          center: initialCenter,
          zoom: 14,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
        });
        mapObj.current = map;
        setMapReady(true);

        // ApiTargetBlockedMapError : tuiles refusées → bascule carte de secours
        const switchFallback = () => {
          if (cancelled) return;
          setUseFallback(true);
          setError(
            "Google Maps bloqué (restrictions API). Carte de secours — Google Cloud → Identifiants → « Ne pas restreindre la clé ».",
          );
        };
        if (mapRef.current?.querySelector(".gm-err-container")) switchFallback();
        else {
          const obs = new MutationObserver(() => {
            if (mapRef.current?.querySelector(".gm-err-container")) {
              obs.disconnect();
              switchFallback();
            }
          });
          if (mapRef.current) obs.observe(mapRef.current, { childList: true, subtree: true });
          mapObj.current.__errObs = obs;
          // Si aucune erreur n'a été détectée dans la fenêtre d'observation, on
          // arrête simplement la surveillance — la carte fonctionne normalement.
          // (Avant : ce timeout forçait le repli même sans erreur réelle.)
          mapObj.current.__errTimer = window.setTimeout(() => { obs.disconnect(); }, 4000);
        }

        if (interactive) {
          map.addListener("click", (e: any) => {
            const ll = { lat: e.latLng.lat(), lng: e.latLng.lng() };
            if (!markers.current.pickup) cbRef.current.onPickupChange?.(ll);
            else if (!markers.current.dropoff) cbRef.current.onDropoffChange?.(ll);
            else cbRef.current.onDropoffChange?.(ll);
          });
        }
      })
      .catch((e) => {
        setUseFallback(true);
        setError(e.message);
      });
    return () => {
      cancelled = true;
      setMapReady(false);
      mapObj.current?.__errObs?.disconnect();
      if (mapObj.current?.__errTimer) window.clearTimeout(mapObj.current.__errTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapReady || !mapObj.current || !window.google?.maps) return;
    const g = window.google.maps;
    if (!pickup) {
      if (markers.current.pickup) { markers.current.pickup.setMap(null); markers.current.pickup = null; }
      return;
    }
    if (!markers.current.pickup) {
      markers.current.pickup = new g.Marker({
        position: pickup, map: mapObj.current, label: "A", title: "Départ", draggable: interactive, zIndex: 10,
      });
      if (interactive) {
        markers.current.pickup.addListener("dragend", (e: any) =>
          cbRef.current.onPickupChange?.({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
      }
    } else {
      markers.current.pickup.setPosition(pickup);
    }
  }, [mapReady, pickup?.lat, pickup?.lng, interactive]);

  useEffect(() => {
    if (!mapReady || !mapObj.current || !window.google?.maps) return;
    const g = window.google.maps;
    if (!dropoff) {
      if (markers.current.dropoff) { markers.current.dropoff.setMap(null); markers.current.dropoff = null; }
      return;
    }
    if (!markers.current.dropoff) {
      markers.current.dropoff = new g.Marker({
        position: dropoff, map: mapObj.current, label: "B", title: "Arrivée", draggable: interactive, zIndex: 10,
      });
      if (interactive) {
        markers.current.dropoff.addListener("dragend", (e: any) =>
          cbRef.current.onDropoffChange?.({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
      }
    } else {
      markers.current.dropoff.setPosition(dropoff);
    }
  }, [mapReady, dropoff?.lat, dropoff?.lng, interactive]);

  // Cadre initial : départ + arrivée (pas le chauffeur — sinon la carte ne "suit" pas)
  useEffect(() => {
    if (!mapReady || !mapObj.current || !window.google?.maps || followDriver) return;
    const bounds = new window.google.maps.LatLngBounds();
    if (pickup) bounds.extend(pickup);
    if (dropoff) bounds.extend(dropoff);
    if (driver) bounds.extend(driver);
    if (!bounds.isEmpty()) {
      mapObj.current.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
    }
  }, [mapReady, followDriver, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  // Premier cadrage en mode suivi chauffeur
  const didInitialFit = useRef(false);
  useEffect(() => {
    if (!mapReady || !mapObj.current || !followDriver || didInitialFit.current) return;
    const bounds = new window.google.maps.LatLngBounds();
    if (pickup) bounds.extend(pickup);
    if (dropoff) bounds.extend(dropoff);
    if (driver) bounds.extend(driver);
    if (!bounds.isEmpty()) {
      mapObj.current.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
      didInitialFit.current = true;
    }
  }, [mapReady, followDriver, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, driver?.lat, driver?.lng]);

  useEffect(() => {
    if (!mapReady || !mapObj.current || !window.google?.maps) return;
    if (markers.current.route) { markers.current.route.setMap(null); markers.current.route = null; }
    if (polyline) {
      const path = decodePolyline(polyline);
      markers.current.route = new window.google.maps.Polyline({
        path, map: mapObj.current, strokeColor: "#3b82f6", strokeOpacity: 0.85, strokeWeight: 5, zIndex: 5,
      });
    }
  }, [mapReady, polyline]);

  const lastDriverKey = useRef<string>("");
  useEffect(() => {
    if (!mapReady || !mapObj.current || !window.google?.maps) return;
    const g = window.google.maps;
    if (!driver) {
      if (markers.current.driver) { markers.current.driver.setMap(null); markers.current.driver = null; }
      lastDriverKey.current = "";
      return;
    }

    const key = `${driver.lat.toFixed(6)},${driver.lng.toFixed(6)}`;
    if (key === lastDriverKey.current) return;
    lastDriverKey.current = key;

    if (!markers.current.driver) {
      markers.current.driver = new g.Marker({
        position: driver,
        map: mapObj.current,
        title: "Chauffeur",
        icon: driverCarIcon(g),
        zIndex: 999,
        optimized: false,
      });
    } else {
      markers.current.driver.setPosition(driver);
    }

    if (followDriver) {
      mapObj.current.panTo(driver);
    }
  }, [mapReady, driver?.lat, driver?.lng, followDriver]);

  if (useFallback) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-border bg-muted">
        <FallbackRideMap pickup={pickup} dropoff={dropoff} driver={driver ?? null} polyline={polyline} height={height} />
        {driver && (
          <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5 rounded-md bg-background/95 px-2 py-1 text-xs font-medium shadow">
            <span className="text-base leading-none">🚗</span> Chauffeur en direct
          </div>
        )}
        {error && (
          <div className="border-t border-border bg-background/95 px-3 py-2 text-center text-xs text-muted-foreground">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-muted">
      <div ref={mapRef} style={{ height }} className="w-full" />
      {driver && (
        <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5 rounded-md bg-background/95 px-2 py-1 text-xs font-medium shadow">
          <span className="text-base leading-none">🚗</span> Chauffeur en direct
        </div>
      )}
      {interactive && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-background/90 px-2 py-1 text-xs shadow">
          {!pickup ? "Cliquez sur la carte pour définir le départ" :
           !dropoff ? "Cliquez sur la carte pour définir l'arrivée" :
           "Glissez A ou B pour ajuster"}
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 p-4 text-center text-sm text-muted-foreground">
          <div>
            <p className="font-medium text-foreground">Carte indisponible</p>
            <p className="mt-1">{error}</p>
            <p className="mt-2 text-xs">
              Vérifiez que <code className="rounded bg-muted px-1">VITE_GOOGLE_MAPS_BROWSER_KEY</code> est
              une clé de <strong>votre</strong> projet Google Cloud (pas la clé Lovable), avec
              Maps JavaScript API activée.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
