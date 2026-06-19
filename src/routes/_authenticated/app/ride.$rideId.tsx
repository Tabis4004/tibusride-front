import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ArrowLeft, Download, FileText, MapPin, Phone, MessageCircle, Sparkles, Wallet } from "lucide-react";
import { RideTrackingMap, type LatLng } from "@/components/RideTrackingMap";
import { exportRideHistoryCsv, getRideHistory, logContactView, toggleContactShare } from "@/lib/tracking.functions";
import { formatXof, CATEGORIES } from "@/lib/pricing";
import { useAuth } from "@/hooks/use-auth";
import jsPDF from "jspdf";

export const Route = createFileRoute("/_authenticated/app/ride/$rideId")({
  head: () => ({ meta: [{ title: "Détail de la course — Tibus Ride" }] }),
  component: RideDetailPage,
});

function RideDetailPage() {
  const { rideId } = Route.useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const getHistory = useServerFn(getRideHistory);
  const exportCsv = useServerFn(exportRideHistoryCsv);
  const toggleShare = useServerFn(toggleContactShare);
  const logView = useServerFn(logContactView);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ride-history", rideId],
    queryFn: () => getHistory({ data: { rideId } }),
    refetchInterval: 8000,
  });

  const ride: any = data?.ride;
  const events = data?.events ?? [];
  const isPassenger = user?.id === ride?.passenger_id;
  const isDriver = user?.id === ride?.driver_id;

  // Counterpart contact
  const counterpartId = isPassenger ? ride?.driver_id : ride?.passenger_id;
  const counterpartSharesPhone = isPassenger ? ride?.driver_shares_phone : ride?.passenger_shares_phone;
  const ownShare = isPassenger ? ride?.passenger_shares_phone : ride?.driver_shares_phone;

  const counterpartQ = useQuery({
    queryKey: ["ride-counterpart", counterpartId],
    enabled: !!counterpartId,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("full_name,phone").eq("id", counterpartId).maybeSingle();
      return data;
    },
  });
  const counterpartPhone = isPassenger
    ? counterpartQ.data?.phone
    : ride?.passenger_phone ?? counterpartQ.data?.phone;

  const [revealed, setRevealed] = useState(false);

  const toggleMut = useMutation({
    mutationFn: (share: boolean) => toggleShare({ data: { rideId, share } }),
    onSuccess: () => { refetch(); toast.success("Préférence enregistrée"); },
  });

  const positions = useMemo(
    () => events.filter((e: any) => e.event_type === "location" && e.lat && e.lng).map((e: any) => ({ lat: e.lat, lng: e.lng })),
    [events],
  );
  const statusChanges = useMemo(() => events.filter((e: any) => e.event_type === "status_change"), [events]);
  const contactLogs = useMemo(() => events.filter((e: any) => e.event_type === "contact_view" || e.event_type === "contact_toggle"), [events]);

  const pickup: LatLng | null = ride?.pickup_lat && ride?.pickup_lng ? { lat: ride.pickup_lat, lng: ride.pickup_lng } : positions[0] ?? null;
  const dropoff: LatLng | null = ride?.dropoff_lat && ride?.dropoff_lng ? { lat: ride.dropoff_lat, lng: ride.dropoff_lng } : positions[positions.length - 1] ?? null;

  const handleReveal = async () => {
    setRevealed((s) => !s);
    if (!revealed) {
      try { await logView({ data: { rideId, target: isPassenger ? "driver" : "passenger" } }); } catch {}
    }
  };

  // Wallet widget data
  const paxWalletQ = useQuery({
    queryKey: ["pax-wallet", user?.id],
    enabled: !!user && isPassenger,
    queryFn: async () => {
      const { data } = await supabase.from("passenger_wallets").select("balance_pts").eq("user_id", user!.id).maybeSingle();
      return data ?? { balance_pts: 0 };
    },
  });
  const drvWalletQ = useQuery({
    queryKey: ["driver-wallet", user?.id],
    enabled: !!user && isDriver,
    queryFn: async () => {
      const { data } = await supabase.from("driver_wallets").select("balance_xof").eq("user_id", user!.id).maybeSingle();
      return data ?? { balance_xof: 0 };
    },
  });
  const settingsQ = useQuery({
    queryKey: ["reward-settings"],
    queryFn: async () => {
      const { data } = await supabase.from("reward_settings").select("point_value_xof,passenger_ride_earn_pts").eq("id", true).maybeSingle();
      return data;
    },
  });
  const payoutQ = useQuery({
    queryKey: ["ride-payout", rideId],
    enabled: !!rideId && isDriver,
    queryFn: async () => {
      const { data } = await supabase.from("ride_payouts").select("*").eq("ride_id", rideId).maybeSingle();
      return data;
    },
    refetchInterval: 5000,
  });

  const handleDownloadCsv = async () => {
    const { csv } = await exportCsv({ data: { rideId } });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `course-${rideId.slice(0, 8)}-events.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = () => {
    if (!ride) return;
    const doc = new jsPDF();
    doc.setFontSize(16); doc.text("Tibus Ride — Détail de course", 14, 18);
    doc.setFontSize(10);
    doc.text(`Course #${ride.id.slice(0, 8)}`, 14, 28);
    doc.text(`Créée le ${new Date(ride.created_at).toLocaleString("fr-FR")}`, 14, 34);
    doc.text(`Ville : ${ride.city}    Catégorie : ${ride.category}`, 14, 40);
    doc.text(`Départ : ${ride.pickup_address}`, 14, 46);
    doc.text(`Arrivée : ${ride.dropoff_address}`, 14, 52);
    doc.text(`Prix : ${formatXof(ride.price_xof)}    Statut : ${ride.status}`, 14, 58);
    doc.setFontSize(12); doc.text("Historique des événements", 14, 70);
    doc.setFontSize(9);
    let y = 78;
    events.forEach((e: any) => {
      const ts = new Date(e.created_at).toLocaleString("fr-FR");
      const detail = e.event_type === "status_change" ? `statut → ${e.status}`
        : e.event_type === "location" ? `position ${e.lat?.toFixed(5)}, ${e.lng?.toFixed(5)}`
        : `${e.event_type} ${JSON.stringify(e.details ?? {})}`;
      const line = `${ts}  ·  ${detail}`;
      if (y > 280) { doc.addPage(); y = 20; }
      doc.text(line.slice(0, 110), 14, y); y += 5;
    });
    doc.save(`course-${ride.id.slice(0, 8)}.pdf`);
  };

  if (isLoading || !ride) return <div className="py-12 text-center text-muted-foreground">Chargement…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/app/rides" })}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Retour
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleDownloadCsv}><Download className="mr-1 h-4 w-4" />CSV</Button>
          <Button variant="outline" size="sm" onClick={handleDownloadPdf}><FileText className="mr-1 h-4 w-4" />PDF</Button>
        </div>
      </div>

      <header className="rounded-3xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-2xl">{CATEGORIES[ride.category as keyof typeof CATEGORIES]?.emoji}</span>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{ride.city}</span>
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">{ride.status}</span>
          <span className="ml-auto font-display text-2xl font-bold">{formatXof(ride.price_xof)}</span>
        </div>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div className="flex items-start gap-2"><MapPin className="h-4 w-4 text-success mt-0.5" />{ride.pickup_address}</div>
          <div className="flex items-start gap-2"><MapPin className="h-4 w-4 text-primary mt-0.5" />{ride.dropoff_address}</div>
        </div>
      </header>

      {/* Wallet & rewards widget */}
      {isPassenger && (() => {
        const pts = paxWalletQ.data?.balance_pts ?? 0;
        const ptVal = settingsQ.data?.point_value_xof ?? 1;
        const earnPts = settingsQ.data?.passenger_ride_earn_pts ?? 0;
        const credit = Math.min(pts * ptVal, ride.price_xof);
        return (
          <section className="rounded-3xl border border-primary/30 bg-primary/5 p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h2 className="font-display text-base font-semibold">Mes récompenses</h2>
              <Link to="/app/rewards" className="ml-auto text-xs font-medium text-primary underline-offset-2 hover:underline">Voir le détail</Link>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-card border border-border p-3">
                <div className="text-xs text-muted-foreground">Mon solde points</div>
                <div className="text-2xl font-bold">{pts.toLocaleString()} pts</div>
                <div className="text-xs text-muted-foreground">≈ {formatXof(pts * ptVal)} de crédit</div>
              </div>
              <div className="rounded-xl bg-card border border-border p-3 text-sm">
                <div className="font-medium">Économisez sur cette course</div>
                {credit > 0
                  ? <p className="mt-1 text-muted-foreground">Vous pouvez déduire jusqu'à <strong className="text-foreground">{formatXof(credit)}</strong> du prix ({formatXof(ride.price_xof)}) en utilisant vos points.</p>
                  : <p className="mt-1 text-muted-foreground">Pas encore de points. Vous gagnerez <strong className="text-foreground">{earnPts} pts</strong> à la fin de cette course.</p>}
              </div>
            </div>
          </section>
        );
      })()}
      {isDriver && (
        <section className="rounded-3xl border border-primary/30 bg-primary/5 p-5">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            <h2 className="font-display text-base font-semibold">Mon wallet chauffeur</h2>
            <Link to="/app/rewards" className="ml-auto text-xs font-medium text-primary underline-offset-2 hover:underline">Détails</Link>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 text-sm">
            <div className="rounded-xl bg-card border border-border p-3">
              <div className="text-xs text-muted-foreground">Solde</div>
              <div className="text-2xl font-bold">{formatXof(drvWalletQ.data?.balance_xof ?? 0)}</div>
            </div>
            <div className="rounded-xl bg-card border border-border p-3">
              <div className="text-xs text-muted-foreground">Gains nets prévus</div>
              <div className="text-xl font-bold">{formatXof(ride.driver_earnings_xof ?? Math.max((ride.price_xof ?? 0) - (ride.commission_xof ?? 0), 0))}</div>
              <div className="text-xs text-muted-foreground">Commission : {formatXof(ride.commission_xof ?? 0)}</div>
            </div>
            <div className="rounded-xl bg-card border border-border p-3">
              <div className="text-xs text-muted-foreground">Versement</div>
              <div className="text-sm font-semibold capitalize">{payoutQ.data?.status ?? (ride.status === "completed" ? "en cours" : "à la fin de course")}</div>
              {payoutQ.data?.processed_at && <div className="text-xs text-muted-foreground">{new Date(payoutQ.data.processed_at).toLocaleString("fr-FR")}</div>}
              {payoutQ.data?.error && <div className="text-xs text-destructive mt-1">{payoutQ.data.error}</div>}
            </div>
          </div>
        </section>
      )}


      {pickup && dropoff && (
        <RideTrackingMap pickup={pickup} dropoff={dropoff} driver={positions[positions.length - 1] ?? null} height={320} />
      )}

      {(isPassenger || isDriver) && counterpartId && (
        <section className="rounded-3xl border border-border bg-card p-5">
          <h2 className="font-display text-lg font-semibold">Contact {isPassenger ? "chauffeur" : "passager"}</h2>
          <div className="mt-3 flex items-center justify-between rounded-xl border border-border p-3">
            <div className="text-sm">
              <div className="font-medium">{counterpartQ.data?.full_name ?? "—"}</div>
              <div className="text-xs text-muted-foreground">
                {counterpartPhone && counterpartSharesPhone
                  ? (revealed ? counterpartPhone : "•••• " + counterpartPhone.slice(-3))
                  : counterpartSharesPhone === false ? "Numéro masqué par la contrepartie" : "Pas de numéro renseigné"}
              </div>
            </div>
            {counterpartPhone && counterpartSharesPhone && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleReveal}>{revealed ? "Masquer" : "Afficher"}</Button>
                {revealed && (
                  <>
                    <Button asChild size="sm" variant="outline"><a href={`tel:${counterpartPhone}`}><Phone className="h-4 w-4" /></a></Button>
                    <Button asChild size="sm" variant="outline">
                      <a href={`https://wa.me/${counterpartPhone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" /></a>
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between rounded-xl border border-border p-3">
            <div className="text-sm">
              <div className="font-medium">Partager mon numéro</div>
              <div className="text-xs text-muted-foreground">La contrepartie pourra voir votre téléphone.</div>
            </div>
            <Switch checked={!!ownShare} onCheckedChange={(v) => toggleMut.mutate(v)} />
          </div>
        </section>
      )}

      <section className="rounded-3xl border border-border bg-card p-5">
        <h2 className="font-display text-lg font-semibold">Historique du trajet</h2>
        <div className="mt-3 space-y-1 text-sm">
          {statusChanges.length === 0 && <p className="text-muted-foreground">Aucun changement de statut.</p>}
          {statusChanges.map((e: any) => (
            <div key={e.id} className="flex justify-between rounded border border-border px-3 py-1.5">
              <span className="capitalize">{e.status}</span>
              <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("fr-FR")}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 text-xs text-muted-foreground">
          {positions.length} points GPS enregistrés
        </div>
      </section>

      {contactLogs.length > 0 && (
        <section className="rounded-3xl border border-border bg-card p-5">
          <h2 className="font-display text-lg font-semibold">Journal des échanges de contact</h2>
          <div className="mt-3 space-y-1 text-xs">
            {contactLogs.map((e: any) => (
              <div key={e.id} className="flex justify-between rounded border border-border px-3 py-1">
                <span>{e.event_type === "contact_view" ? "Numéro consulté" : `Partage ${e.details?.share ? "activé" : "désactivé"}`} ({e.details?.role ?? e.details?.target})</span>
                <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString("fr-FR")}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
