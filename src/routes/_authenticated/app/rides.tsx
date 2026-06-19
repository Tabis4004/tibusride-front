import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { CATEGORIES, formatXof } from "@/lib/pricing";
import { MapPin } from "lucide-react";
import { listMyRides } from "@/lib/app-data.functions";

export const Route = createFileRoute("/_authenticated/app/rides")({
  head: () => ({ meta: [{ title: "Mes courses — Tibus Ride" }] }),
  component: RidesPage,
});

function RidesPage() {
  const { user, primaryRole } = useAuth();
  const listFn = useServerFn(listMyRides);

  const { data, isLoading } = useQuery({
    queryKey: ["my-rides", user?.id, primaryRole],
    enabled: !!user,
    refetchInterval: 6000,
    queryFn: async () => {
      const res = await listFn();
      return primaryRole === "driver" ? res.asDriver : res.asPassenger;
    },
  });

  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Chargement…</div>;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Mes courses</h1>
      {(data ?? []).length === 0 ? (
        <p className="text-muted-foreground">Aucune course pour le moment.</p>
      ) : (
        <ul className="space-y-3">
          {(data ?? []).map((r: any) => (
            <li key={r.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium capitalize">{r.status.replace("_", " ")}</span>
                <span className="text-muted-foreground">{new Date(r.created_at).toLocaleString("fr-FR")}</span>
              </div>
              <div className="mt-2 space-y-1 text-sm">
                <div className="flex gap-2"><MapPin className="h-4 w-4 text-success" />{r.pickup_address}</div>
                <div className="flex gap-2"><MapPin className="h-4 w-4 text-primary" />{r.dropoff_address}</div>
              </div>
              <div className="mt-2 flex justify-between text-sm">
                <span>{CATEGORIES[r.category as keyof typeof CATEGORIES]?.label ?? r.category}</span>
                <span className="font-semibold text-primary">{formatXof(r.price_xof)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
