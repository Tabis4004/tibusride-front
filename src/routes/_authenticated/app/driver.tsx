import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CATEGORIES, CITIES, formatXof } from "@/lib/pricing";
import { toast } from "sonner";
import { Car, Clock, MapPin, Wallet } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getMyWallet } from "@/lib/wallet.functions";

export const Route = createFileRoute("/_authenticated/app/driver")({
  head: () => ({ meta: [{ title: "Tableau de bord chauffeur — Tibus Ride" }] }),
  component: DriverPage,
});

function DriverPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

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
    queryKey: ["open-rides", driverQ.data?.is_online, driverQ.data?.city],
    enabled: !!driverQ.data?.is_online && driverQ.data?.status === "approved",
    refetchInterval: 4000,
    queryFn: async () => {
      let q = supabase.from("rides").select("*").eq("status", "requested").order("requested_at", { ascending: true }).limit(20);
      if (driverQ.data?.city) q = q.eq("city", driverQ.data.city);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

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
      <div className="mx-auto max-w-xl rounded-3xl border border-warning/40 bg-warning/10 p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warning/20"><Clock className="h-5 w-5 text-warning-foreground" /></div>
        <h2 className="mt-4 font-display text-xl font-bold">Compte en attente de validation</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Statut : <span className="font-medium capitalize">{driverQ.data.status}</span>. Notre équipe vérifie vos informations sous 72h.
        </p>
        <DriverInfoForm profile={driverQ.data} onSaved={() => qc.invalidateQueries({ queryKey: ["driver-profile"] })} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-border bg-card p-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Tableau de bord</h1>
          <p className="text-sm text-muted-foreground">{driverQ.data.city ?? "Ville non définie"} — {driverQ.data.rides_count} courses</p>
        </div>
        <div className="flex items-center gap-3">
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
          {driverQ.data.is_online ? `Courses disponibles${driverQ.data.city ? ` à ${driverQ.data.city}` : ""}` : "Activez-vous pour voir les courses"}
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
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-2xl">{CATEGORIES[ride.category as keyof typeof CATEGORIES]?.emoji}</span>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{ride.city}</span>
          <span className="text-xs text-muted-foreground">{ride.distance_km} km · {ride.duration_min} min</span>
        </div>
        <div className="font-display text-lg font-bold text-primary">{formatXof(ride.price_xof)}</div>
      </div>
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
      <h2 className="font-display text-xl font-bold">Initialiser votre profil chauffeur</h2>
      <p className="mt-2 text-sm text-muted-foreground">Créez votre profil pour commencer.</p>
      <Button className="mt-4" onClick={() => mut.mutate()} disabled={mut.isPending}>Créer mon profil</Button>
    </div>
  );
}

function DriverInfoForm({ profile, onSaved }: { profile: any; onSaved: () => void }) {
  const { user } = useAuth();
  const [city, setCity] = useState(profile.city ?? "");
  const [license, setLicense] = useState(profile.license_number ?? "");
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("driver_profiles").update({ city, license_number: license }).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Informations enregistrées"); onSaved(); },
  });
  return (
    <div className="mt-6 space-y-3 text-left">
      <div>
        <label className="text-sm font-medium">Ville</label>
        <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={city} onChange={(e) => setCity(e.target.value)}>
          <option value="">— choisir —</option>
          {CITIES.map((c) => <option key={c.value} value={c.value}>{c.value}</option>)}
        </select>
      </div>
      <div>
        <label className="text-sm font-medium">N° permis de conduire</label>
        <input className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={license} onChange={(e) => setLicense(e.target.value)} maxLength={50} />
      </div>
      <Button className="w-full" onClick={() => save.mutate()} disabled={save.isPending}>Enregistrer</Button>
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
            Les commissions plateforme sont automatiquement débitées à chaque course terminée.
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
