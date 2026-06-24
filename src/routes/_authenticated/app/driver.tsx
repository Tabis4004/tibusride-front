import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { CATEGORIES, formatXof } from "@/lib/pricing";
import { toast } from "sonner";
import { Car, Clock, MapPin, Wallet } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getMyWallet } from "@/lib/wallet.functions";
import { getNotificationPrefs } from "@/lib/tracking.functions";
import { getNotifyPermission, requestNotifyPermission, showLocalNotification, speakAnnouncement, primeSpeechSynthesis } from "@/lib/notify";

/** Durée (s) d'affichage du popup d'alerte "nouvelle course" en mode liste
 * ouverte (self_assign) — en mode 'proximity', c'est `ride_offers.expires_at`
 * (configuré par programme, `market_programs.dispatch_offer_seconds`) qui
 * fait foi ; ici, aucune réservation exclusive n'existe, le popup n'est
 * qu'une alerte temporisée pour inciter à réagir vite. */
const SELF_ASSIGN_POPUP_SECONDS = 20;
import {
  reportMyLocation,
  getMyZone,
  setMyZone,
  clearMyZone,
  getMyPendingOffer,
  acceptRideOffer,
  declineRideOffer,
  penalizeSelfIgnoredRide,
} from "@/lib/dispatch.functions";
import { EnrollmentWizard } from "@/components/driver/EnrollmentWizard";
import { PARTNER_TYPES, VEHICLE_TYPES, RIDE_CATEGORIES, DELIVERY_CATEGORIES, INSURANCE_STATUS_LABEL, type InsuranceStatus } from "@/lib/driver-enrollment";
import { renewMyInsurance } from "@/lib/driver-enrollment.functions";
import { Input } from "@/components/ui/input";
import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { DELIVERY_VEHICLES, PACKAGE_TYPES, vehicleFromAssignedCategory } from "@/lib/delivery-pricing";
import { useCountryMarket } from "@/hooks/use-country-market";
import { isEcoTibus, marketAppName } from "@/lib/country-market";
import { MarketProgramSwitcher } from "@/components/MarketProgramSwitcher";
import { getCurrentPosition } from "@/lib/native-geolocation";
import { RideTrackingMap, type LatLng } from "@/components/RideTrackingMap";

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

  // Solde wallet : un chauffeur dont le solde est épuisé (<= 0) ne doit plus
  // recevoir d'offres/notifications de nouvelles courses, ni pouvoir en
  // accepter (la base l'impose aussi via un trigger — voir migration
  // 20260630000000_wallet_balance_gating.sql — ceci n'est qu'un confort UX
  // pour éviter de lui présenter des courses qu'il ne pourrait pas accepter).
  const getWalletFn = useServerFn(getMyWallet);
  const walletQ = useQuery({
    queryKey: ["my-wallet"],
    queryFn: () => getWalletFn(),
    refetchInterval: 15000,
  });
  const walletEmpty = walletQ.data !== undefined && Number(walletQ.data.balance_xof ?? 0) <= 0;

  const openRidesQ = useQuery({
    queryKey: ["open-rides", driverQ.data?.is_online, driverQ.data?.city, myCountry, driverQ.data?.partner_type, driverQ.data?.assigned_category],
    enabled: !!driverQ.data?.is_online && driverQ.data?.status === "approved" && !!myCountry && !walletEmpty,
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

  // Popup minuté "nouvelle course" (mode self_assign) : affiché le temps de
  // SELF_ASSIGN_POPUP_SECONDS, accompagné de la notification système ET d'un
  // message vocal "Vous avez une commande" — en plus du toast/bip existants.
  const [newRidePopup, setNewRidePopup] = useState<{ id: string; title: string; description: string } | null>(null);
  const [newRidePopupSeconds, setNewRidePopupSeconds] = useState(SELF_ASSIGN_POPUP_SECONDS);
  const penalizeFn = useServerFn(penalizeSelfIgnoredRide);
  const penalize = useMutation({
    mutationFn: (rideId: string) => penalizeFn({ data: { rideId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-reward-wallet"] }),
    // Non bloquant : une pénalité ratée (offline, etc.) ne doit jamais gêner le chauffeur.
    onError: () => {},
  });
  // "Ignorer" explicite OU laisser filer le compte à rebours sans réagir :
  // dans les deux cas le chauffeur a vu passer une course sans répondre,
  // donc la pénalité s'applique de la même façon.
  const dismissPopupWithPenalty = (rideId: string) => {
    penalize.mutate(rideId);
    toast.warning("Course ignorée — pénalité appliquée sur vos points reward.");
    setNewRidePopup(null);
  };
  useEffect(() => {
    if (!newRidePopup) return;
    setNewRidePopupSeconds(SELF_ASSIGN_POPUP_SECONDS);
    const timer = setInterval(() => {
      setNewRidePopupSeconds((s) => {
        if (s <= 1) {
          clearInterval(timer);
          penalize.mutate(newRidePopup.id);
          setNewRidePopup(null);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [newRidePopup?.id]);

  // Demande la permission de notification une seule fois si le canal système est activé.
  useEffect(() => {
    if (!prefs?.channel_system || !prefs?.notify_new_ride) return;
    getNotifyPermission().then((p) => {
      if (p === "default") requestNotifyPermission().catch(() => {});
    });
  }, [prefs?.channel_system, prefs?.notify_new_ride]);
  useEffect(() => {
    if (!myCountry || !driverQ.data?.is_online) return;
    if (!prefs?.notify_new_ride) return;
    // Wallet épuisé : ni notification, ni popup, ni offre — voir migration
    // 20260630000000_wallet_balance_gating.sql pour le mode 'proximity'.
    if (walletEmpty) return;
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
        const description = `${r.pickup_address ?? "Point de départ"} → ${r.dropoff_address ?? ""}`;
        if (prefs.channel_toast) {
          toast.success(title, { description: description.slice(0, 120), duration: 9000 });
        }
        try {
          if (prefs.channel_system) {
            showLocalNotification(isDelivery ? "Nouvelle livraison à proximité" : "Nouvelle course à proximité", description);
          }
          if (prefs.sound_enabled) {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const o = ctx.createOscillator(); const g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.frequency.value = 1040; g.gain.value = 0.18;
            o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 380);
          }
          speakAnnouncement("Vous avez une commande");
        } catch {}
        setNewRidePopup({ id: r.id, title, description });
        qc.invalidateQueries({ queryKey: ["open-rides"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [myCountry, driverQ.data?.is_online, driverQ.data?.city, qc, prefs?.notify_new_ride, prefs?.channel_toast, prefs?.channel_system, prefs?.sound_enabled, walletEmpty]);


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
      // Garde-fou UX : le trigger SQL bloque de toute façon l'acceptation si le
      // wallet est épuisé (voir 20260630000000_wallet_balance_gating.sql), mais
      // on évite ici l'appel réseau + le message d'erreur Postgres brut.
      if (walletEmpty) throw new Error("Solde wallet insuffisant. Contactez l'administration pour recharger votre wallet.");
      const { error } = await supabase.from("rides").update({
        driver_id: user!.id, status: "accepted", accepted_at: new Date().toISOString(),
      }).eq("id", rideId).eq("status", "requested");
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Course acceptée !"); qc.invalidateQueries(); setNewRidePopup(null); },
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
      <InsuranceAlertsBanner />
      <PendingOfferBanner />

      {/* Popup minuté "nouvelle course" — mode self_assign, voir SELF_ASSIGN_POPUP_SECONDS. */}
      <Dialog open={!!newRidePopup} onOpenChange={() => {}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{newRidePopup?.title ?? "Nouvelle course disponible !"}</DialogTitle>
            <DialogDescription>{newRidePopup?.description}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Disponible encore {newRidePopupSeconds}s — ignorer ou laisser expirer entraîne une pénalité sur vos points reward.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => newRidePopup && dismissPopupWithPenalty(newRidePopup.id)}
            >
              Ignorer
            </Button>
            <Button
              onClick={() => newRidePopup && accept.mutate(newRidePopup.id)}
              disabled={accept.isPending}
            >
              Accepter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {driverQ.data.is_online && (!myRidesQ.data || myRidesQ.data.length === 0) && (
        <DriverIdleMap />
      )}

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
            onCheckedChange={(v) => { primeSpeechSynthesis(); toggleOnline.mutate(v); }}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={Wallet} label="Gains totaux" value={formatXof(Number(driverQ.data.total_earnings ?? 0))} />
        <Stat icon={Car} label="Courses effectuées" value={String(driverQ.data.rides_count)} />
        <Stat icon={Clock} label="Note moyenne" value={`${Number(driverQ.data.rating_avg ?? 5).toFixed(1)} / 5`} />
      </div>

      <DriverZoneSettings />

      <InsuranceStatusCard profile={driverQ.data} />

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
                <DriverLocationSharer
                  rideId={r.id}
                  pickup={r.pickup_lat && r.pickup_lng ? { lat: r.pickup_lat, lng: r.pickup_lng } : null}
                  dropoff={r.dropoff_lat && r.dropoff_lng ? { lat: r.dropoff_lat, lng: r.dropoff_lng } : null}
                />
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
        ) : walletEmpty ? (
          <div className="rounded-2xl border border-dashed border-destructive/50 bg-destructive/5 p-8 text-center text-sm text-destructive">
            Solde wallet insuffisant. Contactez l'administration pour recharger votre wallet afin de recevoir et d'accepter des courses.
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

  // Détecte l'arrivée d'une *nouvelle* offre (id différent de la dernière vue)
  // pour ne déclencher la notification système + le message vocal qu'une seule
  // fois par offre, pas à chaque refetch toutes les 3s.
  const lastOfferIdRef = useRef<string | null>(null);
  useEffect(() => {
    const offer = offerQ.data as any;
    if (!offer || offer.id === lastOfferIdRef.current) return;
    lastOfferIdRef.current = offer.id;
    const isDelivery = offer.rides?.service_type === "delivery";
    try {
      showLocalNotification(
        isDelivery ? "Nouvelle livraison à proximité" : "Nouvelle course à proximité",
        "Vous avez une nouvelle offre — répondez avant expiration.",
      );
      speakAnnouncement("Vous avez une commande");
    } catch {}
  }, [offerQ.data]);

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
  const isDelivery = ride?.service_type === "delivery";
  const deliveryVehicle = ride?.delivery_vehicle as keyof typeof DELIVERY_VEHICLES | undefined;
  const vehicleEmoji = isDelivery && deliveryVehicle
    ? DELIVERY_VEHICLES[deliveryVehicle]?.emoji
    : CATEGORIES[ride?.category as keyof typeof CATEGORIES]?.emoji;
  const vehicleLabel = isDelivery && deliveryVehicle
    ? DELIVERY_VEHICLES[deliveryVehicle]?.label
    : CATEGORIES[ride?.category as keyof typeof CATEGORIES]?.label;

  // Avant acceptation : aucune adresse précise, aucun prix, aucune identité
  // passager — uniquement distance / type de véhicule / ville. Les détails
  // complets n'arrivent qu'après l'acceptation (cf. myRidesQ qui fait alors
  // un select("*") légitime sur la course acceptée).
  const banner = (
    <div className="rounded-3xl border-2 border-primary bg-primary/5 p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
          Nouvelle {isDelivery ? "livraison" : "course"} proposée — {secondsLeft}s pour répondre
        </span>
        {typeof offer.distance_km === "number" && (
          <span className="text-xs text-muted-foreground">≈ {offer.distance_km.toFixed(1)} km de vous</span>
        )}
      </div>
      {ride && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-2xl">{vehicleEmoji ?? "📦"}</span>
          {vehicleLabel && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{vehicleLabel}</span>}
          {ride.city && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{ride.city}</span>}
          {typeof ride.duration_min === "number" && (
            <span className="text-xs text-muted-foreground">≈ {ride.duration_min} min de trajet</span>
          )}
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Adresse de départ, destination, prix et contact du passager s'affichent après acceptation.
      </p>
      <div className="mt-4 flex gap-2">
        <Button onClick={() => accept.mutate(offer.ride_id)} disabled={accept.isPending}>Accepter</Button>
        <Button variant="outline" onClick={() => decline.mutate(offer.ride_id)} disabled={decline.isPending}>Refuser</Button>
      </div>
    </div>
  );

  // Le bandeau reste affiché dans le tableau de bord (countdown en direct), et
  // un vrai popup modal reprend la même alerte tant que l'offre est nouvelle —
  // il se ferme dès qu'on accepte/refuse ou qu'il expire (countdown commun).
  return (
    <>
      {banner}
      <Dialog open={secondsLeft > 0} onOpenChange={() => {}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle {isDelivery ? "livraison" : "course"} proposée !</DialogTitle>
            <DialogDescription>
              {secondsLeft}s pour répondre
              {typeof offer.distance_km === "number" ? ` — ≈ ${offer.distance_km.toFixed(1)} km de vous` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button onClick={() => accept.mutate(offer.ride_id)} disabled={accept.isPending}>Accepter</Button>
            <Button variant="outline" onClick={() => decline.mutate(offer.ride_id)} disabled={decline.isPending}>Refuser</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Alertes d'expiration d'assurance (générées quotidiennement côté serveur,
 * voir public.generate_insurance_alerts) : affiche les alertes non lues du
 * chauffeur (toast + notification système, une seule fois chacune), puis les
 * marque comme lues.
 */
function InsuranceAlertsBanner() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const shownRef = useRef<Set<string>>(new Set());

  const alertsQ = useQuery({
    queryKey: ["driver-alerts", user?.id],
    enabled: !!user,
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("driver_alerts")
        .select("*")
        .eq("driver_id", user!.id)
        .is("read_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    for (const a of alertsQ.data ?? []) {
      if (shownRef.current.has(a.id)) continue;
      shownRef.current.add(a.id);
      const isExpired = a.type === "insurance_expired";
      if (isExpired) toast.error(a.title, { description: a.body, duration: 12000 });
      else toast.warning(a.title, { description: a.body, duration: 10000 });
      try {
        showLocalNotification(a.title, a.body);
      } catch {}
    }
  }, [alertsQ.data]);

  const markAllRead = useMutation({
    mutationFn: async () => {
      const ids = (alertsQ.data ?? []).map((a) => a.id);
      if (ids.length === 0) return;
      const { error } = await supabase.from("driver_alerts").update({ read_at: new Date().toISOString() }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driver-alerts"] }),
  });

  const alerts = alertsQ.data ?? [];
  if (alerts.length === 0) return null;

  return (
    <div className="rounded-3xl border border-warning/40 bg-warning/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="space-y-1">
            {alerts.map((a) => (
              <p key={a.id} className="text-sm">
                <span className="font-semibold">{a.title}</span> — {a.body}
              </p>
            ))}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
          OK, compris
        </Button>
      </div>
    </div>
  );
}

/** Statut d'assurance + renouvellement (remet le dossier en attente de
 *  validation par l'assureur). */
function InsuranceStatusCard({ profile }: { profile: any }) {
  const qc = useQueryClient();
  const renewFn = useServerFn(renewMyInsurance);
  const [expiresAt, setExpiresAt] = useState(profile.insurance_expires_at ?? "");

  const renew = useMutation({
    mutationFn: () => renewFn({ data: { expires_at: expiresAt } }),
    onSuccess: () => {
      toast.success("Renouvellement envoyé — en attente de validation par l'assureur");
      qc.invalidateQueries({ queryKey: ["driver-profile"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const status = (profile.insurance_status ?? "pending") as InsuranceStatus;
  const daysLeft = profile.insurance_expires_at
    ? Math.round((new Date(profile.insurance_expires_at).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <div className="rounded-3xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold">Assurance</h3>
          <p className="text-xs text-muted-foreground">
            {profile.insurance_expires_at
              ? `Expire le ${new Date(profile.insurance_expires_at).toLocaleDateString("fr-FR")}`
              : "Date d'expiration non renseignée"}
            {typeof daysLeft === "number" && (
              <span className={daysLeft < 0 ? "text-destructive" : daysLeft <= 7 ? "text-warning" : ""}>
                {" "}({daysLeft < 0 ? "expirée" : `${daysLeft} j restants`})
              </span>
            )}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium",
            status === "verified" ? "border-success/40 bg-success/10 text-success"
              : status === "expired" ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-warning/40 bg-warning/10 text-warning",
          )}
        >
          {INSURANCE_STATUS_LABEL[status]}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Nouvelle date d'expiration</label>
          <Input type="date" className="mt-1" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </div>
        <Button size="sm" disabled={!expiresAt || renew.isPending} onClick={() => renew.mutate()}>
          {renew.isPending ? "Envoi…" : "Renouveler"}
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Le renouvellement remet votre dossier en attente de validation par l'assureur.
      </p>
    </div>
  );
}

/**
 * Carte par défaut du tableau de bord conducteur : tant qu'aucune course
 * n'est en cours, affiche la position GPS courante du chauffeur (centrée,
 * suivie en direct) — c'est depuis cette vue qu'il verra arriver les
 * notifications d'offre de course (PendingOfferBanner au-dessus).
 */
function DriverIdleMap() {
  const [pos, setPos] = useState<LatLng | null>(null);
  const [status, setStatus] = useState<"idle" | "ok" | "denied" | "error">("idle");

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("error");
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (p) => {
        setStatus("ok");
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error"),
      { enableHighAccuracy: true, maximumAge: 8000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  return (
    <section className="space-y-2">
      <h2 className="font-display text-base font-semibold">Votre position</h2>
      {pos ? (
        <RideTrackingMap pickup={null} dropoff={null} driver={pos} center={pos} followDriver height={260} />
      ) : (
        <div className="flex h-[260px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
          {status === "denied"
            ? "Autorisez la géolocalisation pour afficher votre position sur la carte."
            : status === "error"
              ? "Géolocalisation indisponible."
              : "Localisation en cours…"}
        </div>
      )}
    </section>
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

/**
 * Streams the driver's GPS position to the ride row every ~6s while active,
 * et affiche la carte de progression (position chauffeur + départ/arrivée)
 * — c'est la vue "détails visibles après acceptation" demandée : une fois la
 * course acceptée, le chauffeur voit sa progression sur la carte.
 */
function DriverLocationSharer({ rideId, pickup, dropoff }: { rideId: string; pickup: LatLng | null; dropoff: LatLng | null }) {
  const [status, setStatus] = useState<"idle" | "ok" | "denied" | "error">("idle");
  const [pos, setPos] = useState<LatLng | null>(null);
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("error");
      return;
    }
    let lastSent = 0;
    const watchId = navigator.geolocation.watchPosition(
      async (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        const now = Date.now();
        if (now - lastSent < 6000) return;
        lastSent = now;
        const { error } = await supabase.from("rides").update({
          driver_lat: p.coords.latitude,
          driver_lng: p.coords.longitude,
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
    <div className="space-y-2">
      <div className="rounded-xl border border-border bg-card px-4 py-2 text-xs text-muted-foreground">
        {status === "ok" && <>📍 Position partagée avec le passager (mise à jour en direct)</>}
        {status === "idle" && <>📍 Activation du partage de position…</>}
        {status === "denied" && <span className="text-destructive">⚠ Autorisez la géolocalisation pour que le passager vous suive.</span>}
        {status === "error" && <span className="text-destructive">⚠ Impossible d'accéder à la géolocalisation.</span>}
      </div>
      {(pos || pickup || dropoff) && (
        <RideTrackingMap pickup={pickup} dropoff={dropoff} driver={pos} followDriver height={260} />
      )}
    </div>
  );
}
