import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ShieldCheck, Phone, MapPin, Car } from "lucide-react";
import { listInsuredDrivers, verifyDriverInsurance } from "@/lib/insurance.functions";
import { INSURANCE_STATUS_LABEL, type InsuranceStatus } from "@/lib/driver-enrollment";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/insurer")({
  head: () => ({ meta: [{ title: "Dashboard Assureur — Tibus Ride" }] }),
  component: InsurerDashboard,
});

function statusBadgeClass(status: string) {
  if (status === "verified") return "border-success/40 bg-success/10 text-success";
  if (status === "expired") return "border-destructive/40 bg-destructive/10 text-destructive";
  return "border-warning/40 bg-warning/10 text-warning";
}

function InsurerDashboard() {
  const { roles, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | InsuranceStatus>("all");

  useEffect(() => {
    if (loading) return;
    if (!roles.includes("insurer") && !roles.includes("admin")) {
      navigate({ to: "/app", replace: true });
    }
  }, [loading, roles, navigate]);

  const listFn = useServerFn(listInsuredDrivers);
  const verifyFn = useServerFn(verifyDriverInsurance);

  const q = useQuery({
    queryKey: ["insurer", "insured-drivers"],
    refetchInterval: 30000,
    enabled: roles.includes("insurer") || roles.includes("admin"),
    queryFn: () => listFn(),
  });

  const verify = useMutation({
    mutationFn: (driverId: string) => verifyFn({ data: { driverId } }),
    onSuccess: () => {
      toast.success("Assurance validée");
      qc.invalidateQueries({ queryKey: ["insurer", "insured-drivers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const drivers = (q.data ?? []).filter((d) => filter === "all" || d.insurance_status === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-6 w-6 text-primary" />
        <h1 className="font-display text-2xl font-bold">Dashboard Assureur</h1>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["all", "pending", "verified", "expired"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "Tous" : INSURANCE_STATUS_LABEL[f]}
          </Button>
        ))}
      </div>
      <div className="space-y-2">
        {q.isLoading && <div className="text-sm text-muted-foreground">Chargement…</div>}
        {!q.isLoading && drivers.length === 0 && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">Aucun chauffeur assuré dans cette catégorie.</CardContent></Card>
        )}
        {drivers.map((d) => (
          <Card key={d.user_id}>
            <CardContent className="flex flex-wrap items-start justify-between gap-3 py-4">
              <div className="min-w-0 space-y-1">
                <div className="font-medium">{d.full_name ?? "Sans nom"}</div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {d.phone && (
                    <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{d.phone}</span>
                  )}
                  {d.city && (
                    <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{d.city}{d.country ? `, ${d.country}` : ""}</span>
                  )}
                  {d.vehicle_type && (
                    <span className="flex items-center gap-1"><Car className="h-3.5 w-3.5" />{d.vehicle_type}</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  Expire le {d.insurance_expires_at ? new Date(d.insurance_expires_at).toLocaleDateString("fr-FR") : "—"}
                  {typeof d.days_remaining === "number" && (
                    <span className={cn("ml-1", d.days_remaining < 0 ? "text-destructive" : d.days_remaining <= 7 ? "text-warning" : "")}>
                      ({d.days_remaining < 0 ? "expirée" : `${d.days_remaining} j restants`})
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <Badge variant="outline" className={statusBadgeClass(d.insurance_status)}>
                  {INSURANCE_STATUS_LABEL[d.insurance_status as InsuranceStatus] ?? d.insurance_status}
                </Badge>
                {d.insurance_status !== "verified" && (
                  <Button size="sm" disabled={verify.isPending} onClick={() => verify.mutate(d.user_id)}>
                    Valider
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
