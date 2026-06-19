import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { getNotificationPrefs, updateNotificationPrefs } from "@/lib/tracking.functions";
import { Bell, BellOff } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/settings")({
  head: () => ({ meta: [{ title: "Paramètres — Tibus Ride" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const getPrefs = useServerFn(getNotificationPrefs);
  const updatePrefs = useServerFn(updateNotificationPrefs);
  const { data, refetch } = useQuery({ queryKey: ["notif-prefs"], queryFn: () => getPrefs() });

  const [permission, setPermission] = useState<NotificationPermission>("default");
  useEffect(() => {
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
  }, []);

  const update = useMutation({
    mutationFn: (patch: any) => updatePrefs({ data: patch }),
    onSuccess: () => { refetch(); toast.success("Préférence enregistrée"); },
  });

  const requestPerm = async () => {
    if (typeof Notification === "undefined") {
      toast.error("Notifications non supportées par ce navigateur");
      return;
    }
    const p = await Notification.requestPermission();
    setPermission(p);
    if (p === "granted") toast.success("Notifications activées");
  };

  if (!data) return <div className="py-12 text-center text-muted-foreground">Chargement…</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="font-display text-2xl font-bold">Paramètres</h1>

      <section className="rounded-3xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {permission === "granted" ? <Bell className="h-5 w-5 text-primary" /> : <BellOff className="h-5 w-5 text-muted-foreground" />}
            <div>
              <h2 className="font-semibold">Notifications du navigateur</h2>
              <p className="text-xs text-muted-foreground">État : {permission === "granted" ? "autorisé" : permission === "denied" ? "refusé" : "non demandé"}</p>
            </div>
          </div>
          {permission !== "granted" && (
            <Button size="sm" onClick={requestPerm} disabled={permission === "denied"}>Activer</Button>
          )}
        </div>
        {permission === "denied" && (
          <p className="mt-3 text-xs text-destructive">Les notifications ont été refusées. Réactivez-les dans les paramètres de votre navigateur.</p>
        )}
      </section>

      <section className="rounded-3xl border border-border bg-card p-5">
        <h2 className="font-display text-lg font-semibold">Notifications de course</h2>
        <div className="mt-4 space-y-4">
          <PrefRow label="Changement de statut" desc="Acceptée, en route, démarrée, terminée…"
            value={data.notify_status_change} onChange={(v) => update.mutate({ notify_status_change: v })} />
          <PrefRow label="Chauffeur arrivé" desc="Quand le chauffeur passe en statut « j'arrive »."
            value={data.notify_driver_arriving} onChange={(v) => update.mutate({ notify_driver_arriving: v })} />
          <PrefRow label="Chauffeur à proximité" desc="Alerte quand le chauffeur est à moins de 300 m du point de départ."
            value={data.notify_driver_nearby} onChange={(v) => update.mutate({ notify_driver_nearby: v })} />
          <PrefRow label="Son" desc="Bip sonore en plus des notifications visuelles."
            value={data.sound_enabled} onChange={(v) => update.mutate({ sound_enabled: v })} />
        </div>
      </section>
    </div>
  );
}

function PrefRow({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border p-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}
