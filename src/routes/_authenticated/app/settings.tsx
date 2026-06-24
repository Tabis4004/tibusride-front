import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { SERVICE_COUNTRIES } from "@/lib/countries";
import { getNotificationPrefs, updateNotificationPrefs, updateMyCountry } from "@/lib/tracking.functions";
import { getNotifyPermission, requestNotifyPermission, isNotifySupported, type NotifyPermission } from "@/lib/notify";
import { Bell, BellOff, Globe } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/settings")({
  head: () => ({ meta: [{ title: "Paramètres — Tibus Ride" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const getPrefs = useServerFn(getNotificationPrefs);
  const updatePrefs = useServerFn(updateNotificationPrefs);
  const changeCountry = useServerFn(updateMyCountry);

  const { data, refetch } = useQuery({ queryKey: ["notif-prefs"], queryFn: () => getPrefs() });

  const profileQ = useQuery({
    queryKey: ["self-profile-settings", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles").select("country").eq("id", user!.id).maybeSingle();
      if (error) throw error;
      return data as { country: string | null } | null;
    },
  });

  const [permission, setPermission] = useState<NotifyPermission>("default");
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    setSupported(isNotifySupported());
    getNotifyPermission().then(setPermission);
  }, []);

  const update = useMutation({
    mutationFn: (patch: any) => updatePrefs({ data: patch }),
    onSuccess: () => { refetch(); toast.success("Préférence enregistrée"); },
  });

  const [country, setCountry] = useState<string>("");
  useEffect(() => { if (profileQ.data?.country) setCountry(profileQ.data.country); }, [profileQ.data?.country]);

  const saveCountry = useMutation({
    mutationFn: (c: string) => changeCountry({ data: { country: c } }),
    onSuccess: (res: any) => {
      toast.success(`Pays mis à jour : ${res.country}. Les trajets visibles ont été recalculés.`);
      qc.invalidateQueries({ queryKey: ["self-profile-settings"] });
      qc.invalidateQueries({ queryKey: ["self-profile"] });
      qc.invalidateQueries({ queryKey: ["open-rides"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const requestPerm = async () => {
    if (!isNotifySupported()) {
      toast.error("Notifications non supportées sur cet appareil");
      return;
    }
    const p = await requestNotifyPermission();
    setPermission(p);
    if (p === "granted") toast.success("Notifications activées");
  };

  if (!data) return <div className="py-12 text-center text-muted-foreground">Chargement…</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="font-display text-2xl font-bold">Paramètres</h1>

      <section className="rounded-3xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-semibold">Pays</h2>
            <p className="text-xs text-muted-foreground">Vous ne verrez que les trajets de ce pays.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="country">Pays actuel</Label>
            <select
              id="country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="" disabled>Sélectionnez votre pays</option>
              {SERVICE_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <Button
            onClick={() => saveCountry.mutate(country)}
            disabled={!country || country === profileQ.data?.country || saveCountry.isPending}
          >
            {saveCountry.isPending ? "Enregistrement…" : "Mettre à jour"}
          </Button>
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {permission === "granted" ? <Bell className="h-5 w-5 text-primary" /> : <BellOff className="h-5 w-5 text-muted-foreground" />}
            <div>
              <h2 className="font-semibold">Notifications</h2>
              <p className="text-xs text-muted-foreground">
                État : {!supported ? "non disponible sur cette version de l'app" : permission === "granted" ? "autorisé" : permission === "denied" ? "refusé" : "non demandé"}
              </p>
            </div>
          </div>
          {supported && permission !== "granted" && (
            <Button size="sm" onClick={requestPerm} disabled={permission === "denied"}>Activer</Button>
          )}
        </div>
        {permission === "denied" && (
          <p className="mt-3 text-xs text-destructive">Les notifications ont été refusées. Réactivez-les dans les paramètres de votre appareil.</p>
        )}
        {!supported && (
          <p className="mt-3 text-xs text-muted-foreground">Mettez à jour l'application vers la dernière version pour activer les notifications.</p>
        )}
      </section>

      <section className="rounded-3xl border border-border bg-card p-5">
        <h2 className="font-display text-lg font-semibold">Nouvelles courses</h2>
        <p className="text-xs text-muted-foreground">Alertes envoyées aux chauffeurs lorsqu'une nouvelle course est demandée dans leur pays.</p>
        <div className="mt-4 space-y-4">
          <PrefRow label="Recevoir les alertes de nouvelles courses" desc="Active ou désactive complètement les notifications de nouvelles demandes."
            value={data.notify_new_ride ?? true} onChange={(v) => update.mutate({ notify_new_ride: v })} />
          <div className={`space-y-4 transition-opacity ${data.notify_new_ride === false ? "pointer-events-none opacity-50" : ""}`}>
            <PrefRow label="Toast dans l'application" desc="Bannière affichée dans l'app quand elle est ouverte."
              value={data.channel_toast ?? true} onChange={(v) => update.mutate({ channel_toast: v })} />
            <PrefRow label="Notification système" desc="Notification du navigateur, même si l'app est en arrière-plan."
              value={data.channel_system ?? true} onChange={(v) => update.mutate({ channel_system: v })} />
            <PrefRow label="Son" desc="Bip sonore en plus des notifications visuelles."
              value={data.sound_enabled} onChange={(v) => update.mutate({ sound_enabled: v })} />
          </div>
        </div>
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
