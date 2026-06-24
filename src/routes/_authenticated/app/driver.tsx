import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CATEGORIES, formatXof } from "@/lib/pricing";
import { toast } from "sonner";
import { Car, Clock, MapPin, Wallet } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getMyWallet } from "@/lib/wallet.functions";
import { getNotificationPrefs } from "@/lib/tracking.functions";
import {
  reportMyLocation,
  getMyZone,
  setMyZone,
  clearMyZone,
  getMyPendingOffer,
  acceptRideOffer,
  declineRideOffer,
} from "@/lib/dispatch.functions";
import { EnrollmentWizard } from "@/components/driver/EnrollmentWizard";
import { PARTNER_TYPES, VEHICLE_TYPES, RIDE_CATEGORIES, DELIVERY_CATEGORIES } from "@/lib/driver-enrollment";
import { DELIVERY_VEHICLES, PACKAGE_TYPES, vehicleFromAssignedCategory } from "@/lib/delivery-pricing";
import { useCountryMarket } from "@/hooks/use-country-market";
import { isEcoTibus, marketAppName } from "@/lib/country-market";
import { MarketProgramSwitcher } from "@/components/MarketProgramSwitcher";
import { getCurrentPosition } from "@/lib/native-geolocation";

export const Route = createFileRoute("/_authenticated/app/driver")({
  head: () => ({ meta: [{ title: "Espace chauffeur & livreur — Tibus Ride" }] }),
  component: DriverPage,
});

function DriverPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const profileQ = useQuery({
    queryKey: ["self-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("country").eq("id", user!.id).maybeSingle();
      if (error) throw error;
      return data as { country: string | null } | null;
    },
  });
  const myCountry = profileQ.data?.country ?? null;

  const driverQ = useQuery({
    queryKey: ["driver-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("driver_profiles").select("*").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const myRidesQ = useQuery({
    queryKey: ["driver-rides", user?.id],
    enabled: !!user,
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rides")
        .select("*")
        .eq("driver_id", user!.id)
        .in("status", ["accepted", "arriving", "in_progress"])
        .order("accepted_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const openRidesQ = useQuery({
    queryKey: ["open-rides", driverQ.data?.is_online, driverQ.data?.city, myCountry, driverQ.data?.partner_type, driverQ.data?.assigned_category],
    enabled: !!driverQ.data?.is_online && driverQ.data?.status === "approved" && !!myCountry,
    refetchInterval: 4000,
    queryFn: async () => {
      const dp = driverQ.data!;
      let q = supabase.from("rides").select("*").eq("status", "requested").order("requested_at", { ascending: true }).limit(30);
      if (myCountry) q = q.eq("country", myCountry);
      if (dp.city) q = q.eq("city", dp.city);
      if (dp.partner_type === "delivery") {
        const vehicle = vehicleFromAssignedCategory(dp.assigned_category);
        q = q.eq("service_type", "delivery");
        if (vehicle) q = q.eq("delivery_vehicle", vehicle);
      } else {
        q = q.eq("service_type", "ride");
        if (dp.assigned_category) q = q.eq("category", dp.assigned_category);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Notification preferences
  const getPrefs = useServerFn(getNotificationPrefs);
  const prefsQ = useQuery({ queryKey: ["notif-prefs", user?.id], enabled: !!user, queryFn: () => getPrefs() });
  const prefs = prefsQ.data;

  // Ask browser notification permission once if system channel enabled
  useEffect(() => {
    if (prefs?.channel_system && prefs?.notify_new_ride
        && typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, [prefs?.channel_system, prefs?.notify_new_ride]);
  useEffect(() => {
    if (!myCountry || !driverQ.data?.is_online) return;
    if (!prefs?.notify_new_ride) return;
    const ch = supabase
      .channel(`new-rides-${myCountry}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "rides", filter: `country=eq.${myCountry}` }, (payload) => {
        const r: any = payload.new;
        if (r?.status !== "requested") return;
        if (driverQ.data?.city && r.city !== driverQ.data.city) return;
        const isDelivery = r.service_type === "delivery";
        if (driverQ.data?.partner_type === "delivery") {
          if (!isDelivery) return;
          const vehicle = vehicleFromAssignedCategory(driverQ.data.assigned_category);
          if (vehicle && r.delivery_vehicle !== vehicle) return;
        } else if (isDelivery) return;
        const title = isDelivery ? "Nouvelle livraison disponible !" : "Nouvelle course disponible !";
        if (prefs.channel_toast) {
          toast.success(title, { description: `${r.pickup_address ?? ""} → ${r.dropoff_address ?? ""}`.slice(0, 120), duration: 9000 });
        }
        try {
          if (prefs.channel_system && typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification(isDelivery ? "Nouvelle livraison à proximité" : "Nouvelle course à proximité", { body: `${r.pickup_address ?? "Point de départ"} → ${r.dropoff_address ?? ""}`, tag: `ride-new-${r.id}`, icon: "/favicon.ico" });
          }
          if (prefs.sound_enabled) {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const o = ctx.createOscillator(); const g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.frequency.value = 1040; g.gain.value = 0.18;
            o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 380);
          }
        } catch {}
        qc.invalidateQueries({ queryKey: ["open-rides"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [myCountry, driverQ.data?.is_online, driverQ.data?.city, qc, prefs?.notify_new_ride, prefs?.channel_toast, prefs?.channel_system, prefs?.sound_enabled]);


  const toggleOnline = useMutation({
    mutationFn: async (online: boolean) => {
      const { error } = await supabase.from("driver_profiles").update({ is_online: online }).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driver-profile"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const accept = useMutation({
    mutationFn: async (rideId: string) => {
      const { error } = await supabase.from("rides").update({
        driver_id: user!.id, status: "accepted", accepted_at: new Date().toISOString(),
      }).eq("id", rideId).eq("status", "requested");
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Course acceptée !"); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ rideId, status }: { rideId: string; status: string }) => {
      const patch: any = { status };
      if (status === "in_progress") patch.started_at = new Date().toISOString();
      if (status === "completed") patch.completed_at = new Date().toISOString();
      const { error } = await supabase.from("rides").update(patch).eq("id", rideId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
  });

  if (driverQ.isLoading) return <div className="py-12 text-center text-muted-foreground">Chargement…</div>;

  if (!driverQ.data) {
    return (
      <CityBootstrap onCreated={() => qc.invalidateQueries({ queryKey: ["driver-profile"] })} />
    );
  }

  if (driverQ.data.status !== "approved") {
    return (
      <EnrollmentWizard
        profile={driverQ.data}
        country={myCountry}
        onRefresh={() => qc.invalidateQueries({ queryKey: ["driver-profile"] })}
      />
    );
  }

  const partnerLabel = PARTNER_TYPES.find((p) => p.value === driverQ.data.partner_type)?.label ?? "Partenaire";
  const vehicleLabel = VEHICLE_TYPES.find((v) => v.value === driverQ.data.vehicle_type)?.label;
  const categoryLabel =
    driverQ.data.partner_type === "delivery"
      ? DELIVERY_CATEGORIES.find((c) => c.value === driverQ.data.assigned_category)?.label
      : RIDE_CATEGORIES.find((c) => c.value === driverQ.data.assigned_category)?.label;

  return (
    <div className="space-y-6">
      {driverQ.data.is_online && <IdleLocationReporter />}
      <PendingOfferBanner />

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-border bg-card p-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Tableau de bord</h1>
          <p className="text-sm text-muted-foreground">
            {partnerLabel}
            {vehicleLabel ? ` · ${vehicleLabel}` : ""}
            {categoryLabel ? ` · ${categoryLabel}` : ""}
            {" — "}
            {driverQ.data.city ?? "Ville non définie"} — {driverQ.data.rides_count} courses
          </p>
        </div>
        <div className="flex items-center gap-3">
          <MarketProgramSwitcher />
          <span className="text-sm font-medium">{driverQ.data.is_online ? "En ligne" : "Hors ligne"}</span>
          <Switch
            checked={driverQ.data.is_online}
            onCheckedChange={(v) => toggleOnline.mutate(v)}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={Wallet} label="Gains totaux" value={formatXof(Number(driverQ.data.total_earnings ?? 0))} />
        <Stat icon={Car} label="Courses effectuées" value={String(driverQ.data.rides_count)} />
        <Stat icon={Clock} label="Note moyenne" value={`${Number(driverQ.data.rating_avg ?? 5).toFixed(1)} / 5`} />
      </div>

      <DriverZoneSettings />

      <WalletSection />


      {myRidesQ.data && myRidesQ.data.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold">Courses en cours</h2>
          <div className="space-y-3">
            {myRidesQ.data.map((r) => (
              <div key={r.id} className="space-y-2">
                <RideCard ride={r} actions={
                  <div className="flex gap-2">
                    {r.status === "accepted" && <Button size="sm" onClick={() => updateStatus.mutate({ rideId: r.id, status: "arriving" })}>J'arrive</Button>}
                    {r.status === "arriving" && <Button size="sm" onClick={() => updateStatus.mutate({ rideId: r.id, status: "in_progress" })}>Démarrer</Button>}
                    {r.status === "in_progress" && <Button size="sm" onClick={() => updateStatus.mutate({ rideId: r.id, status: "completed" })}>Terminer</Button>}
                  </div>
                } />
                <DriverLocationSharer rideId={r.id} />
                {r.passenger_phone && r.passenger_shares_phone && (
                  <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs">
                    Passager : <a className="font-semibold text-primary" href={`tel:${r.passenger_phone}`}>{r.passenger_phone}</a>
                    {" · "}
                    <a className="text-primary hover:underline" href={`https://wa.me/${r.passenger_phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer">WhatsApp</a>
                  </div>
                )}
                {r.passenger_phone && !r.passenger_shares_phone && (
                  <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs text-muted-foreground">
                    Numéro passager masqué par le passager.
                  </div>
                )}
                <a href={`/app/ride/${r.id}`} className="ml-1 text-xs font-medium text-primary hover:underline">
                  Voir détails &amp; gérer le partage du contact →
                </a>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">
          {driverQ.data.is_online
            ? driverQ.data.partner_type === "delivery"
              ? `Livraisons disponibles${driverQ.data.city ? ` à ${driverQ.data.city}` : ""}`
              : `Courses disponibles${driverQ.data.city ? ` à ${driverQ.data.city}` : ""}`
            : driverQ.data.partner_type === "delivery"
              ? "Activez-vous pour voir les livraisons"
              : "Activez-vous pour voir les courses"}
        </h2>
        {!driverQ.data.is_online ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Passez en ligne pour recevoir des demandes.
          </div>
        ) : openRidesQ.data && openRidesQ.data.length > 0 ? (
          <div className="space-y-3">
            {openRidesQ.data.map((r) => (
              <RideCard key={r.id} ride={r} actions={
                <Button size="sm" onClick={() => accept.mutate(r.id)} disabled={accept.isPending}>Accepter</Button>
              } />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Aucune course en attente. Restez prêt !
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div>
      <div className="mt-3 text-xs text-muted-foreground">{label}</div>
      <div className="font-display text-2xl font-bold">{value}</div>
    </div>
  );
}

function RideCard({ ride, actions }: { ride: any; actions: React.ReactNode }) {
  const isDelivery = ride.service_type === "delivery";
  const deliveryVehicle = ride.delivery_vehicle as keyof typeof DELIVERY_VEHICLES | undefined;
  const packageType = ride.package_type as keyof typeof PACKAGE_TYPES | undefined;
  const vehicleEmoji = isDelivery && deliveryVehicle
    ? DELIVERY_VEHICLES[deliveryVehicle]?.emoji
    : CATEGORIES[ride.category as keyof typeof CATEGORIES]?.emoji;
  const vehicleLabel = isDelivery && deliveryVehicle
    ? DELIVERY_VEHICLES[deliveryVehicle]?.label
    : CATEGORIES[ride.category as keyof typeof CATEGORIES]?.label;

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-2xl">{vehicleEmoji ?? "📦"}</span>
          {isDelivery && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Livraison</span>
          )}
          {vehicleLabel && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{vehicleLabel}</span>}
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{ride.city}</span>
          <span className="text-xs text-muted-foreground">{ride.distance_km} km · {ride.duration_min} min</span>
        </div>
        <div className="font-display text-lg font-bold text-primary">{formatXof(ride.price_xof)}</div>
      </div>
      {isDelivery && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          {packageType && PACKAGE_TYPES[packageType] && (
            <span className="rounded-full border border-border px-2 py-0.5">{PACKAGE_TYPES[packageType].emoji} {PACKAGE_TYPES[packageType].label}</span>
          )}
          {ride.delivery_urgent && <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-amber-700">Urgent</span>}
          {ride.delivery_insulated_bag && <span className="rounded-full border border-border px-2 py-0.5">Sac isotherme</span>}
        </div>
      )}
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div className="flex items-start gap-2"><MapPin className="h-4 w-4 text-success mt-0.5 shrink-0" /><div className="truncate">{ride.pickup_address}</div></div>
        <div className="flex items-start gap-2"><MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" /><div className="truncate">{ride.dropoff_address}</div></div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="text-xs text-muted-foreground capitalize">Paiement : {ride.payment_method.replace("_", " ")}</div>
        {actions}
      </div>
    </div>
  );
}

function CityBootstrap({ onCreated }: { onCreated: () => void }) {
  const { user } = useAuth();
  const mut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("driver_profiles").insert({ user_id: user!.id, status: "pending" });
      if (error) throw error;
    },
    onSuccess: onCreated,
  });
  return (
    <div className="mx-auto max-w-xl rounded-3xl border border-border bg-card p-8 text-center">
      <h2 className="font-display text-xl font-bold">Devenir chauffeur ou livreur</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Créez votre dossier d'enrôlement : permis, carte grise et photos du véhicule pour vérification physique.
      </p>
      <Button className="mt-4" onClick={() => mut.mutate()} disabled={mut.isPending}>Commencer l'enrôlement</Button>
    </div>
  );
}

const TX_LABEL: Record<string, string> = {
  topup: "Recharge",
  commission: "Commission",
  adjustment: "Ajustement",
  refund: "Remboursement",
};

function WalletSection() {
  const getWalletFn = useServerFn(getMyWallet);
  const { config: marketConfig } = useCountryMarket();
  const commissionPct = marketConfig?.commissionDefault ?? 20;
  const { data, isLoading } = useQuery({
    queryKey: ["my-wallet"],
    queryFn: () => getWalletFn(),
    refetchInterval: 15000,
  });

  return (
    <section className="rounded-3xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Solde wallet</p>
          <p className="font-display text-3xl font-bold">
            {isLoading ? "…" : formatXof(data?.balance_xof ?? 0)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Commission plateforme : <strong>{commissionPct} %</strong>
            {isEcoTibus(marketConfig) ? ` (${marketAppName(marketConfig)} — modèle éthique)` : ""}.
            Débitée automatiquement à chaque course terminée.
            Contactez l'administration pour recharger votre wallet.
          </p>
        </div>
        <Wallet className="h-8 w-8 text-primary" />
      </div>

      <h3 className="mb-2 text-sm font-semibold">Derniers mouvements</h3>
      <div className="space-y-1 text-xs">
        {(data?.transactions ?? []).length === 0 ? (
          <p className="text-muted-foreground">Aucun mouvement pour le moment.</p>
        ) : (
          (data?.transactions ?? []).slice(0, 10).map((t: any) => (
            <div key={t.id} className="flex justify-between rounded border border-border px-2 py-1">
              <span className="truncate">
                {new Date(t.created_at).toLocaleString("fr-FR")} · {TX_LABEL[t.type] ?? t.type}
                {t.notes ? ` — ${t.notes}` : ""}
              </span>
              <span className={t.amount_xof < 0 ? "font-semibold text-destructive" : "font-semibold text-emerald-600"}>
                {t.amount_xof > 0 ? "+" : ""}{formatXof(t.amount_xof)}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/**
 * Tant que le conducteur est en ligne (même sans course en cours), signale sa
 * position courante au serveur. C'est cette position qui permet au moteur de
 * dispatch (mode 'proximity') de le considérer comme candidat le plus proche
 * pour une nouvelle demande. Sans ce composant, driver_profiles.current_lat/
 * current_lng restent figés et le dispatch par proximité ne peut pas trouver
 * de conducteur disponible.
 */
function IdleLocationReporter() {
  const reportFn = useServerFn(reportMyLocation);
  useEffect(() => {
    let lastSent = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const send = async () => {
      try {
        const pos = await getCurrentPosition({ maximumAge: 8000 });
        if (cancelled) return;
        const now = Date.now();
        if (now - lastSent < 9000) return;
        lastSent = now;
        await reportFn({ data: { lat: pos.coords.lat, lng: pos.coords.lng } });
      } catch {
        // Géolocalisation indisponible/refusée : on retentera au prochain tick.
      }
    };

    send();
    timer = setInterval(send, 10000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [reportFn]);

  return null;
}

/** Bandeau d'offre de course poussée par le moteur de dispatch (mode 'proximity'). */
function PendingOfferBanner() {
  const qc = useQueryClient();
  const getOfferFn = useServerFn(getMyPendingOffer);
  const acceptFn = useServerFn(acceptRideOffer);
  const declineFn = useServerFn(declineRideOffer);

  const offerQ = useQuery({
    queryKey: ["my-pending-offer"],
    queryFn: () => getOfferFn(),
    refetchInterval: 3000,
  });

  const accept = useMutation({
    mutationFn: (rideId: string) => acceptFn({ data: { rideId } }),
    onSuccess: () => { toast.success("Course acceptée !"); qc.invalidateQueries(); },
    onError: (e: Error) => { toast.error(e.message); qc.invalidateQueries({ queryKey: ["my-pending-offer"] }); },
  });
  const decline = useMutation({
    mutationFn: (rideId: string) => declineFn({ data: { rideId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-pending-offer"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const offer = offerQ.data as any;
  if (!offer) return null;
  const ride = offer.rides;
  const secondsLeft = Math.max(0, Math.round((new Date(offer.expires_at).getTime() - Date.now()) / 1000));

  return (
    <div className="rounded-3xl border-2 border-primary bg-primary/5 p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
          Nouvelle course proposée — {secondsLeft}s pour répondre
        </span>
        {typeof offer.distance_km === "number" && (
          <span className="text-xs text-muted-foreground">≈ {offer.distance_km.toFixed(1)} km de vous</span>
        )}
      </div>
      {ride && (
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div className="flex items-start gap-2"><MapPin className="h-4 w-4 text-success mt-0.5 shrink-0" /><div className="truncate">{ride.pickup_address}</div></div>
          <div className="flex items-start gap-2"><MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" /><div className="truncate">{ride.dropoff_address}</div></div>
        </div>
      )}
      {ride && <div className="mt-2 font-display text-lg font-bold text-primary">{formatXof(ride.price_xof)}</div>}
      <div className="mt-4 flex gap-2">
        <Button onClick={() => accept.mutate(offer.ride_id)} disabled={accept.isPending}>Accepter</Button>
        <Button variant="outline" onClick={() => decline.mutate(offer.ride_id)} disabled={decline.isPending}>Refuser</Button>
      </div>
    </div>
  );
}

/** Réglage de la zone d'opération (cercle centre + rayon) du conducteur/livreur. */
function DriverZoneSettings() {
  const qc = useQueryClient();
  const getZoneFn = useServerFn(getMyZone);
  const setZoneFn = useServerFn(setMyZone);
  const clearZoneFn = useServerFn(clearMyZone);
  const [open, setOpen] = useState(false);
  const [radiusKm, setRadiusKm] = useState(5);
  const [locating, setLocating] = useState(false);

  const zoneQ = useQuery({ queryKey: ["my-zone"], queryFn: () => getZoneFn() });

  useEffect(() => {
    if (zoneQ.data?.radius_km) setRadiusKm(Number(zoneQ.data.radius_km));
  }, [zoneQ.data?.radius_km]);

  const save = useMutation({
    mutationFn: async () => {
      setLocating(true);
      try {
        const pos = await getCurrentPosition();
        return setZoneFn({ data: { centerLat: pos.coords.lat, centerLng: pos.coords.lng, radiusKm, isActive: true } });
      } finally {
        setLocating(false);
      }
    },
    onSuccess: () => { toast.success("Zone d'opération enregistrée."); qc.invalidateQueries({ queryKey: ["my-zone"] }); },
    onError: () => toast.error("Impossible d'obtenir votre position. Autorisez la géolocalisation."),
  });

  const toggleActive = useMutation({
    mutationFn: (isActive: boolean) => {
      if (!zoneQ.data) throw new Error("Aucune zone définie.");
      return setZoneFn({ data: { centerLat: zoneQ.data.center_lat, centerLng: zoneQ.data.center_lng, radiusKm: Number(zoneQ.data.radius_km), isActive } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-zone"] }),
  });

  const clear = useMutation({
    mutationFn: () => clearZoneFn(),
    onSuccess: () => { toast.success("Zone supprimée — vous êtes disponible partout dans votre pays."); qc.invalidateQueries({ queryKey: ["my-zone"] }); },
  });

  return (
    <div className="rounded-3xl border border-border bg-card p-5">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen((o) => !o)}>
        <div>
          <h3 className="font-display text-base font-semibold">Ma zone d'opération</h3>
          <p className="text-xs text-muted-foreground">
            {zoneQ.data
              ? `Rayon de ${Number(zoneQ.data.radius_km)} km${zoneQ.data.is_active ? "" : " (désactivée)"} — vous ne recevrez des propositions que dans ce périmètre.`
              : "Aucune zone définie — vous pouvez recevoir des courses partout dans votre pays."}
          </p>
        </div>
        <span className="text-xs text-primary">{open ? "Fermer" : "Configurer"}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          {zoneQ.data && (
            <div className="flex items-center justify-between text-sm">
              <span>Zone active</span>
              <Switch checked={zoneQ.data.is_active} onCheckedChange={(v) => toggleActive.mutate(v)} />
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Rayon (km)</label>
            <input
              type="range" min={1} max={50} step={1}
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              className="w-full"
            />
            <div className="text-right text-xs text-muted-foreground">{radiusKm} km</div>
          </div>
          <p className="text-xs text-muted-foreground">
            La zone est centrée sur votre position actuelle au moment de l'enregistrement.
            Vous pourrez la redéfinir à tout moment depuis votre position du jour.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || locating}>
              {locating ? "Localisation…" : "Utiliser ma position actuelle"}
            </Button>
            {zoneQ.data && (
              <Button size="sm" variant="outline" onClick={() => clear.mutate()} disabled={clear.isPending}>
                Supprimer la zone
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Streams the driver's GPS position to the ride row every ~6s while active. */
function DriverLocationSharer({ rideId }: { rideId: string }) {
  const [status, setStatus] = useState<"idle" | "ok" | "denied" | "error">("idle");
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("error");
      return;
    }
    let lastSent = 0;
    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const now = Date.now();
        if (now - lastSent < 6000) return;
        lastSent = now;
        const { error } = await supabase.from("rides").update({
          driver_lat: pos.coords.latitude,
          driver_lng: pos.coords.longitude,
          driver_location_updated_at: new Date().toISOString(),
        }).eq("id", rideId);
        if (!error) setStatus("ok");
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [rideId]);

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs text-muted-foreground">
      {status === "ok" && <>📍 Position partagée avec le passager (mise à jour en direct)</>}
      {status === "idle" && <>📍 Activation du partage de position…</>}
      {status === "denied" && <span className="text-destructive">⚠ Autorisez la géolocalisation pour que le passager vous suive.</span>}
      {status === "error" && <span className="text-destructive">⚠ Impossible d'accéder à la géolocalisation.</span>}
    </div>
  );
}
