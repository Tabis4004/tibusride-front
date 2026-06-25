import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CATEGORIES, countryForCoords, estimateDistance, estimateDuration, formatXof, getServiceZone, isInServiceZone, nearestServiceCity, resolveServiceCity, type Category } from "@/lib/pricing";
import { Switch } from "@/components/ui/switch";
import { computeDynamicPrice, estimateDriverWaitMin, type DynamicPriceBreakdown, type WeatherKind } from "@/lib/dynamic-pricing";
import {
  computeDeliveryPrice,
  DELIVERY_EXTRAS,
  DELIVERY_VEHICLES,
  estimateDeliveryWaitMin,
  PACKAGE_TYPES,
  type DeliveryPriceBreakdown,
  type DeliveryVehicle,
  type PackageType,
} from "@/lib/delivery-pricing";
import { toast } from "sonner";
import { Banknote, Car, ChevronRight, CreditCard, MapPin, Phone, Smartphone, MessageCircle, ExternalLink, AlertTriangle, History, RotateCcw, Navigation2, UtensilsCrossed, Package } from "lucide-react";
import { RideTrackingMap, type LatLng } from "@/components/RideTrackingMap";
import { computeRoute, reverseGeocode, getWeatherAtPoint, geocodeAddress } from "@/lib/maps.functions";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { DeliveryPartnerAds } from "@/components/DeliveryPartnerAds";
import { CarIcon } from "@/components/CarIcon";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getNotificationPrefs } from "@/lib/tracking.functions";
import { getNotifyPermission, requestNotifyPermission, showLocalNotification, speakAnnouncementCloud } from "@/lib/notify";
import { getAnnouncementAudioUrl, ANNOUNCEMENT_TEXT } from "@/lib/tts.functions";
import { getEffectivePricingConfig } from "@/lib/pricing.functions";
import { getCurrentPosition } from "@/lib/native-geolocation";
import { useNativeApp } from "@/hooks/use-native-app";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { formatDriverArrivalMessage, formatDriverVehicleDescription, type DriverVehiclePublic } from "@/lib/driver-vehicle";
import { useCountryMarket } from "@/hooks/use-country-market";
import { fetchDefaultMarketProgram, isEcoTibus, marketAppName, type PaymentMethodValue } from "@/lib/country-market";
import { MarketProgramSwitcher } from "@/components/MarketProgramSwitcher";

export const Route = createFileRoute("/_authenticated/app/passenger")({
  head: () => ({ meta: [{ title: "Commander une course — Tibus Ride" }] }),
  component: PassengerPage,
});

function PassengerPage() {
  const { user } = useAuth();
  const { payments: countryPayments, config: marketConfig } = useCountryMarket();
  const qc = useQueryClient();
  const isNative = useNativeApp();
  const [city, setCity] = useState("");
  const profileRef = useRef<{ city?: string | null; country?: string | null }>({});
  const [cityReady, setCityReady] = useState(false);
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [category, setCategory] = useState<Category>("eco");
  const [serviceMode, setServiceMode] = useState<"ride" | "delivery">("ride");
  const [deliveryVehicle, setDeliveryVehicle] = useState<DeliveryVehicle>("motorcycle");
  const [packageType, setPackageType] = useState<PackageType>("small");
  const [deliveryUrgent, setDeliveryUrgent] = useState(false);
  const [deliveryInsulatedBag, setDeliveryInsulatedBag] = useState(false);
  const [payment, setPayment] = useState<PaymentMethodValue>("mobile_money");
  const paymentOptions = useMemo(() => {
    if (countryPayments.length > 0) return countryPayments;
    return [
      { value: "mobile_money" as const, label: "Mobile Money", providerCode: "mobile_money", icon: Smartphone, hint: "Orange Money, Wave, MTN, Moov" },
      { value: "cash" as const, label: "Espèces", providerCode: "cash", icon: Banknote },
      { value: "card" as const, label: "Carte", providerCode: "card", icon: CreditCard },
    ];
  }, [countryPayments]);
  const [phone, setPhone] = useState("");

  // Map state — geocoded points + computed route
  const [pickupLL, setPickupLL] = useState<LatLng | null>(null);
  const [dropoffLL, setDropoffLL] = useState<LatLng | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ seconds: number; staticSeconds: number; distanceMeters: number; polyline?: string } | null>(null);
  const routeFn = useServerFn(computeRoute);
  const reverseFn = useServerFn(reverseGeocode);
  const weatherFn = useServerFn(getWeatherAtPoint);
  const [weather, setWeather] = useState<WeatherKind>("sunny");

  // Règle : le tarif et la commission liés à une course se résolvent sur
  // l'adresse GPS réelle de départ, sans aucune considération de ville ou de
  // pays enregistrés au profil. Le passager n'a aucune contrainte ici — il
  // peut commander depuis n'importe quelle adresse, son pays de profil ne
  // joue aucun rôle dans le calcul.
  const pickupCountry = useMemo(() => (pickupLL ? countryForCoords(pickupLL) : null), [pickupLL]);
  const pickupProgramQ = useQuery({
    queryKey: ["pickup-market-program", pickupCountry],
    queryFn: () => fetchDefaultMarketProgram(pickupCountry!),
    enabled: !!pickupCountry,
    staleTime: 5 * 60 * 1000,
  });
  // Tant que le point de départ n'est pas encore géocodé, on retombe sur le
  // programme du profil (affichage initial uniquement) — dès que pickupLL
  // est connu, c'est lui qui décide.
  const pricingProgramId = pickupProgramQ.data?.programId ?? marketConfig?.programId ?? null;

  // Même règle pour la zone de service : dès que le point de départ est connu
  // (GPS, carte ou adresse tapée/sélectionnée), c'est lui qui détermine la
  // ville/zone de référence — le profil n'est qu'un repli avant ce moment,
  // pour éviter qu'une adresse réelle en Côte d'Ivoire (ex.) ne soit comparée
  // par erreur au rayon de Dakar parce que le profil était vide.
  useEffect(() => {
    if (!pickupLL) return;
    setCity(nearestServiceCity(pickupLL));
  }, [pickupLL?.lat, pickupLL?.lng]);

  // Tarif dynamique : base/km/min (pricing_settings) + coefficients trafic/météo
  // (dynamic_pricing_settings, scoped programme) — résolus en base, plus de
  // constantes codées en dur dans dynamic-pricing.ts/delivery-pricing.ts.
  const pricingConfigFn = useServerFn(getEffectivePricingConfig);
  const pricingConfigQ = useQuery({
    queryKey: ["pricing-config", pricingProgramId],
    queryFn: () => pricingConfigFn({ data: { programId: pricingProgramId } }),
    staleTime: 60_000,
  });

  // Évite d'effacer les coordonnées quand le texte est mis à jour programmatiquement (carte, GPS, liste).
  const programmaticPickupRef = useRef(false);
  const programmaticDropoffRef = useRef(false);
  const [pickupGeoLoading, setPickupGeoLoading] = useState(true);
  const [tripOpen, setTripOpen] = useState(false);
  const [pickupOpen, setPickupOpen] = useState(false);

  const applyCurrentLocationPickup = useCallback(() => {
    setPickupGeoLoading(true);
    getCurrentPosition({ enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 })
      .then((pos) => {
        const ll = { lat: pos.coords.lat, lng: pos.coords.lng };
        setPickupLL(ll);
        const resolved = resolveServiceCity({
          profileCity: profileRef.current.city,
          profileCountry: profileRef.current.country,
          gps: ll,
        });
        setCity(resolved);
        return reverseFn({ data: ll })
          .then((r) => {
            programmaticPickupRef.current = true;
            setPickup(r.ok ? r.formatted : "Ma position actuelle");
          })
          .catch(() => {
            programmaticPickupRef.current = true;
            setPickup("Ma position actuelle");
          });
      })
      .catch((err: { code?: string }) => {
        if (err?.code === "PERMISSION_DENIED") {
          toast.error("Autorisez la localisation pour préremplir votre point de départ.");
        }
      })
      .finally(() => setPickupGeoLoading(false));
  }, [reverseFn]);

  const onPickupChange = (v: string) => {
    setPickup(v);
    if (!programmaticPickupRef.current) setPickupLL(null);
    programmaticPickupRef.current = false;
  };
  const onDropoffChange = (v: string) => {
    setDropoff(v);
    if (!programmaticDropoffRef.current) setDropoffLL(null);
    programmaticDropoffRef.current = false;
  };

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("city, country, phone").eq("id", user.id).maybeSingle()
      .then(({ data }) => {
        profileRef.current = { city: data?.city, country: data?.country };
        const resolved = resolveServiceCity({
          profileCity: data?.city,
          profileCountry: data?.country,
        });
        setCity(resolved);
        setCityReady(true);
        // Le téléphone est obligatoire pour la course (le chauffeur doit
        // pouvoir appeler à l'arrivée) — on le préremplit depuis le profil,
        // déjà collecté et validé à l'inscription.
        if (data?.phone) setPhone((p) => p || data.phone!);
      });
  }, [user?.id]);

  useEffect(() => {
    if (!cityReady) return;
    applyCurrentLocationPickup();
  }, [cityReady, applyCurrentLocationPickup]);

  // Map interaction: clicking or dragging a marker updates LL + reverse-geocodes to fill input
  const handlePickupFromMap = (ll: LatLng) => {
    setPickupLL(ll);
    reverseFn({ data: ll }).then((r) => {
      if (r.ok) { programmaticPickupRef.current = true; setPickup(r.formatted); }
    }).catch(() => {});
  };
  const handleDropoffFromMap = (ll: LatLng) => {
    setDropoffLL(ll);
    reverseFn({ data: ll }).then((r) => {
      if (r.ok) { programmaticDropoffRef.current = true; setDropoff(r.formatted); }
    }).catch(() => {});
  };

  // Compute route when both points are known
  useEffect(() => {
    if (!pickupLL || !dropoffLL) { setRouteInfo(null); return; }
    routeFn({ data: { origin: pickupLL, destination: dropoffLL } })
      .then((r) => {
        if (r.ok) {
          setRouteInfo({
            seconds: r.seconds,
            staticSeconds: r.staticSeconds ?? r.seconds,
            distanceMeters: r.distanceMeters,
            polyline: r.polyline,
          });
        }
      })
      .catch(() => {});
  }, [pickupLL?.lat, pickupLL?.lng, dropoffLL?.lat, dropoffLL?.lng, routeFn]);

  useEffect(() => {
    if (!pickupLL) return;
    weatherFn({ data: pickupLL })
      .then((r) => { if (r.ok) setWeather(r.weather); })
      .catch(() => {});
  }, [pickupLL?.lat, pickupLL?.lng, weatherFn]);

  const km = routeInfo ? Math.max(1, Math.round(routeInfo.distanceMeters / 100) / 10) : estimateDistance(pickup, dropoff);
  const min = routeInfo ? Math.max(1, Math.round(routeInfo.seconds / 60)) : estimateDuration(km);
  const staticMin = routeInfo ? Math.max(1, Math.round(routeInfo.staticSeconds / 60)) : min;
  const hasTrip = !!(pickupLL && dropoffLL);
  const pricingConfig = pricingConfigQ.data;
  const rideBreakdown: DynamicPriceBreakdown | null =
    serviceMode === "ride" && hasTrip
      ? computeDynamicPrice({
          category,
          km,
          durationMin: min,
          staticDurationMin: staticMin,
          weather,
          rates: pricingConfig?.categories[category],
          coefficients: pricingConfig?.dynamic,
        })
      : null;
  const deliveryBreakdown: DeliveryPriceBreakdown | null =
    serviceMode === "delivery" && hasTrip
      ? computeDeliveryPrice({
          vehicle: deliveryVehicle,
          packageType,
          km,
          durationMin: min,
          staticDurationMin: staticMin,
          weather,
          urgent: deliveryUrgent,
          insulatedBag: deliveryInsulatedBag,
          rates: pricingConfig?.deliveryVehicles?.[deliveryVehicle],
          coefficients: pricingConfig?.dynamic,
          packageMultiplier: pricingConfig?.packageMultipliers?.[packageType],
          extras: pricingConfig?.deliveryExtras,
        })
      : null;
  const breakdown = serviceMode === "delivery" ? deliveryBreakdown : rideBreakdown;
  const price = breakdown?.total ?? 0;

  // Service zone checks
  const zone = getServiceZone(city);
  const pickupZone = isInServiceZone(city, pickupLL);
  const dropoffZone = isInServiceZone(city, dropoffLL);
  const outOfZone = (pickupLL && !pickupZone.ok) || (dropoffLL && !dropoffZone.ok);
  const mapBias = zone ? { lat: zone.lat, lng: zone.lng, radiusMeters: zone.radiusKm * 1000 } : undefined;
  const pickupBias = pickupLL
    ? { lat: pickupLL.lat, lng: pickupLL.lng, radiusMeters: 25000 }
    : mapBias;
  const dropoffBias = pickupLL
    ? { lat: pickupLL.lat, lng: pickupLL.lng, radiusMeters: 40000 }
    : mapBias;
  const nearbyPickupOption = pickupLL && pickup
    ? { title: "Ma position actuelle", subtitle: pickup, lat: pickupLL.lat, lng: pickupLL.lng, formatted: pickup }
    : undefined;

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
    programmaticPickupRef.current = true;
    programmaticDropoffRef.current = true;
    setCity(r.city);
    setPickup(r.pickup_address);
    setDropoff(r.dropoff_address);
    setCategory(r.category as Category);
    if (r.pickup_lat && r.pickup_lng) setPickupLL({ lat: r.pickup_lat, lng: r.pickup_lng });
    if (r.dropoff_lat && r.dropoff_lng) setDropoffLL({ lat: r.dropoff_lat, lng: r.dropoff_lng });
    setTripOpen(true);
    toast.success("Trajet repris — vérifiez et commandez");
  };

  const quickDestination = (address: string, lat?: number | null, lng?: number | null) => {
    programmaticDropoffRef.current = true;
    setDropoff(address);
    if (lat != null && lng != null) setDropoffLL({ lat, lng });
    else setDropoffLL(null);
    setTripOpen(true);
  };

  const pickupSummary = pickupGeoLoading
    ? "Détection de votre position…"
    : pickup
      ? pickup.split(",")[0]
      : "Position non définie";



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
      if (!pickupLL || !dropoffLL) {
        throw new Error("Sélectionnez chaque adresse dans la liste Google ou cliquez sur la carte.");
      }

      const insertPayload: Record<string, unknown> = {
        passenger_id: user!.id,
        pickup_address: pickup,
        dropoff_address: dropoff,
        pickup_lat: pickupLL?.lat ?? null,
        pickup_lng: pickupLL?.lng ?? null,
        dropoff_lat: dropoffLL?.lat ?? null,
        dropoff_lng: dropoffLL?.lng ?? null,
        // Pays et programme = résolus depuis l'adresse GPS réelle de départ
        // (pickupCountry/pricingProgramId), jamais depuis le pays du profil —
        // c'est ce qui fixe le tarif et la commission appliqués à cette course.
        country: pickupCountry ?? undefined,
        program_id: pricingProgramId ?? undefined,
        city,
        category: serviceMode === "delivery" ? "eco" : category,
        service_type: serviceMode,
        distance_km: km,
        duration_min: min,
        price_xof: price,
        payment_method: payment,
        passenger_phone: phone || null,
        status: "requested",
      };
      if (serviceMode === "delivery") {
        insertPayload.delivery_vehicle = deliveryVehicle;
        insertPayload.package_type = packageType;
        insertPayload.delivery_urgent = deliveryUrgent;
        insertPayload.delivery_insulated_bag = deliveryInsulatedBag;
        const pkg = PACKAGE_TYPES[packageType];
        const extras = [
          deliveryUrgent ? "urgent" : null,
          deliveryInsulatedBag ? "sac isotherme" : null,
        ].filter(Boolean).join(", ");
        insertPayload.notes = `Livraison ${DELIVERY_VEHICLES[deliveryVehicle].label} · ${pkg.label}${extras ? ` · ${extras}` : ""}`;
      }

      const { error, data } = await supabase.from("rides").insert(insertPayload as never).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      const waitEst = serviceMode === "delivery"
        ? estimateDeliveryWaitMin(deliveryVehicle)
        : estimateDriverWaitMin(category);
      toast.success(serviceMode === "delivery" ? "Livraison demandée !" : "Course demandée !", {
        description: serviceMode === "delivery"
          ? `Recherche d'un livreur… attente estimée ~${waitEst} min`
          : `Recherche d'un chauffeur… temps d'attente estimé ~${waitEst} min`,
        duration: 8000,
      });
      qc.invalidateQueries({ queryKey: ["current-ride"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (currentRideQ.data) {
    return <CurrentRideBanner ride={currentRideQ.data} onCancel={() => qc.invalidateQueries({ queryKey: ["current-ride"] })} />;
  }

  return (
    <div className={cn("grid min-w-0 gap-6", isNative ? "gap-4" : "lg:grid-cols-[minmax(0,1fr)_340px]")}>
      <div className="min-w-0 space-y-4">
        {/* En-tête type Yango */}
        <section className="rounded-3xl border border-border bg-card p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{zone ? `${zone.value} — ${zone.country}` : "Détection de votre zone…"}</p>
              <h1 className="font-display text-xl font-bold">{marketAppName(marketConfig)}</h1>
            </div>
            <MarketProgramSwitcher className="shrink-0" />
          </div>

          {/* Services rapides */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setServiceMode("ride")}
              className={cn(
                "rounded-2xl border p-3 text-left transition-all",
                serviceMode === "ride" ? "border-primary/30 bg-primary/5 ring-1 ring-primary/20" : "border-border bg-muted/30",
              )}
            >
              <Car className={cn("h-5 w-5", serviceMode === "ride" ? "text-primary" : "text-muted-foreground")} />
              <div className="mt-2 text-xs font-semibold">Courses</div>
              <div className="text-[10px] text-muted-foreground">dès 4 min</div>
            </button>
            <button
              type="button"
              onClick={() => setServiceMode("delivery")}
              className={cn(
                "rounded-2xl border p-3 text-left transition-all",
                serviceMode === "delivery" ? "border-primary/30 bg-primary/5 ring-1 ring-primary/20" : "border-border bg-muted/30",
              )}
            >
              <Package className={cn("h-5 w-5", serviceMode === "delivery" ? "text-primary" : "text-muted-foreground")} />
              <div className="mt-2 text-xs font-semibold">Livraison</div>
              <div className="text-[10px] text-muted-foreground">colis & repas</div>
            </button>
            <button type="button" onClick={() => toast.info("Tibus Food — bientôt disponible")} className="rounded-2xl border border-border bg-muted/30 p-3 text-left opacity-80">
              <UtensilsCrossed className="h-5 w-5 text-muted-foreground" />
              <div className="mt-2 text-xs font-semibold">Food</div>
              <div className="text-[10px] text-muted-foreground">restos</div>
            </button>
          </div>
        </section>

        {/* Position actuelle — accordéon fermé */}
        <section className="rounded-3xl border border-border bg-card px-4 py-1">
          <Collapsible open={pickupOpen} onOpenChange={setPickupOpen}>
            <CollapsibleTrigger className="flex w-full items-center gap-3 py-3 text-left">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/10">
                <Navigation2 className="h-4 w-4 text-success" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-muted-foreground">Votre position</div>
                <div className="truncate text-sm font-medium">{pickupSummary}</div>
              </div>
              <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${pickupOpen ? "rotate-90" : ""}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pb-4">
              <div className="flex items-start gap-2">
                <AddressAutocomplete
                  value={pickup}
                  onChange={onPickupChange}
                  placeholder={pickupGeoLoading ? "Détection de votre position…" : "Adresse de départ"}
                  bias={pickupBias}
                  regionCode={zone?.countryCode}
                  resolved={!!pickupLL}
                  nearbyOption={nearbyPickupOption}
                  onSelect={({ lat, lng, formatted }) => {
                    programmaticPickupRef.current = true;
                    setPickup(formatted);
                    setPickupLL({ lat, lng });
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  title="Utiliser ma position actuelle"
                  disabled={pickupGeoLoading}
                  onClick={applyCurrentLocationPickup}
                >
                  <Navigation2 className={`h-4 w-4 ${pickupGeoLoading ? "animate-pulse text-primary" : ""}`} />
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </section>

        {/* Où allons-nous ? — accordéon fermé par défaut */}
        <section className="rounded-3xl border border-border bg-card overflow-hidden">
          <Collapsible open={tripOpen} onOpenChange={setTripOpen}>
            <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-muted/30">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted">
                <Car className="h-5 w-5 text-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold">
                  {dropoff
                    ? dropoff.split(",")[0]
                    : serviceMode === "delivery"
                      ? "Où livrer ?"
                      : "Où allons-nous ?"}
                </div>
                {dropoff && (
                  <div className="truncate text-xs text-muted-foreground">{dropoff}</div>
                )}
              </div>
              <ChevronRight className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${tripOpen ? "rotate-90" : ""}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 border-t border-border px-4 pb-5 pt-4">
              <div className="relative flex items-start gap-3">
                <div className="mt-3 h-3 w-3 shrink-0 rounded-sm bg-primary ring-4 ring-primary/20" />
                <AddressAutocomplete
                  value={dropoff}
                  onChange={onDropoffChange}
                  placeholder={serviceMode === "delivery" ? "Adresse de livraison" : "Adresse d'arrivée"}
                  bias={dropoffBias}
                  regionCode={zone?.countryCode}
                  resolved={!!dropoffLL}
                  onSelect={({ lat, lng, formatted }) => {
                    programmaticDropoffRef.current = true;
                    setDropoff(formatted);
                    setDropoffLL({ lat, lng });
                  }}
                />
              </div>

              {(recentRidesQ.data ?? []).length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-medium text-muted-foreground">Adresses récentes</p>
                  <ul className="flex flex-col gap-1">
                    {(recentRidesQ.data ?? []).slice(0, 2).map((r: any) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => quickDestination(r.dropoff_address, r.dropoff_lat, r.dropoff_lng)}
                          className="flex w-full items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2 text-left text-sm hover:bg-muted/50"
                        >
                          <History className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="min-w-0 truncate font-medium">{r.dropoff_address.split(",")[0]}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {outOfZone && (
                <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <strong>Hors zone de service.</strong> {zone?.value} — rayon {zone?.radiusKm} km.
                  </div>
                </div>
              )}

              <RideTrackingMap
                pickup={pickupLL}
                dropoff={dropoffLL}
                polyline={routeInfo?.polyline}
                height={isNative ? 280 : 220}
                interactive
                center={pickupLL ?? (zone ? { lat: zone.lat, lng: zone.lng } : undefined)}
                onPickupChange={handlePickupFromMap}
                onDropoffChange={handleDropoffFromMap}
              />
              {routeInfo && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs">
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3 text-primary" /> {(routeInfo.distanceMeters / 1000).toFixed(1)} km</span>
                  <span className="text-muted-foreground">·</span>
                  <span>⏱ {Math.round(routeInfo.seconds / 60)} min</span>
                  {breakdown && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span>{"factors" in breakdown && "trafficLabel" in breakdown.factors ? breakdown.factors.trafficLabel : ""}</span>
                  <span className="text-muted-foreground">·</span>
                  <span>{breakdown.factors.weatherLabel}</span>
                </>
              )}
                </div>
              )}

              {serviceMode === "ride" ? (
              <div>
                <Label className="text-xs">Véhicule</Label>
                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {(Object.entries(CATEGORIES) as Array<[Category, typeof CATEGORIES[Category]]>).map(([key, c]) => {
                    const selected = category === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setCategory(key)}
                        className={[
                          "rounded-xl border p-2 text-center transition-all",
                          selected ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border hover:border-primary/50",
                        ].join(" ")}
                      >
                        <CarIcon category={key} className="mx-auto h-7 w-11" />
                        <div className="mt-0.5 text-[10px] font-semibold leading-tight">{c.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              ) : (
              <>
              <div>
                <Label className="text-xs">Véhicule livreur</Label>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(Object.entries(DELIVERY_VEHICLES) as Array<[DeliveryVehicle, typeof DELIVERY_VEHICLES[DeliveryVehicle]]>).map(([key, v]) => {
                    const selected = deliveryVehicle === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setDeliveryVehicle(key)}
                        className={cn(
                          "rounded-xl border p-2.5 text-left transition-all",
                          selected ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border",
                        )}
                      >
                        <div className="text-lg">{v.emoji}</div>
                        <div className="text-xs font-semibold">{v.label}</div>
                        <div className="text-[10px] text-muted-foreground">{v.eta}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <Label className="text-xs">Type de colis</Label>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(Object.entries(PACKAGE_TYPES) as Array<[PackageType, typeof PACKAGE_TYPES[PackageType]]>).map(([key, p]) => {
                    const selected = packageType === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setPackageType(key)}
                        className={cn(
                          "rounded-xl border p-2 text-left transition-all",
                          selected ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border",
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <span>{p.emoji}</span>
                          <span className="text-xs font-semibold">{p.label}</span>
                        </div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">{p.hint}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{DELIVERY_EXTRAS.urgent.label}</div>
                    <div className="text-[11px] text-muted-foreground">{DELIVERY_EXTRAS.urgent.description}</div>
                  </div>
                  <Switch checked={deliveryUrgent} onCheckedChange={setDeliveryUrgent} />
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                  <div>
                    <div className="text-sm font-medium">{DELIVERY_EXTRAS.insulated_bag.label}</div>
                    <div className="text-[11px] text-muted-foreground">{DELIVERY_EXTRAS.insulated_bag.description} (+{DELIVERY_EXTRAS.insulated_bag.fee} F)</div>
                  </div>
                  <Switch checked={deliveryInsulatedBag} onCheckedChange={setDeliveryInsulatedBag} />
                </div>
              </div>
              </>
              )}

              <div>
                <Label className="text-xs">Paiement</Label>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {paymentOptions.map((p) => {
                    const Icon = p.icon;
                    const selected = payment === p.value;
                    return (
                      <button
                        key={p.providerCode}
                        type="button"
                        onClick={() => setPayment(p.value)}
                        className={[
                          "flex items-center gap-2 rounded-xl border p-2.5 text-left text-xs transition-all",
                          selected ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border",
                        ].join(" ")}
                      >
                        <Icon className="h-4 w-4 shrink-0 text-primary" />
                        <span className="font-semibold">{p.label}</span>
                      </button>
                    );
                  })}
                </div>
                {isEcoTibus(marketConfig) && marketConfig?.branding?.tagline && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">{marketConfig.branding.tagline}</p>
                )}
              </div>

              <div>
                <Label htmlFor="phone" className="text-xs">Téléphone (obligatoire)</Label>
                <Input id="phone" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+225 …" maxLength={20} className="mt-1.5 h-9" />
                <p className="mt-1 text-[11px] text-muted-foreground">Le chauffeur pourra vous appeler à l'arrivée si besoin.</p>
              </div>

              <Button
                className="w-full"
                size="lg"
                disabled={!pickupLL || !dropoffLL || !!outOfZone || !phone.trim() || create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? "Envoi…" : outOfZone ? "Hors zone" : !pickupLL || !dropoffLL ? "Choisissez les adresses" : !phone.trim() ? "Téléphone requis" : `${serviceMode === "delivery" ? "Commander livraison" : "Commander"} · ${price > 0 ? formatXof(price) : ""}`}
              </Button>
            </CollapsibleContent>
          </Collapsible>
        </section>

        {/* Espace pub restaurants */}
        <section className="rounded-3xl border border-border bg-card p-4">
          <DeliveryPartnerAds city={city} />
        </section>
      </div>

      {!isNative && (
      <aside className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-3xl border border-border bg-card p-6">
          <h3 className="font-display text-lg font-semibold">{serviceMode === "delivery" ? "Tarif livraison" : "Tarif dynamique"}</h3>
          <p className="text-xs text-muted-foreground">Distance, trafic, durée et météo{serviceMode === "delivery" ? " + colis et options" : ""}.</p>
          <dl className="mt-4 space-y-2 text-sm">
            {serviceMode === "ride" ? (
              <div className="flex justify-between gap-2"><dt className="shrink-0 text-muted-foreground">Véhicule</dt><dd className="truncate text-right">{CATEGORIES[category].label}</dd></div>
            ) : deliveryBreakdown && (
              <>
                <div className="flex justify-between gap-2"><dt className="shrink-0 text-muted-foreground">Livreur</dt><dd className="truncate text-right">{DELIVERY_VEHICLES[deliveryVehicle].label}</dd></div>
                <div className="flex justify-between gap-2"><dt className="shrink-0 text-muted-foreground">Colis</dt><dd className="truncate text-right">{deliveryBreakdown.factors.packageLabel}</dd></div>
              </>
            )}
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-muted-foreground">Distance</dt><dd className="truncate text-right">{breakdown ? `${km} km` : "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-muted-foreground">Durée</dt><dd className="truncate text-right">{breakdown ? `${min} min` : "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-muted-foreground">Trafic</dt><dd className="truncate text-right">{breakdown ? breakdown.factors.trafficLabel : "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-muted-foreground">Météo</dt><dd className="truncate text-right">{breakdown ? breakdown.factors.weatherLabel : "—"}</dd></div>
            <div className="my-2 border-t border-border" />
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-muted-foreground">Base</dt><dd className="truncate text-right">{breakdown ? formatXof(breakdown.base) : "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-muted-foreground">Distance</dt><dd className="truncate text-right">{breakdown ? formatXof(breakdown.distance) : "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-muted-foreground">Durée</dt><dd className="truncate text-right">{breakdown ? formatXof(breakdown.duration) : "—"}</dd></div>
            {deliveryBreakdown && deliveryBreakdown.packageSurcharge > 0 && (
              <div className="flex justify-between gap-2"><dt className="shrink-0 text-muted-foreground">Colis (taille)</dt><dd className="truncate text-right">+{formatXof(deliveryBreakdown.packageSurcharge)}</dd></div>
            )}
            {deliveryBreakdown && deliveryBreakdown.urgentFee > 0 && (
              <div className="flex justify-between gap-2"><dt className="shrink-0 text-muted-foreground">Urgent</dt><dd className="truncate text-right">+{formatXof(deliveryBreakdown.urgentFee)}</dd></div>
            )}
            {deliveryBreakdown && deliveryBreakdown.insulatedBagFee > 0 && (
              <div className="flex justify-between gap-2"><dt className="shrink-0 text-muted-foreground">Sac isotherme</dt><dd className="truncate text-right">+{formatXof(deliveryBreakdown.insulatedBagFee)}</dd></div>
            )}
            {(rideBreakdown?.trafficSurcharge ?? deliveryBreakdown?.trafficSurcharge ?? 0) > 0 && (
              <div className="flex justify-between gap-2"><dt className="shrink-0 text-muted-foreground">Suppl. trafic</dt><dd className="truncate text-right">+{formatXof((rideBreakdown ?? deliveryBreakdown)!.trafficSurcharge)}</dd></div>
            )}
            {(rideBreakdown?.weatherSurcharge ?? deliveryBreakdown?.weatherSurcharge ?? 0) > 0 && (
              <div className="flex justify-between gap-2"><dt className="shrink-0 text-muted-foreground">Suppl. météo</dt><dd className="truncate text-right">+{formatXof((rideBreakdown ?? deliveryBreakdown)!.weatherSurcharge)}</dd></div>
            )}
            <div className="my-2 border-t border-border" />
            <div className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0 text-muted-foreground">Total</dt>
              <dd className="truncate text-right font-display text-2xl font-bold text-primary">{price > 0 ? formatXof(price) : "—"}</dd>
            </div>
          </dl>
          <Button
            className="mt-6 w-full"
            size="lg"
            disabled={!pickupLL || !dropoffLL || !!outOfZone || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Envoi…" : serviceMode === "delivery" ? "Commander la livraison" : "Commander la course"}
          </Button>
          {(!pickupLL || !dropoffLL) && (
            <button type="button" onClick={() => setTripOpen(true)} className="mt-2 w-full text-center text-xs text-primary hover:underline">
              Ouvrir le formulaire de course
            </button>
          )}
        </div>

        {(recentRidesQ.data?.length ?? 0) > 0 && (
          <div className="hidden rounded-3xl border border-border bg-card p-5 lg:block">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <History className="h-4 w-4 text-primary" /> Trajets récents
            </h3>
            <ul className="mt-3 space-y-2">
              {(recentRidesQ.data ?? []).slice(0, 3).map((r: any) => (
                <li key={r.id} className="rounded-xl border border-border p-3 text-xs">
                  <div className="truncate font-medium">{r.dropoff_address.split(",")[0]}</div>
                  <Button size="sm" variant="outline" className="mt-2 h-7 w-full text-xs" onClick={() => resumeRide(r)}>
                    <RotateCcw className="mr-1 h-3 w-3" /> Reprendre
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
      )}

      {isNative && (
        <div className="native-cta-bar fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 px-3">
          <div className="mx-auto max-w-lg rounded-2xl border border-border bg-card/95 p-3 shadow-soft backdrop-blur">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {serviceMode === "delivery"
                  ? `${DELIVERY_VEHICLES[deliveryVehicle].label} · ${PACKAGE_TYPES[packageType].label}`
                  : CATEGORIES[category].label}
              </span>
              <span className="font-display text-lg font-bold text-primary">{price > 0 ? formatXof(price) : "—"}</span>
            </div>
            <Button
              className="w-full"
              size="lg"
              disabled={!pickupLL || !dropoffLL || !!outOfZone || create.isPending}
              onClick={() => (tripOpen ? create.mutate() : setTripOpen(true))}
            >
              {create.isPending
                ? "Envoi…"
                : !tripOpen
                  ? "Où allons-nous ?"
                  : outOfZone
                    ? "Hors zone"
                    : !pickupLL || !dropoffLL
                      ? "Choisissez les adresses"
                      : `Commander · ${price > 0 ? formatXof(price) : ""}`}
            </Button>
          </div>
        </div>
      )}
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
  const [clock, setClock] = useState(Date.now());
  const requestedNotifiedRef = useRef(false);
  const lastWaitThresholdRef = useRef(0);
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
    const t = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const waitMin = Math.max(0, Math.floor((clock - new Date(activeRide.created_at).getTime()) / 60_000));
  const estimatedWait = estimateDriverWaitMin((activeRide.category ?? "eco") as Category);

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
  const getAnnouncementAudioUrlFn = useServerFn(getAnnouncementAudioUrl);
  const { data: prefs } = useQuery({ queryKey: ["notif-prefs"], queryFn: () => getPrefsFn() });

  // Driver contact — via security-definer RPC (only safe vehicle / contact fields)
  const driverQ = useQuery({
    queryKey: ["ride-driver", activeRide.id, activeRide.driver_id],
    enabled: !!activeRide.driver_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("get_ride_driver_public", { _ride_id: activeRide.id })
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

  // Demande la permission de notification au montage.
  useEffect(() => {
    getNotifyPermission().then((p) => {
      if (p === "default") requestNotifyPermission().catch(() => {});
    });
  }, []);

  // Helper: push notification + sound
  const notify = (title: string, body: string, type: "status" | "arriving" | "nearby") => {
    const opt = type === "status" ? prefs?.notify_status_change
      : type === "arriving" ? prefs?.notify_driver_arriving
      : prefs?.notify_driver_nearby;
    if (opt === false) return;
    toast.success(title, { description: body, duration: 7000 });
    showLocalNotification(title, body);
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
          if (next.status !== "arriving") {
            const label = STATUS_LABEL[next.status] ?? next.status;
            notify("Mise à jour de la course", label, "status");
          }
        }
        if (next.status === "completed") {
          toast.success("Merci d'avoir utilisé Tibus Ride", { description: "Heureux de vous revoir bientôt !", duration: 7000 });
          speakAnnouncementCloud("ride_completed_thanks", ANNOUNCEMENT_TEXT.ride_completed_thanks, getAnnouncementAudioUrlFn);
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
      const vehicle = formatDriverVehicleDescription(driverQ.data as DriverVehiclePublic | undefined);
      const body = vehicle
        ? `${vehicle} — à ~${Math.round(distM)} m de votre point de départ`
        : `À ~${Math.round(distM)} m de votre point de départ.`;
      notify("Chauffeur à proximité", body, "nearby");
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

  // Arrêt intermédiaire : le passager ajoute une adresse sur le trajet ; le
  // prix est recalculé sur la distance/durée du nouvel itinéraire complet
  // (départ → arrêts → arrivée), selon les mêmes règles tarifaires (tarifs
  // DB de la catégorie + coefficients trafic/météo) que le reste de la course.
  const [stopOpen, setStopOpen] = useState(false);
  const [stopAddr, setStopAddr] = useState("");
  const stopPricingConfigFn = useServerFn(getEffectivePricingConfig);
  const stopPricingConfigQ = useQuery({
    queryKey: ["pricing-config-stop", activeRide.program_id],
    queryFn: () => stopPricingConfigFn({ data: { programId: activeRide.program_id ?? undefined } }),
  });
  const addStop = useMutation({
    mutationFn: async (point: { lat: number; lng: number; formatted: string }) => {
      if (!pickup || !dropoff) throw new Error("Itinéraire incomplet.");
      const waypoints: Array<{ address: string; lat: number; lng: number; added_at: string }> =
        Array.isArray(activeRide.waypoints) ? activeRide.waypoints : [];
      const chain: LatLng[] = [pickup, ...waypoints.map((w) => ({ lat: w.lat, lng: w.lng })), { lat: point.lat, lng: point.lng }, dropoff];
      let totalMeters = 0;
      let totalSeconds = 0;
      for (let i = 0; i < chain.length - 1; i++) {
        const r = await routeFn({ data: { origin: chain[i], destination: chain[i + 1] } });
        if (!r.ok) throw new Error("Impossible de calculer le nouvel itinéraire.");
        totalMeters += r.distanceMeters;
        totalSeconds += r.seconds;
      }
      const km = Math.max(1, totalMeters / 1000);
      const min = Math.max(1, totalSeconds / 60);
      const pricingConfig = stopPricingConfigQ.data;
      const cat = (activeRide.category ?? "eco") as Category;
      const breakdown = computeDynamicPrice({
        category: cat,
        km,
        durationMin: min,
        staticDurationMin: min,
        rates: pricingConfig?.categories?.[cat],
        coefficients: pricingConfig?.dynamic,
      });
      const newPrice = Math.max(activeRide.price_xof, breakdown.total + Number(activeRide.waiting_fee_xof ?? 0));
      const { error } = await supabase.from("rides").update({
        waypoints: [...waypoints, { address: point.formatted, lat: point.lat, lng: point.lng, added_at: new Date().toISOString() }],
        distance_km: km,
        duration_min: min,
        price_xof: newPrice,
      }).eq("id", activeRide.id);
      if (error) throw error;
      return newPrice - activeRide.price_xof;
    },
    onSuccess: (delta) => {
      qc.invalidateQueries();
      setStopOpen(false);
      setStopAddr("");
      toast.success(delta > 0 ? `Arrêt ajouté — +${formatXof(delta)} sur le prix` : "Arrêt ajouté");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const etaText = etaSec != null ? (etaSec < 60 ? `${etaSec}s` : `${Math.round(etaSec / 60)} min`) : "—";
  const driverInfo = driverQ.data as (DriverVehiclePublic & { full_name?: string; phone?: string; rating_avg?: number }) | null | undefined;
  const driverPhone = driverInfo?.phone;
  const driverName = driverInfo?.full_name;
  const driverVehicleLine = formatDriverVehicleDescription(driverInfo);

  const statusMessage = useMemo(() => {
    switch (activeRide.status) {
      case "requested":
        return waitMin === 0
          ? `Recherche d'un chauffeur… attente estimée ~${estimatedWait} min`
          : `Recherche en cours — ${waitMin} min d'attente (estimé ~${estimatedWait} min)`;
      case "accepted":
        if (driverVehicleLine) {
          return etaSec != null
            ? `${driverName ? `${driverName} · ` : ""}${driverVehicleLine} — arrivée dans ${etaSec < 60 ? `${etaSec} s` : `${Math.ceil(etaSec / 60)} min`}`
            : `${driverVehicleLine} — votre chauffeur est en route`;
        }
        return etaSec != null
          ? `${driverName ? `${driverName} arrive` : "Chauffeur en route"} dans ${etaSec < 60 ? `${etaSec} s` : `${Math.ceil(etaSec / 60)} min`}`
          : "Votre chauffeur est en route vers vous";
      case "arriving":
        return formatDriverArrivalMessage(driverInfo, etaSec == null || etaSec > 90);
      case "in_progress":
        return etaSec != null
          ? `Course en cours — destination dans ~${Math.ceil(etaSec / 60)} min`
          : "Course en cours";
      default:
        return STATUS_LABEL[activeRide.status] ?? activeRide.status;
    }
  }, [activeRide.status, waitMin, estimatedWait, etaSec, driverName, driverVehicleLine, driverInfo]);

  useEffect(() => {
    if (activeRide.status !== "requested" || requestedNotifiedRef.current) return;
    requestedNotifiedRef.current = true;
    notify(
      "Course demandée",
      `Recherche d'un chauffeur — attente estimée ~${estimatedWait} min`,
      "status",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRide.status, estimatedWait]);

  useEffect(() => {
    if (activeRide.status !== "requested") return;
    for (const th of [3, 5, 8]) {
      if (waitMin >= th && lastWaitThresholdRef.current < th) {
        lastWaitThresholdRef.current = th;
        notify(
          "Temps d'attente",
          `Toujours en recherche… ${waitMin} min écoulées (estimé ~${estimatedWait} min)`,
          "status",
        );
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitMin, activeRide.status, estimatedWait]);

  useEffect(() => {
    if (activeRide.status !== "arriving" || alertedArrivingRef.current) return;
    if (activeRide.driver_id && driverQ.isLoading) return;
    alertedArrivingRef.current = true;
    const body = formatDriverArrivalMessage(driverInfo, true);
    notify("Votre chauffeur est arrivé !", body, "arriving");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRide.status, activeRide.driver_id, driverQ.isLoading, driverInfo]);

  return (
    <div className="space-y-4 rounded-3xl border border-primary/30 bg-primary/5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-primary">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary" />
          <span className="min-w-0">{statusMessage}</span>
        </div>
        {activeRide.status === "requested" && (
          <div className="rounded-full bg-card px-3 py-1 text-xs font-semibold">
            Attente : <span className="text-primary">{waitMin} min</span>
          </div>
        )}
        {activeRide.status !== "in_progress" && activeRide.status !== "requested" && activeRide.driver_id && (
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

      {(activeRide.status === "accepted" || activeRide.status === "arriving" || activeRide.status === "in_progress") && (
        <div className="rounded-xl border border-border bg-card p-3">
          {Array.isArray(activeRide.waypoints) && activeRide.waypoints.length > 0 && (
            <ul className="mb-2 space-y-1 text-xs text-muted-foreground">
              {activeRide.waypoints.map((w: any, i: number) => (
                <li key={i} className="flex items-center gap-2"><MapPin className="h-3 w-3 shrink-0" />{w.address}</li>
              ))}
            </ul>
          )}
          {stopOpen ? (
            <div className="flex items-start gap-2">
              <AddressAutocomplete
                value={stopAddr}
                onChange={setStopAddr}
                placeholder="Adresse de l'arrêt"
                resolved={false}
                onSelect={({ lat, lng, formatted }) => {
                  setStopAddr(formatted);
                  addStop.mutate({ lat, lng, formatted });
                }}
              />
              <Button type="button" size="sm" variant="ghost" onClick={() => { setStopOpen(false); setStopAddr(""); }}>Annuler</Button>
            </div>
          ) : (
            <Button type="button" size="sm" variant="outline" disabled={addStop.isPending} onClick={() => setStopOpen(true)}>
              {addStop.isPending ? "Calcul en cours…" : "+ Ajouter un arrêt"}
            </Button>
          )}
          <p className="mt-1.5 text-[11px] text-muted-foreground">Un arrêt modifie le prix selon la distance et la durée ajoutées.</p>
        </div>
      )}

      {activeRide.driver_id && driverQ.data && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs text-muted-foreground">Votre chauffeur</div>
              <div className="font-semibold">{driverInfo?.full_name ?? "Chauffeur"}</div>
              {driverVehicleLine ? (
                <div className="mt-1 text-xs text-muted-foreground">{driverVehicleLine}</div>
              ) : (
                <div className="mt-1 text-xs text-muted-foreground">Informations véhicule non renseignées</div>
              )}
              {driverInfo?.rating_avg ? (
                <div className="text-xs text-muted-foreground">★ {Number(driverInfo.rating_avg).toFixed(1)}</div>
              ) : null}
            </div>
            {driverPhone ? (
              <div className="flex gap-2">
                <Button asChild size="sm" variant="outline"><a href={`tel:${driverPhone}`}><Phone className="mr-1 h-4 w-4" />Appeler</a></Button>
                <Button asChild size="sm" variant="outline">
                  <a href={`https://wa.me/${driverPhone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer">
                    <MessageCircle className="mr-1 h-4 w-4" />WhatsApp
                  </a>
                </Button>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Téléphone non renseigné</div>
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
