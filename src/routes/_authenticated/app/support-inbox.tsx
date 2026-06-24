import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { searchAgentUsers, createTicketAsAgent } from "@/lib/admin.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Inbox, Plus, Search } from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = [
  { v: "account", l: "Compte" },
  { v: "payment", l: "Paiement" },
  { v: "ride", l: "Course" },
  { v: "driver", l: "Chauffeur" },
  { v: "passenger", l: "Passager" },
  { v: "technical", l: "Technique" },
  { v: "other", l: "Autre" },
] as const;

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

function NewTicketDialog({ onCreated }: { onCreated: () => void }) {
  const searchFn = useServerFn(searchAgentUsers);
  const createFn = useServerFn(createTicketAsAgent);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ id: string; email: string | null; full_name: string | null; phone: string | null } | null>(null);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [body, setBody] = useState("");

  const searchQ = useQuery({
    queryKey: ["agent-user-search", query],
    enabled: query.trim().length > 1 && !selected,
    queryFn: () => searchFn({ data: { query: query.trim() } }),
  });

  const createMut = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          userId: selected!.id,
          subject,
          category: category as any,
          body,
        },
      }),
    onSuccess: () => {
      toast.success("Ticket créé pour l'utilisateur");
      setOpen(false);
      setQuery(""); setSelected(null); setSubject(""); setBody(""); setCategory("other");
      onCreated();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="gap-2">
        <Plus className="h-4 w-4" /> Nouveau ticket
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ouvrir un ticket pour un utilisateur</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <label className="text-sm font-medium">Utilisateur (nom, email ou téléphone)</label>
          {selected ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 mt-1">
              <div className="text-sm">
                <div className="font-medium">{selected.full_name ?? selected.email ?? selected.id}</div>
                <div className="text-xs text-muted-foreground">{selected.email} {selected.phone ? `· ${selected.phone}` : ""}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Changer</Button>
            </div>
          ) : (
            <div className="relative mt-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un utilisateur…" />
              {query.trim().length > 1 && (
                <div className="mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover">
                  {searchQ.isLoading && <div className="px-3 py-2 text-sm text-muted-foreground">Recherche…</div>}
                  {!searchQ.isLoading && (searchQ.data?.length ?? 0) === 0 && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">Aucun résultat.</div>
                  )}
                  {(searchQ.data ?? []).map((u: any) => (
                    <button
                      key={u.id}
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                      onClick={() => setSelected(u)}
                    >
                      <div className="font-medium">{u.full_name ?? u.email ?? u.id}</div>
                      <div className="text-xs text-muted-foreground">{u.email} {u.phone ? `· ${u.phone}` : ""}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div>
          <label className="text-sm font-medium">Sujet</label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} placeholder="Court résumé" />
        </div>
        <div>
          <label className="text-sm font-medium">Catégorie</label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.v} value={c.v}>{c.l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium">Message (ex. résumé de l'appel)</label>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={4000} placeholder="Détails du problème rapporté" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
          <Button
            disabled={!selected || subject.trim().length < 3 || body.trim().length < 5 || createMut.isPending}
            onClick={() => createMut.mutate()}
          >
            {createMut.isPending ? "Création…" : "Créer le ticket"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SupportInbox() {
  const { roles, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Inbox className="h-6 w-6 text-primary" />
          <h1 className="font-display text-2xl font-bold">Inbox Support</h1>
        </div>
        <NewTicketDialog onCreated={() => qc.invalidateQueries({ queryKey: ["support", "inbox"] })} />
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
          <Link key={t.id} to="/app/ticket/$ticketId" params={{ ticketId: t.id }}>
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
