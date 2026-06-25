import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { LifeBuoy, MessageSquare, Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/support")({
  head: () => ({ meta: [{ title: "Aide & Support — Tibus Ride" }] }),
  component: SupportPage,
});

const CATEGORIES = [
  { v: "account", l: "Compte" },
  { v: "payment", l: "Paiement" },
  { v: "ride", l: "Course" },
  { v: "driver", l: "Chauffeur" },
  { v: "passenger", l: "Passager" },
  { v: "technical", l: "Technique" },
  { v: "other", l: "Autre" },
] as const;

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  open: { label: "Ouvert", tone: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  pending: { label: "En attente de vous", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  resolved: { label: "Résolu", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  closed: { label: "Fermé", tone: "bg-muted text-muted-foreground" },
};

const schema = z.object({
  subject: z.string().trim().min(3, "Minimum 3 caractères").max(200),
  category: z.enum(["account", "payment", "ride", "driver", "passenger", "technical", "other"]),
  body: z.string().trim().min(5, "Décrivez votre problème").max(4000),
});

function SupportPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [body, setBody] = useState("");

  const ticketsQ = useQuery({
    queryKey: ["support", "my-tickets", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("*")
        .eq("created_by", user!.id)
        .order("last_message_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const parsed = schema.parse({ subject, category, body });
      const { data: ticket, error } = await supabase
        .from("support_tickets")
        .insert({
          created_by: user!.id,
          subject: parsed.subject,
          category: parsed.category,
        })
        .select()
        .single();
      if (error) throw error;
      const { error: msgErr } = await supabase
        .from("ticket_messages")
        .insert({ ticket_id: ticket.id, author_id: user!.id, body: parsed.body });
      if (msgErr) throw msgErr;
      return ticket;
    },
    onSuccess: () => {
      toast.success("Ticket créé");
      setOpen(false);
      setSubject(""); setBody(""); setCategory("other");
      qc.invalidateQueries({ queryKey: ["support", "my-tickets"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <LifeBuoy className="h-6 w-6 text-primary" /> Aide & Support
          </h1>
          <p className="text-sm text-muted-foreground">
            Ouvrez un ticket — notre équipe support vous répondra rapidement.
          </p>
        </div>
        <Button onClick={() => setOpen((v) => !v)} className="gap-2">
          <Plus className="h-4 w-4" /> Nouveau ticket
        </Button>
      </div>

      {open && (
        <Card>
          <CardHeader>
            <CardTitle>Décrivez votre demande</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
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
              <label className="text-sm font-medium">Message</label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={4000} placeholder="Détails du problème, n° de course, etc." />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
              <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
                {createMut.isPending ? "Envoi…" : "Envoyer"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {ticketsQ.isLoading && <div className="text-muted-foreground text-sm">Chargement…</div>}
        {!ticketsQ.isLoading && (ticketsQ.data?.length ?? 0) === 0 && (
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            Aucun ticket pour le moment.
          </CardContent></Card>
        )}
        {(ticketsQ.data ?? []).map((t) => {
          const s = STATUS_LABEL[t.status] ?? STATUS_LABEL.open;
          return (
            <Link key={t.id} to="/app/ticket/$ticketId" params={{ ticketId: t.id }}>
              <Card className="hover:border-primary transition-colors">
                <CardContent className="py-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{t.subject}</div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                      <MessageSquare className="h-3 w-3" />
                      {new Date(t.last_message_at).toLocaleString("fr-FR")}
                      <span>· {t.category}</span>
                    </div>
                  </div>
                  <Badge className={s.tone} variant="outline">{s.label}</Badge>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
