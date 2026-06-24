import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Lock } from "lucide-react";

// Anciennement "support.$ticketId.tsx" : sous ce nom, TanStack Router
// l'imbriquait automatiquement comme route enfant de "support.tsx" (même
// préfixe de fichier). Or support.tsx ne rend aucun <Outlet />, donc la
// navigation vers un ticket réaffichait la page de liste/soumission au lieu
// du détail du ticket. Renommé en route soeur (comme ride.$rideId.tsx vis-à-vis
// de rides.tsx) pour casser cette imbrication involontaire.
export const Route = createFileRoute("/_authenticated/app/ticket/$ticketId")({
  head: () => ({ meta: [{ title: "Ticket — Support" }] }),
  component: TicketView,
});

const STATUS = ["open", "pending", "resolved", "closed"] as const;
const PRIORITY = ["low", "normal", "high", "urgent"] as const;

function TicketView() {
  const { ticketId } = Route.useParams();
  const { user, roles } = useAuth();
  const qc = useQueryClient();
  const isAgent = roles.includes("support") || roles.includes("admin");
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const ticketQ = useQuery({
    queryKey: ["support", "ticket", ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("*")
        .eq("id", ticketId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const messagesQ = useQuery({
    queryKey: ["support", "messages", ticketId],
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_messages")
        .select("*")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQ.data?.length]);

  const sendMut = useMutation({
    mutationFn: async () => {
      const text = body.trim();
      if (text.length < 1) throw new Error("Message vide");
      const { error } = await supabase.from("ticket_messages").insert({
        ticket_id: ticketId,
        author_id: user!.id,
        body: text,
        is_internal: internal && isAgent,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setBody("");
      setInternal(false);
      qc.invalidateQueries({ queryKey: ["support", "messages", ticketId] });
      qc.invalidateQueries({ queryKey: ["support", "ticket", ticketId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  const updateMut = useMutation({
    mutationFn: async (patch: Record<string, any>) => {
      const { error } = await supabase
        .from("support_tickets")
        .update({ ...patch, ...(patch.status === "closed" ? { closed_at: new Date().toISOString() } : {}) })
        .eq("id", ticketId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Mis à jour");
      qc.invalidateQueries({ queryKey: ["support", "ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["support", "my-tickets"] });
      qc.invalidateQueries({ queryKey: ["support", "inbox"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  const t = ticketQ.data;
  const closed = t?.status === "closed";

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <Link to={isAgent ? "/app/support-inbox" : "/app/support"} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 mr-1" /> Retour
      </Link>

      {ticketQ.isLoading && <div className="text-muted-foreground">Chargement…</div>}

      {t && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>{t.subject}</CardTitle>
                <div className="text-xs text-muted-foreground mt-1">
                  Catégorie : {t.category} · Priorité : {t.priority} · Statut : {t.status}
                </div>
              </div>
              <Badge variant="outline">#{t.id.slice(0, 8)}</Badge>
            </div>
          </CardHeader>
          {isAgent && (
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground">Statut</label>
                <Select value={t.status} onValueChange={(v) => updateMut.mutate({ status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Priorité</label>
                <Select value={t.priority} onValueChange={(v) => updateMut.mutate({ priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITY.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => updateMut.mutate({ assigned_to: user!.id })}
                  disabled={t.assigned_to === user!.id}
                >
                  {t.assigned_to === user!.id ? "Vous êtes assigné" : "M'assigner ce ticket"}
                </Button>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      <div className="space-y-2">
        {(messagesQ.data ?? []).map((m) => {
          const mine = m.author_id === user?.id;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                m.is_internal
                  ? "bg-amber-500/15 border border-amber-500/30"
                  : mine
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
              }`}>
                {m.is_internal && (
                  <div className="text-xs flex items-center gap-1 mb-1 opacity-80">
                    <Lock className="h-3 w-3" /> Note interne
                  </div>
                )}
                <div className="whitespace-pre-wrap break-words">{m.body}</div>
                <div className="text-[10px] opacity-70 mt-1">
                  {new Date(m.created_at).toLocaleString("fr-FR")}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {!closed ? (
        <Card>
          <CardContent className="pt-4 space-y-2">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="Votre réponse…"
            />
            <div className="flex items-center justify-between">
              {isAgent ? (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox checked={internal} onCheckedChange={(v) => setInternal(!!v)} />
                  Note interne (cachée du client)
                </label>
              ) : <span />}
              <Button onClick={() => sendMut.mutate()} disabled={sendMut.isPending}>
                {sendMut.isPending ? "Envoi…" : "Envoyer"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="text-center text-sm text-muted-foreground py-4">
          Ce ticket est fermé.
        </div>
      )}

      {t && t.created_by === user?.id && !closed && (
        <div className="text-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => updateMut.mutate({ status: "closed" })}
          >
            Fermer ce ticket
          </Button>
        </div>
      )}
    </div>
  );
}
