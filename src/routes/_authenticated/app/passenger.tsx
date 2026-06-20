import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CATEGORIES, CITIES, estimateDistance, estimateDuration, estimatePrice, formatXof, getPriceBreakdown, getServiceZone, isInServiceZone, type Category } from "@/lib/pricing";
import { toast } from "sonner";
import { Banknote, CreditCard, MapPin, Phone, Smartphone, MessageCircle, ExternalLink, AlertTriangle, History, RotateCcw } from "lucide-react";
import { RideTrackingMap, type LatLng } from "@/components/RideTrackingMap";
import { computeRoute, geocodeAddress, reverseGeocode } from "@/lib/maps.functions";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { getNotificationPrefs } from "@/lib/tracking.functions";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/app/passenger")({
  head: () => ({ meta: [{ title: "Commander une course — Tibus Ride" }] }),
  component: PassengerPage,
});

const PAYMENTS = [
  { value: "mobile_money", label: "Mobile Money", icon: Smartphone, hint: "Orange Money, Wave, MTN, Moov" },
  { value: "cash", label: "Cash", icon: Banknote, hint: "À régler au chauffeur" },
  { value: "card", label: "Carte", icon: CreditCard, hint: "Visa / Mastercard" },
] as const;

function PassengerPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [city, setCity] = useState("Dakar");
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [category, setCategory] = useState<Category>("eco");
  const [payment, setPayment] = useState<"mobile_money" | "cash" | "card">("mobile_money");
  const [phone, setPhone] = useState("");

  // Map state — geocoded points + computed route
  const [pickupLL, setPickupLL] = useState<LatLng | null>(null);
  const [dropoffLL, setDropoffLL] = useState<LatLng | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ seconds: number; distanceMeters: number; polyline?: string } | null>(null);
  const geocodeFn = useServerFn(geocodeAddress);
  const routeFn = useServerFn(computeRoute);
  const reverseFn = useServerFn(reverseGeocode);

  // Refs to avoid re-geocoding text that we just wrote from a reverse-geocode
  const skipPickupGeoRef = useRef(false);
  const skipDropoffGeoRef = useRef(false);

  // Auto-geolocate user once → set pickup point + fill address
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const ll = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setPickupLL(ll);
      reverseFn({ data: ll }).then((r) => {
        if (r.ok) { skipPickupGeoRef.current = true; setPickup(r.formatted); }
      }).catch(() => {});
    }, () => {}, { enableHighAccuracy: true, timeout: 8000 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced geocoding when address text changes
  useEffect(() => {
    if (skipPickupGeoRef.current) { skipPickupGeoRef.current = false; return; }
    if (pickup.trim().length < 3) return;
    const t = setTimeout(() => {
      geocodeFn({ data: { address: `${pickup}, ${city}` } })
        .then((r) => { if (r.ok) setPickupLL({ lat: r.lat, lng: r.lng }); })
        .catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [pickup, city, geocodeFn]);

  useEffect(() => {
    if (skipDropoffGeoRef.current) { skipDropoffGeoRef.current = false; return; }
    if (dropoff.trim().length < 3) return;
    const t = setTimeout(() => {
      geocodeFn({ data: { address: `${dropoff}, ${city}` } })
        .then((r) => { if (r.ok) setDropoffLL({ lat: r.lat, lng: r.lng }); })
        .catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [dropoff, city, geocodeFn]);

  // Map interaction: clicking or dragging a marker updates LL + reverse-geocodes to fill input
  const handlePickupFromMap = (ll: LatLng) => {
    setPickupLL(ll);
    reverseFn({ data: ll }).then((r) => {
      if (r.ok) { skipPickupGeoRef.current = true; setPickup(r.formatted); }
    }).catch(() => {});
  };
  const handleDropoffFromMap = (ll: LatLng) => {
    setDropoffLL(ll);
    reverseFn({ data: ll }).then((r) => {
      if (r.ok) { skipDropoffGeoRef.current = true; setDropoff(r.formatted); }
    }).catch(() => {});
  };

  // Compute route when both points are known
  useEffect(() => {
    if (!pickupLL || !dropoffLL) { setRouteInfo(null); return; }
    routeFn({ data: { origin: pickupLL, destination: dropoffLL } })
      .then((r) => { if (r.ok) setRouteInfo({ seconds: r.seconds, distanceMeters: r.distanceMeters, polyline: r.polyline }); })
      .catch(() => {});
  }, [pickupLL?.lat, pickupLL?.lng, dropoffLL?.lat, dropoffLL?.lng, routeFn]);

  const km = routeInfo ? Math.max(1, Math.round(routeInfo.distanceMeters / 100) / 10) : estimateDistance(pickup, dropoff);
  const min = routeInfo ? Math.max(1, Math.round(routeInfo.seconds / 60)) : estimateDuration(km);
  const hasTrip = !!((pickup || pickupLL) && (dropoff || dropoffLL));
  const breakdown = hasTrip ? getPriceBreakdown(category, km, min, 0) : null;
  const price = breakdown?.total ?? 0;

  // Service zone checks
  const zone = getServiceZone(city);
  const pickupZone = isInServiceZone(city, pickupLL);
  const dropoffZone = isInServiceZone(city, dropoffLL);
  const outOfZone = (pickupLL && !pickupZone.ok) || (dropoffLL && !dropoffZone.ok);
  const mapBias = zone ? { lat: zone.lat, lng: zone.lng, radiusMeters: zone.radiusKm * 1000 } : undefined;

  // Recent rides — quick resume
  const recentRidesQ = useQuery({
    queryKey: ["recent-rides", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rides")
        .select("id, pickup_address, dropoff_address, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, city, category, created_at, status")
        .eq("passenger_id", user!.id)
        .in("status", ["completed", "cancelled"])
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  const resumeRide = (r: any) => {
    skipPickupGeoRef.current = true;
    skipDropoffGeoRef.current = true;
    setCity(r.city);
    setPickup(r.pickup_address);
    setDropoff(r.dropoff_address);
    setCategory(r.category as Category);
    if (r.pickup_lat && r.pickup_lng) setPickupLL({ lat: r.pickup_lat, lng: r.pickup_lng });
    if (r.dropoff_lat && r.dropoff_lng) setDropoffLL({ lat: r.dropoff_lat, lng: r.dropoff_lng });
    toast.success("Trajet repris — vérifiez et commandez");
  };



  const currentRideQ = useQuery({
    queryKey: ["current-ride", user?.id],
    enabled: !!user,
    refetchInterval: (query) => {
      const status = query.state.data?.status as string | undefined;
      return status && ["requested", "accepted", "arriving", "in_progress"].includes(status) ? 3000 : false;
    },
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rides")
        .select("*")
        .eq("passenger_id", user!.id)
        .in("status", ["requested", "accepted", "arriving", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const schema = z.object({
        pickup: z.string().trim().min(3, "Adresse de départ requise").max(200),
        dropoff: z.string().trim().min(3, "Adresse d'arrivée requise").max(200),
      });
      const parsed = schema.safeParse({ pickup, dropoff });
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);

      const { error, data } = await supabase.from("rides").insert({
        passenger_id: user!.id,
        pickup_address: pickup,
        dropoff_address: dropoff,
        pickup_lat: pickupLL?.lat ?? null,
        pickup_lng: pickupLL?.lng ?? null,
        dropoff_lat: dropoffLL?.lat ?? null,
        dropoff_lng: dropoffLL?.lng ?? null,
        city,
        category,
        distance_km: km,
        duration_min: min,
        price_xof: price,
        payment_method: payment,
        passenger_phone: phone || null,
        status: "requested",
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Course demandée ! Recherche d'un chauffeur…");
      qc.invalidateQueries({ queryKey: ["current-ride"] });
      navigate({ to: "/app/rides" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (currentRideQ.data) {
    return <CurrentRideBanner ride={currentRideQ.data} onCancel={() => qc.invalidateQueries({ queryKey: ["current-ride"] })} />;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section className="rounded-3xl border border-border bg-card p-6">
        <h1 className="font-display text-2xl font-bold">Où allez-vous ?</h1>
        <p className="text-sm text-muted-foreground">Renseignez votre trajet, choisissez votre véhicule.</p>

        <div className="mt-6 space-y-4">
          <div>
            <Label htmlFor="city">Ville</Label>
            <Select value={city} onValueChange={setCity}>
              <SelectTrigger id="city"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CITIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.value} <span className="text-xs text-muted-foreground">— {c.country}</span></SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="relative space-y-3">
            <div className="absolute left-[14px] top-[34px] bottom-[34px] w-0.5 bg-border" />
            <div className="relative flex items-start gap-3">
              <div className="mt-3 h-3 w-3 shrink-0 rounded-full bg-success ring-4 ring-success/20" />
              <AddressAutocomplete
                value={pickup}
                onChange={setPickup}
                placeholder="Adresse de départ"
                bias={mapBias}
                onSelect={({ lat, lng, formatted }) => {
                  skipPickupGeoRef.current = true;
                  setPickup(formatted);
                  setPickupLL({ lat, lng });
                }}
              />
            </div>
            <div className="relative flex items-start gap-3">
              <div className="mt-3 h-3 w-3 shrink-0 rounded-sm bg-primary ring-4 ring-primary/20" />
              <AddressAutocomplete
                value={dropoff}
                onChange={setDropoff}
                placeholder="Adresse d'arrivée"
                bias={mapBias}
                onSelect={({ lat, lng, formatted }) => {
                  skipDropoffGeoRef.current = true;
                  setDropoff(formatted);
                  setDropoffLL({ lat, lng });
                }}
              />
            </div>
          </div>

          {outOfZone && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <strong>Hors zone de service.</strong> {zone?.value} est couverte dans un rayon de {zone?.radiusKm} km.
                {pickupLL && !pickupZone.ok && pickupZone.distanceKm != null && (
                  <div>Départ à ~{pickupZone.distanceKm.toFixed(1)} km du centre.</div>
                )}
                {dropoffLL && !dropoffZone.ok && dropoffZone.distanceKm != null && (
                  <div>Arrivée à ~{dropoffZone.distanceKm.toFixed(1)} km du centre.</div>
                )}
              </div>
            </div>
          )}

          {zone && zone.districts.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Quartiers couverts à {zone.value} : {zone.districts.join(" · ")}
            </div>
          )}

          <div className="space-y-2">
            <RideTrackingMap
              pickup={pickupLL}
              dropoff={dropoffLL}
              polyline={routeInfo?.polyline}
              height={260}
              interactive
              center={zone ? { lat: zone.lat, lng: zone.lng } : undefined}
              onPickupChange={handlePickupFromMap}
              onDropoffChange={handleDropoffFromMap}
            />
            {routeInfo && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs">
                <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3 text-primary" /> {(routeInfo.distanceMeters / 1000).toFixed(1)} km</span>
                <span className="text-muted-foreground">·</span>
                <span>⏱ Durée estimée : <strong className="text-foreground">{Math.round(routeInfo.seconds / 60)} min</strong></span>
              </div>
            )}
            {(!pickupLL || !dropoffLL) && (
              <p className="text-xs text-muted-foreground">
                Astuce : tapez une adresse et choisissez une suggestion, ou cliquez sur la carte.
              </p>
            )}
          </div>

          <div>
            <Label>Type de véhicule</Label>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {(Object.entries(CATEGORIES) as Array<[Category, typeof CATEGORIES[Category]]>).map(([key, c]) => {
                const selected = category === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setCategory(key)}
                    className={[
                      "rounded-xl border p-3 text-left transition-all",
                      selected ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border hover:border-primary/50",
                    ].join(" ")}
                  >
                    <div className="text-2xl">{c.emoji}</div>
                    <div className="mt-1 text-sm font-semibold">{c.label}</div>
                    <div className="text-xs text-muted-foreground">{c.capacity}</div>
                    <div className="text-xs text-muted-foreground">{c.eta}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label>Paiement</Label>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {PAYMENTS.map((p) => {
                const Icon = p.icon;
                const selected = payment === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPayment(p.value)}
                    className={[
                      "flex items-start gap-3 rounded-xl border p-3 text-left transition-all",
                      selected ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border hover:border-primary/50",
                    ].join(" ")}
                  >
                    <Icon className="h-5 w-5 text-primary" />
                    <div>
                      <div className="text-sm font-semibold">{p.label}</div>
                      <div className="text-xs text-muted-foreground">{p.hint}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label htmlFor="phone">Téléphone (optionnel — pour que le chauffeur vous joigne)</Label>
            <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+221 77 ..." maxLength={20} />
          </div>
        </div>
      </section>

      <aside className="space-y-4">
        <div className="rounded-3xl border border-border bg-card p-6">
          <h3 className="font-display text-lg font-semibold">Tarif détaillé</h3>
          <p className="text-xs text-muted-foreground">Estimation transparente, mise à jour en temps réel.</p>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Véhicule</dt><dd>{CATEGORIES[category].label}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Distance</dt><dd>{breakdown ? `${km} km` : "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Durée</dt><dd>{breakdown ? `${min} min` : "—"}</dd></div>
            <div className="my-2 border-t border-border" />
            <div className="flex justify-between"><dt className="text-muted-foreground">Prise en charge (base)</dt><dd>{breakdown ? formatXof(breakdown.base) : "—"}</dd></div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Distance ({km > 0 ? `${km} × ${CATEGORIES[category].perKm}` : "—"})</dt>
              <dd>{breakdown ? formatXof(breakdown.distance) : "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Durée ({min > 0 ? `${min} × ${CATEGORIES[category].perMin}` : "—"})</dt>
              <dd>{breakdown ? formatXof(breakdown.duration) : "—"}</dd>
            </div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Frais de livraison</dt><dd>{breakdown ? formatXof(breakdown.delivery) : "—"}</dd></div>
            <div className="my-2 border-t border-border" />
            <div className="flex items-baseline justify-between">
              <dt className="text-muted-foreground">Total estimé</dt>
              <dd className="font-display text-2xl font-bold text-primary">{price > 0 ? formatXof(price) : "—"}</dd>
            </div>
          </dl>
          <Button
            className="mt-6 w-full"
            size="lg"
            disabled={!pickup || !dropoff || !!outOfZone || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Envoi…" : outOfZone ? "Hors zone de service" : "Commander la course"}
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            Tarif indicatif. Le prix final peut varier selon le trafic.
          </p>
        </div>

        {(recentRidesQ.data?.length ?? 0) > 0 && (
          <div className="rounded-3xl border border-border bg-card p-6">
            <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
              <History className="h-4 w-4 text-primary" /> Trajets récents
            </h3>
            <ul className="mt-3 space-y-2">
              {(recentRidesQ.data ?? []).map((r: any) => (
                <li key={r.id} className="rounded-xl border border-border p-3 text-xs">
                  <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{new Date(r.created_at).toLocaleDateString("fr-FR")}</span>
                    <span>{r.city} · {CATEGORIES[r.category as Category]?.label}</span>
                  </div>
                  <div className="flex items-start gap-1.5"><MapPin className="mt-0.5 h-3 w-3 shrink-0 text-success" /><span className="truncate">{r.pickup_address}</span></div>
                  <div className="flex items-start gap-1.5"><MapPin className="mt-0.5 h-3 w-3 shrink-0 text-primary" /><span className="truncate">{r.dropoff_address}</span></div>
                  <Button size="sm" variant="outline" className="mt-2 h-7 w-full text-xs" onClick={() => resumeRide(r)}>
                    <RotateCcw className="mr-1 h-3 w-3" /> Reprendre ce trajet
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  requested: "Recherche d'un chauffeur…",
  accepted: "Chauffeur en route",
  arriving: "Le chauffeur arrive",
  in_progress: "Course en cours",
};

function CurrentRideBanner({ ride: initialRide, onCancel }: { ride: any; onCancel: () => void }) {
  const qc = useQueryClient();
  const [ride, setRide] = useState<any>(initialRide);
  const [pickup, setPickup] = useState<LatLng | null>(
    initialRide.pickup_lat != null && initialRide.pickup_lng != null
      ? { lat: Number(initialRide.pickup_lat), lng: Number(initialRide.pickup_lng) }
      : null,
  );
  const [dropoff, setDropoff] = useState<LatLng | null>(
    initialRide.dropoff_lat != null && initialRide.dropoff_lng != null
      ? { lat: Number(initialRide.dropoff_lat), lng: Number(initialRide.dropoff_lng) }
      : null,
  );
  const [polyline, setPolyline] = useState<string | undefined>();
  const [etaSec, setEtaSec] = useState<number | null>(initialRide.eta_seconds ?? null);
  const alertedArrivingRef = useRef(false);
  const alertedNearbyRef = useRef(false);
  const lastRouteCallRef = useRef(0);
  const lastStatusNotifiedRef = useRef<string>(initialRide.status);

  // Polling direct sur la course (indépendant de Realtime / React Query parent)
  const rideLiveQ = useQuery({
    queryKey: ["ride-live", initialRide.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("rides").select("*").eq("id", initialRide.id).single();
      if (error) throw error;
      return data;
    },
    refetchInterval: 2000,
  });

  const activeRide = rideLiveQ.data ?? ride;

  useEffect(() => {
    setRide(initialRide);
  }, [initialRide]);

  useEffect(() => {
    if (activeRide.pickup_lat != null && activeRide.pickup_lng != null) {
      setPickup({ lat: Number(activeRide.pickup_lat), lng: Number(activeRide.pickup_lng) });
    }
    if (activeRide.dropoff_lat != null && activeRide.dropoff_lng != null) {
      setDropoff({ lat: Number(activeRide.dropoff_lat), lng: Number(activeRide.dropoff_lng) });
    }
  }, [activeRide.pickup_lat, activeRide.pickup_lng, activeRide.dropoff_lat, activeRide.dropoff_lng]);

  useEffect(() => {
    if (rideLiveQ.data) setRide(rideLiveQ.data);
  }, [rideLiveQ.data]);

  const geocodeFn = useServerFn(geocodeAddress);
  const routeFn = useServerFn(computeRoute);
  const getPrefsFn = useServerFn(getNotificationPrefs);
  const { data: prefs } = useQuery({ queryKey: ["notif-prefs"], queryFn: () => getPrefsFn() });

  // Driver contact — via security-definer RPC (only safe vehicle / contact fields)
  const driverQ = useQuery({
    queryKey: ["ride-driver", ride.id, ride.driver_id],
    enabled: !!ride.driver_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("get_ride_driver_public", { _ride_id: ride.id })
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Geocode addresses if no coords
  useEffect(() => {
    if (!pickup) geocodeFn({ data: { address: `${ride.pickup_address}, ${ride.city}` } }).then((r) => r.ok && setPickup({ lat: r.lat, lng: r.lng })).catch(() => {});
    if (!dropoff) geocodeFn({ data: { address: `${ride.dropoff_address}, ${ride.city}` } }).then((r) => r.ok && setDropoff({ lat: r.lat, lng: r.lng })).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ask notification permission on mount
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Helper: push notification + sound
  const notify = (title: string, body: string, type: "status" | "arriving" | "nearby") => {
    const opt = type === "status" ? prefs?.notify_status_change
      : type === "arriving" ? prefs?.notify_driver_arriving
      : prefs?.notify_driver_nearby;
    if (opt === false) return;
    toast.success(title, { description: body, duration: 7000 });
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try { new Notification(title, { body, tag: `ride-${ride.id}-${type}`, icon: "/favicon.ico" }); } catch {}
    }
    if (prefs?.sound_enabled !== false) {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = 880; g.gain.value = 0.15;
        o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 350);
      } catch {}
    }
  };

  // Realtime subscription to this ride
  useEffect(() => {
    const ch = supabase
      .channel(`ride-${ride.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rides", filter: `id=eq.${ride.id}` }, (payload) => {
        const next: any = payload.new;
        setRide(next);
        if (next.eta_seconds != null) setEtaSec(next.eta_seconds);
        // status change notification
        if (next.status !== lastStatusNotifiedRef.current) {
          lastStatusNotifiedRef.current = next.status;
          const label = STATUS_LABEL[next.status] ?? next.status;
          notify("Mise à jour de la course", label, "status");
        }
        // arrival notification
        if (next.status === "arriving" && !alertedArrivingRef.current) {
          alertedArrivingRef.current = true;
          notify("Votre chauffeur est arrivé !", "Rejoignez-le au point de départ.", "arriving");
        }
        if (next.status === "completed" || next.status === "cancelled") {
          qc.invalidateQueries({ queryKey: ["current-ride"] });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride.id, qc, prefs?.notify_status_change, prefs?.notify_driver_arriving, prefs?.sound_enabled]);

  // Driver position — toujours depuis la course live (polling 2s)
  const driverPos: LatLng | null =
    activeRide.driver_lat != null && activeRide.driver_lng != null
      ? { lat: Number(activeRide.driver_lat), lng: Number(activeRide.driver_lng) }
      : null;

  useEffect(() => {
    if (!pickup || !driverPos) return;
    const R = 6371000; const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(pickup.lat - driverPos.lat);
    const dLng = toRad(pickup.lng - driverPos.lng);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(pickup.lat)) * Math.cos(toRad(driverPos.lat)) * Math.sin(dLng / 2) ** 2;
    const distM = 2 * R * Math.asin(Math.sqrt(a));
    if (distM < 300 && !alertedNearbyRef.current && activeRide.status !== "in_progress") {
      alertedNearbyRef.current = true;
      notify("Chauffeur à proximité", `À ~${Math.round(distM)} m de votre point de départ.`, "nearby");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverPos?.lat, driverPos?.lng, pickup?.lat, pickup?.lng, activeRide.status]);

  // Throttled ETA / polyline recompute (max once every 10s)
  useEffect(() => {
    if (!pickup || !dropoff) return;
    const isInProgress = activeRide.status === "in_progress";
    const origin = !isInProgress && driverPos ? driverPos : pickup;
    const destination = isInProgress ? dropoff : pickup;
    if (origin.lat === destination.lat && origin.lng === destination.lng) return;
    const now = Date.now();
    const wait = Math.max(0, 10_000 - (now - lastRouteCallRef.current));
    const t = setTimeout(() => {
      lastRouteCallRef.current = Date.now();
      routeFn({ data: { origin, destination } }).then((r) => {
        if (r.ok) {
          setPolyline(r.polyline);
          if (!isInProgress) setEtaSec(r.seconds);
        }
      }).catch(() => {});
    }, wait);
    return () => clearTimeout(t);
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, driverPos?.lat, driverPos?.lng, activeRide.status, routeFn]);

  const cancel = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("rides").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", ride.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Course annulée"); onCancel(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const etaText = etaSec != null ? (etaSec < 60 ? `${etaSec}s` : `${Math.round(etaSec / 60)} min`) : "—";
  const driverPhone = (driverQ.data as any)?.phone as string | undefined;

  return (
    <div className="space-y-4 rounded-3xl border border-primary/30 bg-primary/5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          {STATUS_LABEL[ride.status] ?? ride.status}
        </div>
        {ride.status !== "in_progress" && ride.driver_id && (
          <div className="rounded-full bg-card px-3 py-1 text-xs font-semibold">
            Arrivée estimée : <span className="text-primary">{etaText}</span>
          </div>
        )}
      </div>

      {pickup ? (
        <RideTrackingMap
          pickup={pickup}
          dropoff={dropoff ?? pickup}
          driver={driverPos}
          polyline={polyline}
          height={340}
          followDriver
        />
      ) : (
        <div className="flex h-[340px] items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">
          Chargement de la carte…
        </div>
      )}

      {driverPos && (
        <p className="text-center text-xs text-muted-foreground">
          Position chauffeur : {driverPos.lat.toFixed(5)}, {driverPos.lng.toFixed(5)}
          {activeRide.driver_location_updated_at
            ? ` · maj ${new Date(activeRide.driver_location_updated_at).toLocaleTimeString("fr-FR")}`
            : ""}
        </p>
      )}

      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="flex items-start gap-2"><MapPin className="h-4 w-4 text-success mt-0.5" /><div><div className="text-xs text-muted-foreground">Départ</div>{ride.pickup_address}</div></div>
        <div className="flex items-start gap-2"><MapPin className="h-4 w-4 text-primary mt-0.5" /><div><div className="text-xs text-muted-foreground">Arrivée</div>{ride.dropoff_address}</div></div>
      </div>

      {ride.driver_id && driverQ.data && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs text-muted-foreground">Votre chauffeur</div>
              <div className="font-semibold">{(driverQ.data as any).full_name ?? "Chauffeur"}</div>
              <div className="text-xs text-muted-foreground">
                {(driverQ.data as any).vehicle_model ?? ""} {(driverQ.data as any).vehicle_plate ? `· ${(driverQ.data as any).vehicle_plate}` : ""}
                {(driverQ.data as any).rating_avg ? ` · ★ ${Number((driverQ.data as any).rating_avg).toFixed(1)}` : ""}
              </div>
            </div>
            {driverPhone && ride.driver_shares_phone ? (
              <div className="flex gap-2">
                <Button asChild size="sm" variant="outline"><a href={`tel:${driverPhone}`}><Phone className="mr-1 h-4 w-4" />Appeler</a></Button>
                <Button asChild size="sm" variant="outline">
                  <a href={`https://wa.me/${driverPhone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer">
                    <MessageCircle className="mr-1 h-4 w-4" />WhatsApp
                  </a>
                </Button>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">{ride.driver_shares_phone === false ? "Numéro masqué par le chauffeur" : "Téléphone non renseigné"}</div>
            )}
          </div>
          <div className="mt-3 border-t border-border pt-3">
            <Link to="/app/ride/$rideId" params={{ rideId: ride.id }} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              Voir l'historique et gérer le contact <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
        <div>
          <div className="text-xs text-muted-foreground">Prix</div>
          <div className="font-display text-2xl font-bold">{formatXof(ride.price_xof)}</div>
        </div>
        {(ride.status === "requested" || ride.status === "accepted" || ride.status === "arriving") && (
          <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>Annuler</Button>
        )}
      </div>
    </div>
  );
}
