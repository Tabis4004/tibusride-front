import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CATEGORIES, formatXof } from "@/lib/pricing";
import { MapPin } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/rides")({
  head: () => ({ meta: [{ title: "Mes courses — Tibus Ride" }] }),
  component: RidesPage,
});

function RidesPage() {
  const { user, primaryRole } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["my-rides", user?.id, primaryRole],
    enabled: !!user,
    refetchInterval: 6000,
    queryFn: async () => {
      const col = primaryRole === "driver" ? "driver_id" : "passenger_id";
      const { data, error } = await supabase
        .from("rides")
        .select("*")
        .eq(col, user!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Historique</h1>
      <p className="text-sm text-muted-foreground">Toutes vos courses récentes.</p>

      <div className="mt-6 space-y-3">
        {isLoading && <div className="text-center text-muted-foreground py-8">Chargement…</div>}
        {!isLoading && (data?.length ?? 0) === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
            Aucune course pour le moment.
          </div>
        )}
        {(data ?? []).map((r: any) => (
          <div key={r.id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-xl">{CATEGORIES[r.category as keyof typeof CATEGORIES]?.emoji}</span>
                <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("fr-FR")}</span>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{r.city}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  r.status === "completed" ? "bg-success/20 text-success" :
                  r.status === "cancelled" ? "bg-muted text-muted-foreground" :
                  "bg-primary/15 text-primary"
                }`}>{r.status}</span>
              </div>
              <div className="font-display text-lg font-bold">{formatXof(r.price_xof)}</div>
            </div>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex items-start gap-2"><MapPin className="h-4 w-4 text-success mt-0.5 shrink-0" />{r.pickup_address}</div>
              <div className="flex items-start gap-2"><MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />{r.dropoff_address}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
