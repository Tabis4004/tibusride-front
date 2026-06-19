import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Inbox } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/support-inbox")({
  head: () => ({ meta: [{ title: "Inbox Support — Tibus Ride" }] }),
  component: SupportInbox,
});

const FILTERS = [
  { v: "active", l: "Actifs" },
  { v: "open", l: "Ouverts" },
  { v: "pending", l: "En attente client" },
  { v: "resolved", l: "Résolus" },
  { v: "closed", l: "Fermés" },
  { v: "all", l: "Tous" },
] as const;

function SupportInbox() {
  const { roles, loading } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["v"]>("active");

  useEffect(() => {
    if (loading) return;
    if (!roles.includes("support") && !roles.includes("admin")) {
      navigate({ to: "/app", replace: true });
    }
  }, [loading, roles, navigate]);

  const q = useQuery({
    queryKey: ["support", "inbox", filter],
    refetchInterval: 8000,
    enabled: roles.includes("support") || roles.includes("admin"),
    queryFn: async () => {
      let qb = supabase
        .from("support_tickets")
        .select("*")
        .order("last_message_at", { ascending: false })
        .limit(100);
      if (filter === "active") qb = qb.in("status", ["open", "pending"]);
      else if (filter !== "all") qb = qb.eq("status", filter);
      const { data, error } = await qb;
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Inbox className="h-6 w-6 text-primary" />
        <h1 className="font-display text-2xl font-bold">Inbox Support</h1>
      </div>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.v}
            size="sm"
            variant={filter === f.v ? "default" : "outline"}
            onClick={() => setFilter(f.v)}
          >{f.l}</Button>
        ))}
      </div>
      <div className="space-y-2">
        {q.isLoading && <div className="text-muted-foreground text-sm">Chargement…</div>}
        {!q.isLoading && (q.data?.length ?? 0) === 0 && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">Aucun ticket.</CardContent></Card>
        )}
        {(q.data ?? []).map((t) => (
          <Link key={t.id} to="/app/support/$ticketId" params={{ ticketId: t.id }}>
            <Card className="hover:border-primary transition-colors">
              <CardContent className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{t.subject}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {t.category} · {t.priority} · {new Date(t.last_message_at).toLocaleString("fr-FR")}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant="outline">{t.status}</Badge>
                  {t.assigned_to && <span className="text-[10px] text-muted-foreground">assigné</span>}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
