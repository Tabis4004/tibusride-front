import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { listMarketPrograms, setMarketProgramActive } from "@/lib/admin.functions";

type MarketProgramRow = {
  program_id: string;
  country: string;
  program_code: string;
  display_name: string;
  is_active: boolean;
  is_default: boolean;
  commission_default: number;
  commission_locked: boolean;
};

export function MarketProgramsTab() {
  const qc = useQueryClient();
  const list = useServerFn(listMarketPrograms);
  const toggleFn = useServerFn(setMarketProgramActive);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-market-programs"],
    queryFn: () => list() as Promise<MarketProgramRow[]>,
  });

  const toggle = useMutation({
    mutationFn: (v: { programId: string; isActive: boolean }) => toggleFn({ data: v }),
    onSuccess: (_d, v) => {
      toast.success(v.isActive ? "Programme réactivé" : "Programme désactivé — masqué pour passagers et chauffeurs");
      qc.invalidateQueries({ queryKey: ["admin-market-programs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Chargement…</div>;
  if (error) return <div className="py-8 text-center text-sm text-destructive">{(error as Error).message}</div>;

  const byCountry = (data ?? []).reduce<Record<string, MarketProgramRow[]>>((acc, p) => {
    (acc[p.country] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Désactiver un programme le masque totalement pour les passagers et chauffeurs (sélecteur, inscription, app).
        Vous (admin/superadmin) continuez à le voir et à pouvoir le réactiver ici. Les courses déjà en cours sur ce
        programme gardent leurs règles de commission.
      </p>

      {Object.entries(byCountry).map(([country, programs]) => (
        <section key={country} className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 font-display text-lg font-semibold">{country}</h2>
          <div className="space-y-2">
            {programs.map((p) => (
              <div
                key={p.program_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 p-3"
              >
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {p.display_name}
                    {p.is_default && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        Défaut
                      </span>
                    )}
                    {!p.is_active && (
                      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                        Désactivé
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.program_code} · Commission {p.commission_default}%{p.commission_locked ? " (verrouillée)" : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{p.is_active ? "Actif" : "Inactif"}</span>
                  <Switch
                    checked={p.is_active}
                    disabled={toggle.isPending}
                    onCheckedChange={(v) => toggle.mutate({ programId: p.program_id, isActive: v })}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {!data?.length && (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          Aucun programme dans votre périmètre.
        </div>
      )}
    </div>
  );
}
