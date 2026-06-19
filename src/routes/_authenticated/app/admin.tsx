import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatXof } from "@/lib/pricing";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  listUsers,
  setUserBanned,
  setUserRole,
  updateDriverStatus,
  uploadDriverDocument,
  getDocumentSignedUrl,
  listAuditLogs,
  listPricingSettings,
  updatePricingSetting,
  listCommissionSchedules,
  createCommissionSchedule,
  updateCommissionSchedule,
  deleteCommissionSchedule,
  previewCommission,
  detectScheduleConflicts,
  getRideCommissionDetail,
  commissionReport,
  listCorporates,
  createCorporate,
  listInvoices,
  createInvoice,
  updateInvoiceStatus,
  recordInvoicePayment,
  listInvoicePayments,
} from "@/lib/admin.functions";
import { listDriverWallets, adminWalletTopup, adminWalletAdjust } from "@/lib/wallet.functions";
import {
  Download,
  ExternalLink,
  Eye,
  FileText,
  Lock,
  ShieldCheck,
  ShieldOff,
  Unlock,
  Upload,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/admin")({
  head: () => ({ meta: [{ title: "Administration — Tibus Ride" }] }),
  component: AdminPage,
});

const DRIVER_STATUS_LABEL: Record<string, string> = {
  pending: "Soumis",
  under_review: "En revue",
  approved: "Validé",
  rejected: "Refusé",
  suspended: "Suspendu",
};
const DRIVER_STATUSES = ["pending", "under_review", "approved", "rejected", "suspended"] as const;

function AdminPage() {
  const { hasRole, loading } = useAuth();
  if (loading) return <div className="py-12 text-center text-muted-foreground">Chargement…</div>;
  if (!hasRole("admin")) {
    return (
      <div className="rounded-3xl border border-destructive/30 bg-destructive/5 p-8 text-center">
        <h2 className="font-display text-xl font-bold text-destructive">Accès refusé</h2>
        <p className="mt-2 text-sm text-muted-foreground">Vous n'avez pas les droits administrateur.</p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold">Administration</h1>
      <Tabs defaultValue="drivers">
        <TabsList className="flex-wrap">
          <TabsTrigger value="drivers">Chauffeurs</TabsTrigger>
          <TabsTrigger value="users">Utilisateurs</TabsTrigger>
          <TabsTrigger value="rides">Courses</TabsTrigger>
          <TabsTrigger value="pricing">Tarifs & commissions</TabsTrigger>
          <TabsTrigger value="commissions-report">Rapport commissions</TabsTrigger>
          <TabsTrigger value="billing">Facturation</TabsTrigger>
          <TabsTrigger value="wallets">Wallets</TabsTrigger>
          <TabsTrigger value="audit">Journal d'audit</TabsTrigger>
          <TabsTrigger value="fraud">Anti-fraude</TabsTrigger>
          <TabsTrigger value="rewards">Récompenses</TabsTrigger>
          <TabsTrigger value="metrics">Métriques</TabsTrigger>
        </TabsList>
        <TabsContent value="drivers"><DriversTab /></TabsContent>
        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="rides"><RidesTab /></TabsContent>
        <TabsContent value="pricing"><PricingTab /></TabsContent>
        <TabsContent value="commissions-report"><CommissionReportTab /></TabsContent>
        <TabsContent value="billing"><BillingTab /></TabsContent>
        <TabsContent value="wallets"><WalletsTab /></TabsContent>
        <TabsContent value="audit"><AuditTab /></TabsContent>
        <TabsContent value="fraud"><FraudTab /></TabsContent>
        <TabsContent value="rewards"><RewardsTab /></TabsContent>
        <TabsContent value="metrics"><MetricsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ----------------------------- CSV helpers ----------------------------- */
function downloadCsv(filename: string, rows: Record<string, any>[]) {
  if (rows.length === 0) {
    toast.info("Rien à exporter.");
    return;
  }
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",;\n]/.test(s) ? `"${s}"` : s;
  };
  const csv = [headers.join(";"), ...rows.map((r) => headers.map((h) => escape(r[h])).join(";"))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------ Drivers ------------------------------ */
function DriversTab() {
  const [selected, setSelected] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [onlineFilter, setOnlineFilter] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [q, setQ] = useState("");

  const { data } = useQuery({
    queryKey: ["admin-drivers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("driver_profiles")
        .select("*, profiles:user_id(full_name, phone, city)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const cities = useMemo(() => {
    const set = new Set<string>();
    (data ?? []).forEach((d: any) => d.city && set.add(d.city));
    return Array.from(set).sort();
  }, [data]);

  const filtered = useMemo(() => {
    return (data ?? []).filter((d: any) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (onlineFilter === "online" && !d.is_online) return false;
      if (onlineFilter === "offline" && d.is_online) return false;
      if (cityFilter !== "all" && d.city !== cityFilter) return false;
      if (q) {
        const s = q.toLowerCase();
        const hay = `${d.profiles?.full_name ?? ""} ${d.profiles?.phone ?? ""} ${d.license_number ?? ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [data, statusFilter, onlineFilter, cityFilter, q]);

  const exportCsv = () => {
    const rows = filtered.map((d: any) => ({
      nom: d.profiles?.full_name ?? "",
      telephone: d.profiles?.phone ?? "",
      ville: d.city ?? "",
      permis: d.license_number ?? "",
      statut: DRIVER_STATUS_LABEL[d.status] ?? d.status,
      en_ligne: d.is_online ? "oui" : "non",
      courses: d.rides_count ?? 0,
      note: d.rating_avg ?? "",
      gains_xof: d.total_earnings ?? 0,
      motif_refus: d.rejection_reason ?? "",
      inscrit_le: d.created_at,
    }));
    downloadCsv(`chauffeurs-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs text-muted-foreground">Recherche</Label>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, téléphone, permis…" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Statut</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              {DRIVER_STATUSES.map((s) => <SelectItem key={s} value={s}>{DRIVER_STATUS_LABEL[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Présence</Label>
          <Select value={onlineFilter} onValueChange={setOnlineFilter}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              <SelectItem value="online">En ligne</SelectItem>
              <SelectItem value="offline">Hors ligne</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Ville</Label>
          <Select value={cityFilter} onValueChange={setCityFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes</SelectItem>
              {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-2" />Exporter CSV</Button>
      </div>

      <div className="text-xs text-muted-foreground">{filtered.length} chauffeur{filtered.length > 1 ? "s" : ""}</div>

      <div className="rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-secondary-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Chauffeur</th>
                <th className="px-4 py-3 text-left font-medium">Ville</th>
                <th className="px-4 py-3 text-left font-medium">Statut</th>
                <th className="px-4 py-3 text-left font-medium">En ligne</th>
                <th className="px-4 py-3 text-left font-medium">Courses</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d: any) => (
                <tr key={d.user_id} className="border-t border-border align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">{d.profiles?.full_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{d.profiles?.phone ?? "—"}</div>
                    {d.rejection_reason && (
                      <div className="mt-1 text-xs text-destructive">Motif : {d.rejection_reason}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">{d.city ?? "—"}</td>
                  <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs ${d.is_online ? "text-success" : "text-muted-foreground"}`}>
                      <span className={`h-2 w-2 rounded-full ${d.is_online ? "bg-success" : "bg-muted-foreground/40"}`} />
                      {d.is_online ? "En ligne" : "Hors ligne"}
                    </span>
                  </td>
                  <td className="px-4 py-3">{d.rides_count ?? 0}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => setSelected(d)}>
                      <FileText className="h-3.5 w-3.5 mr-1" /> Gérer
                    </Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Aucun chauffeur.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <DriverManageDialog key={selected.user_id} driver={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function DriverManageDialog({ driver, onClose }: { driver: any; onClose: () => void }) {
  const qc = useQueryClient();
  const updateStatus = useServerFn(updateDriverStatus);
  const [nextStatus, setNextStatus] = useState<string>(driver.status);
  const [reason, setReason] = useState<string>(driver.rejection_reason ?? "");

  const status = useMutation({
    mutationFn: (v: { status: string; reason?: string }) =>
      updateStatus({ data: { userId: driver.user_id, status: v.status as any, reason: v.reason } }),
    onSuccess: () => {
      toast.success("Statut mis à jour");
      qc.invalidateQueries({ queryKey: ["admin-drivers"] });
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reasonRequired = nextStatus === "rejected" || nextStatus === "suspended";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Chauffeur — {driver.profiles?.full_name ?? driver.user_id}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-xl border border-border p-3">
            <Label className="text-xs text-muted-foreground">Workflow de validation</Label>
            <div className="mt-2 flex items-center gap-2">
              <Select value={nextStatus} onValueChange={setNextStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DRIVER_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{DRIVER_STATUS_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {reasonRequired && (
              <div className="mt-3">
                <Label className="text-xs text-muted-foreground">Motif {nextStatus === "rejected" ? "du refus" : "de suspension"}</Label>
                <Textarea
                  className="mt-1"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  placeholder="Expliquez la décision (visible dans le journal)…"
                />
              </div>
            )}
            <div className="mt-3 flex justify-end">
              <Button
                onClick={() => {
                  if (reasonRequired && !reason.trim()) {
                    toast.error("Un motif est requis.");
                    return;
                  }
                  status.mutate({ status: nextStatus, reason: reasonRequired ? reason.trim() : undefined });
                }}
                disabled={status.isPending}
              >
                {status.isPending ? "Mise à jour…" : "Appliquer le statut"}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-xs text-muted-foreground">Documents</Label>
            <DocRow driver={driver} kind="id" label="Pièce d'identité" pathOrUrl={driver.id_document_url} />
            <DocRow driver={driver} kind="license" label="Permis de conduire" pathOrUrl={driver.license_document_url} />
            <DocRow driver={driver} kind="vehicle" label="Carte grise / véhicule" pathOrUrl={driver.vehicle_document_url} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocRow({
  driver,
  kind,
  label,
  pathOrUrl,
}: {
  driver: any;
  kind: "id" | "license" | "vehicle";
  label: string;
  pathOrUrl: string | null;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useServerFn(uploadDriverDocument);
  const signFn = useServerFn(getDocumentSignedUrl);
  const [busy, setBusy] = useState(false);

  const isExternal = !!pathOrUrl && /^https?:\/\//i.test(pathOrUrl);

  const onPick = async (file: File) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(file.type)) {
      toast.error("Format non supporté (JPG, PNG, WEBP ou PDF).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Fichier trop volumineux (max 5 Mo).");
      return;
    }
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
      const base64 = btoa(bin);
      await upload({
        data: { userId: driver.user_id, kind, filename: file.name, contentType: file.type, base64 },
      });
      toast.success("Document envoyé");
      qc.invalidateQueries({ queryKey: ["admin-drivers"] });
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const view = async () => {
    if (!pathOrUrl) return;
    if (isExternal) {
      window.open(pathOrUrl, "_blank", "noopener");
      return;
    }
    try {
      const { url } = await signFn({ data: { path: pathOrUrl } });
      window.open(url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">
            {pathOrUrl ? (isExternal ? "Lien externe" : "Stocké en privé") : "Non fourni"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pathOrUrl && (
            <Button size="sm" variant="outline" onClick={view}>
              {isExternal ? <ExternalLink className="h-3.5 w-3.5 mr-1" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
              Voir
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5 mr-1" />
            {busy ? "Envoi…" : pathOrUrl ? "Remplacer" : "Téléverser"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Users ------------------------------ */
function UsersTab() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const list = useServerFn(listUsers);
  const banFn = useServerFn(setUserBanned);
  const roleFn = useServerFn(setUserRole);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => list(),
  });

  const ban = useMutation({
    mutationFn: (v: { userId: string; banned: boolean; reason?: string }) => banFn({ data: v }),
    onSuccess: (_d, v) => {
      toast.success(v.banned ? "Compte bloqué" : "Compte déverrouillé");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const role = useMutation({
    mutationFn: (v: { userId: string; role: "admin" | "driver" | "passenger" | "support"; grant: boolean }) => roleFn({ data: v }),
    onSuccess: () => {
      toast.success("Rôle mis à jour");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    return (data ?? []).filter((u: any) => {
      if (q) {
        const s = q.toLowerCase();
        const hay = `${u.email ?? ""} ${u.profile?.full_name ?? ""} ${u.profile?.phone ?? ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      if (roleFilter !== "all" && !u.roles.includes(roleFilter)) return false;
      const isBanned = u.banned_until && new Date(u.banned_until) > new Date();
      if (statusFilter === "active" && isBanned) return false;
      if (statusFilter === "banned" && !isBanned) return false;
      return true;
    });
  }, [data, q, roleFilter, statusFilter]);

  const exportCsv = () => {
    const rows = filtered.map((u: any) => {
      const isBanned = u.banned_until && new Date(u.banned_until) > new Date();
      return {
        email: u.email ?? "",
        nom: u.profile?.full_name ?? "",
        telephone: u.profile?.phone ?? "",
        ville: u.profile?.city ?? "",
        roles: (u.roles ?? []).join("|"),
        statut: isBanned ? "bloqué" : "actif",
        inscrit_le: u.created_at,
        derniere_connexion: u.last_sign_in_at ?? "",
      };
    });
    downloadCsv(`utilisateurs-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  const askBan = (u: any) => {
    const reason = window.prompt(`Motif du blocage pour ${u.email ?? u.id} :`, "");
    if (reason === null) return;
    ban.mutate({ userId: u.id, banned: true, reason: reason || undefined });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs text-muted-foreground">Recherche</Label>
          <Input placeholder="Email, nom, téléphone…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Rôle</Label>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="driver">Chauffeur</SelectItem>
              <SelectItem value="passenger">Passager</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Statut</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              <SelectItem value="active">Actif</SelectItem>
              <SelectItem value="banned">Bloqué</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-2" />Exporter CSV</Button>
      </div>

      <div className="text-xs text-muted-foreground">{filtered.length} utilisateur{filtered.length > 1 ? "s" : ""}</div>

      {error && <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{(error as Error).message}</div>}

      <div className="rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-secondary-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Utilisateur</th>
                <th className="px-4 py-3 text-left font-medium">Rôles</th>
                <th className="px-4 py-3 text-left font-medium">Dernière connexion</th>
                <th className="px-4 py-3 text-left font-medium">Statut</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Chargement…</td></tr>}
              {!isLoading && filtered.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Aucun utilisateur.</td></tr>}
              {filtered.map((u: any) => {
                const isBanned = u.banned_until && new Date(u.banned_until) > new Date();
                const isSelf = u.id === me?.id;
                const hasAdmin = u.roles.includes("admin");
                const hasSupport = u.roles.includes("support");
                const hasDriver = u.roles.includes("driver");
                const hasPassenger = u.roles.includes("passenger");
                return (
                  <tr key={u.id} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">{u.profile?.full_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{u.email ?? "—"}</div>
                      {u.profile?.phone && <div className="text-xs text-muted-foreground">{u.profile.phone}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {u.roles.length === 0 && <span className="text-xs text-muted-foreground">aucun</span>}
                        {u.roles.map((r: string) => (
                          <span key={r} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{r}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString("fr-FR") : "jamais"}
                    </td>
                    <td className="px-4 py-3">
                      {isBanned
                        ? <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">Bloqué</span>
                        : <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">Actif</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex flex-wrap justify-end gap-2">
                        {!isSelf && (hasAdmin
                          ? <Button size="sm" variant="outline" onClick={() => role.mutate({ userId: u.id, role: "admin", grant: false })}><ShieldOff className="h-3.5 w-3.5 mr-1" />Retirer admin</Button>
                          : <Button size="sm" variant="outline" onClick={() => role.mutate({ userId: u.id, role: "admin", grant: true })}><ShieldCheck className="h-3.5 w-3.5 mr-1" />Promouvoir admin</Button>
                        )}
                        {!isSelf && (hasSupport
                          ? <Button size="sm" variant="outline" onClick={() => role.mutate({ userId: u.id, role: "support", grant: false })}>Retirer support</Button>
                          : <Button size="sm" variant="outline" onClick={() => role.mutate({ userId: u.id, role: "support", grant: true })}>Promouvoir support</Button>
                        )}
                        {hasDriver
                          ? <Button size="sm" variant="outline" onClick={() => role.mutate({ userId: u.id, role: "driver", grant: false })}>Retirer chauffeur</Button>
                          : <Button size="sm" variant="outline" onClick={() => role.mutate({ userId: u.id, role: "driver", grant: true })}>Promouvoir chauffeur</Button>
                        }
                        {hasPassenger
                          ? <Button size="sm" variant="outline" onClick={() => role.mutate({ userId: u.id, role: "passenger", grant: false })}>Retirer passager</Button>
                          : <Button size="sm" variant="outline" onClick={() => role.mutate({ userId: u.id, role: "passenger", grant: true })}>Ajouter passager</Button>
                        }
                        {!isSelf && (isBanned
                          ? <Button size="sm" onClick={() => ban.mutate({ userId: u.id, banned: false })}><Unlock className="h-3.5 w-3.5 mr-1" />Déverrouiller</Button>
                          : <Button size="sm" variant="destructive" onClick={() => askBan(u)}><Lock className="h-3.5 w-3.5 mr-1" />Bloquer</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Rides ------------------------------ */
function RidesTab() {
  const [selectedRide, setSelectedRide] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["admin-rides"],
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase.from("rides").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-secondary-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Date</th>
              <th className="px-4 py-3 text-left font-medium">Ville</th>
              <th className="px-4 py-3 text-left font-medium">Trajet</th>
              <th className="px-4 py-3 text-left font-medium">Statut</th>
              <th className="px-4 py-3 text-right font-medium">Prix</th>
              <th className="px-4 py-3 text-right font-medium">Détail</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((r: any) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-4 py-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString("fr-FR")}</td>
                <td className="px-4 py-3">{r.city}</td>
                <td className="px-4 py-3 max-w-xs"><div className="truncate">{r.pickup_address}</div><div className="truncate text-xs text-muted-foreground">→ {r.dropoff_address}</div></td>
                <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-3 text-right font-medium">{formatXof(r.price_xof)}</td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="ghost" onClick={() => setSelectedRide(r.id)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {(!data || data.length === 0) && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Aucune course.</td></tr>}
          </tbody>
        </table>
      </div>
      <RideDetailDialog rideId={selectedRide} onClose={() => setSelectedRide(null)} />
    </div>
  );
}

function RideDetailDialog({ rideId, onClose }: { rideId: string | null; onClose: () => void }) {
  const fetchFn = useServerFn(getRideCommissionDetail);
  const { data, isLoading } = useQuery({
    queryKey: ["ride-detail", rideId],
    enabled: !!rideId,
    queryFn: () => fetchFn({ data: { ride_id: rideId! } }),
  });
  const ride = data?.ride as any;
  const r = data?.resolved as any;
  const wtx = (data?.wallet_tx ?? []) as any[];
  const walletDebit = wtx.find((t) => t.type === "commission");
  const calcRule =
    r?.commission_type === "flat"
      ? `Forfait min(${formatXof(r?.commission_flat_xof ?? 0)}, prix)`
      : `${r?.commission_rate ?? 0}% × prix HT`;
  return (
    <Dialog open={!!rideId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Détail de la course</DialogTitle></DialogHeader>
        {isLoading || !ride ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-muted-foreground">Catégorie :</span> {CATEGORY_LABEL[ride.category] ?? ride.category}</div>
              <div><span className="text-muted-foreground">Statut :</span> <StatusBadge status={ride.status} /></div>
              <div><span className="text-muted-foreground">Prix course :</span> <strong>{formatXof(ride.price_xof)}</strong></div>
              <div><span className="text-muted-foreground">Distance :</span> {ride.distance_km ?? "—"} km</div>
            </div>
            <div className="rounded-xl border border-border p-3">
              <div className="font-medium mb-2">Règle de commission appliquée</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">Source :</span> {r?.source === "schedule" ? "Règle planifiée" : r?.source === "default" ? "Par défaut catégorie" : "—"}</div>
                <div><span className="text-muted-foreground">Type :</span> {r?.commission_type === "flat" ? "Forfait" : "Pourcentage"}</div>
                <div className="col-span-2"><span className="text-muted-foreground">Formule :</span> <code>{calcRule}</code></div>
                {r?.notes && <div className="col-span-2"><span className="text-muted-foreground">Note :</span> {r.notes}</div>}
              </div>
            </div>
            <div className="rounded-xl border border-border p-3">
              <div className="font-medium mb-2">Calcul</div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between"><span>Prix HT</span><span>{formatXof(ride.price_xof)}</span></div>
                <div className="flex justify-between"><span>Commission plateforme</span><span className="text-destructive">− {formatXof(ride.commission_xof ?? 0)}</span></div>
                <div className="flex justify-between border-t pt-1 font-medium"><span>Part chauffeur</span><span>{formatXof(ride.driver_earnings_xof ?? 0)}</span></div>
              </div>
            </div>
            <div className="rounded-xl border border-border p-3">
              <div className="font-medium mb-2">Wallet chauffeur</div>
              {walletDebit ? (
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span>Montant débité</span><span className="text-destructive">{formatXof(walletDebit.amount_xof)}</span></div>
                  <div className="flex justify-between"><span>Solde après opération</span><span>{formatXof(walletDebit.balance_after_xof)}</span></div>
                  <div className="text-muted-foreground">{new Date(walletDebit.created_at).toLocaleString("fr-FR")}</div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Aucun débit wallet enregistré pour cette course.</p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ Audit ------------------------------ */
function AuditTab() {
  const list = useServerFn(listAuditLogs);
  const [q, setQ] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-audit"],
    queryFn: () => list(),
  });

  const actions = useMemo(() => {
    const set = new Set<string>();
    (data ?? []).forEach((l: any) => set.add(l.action));
    return Array.from(set).sort();
  }, [data]);

  const filtered = useMemo(() => {
    return (data ?? []).filter((l: any) => {
      if (actionFilter !== "all" && l.action !== actionFilter) return false;
      if (q) {
        const s = q.toLowerCase();
        const hay = `${l.actor_email ?? ""} ${l.target_label ?? ""} ${l.target_id ?? ""} ${JSON.stringify(l.details ?? {})}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [data, q, actionFilter]);

  const exportCsv = () => {
    const rows = filtered.map((l: any) => ({
      date: l.created_at,
      action: l.action,
      acteur: l.actor_email ?? l.actor_id,
      cible_type: l.target_type ?? "",
      cible: l.target_label ?? l.target_id ?? "",
      details: l.details ? JSON.stringify(l.details) : "",
    }));
    downloadCsv(`audit-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs text-muted-foreground">Recherche</Label>
          <Input placeholder="Acteur, cible, détails…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Action</Label>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes</SelectItem>
              {actions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-2" />Exporter CSV</Button>
      </div>

      <div className="text-xs text-muted-foreground">{filtered.length} entrée{filtered.length > 1 ? "s" : ""}</div>

      <div className="rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-secondary-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Date</th>
                <th className="px-4 py-3 text-left font-medium">Action</th>
                <th className="px-4 py-3 text-left font-medium">Acteur</th>
                <th className="px-4 py-3 text-left font-medium">Cible</th>
                <th className="px-4 py-3 text-left font-medium">Détails</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Chargement…</td></tr>}
              {!isLoading && filtered.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Aucune entrée.</td></tr>}
              {filtered.map((l: any) => (
                <tr key={l.id} className="border-t border-border align-top">
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(l.created_at).toLocaleString("fr-FR")}</td>
                  <td className="px-4 py-3"><span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{l.action}</span></td>
                  <td className="px-4 py-3 text-xs">{l.actor_email ?? l.actor_id}</td>
                  <td className="px-4 py-3 text-xs">
                    <div>{l.target_label ?? "—"}</div>
                    <div className="text-muted-foreground">{l.target_type ?? ""}{l.target_id ? ` · ${l.target_id.slice(0, 8)}…` : ""}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-sm">
                    {l.details ? <pre className="whitespace-pre-wrap break-words">{JSON.stringify(l.details)}</pre> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Metrics ------------------------------ */
function MetricsTab() {
  const { data } = useQuery({
    queryKey: ["admin-metrics"],
    queryFn: async () => {
      const [{ count: totalRides }, { count: completed }, { data: rev }, { count: drivers }] = await Promise.all([
        supabase.from("rides").select("*", { count: "exact", head: true }),
        supabase.from("rides").select("*", { count: "exact", head: true }).eq("status", "completed"),
        supabase.from("rides").select("price_xof").eq("status", "completed"),
        supabase.from("driver_profiles").select("*", { count: "exact", head: true }).eq("status", "approved"),
      ]);
      const total = (rev ?? []).reduce((s: number, r: any) => s + (r.price_xof ?? 0), 0);
      const commission = Math.round(total * 0.15);
      return { totalRides: totalRides ?? 0, completed: completed ?? 0, total, commission, drivers: drivers ?? 0 };
    },
  });
  if (!data) return <div className="py-8 text-center text-muted-foreground">Calcul…</div>;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="Courses totales" value={data.totalRides.toString()} />
      <Metric label="Courses terminées" value={data.completed.toString()} />
      <Metric label="Volume d'affaires" value={formatXof(data.total)} />
      <Metric label="Commission (15%)" value={formatXof(data.commission)} highlight />
      <Metric label="Chauffeurs validés" value={data.drivers.toString()} />
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl border p-5 ${highlight ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-2xl font-bold ${highlight ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-warning/20 text-warning-foreground",
    under_review: "bg-primary/15 text-primary",
    approved: "bg-success/20 text-success",
    rejected: "bg-destructive/20 text-destructive",
    suspended: "bg-muted text-muted-foreground",
    requested: "bg-primary/15 text-primary",
    accepted: "bg-accent/30 text-accent-foreground",
    arriving: "bg-accent/30 text-accent-foreground",
    in_progress: "bg-primary/20 text-primary",
    completed: "bg-success/20 text-success",
    cancelled: "bg-muted text-muted-foreground",
  };
  const label = DRIVER_STATUS_LABEL[status] ?? status;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? "bg-muted"}`}>{label}</span>;
}

/* ----------------------------- Pricing tab ----------------------------- */
const CATEGORY_LABEL: Record<string, string> = {
  taxi: "Taxi",
  eco: "Éco",
  confort: "Confort",
  confort_plus: "Confort +",
  vip: "VIP",
};

function PricingTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPricingSettings);
  const updateFn = useServerFn(updatePricingSetting);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "pricing"],
    queryFn: () => listFn({}),
  });
  const [drafts, setDrafts] = useState<Record<string, any>>({});

  const mutation = useMutation({
    mutationFn: (payload: any) => updateFn({ data: payload }),
    onSuccess: (_d, vars: any) => {
      toast.success(`Tarifs ${CATEGORY_LABEL[vars._cat] ?? ""} mis à jour`);
      setDrafts((d) => {
        const { [vars.id]: _, ...rest } = d;
        return rest;
      });
      qc.invalidateQueries({ queryKey: ["admin", "pricing"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur de mise à jour"),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  const rows = (data ?? []) as any[];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Définissez les tarifs et la <strong>commission par défaut</strong> de chaque catégorie. Les valeurs ci-dessous
        s'appliquent en l'absence de règle planifiée. La part chauffeur ={" "}
        <code>prix − commission</code>. Toute mise à jour est appliquée immédiatement aux courses qui se terminent ensuite.
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Catégorie</th>
              <th className="px-3 py-2 text-right">Prise en charge</th>
              <th className="px-3 py-2 text-right">Prix / km</th>
              <th className="px-3 py-2 text-right">Prix / min</th>
              <th className="px-3 py-2 text-right">Tarif min</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-right">%</th>
              <th className="px-3 py-2 text-right">Forfait (XOF)</th>
              <th className="px-3 py-2 text-center">Actif</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const draft = drafts[row.id] ?? {};
              const current = { ...row, ...draft };
              const dirty = Object.keys(draft).length > 0;
              const setField = (k: string, v: any) =>
                setDrafts((d) => ({ ...d, [row.id]: { ...d[row.id], [k]: v } }));
              const numInput = (k: string, step = 50) => (
                <Input
                  type="number"
                  step={step}
                  className="h-8 w-24 text-right"
                  value={current[k] ?? 0}
                  onChange={(e) => setField(k, Number(e.target.value))}
                />
              );
              return (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{CATEGORY_LABEL[row.category] ?? row.category}</td>
                  <td className="px-3 py-2 text-right">{numInput("base_fare_xof")}</td>
                  <td className="px-3 py-2 text-right">{numInput("per_km_xof", 10)}</td>
                  <td className="px-3 py-2 text-right">{numInput("per_min_xof", 5)}</td>
                  <td className="px-3 py-2 text-right">{numInput("min_fare_xof")}</td>
                  <td className="px-3 py-2">
                    <Select
                      value={current.commission_type ?? "percent"}
                      onValueChange={(v) => setField("commission_type", v)}
                    >
                      <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percent">Pourcentage</SelectItem>
                        <SelectItem value="flat">Forfait</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number" step={0.5} min={0} max={100}
                      className="h-8 w-20 text-right"
                      disabled={current.commission_type === "flat"}
                      value={current.commission_rate ?? 0}
                      onChange={(e) => setField("commission_rate", Number(e.target.value))}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number" step={50} min={0}
                      className="h-8 w-24 text-right"
                      disabled={current.commission_type === "percent"}
                      value={current.commission_flat_xof ?? 0}
                      onChange={(e) => setField("commission_flat_xof", Number(e.target.value))}
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={!!current.active}
                      onChange={(e) => setField("active", e.target.checked)}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      disabled={!dirty || mutation.isPending}
                      onClick={() =>
                        mutation.mutate({
                          _cat: row.category,
                          id: row.id,
                          base_fare_xof: Number(current.base_fare_xof),
                          per_km_xof: Number(current.per_km_xof),
                          per_min_xof: Number(current.per_min_xof),
                          min_fare_xof: Number(current.min_fare_xof),
                          commission_type: current.commission_type ?? "percent",
                          commission_rate: Number(current.commission_rate ?? 0),
                          commission_flat_xof: Number(current.commission_flat_xof ?? 0),
                          active: !!current.active,
                        } as any)
                      }
                    >
                      Enregistrer
                    </Button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">
                  Aucune catégorie configurée.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <CommissionSchedulesSection />
    </div>
  );
}

/* -------------------- Commission schedules (period overrides) -------------------- */
function CommissionSchedulesSection() {
  const qc = useQueryClient();
  const listFn = useServerFn(listCommissionSchedules);
  const createFn = useServerFn(createCommissionSchedule);
  const updateFn = useServerFn(updateCommissionSchedule);
  const deleteFn = useServerFn(deleteCommissionSchedule);
  const previewFn = useServerFn(previewCommission);
  const conflictsFn = useServerFn(detectScheduleConflicts);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "commission-schedules"],
    queryFn: () => listFn({}),
  });
  const { data: conflicts } = useQuery({
    queryKey: ["admin", "commission-conflicts"],
    queryFn: () => conflictsFn({}),
  });

  const [form, setForm] = useState<any>({
    category: "taxi",
    commission_type: "percent",
    commission_rate: 20,
    commission_flat_xof: 0,
    starts_at: new Date().toISOString().slice(0, 16),
    ends_at: "",
    priority: 10,
    active: true,
    notes: "",
    sample_price_xof: 5000,
  });
  const [preview, setPreview] = useState<any>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "commission-schedules"] });
    qc.invalidateQueries({ queryKey: ["admin", "commission-conflicts"] });
  };

  const createMut = useMutation({
    mutationFn: (payload: any) => createFn({ data: payload }),
    onSuccess: () => { toast.success("Règle ajoutée"); invalidate(); setPreview(null); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });
  const updateMut = useMutation({
    mutationFn: (payload: any) => updateFn({ data: payload }),
    onSuccess: () => { toast.success("Règle mise à jour"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Règle supprimée"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  const runPreview = async () => {
    try {
      const p = await previewFn({
        data: {
          category: form.category,
          starts_at: new Date(form.starts_at).toISOString(),
          ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
          sample_price_xof: Number(form.sample_price_xof || 5000),
        } as any,
      });
      setPreview(p);
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur prévisualisation");
    }
  };

  const submit = () => {
    const payload = {
      category: form.category,
      commission_type: form.commission_type,
      commission_rate: Number(form.commission_rate || 0),
      commission_flat_xof: Number(form.commission_flat_xof || 0),
      starts_at: new Date(form.starts_at).toISOString(),
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      priority: Number(form.priority || 0),
      active: !!form.active,
      notes: form.notes || null,
    };
    createMut.mutate(payload);
  };

  const conflictList = (conflicts ?? []) as any[];


  const rows = (data ?? []) as any[];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-bold">Commissions planifiées</h2>
          <p className="text-xs text-muted-foreground">
            Règles datées qui remplacent la commission par défaut (heures de pointe, promotions, week-end…).
            La règle active avec la priorité la plus élevée s'applique.
          </p>
        </div>
      </div>

      <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-4">
        <div>
          <Label className="text-xs">Catégorie</Label>
          <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Type</Label>
          <Select value={form.commission_type} onValueChange={(v) => setForm({ ...form, commission_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="percent">Pourcentage</SelectItem>
              <SelectItem value="flat">Forfait</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Taux %</Label>
          <Input type="number" step={0.5} min={0} max={100}
            disabled={form.commission_type === "flat"}
            value={form.commission_rate}
            onChange={(e) => setForm({ ...form, commission_rate: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Forfait (XOF)</Label>
          <Input type="number" step={50} min={0}
            disabled={form.commission_type === "percent"}
            value={form.commission_flat_xof}
            onChange={(e) => setForm({ ...form, commission_flat_xof: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Début</Label>
          <Input type="datetime-local" value={form.starts_at}
            onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Fin (optionnel)</Label>
          <Input type="datetime-local" value={form.ends_at}
            onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Priorité</Label>
          <Input type="number" min={0} value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })} />
        </div>
        <div className="flex items-end gap-2">
          <Button variant="outline" onClick={runPreview} className="flex-1">Prévisualiser</Button>
          <Button onClick={submit} disabled={createMut.isPending} className="flex-1">Enregistrer</Button>
        </div>
        <div className="md:col-span-3">
          <Label className="text-xs">Notes</Label>
          <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="ex. Heures de pointe matin" />
        </div>
        <div>
          <Label className="text-xs">Prix exemple (XOF)</Label>
          <Input type="number" step={500} min={0} value={form.sample_price_xof}
            onChange={(e) => setForm({ ...form, sample_price_xof: e.target.value })} />
        </div>
      </div>

      {preview && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm space-y-2">
          <div className="font-medium">Prévisualisation commission</div>
          <PreviewBlock label="À la date de début" data={preview.at_start} samplePrice={preview.sample_price_xof} />
          {preview.at_end && <PreviewBlock label="À la date de fin" data={preview.at_end} samplePrice={preview.sample_price_xof} />}
          <p className="text-xs text-muted-foreground">
            La règle source indique laquelle s'appliquerait <em>avant</em> l'enregistrement. Vérifiez qu'elle correspond à votre intention.
          </p>
        </div>
      )}

      {conflictList.length > 0 && (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <div className="font-medium mb-2">⚠️ {conflictList.length} chevauchement{conflictList.length > 1 ? "s" : ""} détecté{conflictList.length > 1 ? "s" : ""}</div>
          <ul className="space-y-2 text-xs">
            {conflictList.map((c: any, i: number) => (
              <li key={i} className="rounded-xl border border-warning/30 bg-card p-2">
                <div className="font-medium">{CATEGORY_LABEL[c.category] ?? c.category}</div>
                <div>Règle A : prio {c.a.priority} · {new Date(c.a.starts_at).toLocaleString("fr-FR")} → {c.a.ends_at ? new Date(c.a.ends_at).toLocaleString("fr-FR") : "∞"}</div>
                <div>Règle B : prio {c.b.priority} · {new Date(c.b.starts_at).toLocaleString("fr-FR")} → {c.b.ends_at ? new Date(c.b.ends_at).toLocaleString("fr-FR") : "∞"}</div>
                {c.same_priority
                  ? <div className="text-destructive mt-1">Priorité identique : résultat ambigu. Ajustez la priorité de l'une des règles.</div>
                  : <div className="text-muted-foreground mt-1">→ La règle prioritaire (id {c.winner_id?.slice(0, 8)}…) s'applique.</div>}
              </li>
            ))}
          </ul>
        </div>
      )}


      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Catégorie</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-right">Valeur</th>
              <th className="px-3 py-2 text-left">Période</th>
              <th className="px-3 py-2 text-right">Priorité</th>
              <th className="px-3 py-2 text-center">Actif</th>
              <th className="px-3 py-2 text-left">Notes</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Chargement…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Aucune règle planifiée.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2">{CATEGORY_LABEL[r.category] ?? r.category}</td>
                <td className="px-3 py-2">{r.commission_type === "flat" ? "Forfait" : "Pourcentage"}</td>
                <td className="px-3 py-2 text-right">
                  {r.commission_type === "flat" ? formatXof(r.commission_flat_xof) : `${r.commission_rate} %`}
                </td>
                <td className="px-3 py-2 text-xs">
                  {new Date(r.starts_at).toLocaleString("fr-FR")}
                  <br />→ {r.ends_at ? new Date(r.ends_at).toLocaleString("fr-FR") : "—"}
                </td>
                <td className="px-3 py-2 text-right">{r.priority}</td>
                <td className="px-3 py-2 text-center">
                  <input type="checkbox" checked={!!r.active}
                    onChange={(e) => updateMut.mutate({ id: r.id, active: e.target.checked })} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.notes ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" variant="ghost"
                    onClick={() => { if (confirm("Supprimer cette règle ?")) deleteMut.mutate(r.id); }}>
                    Supprimer
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


/* ----------------------------- Billing tab ----------------------------- */
const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon", issued: "Émise", paid: "Payée", cancelled: "Annulée",
};
const PAYMENT_METHODS = [
  { value: "bank_transfer", label: "Virement bancaire" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "cash", label: "Espèces" },
  { value: "card", label: "Carte" },
  { value: "other", label: "Autre" },
];

function BillingTab() {
  const qc = useQueryClient();
  const listCorpFn = useServerFn(listCorporates);
  const createCorpFn = useServerFn(createCorporate);
  const listInvFn = useServerFn(listInvoices);
  const createInvFn = useServerFn(createInvoice);
  const updateStatusFn = useServerFn(updateInvoiceStatus);

  const corporates = useQuery({ queryKey: ["admin","corporates"], queryFn: () => listCorpFn({}) });
  const invoices = useQuery({ queryKey: ["admin","invoices"], queryFn: () => listInvFn({}) });

  const [newCorpOpen, setNewCorpOpen] = useState(false);
  const [newInvOpen, setNewInvOpen] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<any>(null);

  const corpForm = useRef<any>({});
  const createCorp = useMutation({
    mutationFn: (payload: any) => createCorpFn({ data: payload }),
    onSuccess: () => {
      toast.success("Entreprise créée");
      setNewCorpOpen(false);
      qc.invalidateQueries({ queryKey: ["admin","corporates"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  const [invDraft, setInvDraft] = useState<any>({
    corporate_id: "", due_date: "", notes: "",
    items: [{ description: "", quantity: 1, unit_price_xof: 0 }],
  });
  const createInv = useMutation({
    mutationFn: (payload: any) => createInvFn({ data: payload }),
    onSuccess: () => {
      toast.success("Facture créée");
      setNewInvOpen(false);
      setInvDraft({ corporate_id: "", due_date: "", notes: "",
        items: [{ description: "", quantity: 1, unit_price_xof: 0 }] });
      qc.invalidateQueries({ queryKey: ["admin","invoices"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });
  const updateStatus = useMutation({
    mutationFn: (payload: any) => updateStatusFn({ data: payload }),
    onSuccess: () => {
      toast.success("Statut mis à jour");
      qc.invalidateQueries({ queryKey: ["admin","invoices"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  const invSubtotal = (invDraft.items as any[]).reduce(
    (s, it) => s + Math.round((Number(it.quantity)||0) * (Number(it.unit_price_xof)||0)), 0);
  const invVat = Math.round(invSubtotal * 0.18);
  const invTotal = invSubtotal + invVat;

  return (
    <div className="space-y-6">
      {/* Corporates */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Comptes entreprises</h2>
          <Button size="sm" onClick={() => setNewCorpOpen(true)}>+ Entreprise</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Nom</th>
                <th className="px-3 py-2 text-left">Contact</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Téléphone</th>
                <th className="px-3 py-2 text-left">N° contribuable</th>
              </tr>
            </thead>
            <tbody>
              {(corporates.data ?? []).map((c: any) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2">{c.contact_name ?? "—"}</td>
                  <td className="px-3 py-2">{c.email ?? "—"}</td>
                  <td className="px-3 py-2">{c.phone ?? "—"}</td>
                  <td className="px-3 py-2">{c.tax_id ?? "—"}</td>
                </tr>
              ))}
              {(corporates.data ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Aucune entreprise.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Invoices */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Factures</h2>
          <Button size="sm" onClick={() => setNewInvOpen(true)} disabled={(corporates.data ?? []).length === 0}>
            + Facture
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">N°</th>
                <th className="px-3 py-2 text-left">Entreprise</th>
                <th className="px-3 py-2 text-right">HT</th>
                <th className="px-3 py-2 text-right">TVA 18%</th>
                <th className="px-3 py-2 text-right">TTC</th>
                <th className="px-3 py-2 text-right">Payé</th>
                <th className="px-3 py-2 text-left">Statut</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(invoices.data ?? []).map((inv: any) => (
                <tr key={inv.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{inv.number}</td>
                  <td className="px-3 py-2">{inv.corporate?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{formatXof(inv.subtotal_xof)}</td>
                  <td className="px-3 py-2 text-right">{formatXof(inv.vat_xof)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatXof(inv.total_xof)}</td>
                  <td className="px-3 py-2 text-right">{formatXof(inv.paid_xof)}</td>
                  <td className="px-3 py-2">
                    <Select
                      value={inv.status}
                      onValueChange={(v) => updateStatus.mutate({ invoice_id: inv.id, status: v })}
                    >
                      <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(INVOICE_STATUS_LABEL).map(([k,l]) => (
                          <SelectItem key={k} value={k}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => setPaymentInvoice(inv)}
                      disabled={inv.status === "cancelled"}>
                      Paiement
                    </Button>
                  </td>
                </tr>
              ))}
              {(invoices.data ?? []).length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Aucune facture.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* New corporate dialog */}
      <Dialog open={newCorpOpen} onOpenChange={setNewCorpOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nouvelle entreprise</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {[
              ["name","Raison sociale *"],["contact_name","Contact"],
              ["email","Email"],["phone","Téléphone"],
              ["address","Adresse"],["city","Ville"],["tax_id","N° contribuable"],
            ].map(([k,label]) => (
              <div key={k}>
                <Label>{label}</Label>
                <Input onChange={(e) => (corpForm.current[k] = e.target.value)} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewCorpOpen(false)}>Annuler</Button>
            <Button
              disabled={createCorp.isPending}
              onClick={() => {
                if (!corpForm.current.name?.trim()) { toast.error("Nom requis"); return; }
                createCorp.mutate(corpForm.current);
              }}
            >
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New invoice dialog */}
      <Dialog open={newInvOpen} onOpenChange={setNewInvOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Nouvelle facture (TVA 18% incluse)</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Entreprise *</Label>
                <Select value={invDraft.corporate_id}
                  onValueChange={(v) => setInvDraft({ ...invDraft, corporate_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
                  <SelectContent>
                    {(corporates.data ?? []).map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Échéance</Label>
                <Input type="date" value={invDraft.due_date}
                  onChange={(e) => setInvDraft({ ...invDraft, due_date: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Lignes</Label>
              <div className="space-y-2">
                {invDraft.items.map((it: any, i: number) => (
                  <div key={i} className="grid grid-cols-[1fr_70px_110px_30px] gap-2">
                    <Input placeholder="Description" value={it.description}
                      onChange={(e) => {
                        const items = [...invDraft.items];
                        items[i] = { ...it, description: e.target.value };
                        setInvDraft({ ...invDraft, items });
                      }} />
                    <Input type="number" min={0} step={0.5} value={it.quantity}
                      onChange={(e) => {
                        const items = [...invDraft.items];
                        items[i] = { ...it, quantity: Number(e.target.value) };
                        setInvDraft({ ...invDraft, items });
                      }} />
                    <Input type="number" min={0} step={50} placeholder="PU XOF" value={it.unit_price_xof}
                      onChange={(e) => {
                        const items = [...invDraft.items];
                        items[i] = { ...it, unit_price_xof: Number(e.target.value) };
                        setInvDraft({ ...invDraft, items });
                      }} />
                    <Button variant="ghost" size="sm"
                      onClick={() => setInvDraft({ ...invDraft,
                        items: invDraft.items.filter((_: any, j: number) => j !== i) })}
                      disabled={invDraft.items.length === 1}>×</Button>
                  </div>
                ))}
                <Button variant="outline" size="sm"
                  onClick={() => setInvDraft({ ...invDraft,
                    items: [...invDraft.items, { description: "", quantity: 1, unit_price_xof: 0 }] })}>
                  + Ligne
                </Button>
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={invDraft.notes}
                onChange={(e) => setInvDraft({ ...invDraft, notes: e.target.value })} />
            </div>
            <div className="rounded-lg bg-muted/40 p-3 text-sm">
              <div className="flex justify-between"><span>Sous-total HT</span><span>{formatXof(invSubtotal)}</span></div>
              <div className="flex justify-between"><span>TVA 18%</span><span>{formatXof(invVat)}</span></div>
              <div className="flex justify-between font-semibold"><span>Total TTC</span><span>{formatXof(invTotal)}</span></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewInvOpen(false)}>Annuler</Button>
            <Button disabled={createInv.isPending || !invDraft.corporate_id}
              onClick={() => createInv.mutate({
                corporate_id: invDraft.corporate_id,
                due_date: invDraft.due_date || null,
                notes: invDraft.notes || null,
                items: invDraft.items.filter((it: any) => it.description && it.unit_price_xof > 0),
              })}>
              Créer la facture
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PaymentDialog invoice={paymentInvoice} onClose={() => setPaymentInvoice(null)} />
    </div>
  );
}

function PaymentDialog({ invoice, onClose }: { invoice: any; onClose: () => void }) {
  const qc = useQueryClient();
  const recordFn = useServerFn(recordInvoicePayment);
  const listPaymentsFn = useServerFn(listInvoicePayments);
  const [form, setForm] = useState<any>({
    amount_xof: 0, method: "bank_transfer", reference: "",
    paid_on: new Date().toISOString().slice(0,10), notes: "",
  });

  const payments = useQuery({
    queryKey: ["admin","invoice-payments", invoice?.id],
    queryFn: () => listPaymentsFn({ data: { invoice_id: invoice.id } }),
    enabled: !!invoice,
  });

  const mutation = useMutation({
    mutationFn: (payload: any) => recordFn({ data: payload }),
    onSuccess: () => {
      toast.success("Paiement enregistré");
      qc.invalidateQueries({ queryKey: ["admin","invoices"] });
      qc.invalidateQueries({ queryKey: ["admin","invoice-payments", invoice?.id] });
      setForm({ ...form, amount_xof: 0, reference: "", notes: "" });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  if (!invoice) return null;
  const remaining = invoice.total_xof - invoice.paid_xof;

  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Paiement — {invoice.number}</DialogTitle>
        </DialogHeader>

        <div className="rounded-lg bg-muted/40 p-3 text-sm">
          <div className="flex justify-between"><span>Total TTC</span><span>{formatXof(invoice.total_xof)}</span></div>
          <div className="flex justify-between"><span>Déjà payé</span><span>{formatXof(invoice.paid_xof)}</span></div>
          <div className="flex justify-between font-semibold">
            <span>Reste dû</span><span>{formatXof(Math.max(0, remaining))}</span>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Montant XOF *</Label>
              <Input type="number" min={1} value={form.amount_xof}
                onChange={(e) => setForm({ ...form, amount_xof: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Méthode *</Label>
              <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.paid_on}
                onChange={(e) => setForm({ ...form, paid_on: e.target.value })} />
            </div>
            <div>
              <Label>Référence</Label>
              <Input placeholder="N° transaction, bordereau…" value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <Button className="w-full"
            disabled={mutation.isPending || form.amount_xof <= 0}
            onClick={() => mutation.mutate({
              invoice_id: invoice.id,
              amount_xof: form.amount_xof,
              method: form.method,
              reference: form.reference || null,
              paid_on: form.paid_on,
              notes: form.notes || null,
            })}>
            Enregistrer le paiement
          </Button>
        </div>

        <div className="mt-2">
          <h3 className="mb-2 text-sm font-semibold">Historique</h3>
          <div className="space-y-1 text-xs">
            {(payments.data ?? []).map((p: any) => (
              <div key={p.id} className="flex justify-between rounded border border-border px-2 py-1">
                <span>{p.paid_on} · {PAYMENT_METHODS.find((m) => m.value === p.method)?.label}{p.reference ? ` · ${p.reference}` : ""}</span>
                <span className="font-semibold">{formatXof(p.amount_xof)}</span>
              </div>
            ))}
            {(payments.data ?? []).length === 0 && (
              <p className="text-muted-foreground">Aucun paiement enregistré.</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- Wallets tab ----------------------------- */
function WalletsTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listDriverWallets);
  const topupFn = useServerFn(adminWalletTopup);
  const adjustFn = useServerFn(adminWalletAdjust);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "wallets"],
    queryFn: () => listFn({}),
  });
  const [selected, setSelected] = useState<any>(null);
  const [mode, setMode] = useState<"topup" | "adjust">("topup");
  const [amount, setAmount] = useState<number>(0);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const topup = useMutation({
    mutationFn: (p: any) => topupFn({ data: p }),
    onSuccess: () => { toast.success("Wallet rechargé"); reset(); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });
  const adjust = useMutation({
    mutationFn: (p: any) => adjustFn({ data: p }),
    onSuccess: () => { toast.success("Ajustement enregistré"); reset(); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });
  function reset() {
    qc.invalidateQueries({ queryKey: ["admin", "wallets"] });
    setSelected(null); setAmount(0); setReference(""); setNotes("");
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Chargement…</p>;
  const rows = (data ?? []) as any[];

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Chauffeur</th>
              <th className="px-3 py-2 text-left">Téléphone</th>
              <th className="px-3 py-2 text-right">Solde</th>
              <th className="px-3 py-2 text-left">Mis à jour</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.user_id} className="border-t border-border">
                <td className="px-3 py-2">{w.profile?.full_name ?? w.user_id.slice(0,8)}</td>
                <td className="px-3 py-2">{w.profile?.phone ?? "—"}</td>
                <td className={"px-3 py-2 text-right font-semibold " + (w.balance_xof < 0 ? "text-destructive" : "")}>
                  {formatXof(w.balance_xof)}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {w.updated_at ? new Date(w.updated_at).toLocaleString("fr-FR") : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" variant="outline"
                    onClick={() => { setSelected(w); setMode("topup"); setAmount(0); }}>
                    Recharger / Ajuster
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Aucun wallet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode === "topup" ? "Recharger" : "Ajuster"} le wallet — {selected?.profile?.full_name ?? ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button size="sm" variant={mode === "topup" ? "default" : "outline"} onClick={() => setMode("topup")}>Recharge</Button>
              <Button size="sm" variant={mode === "adjust" ? "default" : "outline"} onClick={() => setMode("adjust")}>Ajustement (+/-)</Button>
            </div>
            <div>
              <Label>Montant XOF {mode === "adjust" && "(négatif autorisé)"}</Label>
              <Input type="number" value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                min={mode === "topup" ? 1 : undefined} />
            </div>
            {mode === "topup" && (
              <div>
                <Label>Référence (mobile money / bordereau)</Label>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
            )}
            <div>
              <Label>Notes {mode === "adjust" && "*"}</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSelected(null)}>Annuler</Button>
            <Button
              disabled={topup.isPending || adjust.isPending ||
                (mode === "topup" ? amount <= 0 : amount === 0 || !notes.trim())}
              onClick={() => {
                if (!selected) return;
                if (mode === "topup") {
                  topup.mutate({ driver_id: selected.user_id, amount_xof: amount,
                    reference: reference || null, notes: notes || null });
                } else {
                  adjust.mutate({ driver_id: selected.user_id, amount_xof: amount, notes });
                }
              }}
            >
              Valider
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ----------------------- Commission report tab ----------------------- */
function CommissionReportTab() {
  const reportFn = useServerFn(commissionReport);
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState(monthStart.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [category, setCategory] = useState<string>("all");
  const [driverId, setDriverId] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const r = await reportFn({
        data: {
          from: new Date(from + "T00:00:00").toISOString(),
          to: new Date(to + "T23:59:59").toISOString(),
          category: category === "all" ? null : (category as any),
          driver_id: driverId.trim() || null,
        } as any,
      });
      setResult(r);
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
    } finally {
      setLoading(false);
    }
  };

  const exportRows = () => {
    if (!result) return;
    const rows = result.rows.map((r: any) => ({
      date: r.completed_at,
      categorie: CATEGORY_LABEL[r.category] ?? r.category,
      chauffeur: r.driver_name ?? r.driver_id ?? "",
      ville: r.city,
      depart: r.pickup_address,
      arrivee: r.dropoff_address,
      prix_xof: r.price_xof ?? 0,
      taux_commission: r.commission_rate ?? "",
      commission_xof: r.commission_xof ?? 0,
      part_chauffeur_xof: r.driver_earnings_xof ?? 0,
    }));
    downloadCsv(`commissions-${from}_${to}.csv`, rows);
  };

  const exportSummary = () => {
    if (!result) return;
    const byCat = result.byCategory.map((c: any) => ({
      type: "categorie",
      cle: CATEGORY_LABEL[c.category] ?? c.category,
      courses: c.rides,
      ca_xof: c.revenue_xof,
      commission_xof: c.commission_xof,
    }));
    const byDrv = result.byDriver.map((d: any) => ({
      type: "chauffeur",
      cle: d.driver_name ?? d.driver_id,
      courses: d.rides,
      ca_xof: d.revenue_xof,
      commission_xof: d.commission_xof,
    }));
    downloadCsv(`commissions-synthese-${from}_${to}.csv`, [...byCat, ...byDrv]);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Génère un rapport des commissions plateforme pour la comptabilité.
        Filtrez par période, catégorie et chauffeur, puis exportez en CSV.
      </div>
      <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-5">
        <div>
          <Label className="text-xs">Du</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Au</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Catégorie</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes</SelectItem>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Chauffeur (UUID, optionnel)</Label>
          <Input value={driverId} onChange={(e) => setDriverId(e.target.value)} placeholder="uuid…" />
        </div>
        <div className="flex items-end">
          <Button onClick={run} disabled={loading} className="w-full">{loading ? "Calcul…" : "Générer"}</Button>
        </div>
      </div>

      {result && (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <Metric label="Courses" value={String(result.totals.rides)} />
            <Metric label="Chiffre d'affaires" value={formatXof(result.totals.revenue_xof)} />
            <Metric label="Commission plateforme" value={formatXof(result.totals.commission_xof)} highlight />
            <Metric label="Part chauffeurs" value={formatXof(result.totals.driver_earnings_xof)} />
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={exportRows}><Download className="h-4 w-4 mr-2" />Détail (CSV)</Button>
            <Button variant="outline" onClick={exportSummary}><Download className="h-4 w-4 mr-2" />Synthèse (CSV)</Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <div className="bg-muted/40 px-4 py-2 text-xs font-medium uppercase">Par catégorie</div>
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground"><tr>
                  <th className="px-3 py-2 text-left">Catégorie</th>
                  <th className="px-3 py-2 text-right">Courses</th>
                  <th className="px-3 py-2 text-right">CA</th>
                  <th className="px-3 py-2 text-right">Commission</th>
                </tr></thead>
                <tbody>
                  {result.byCategory.map((c: any) => (
                    <tr key={c.category} className="border-t border-border">
                      <td className="px-3 py-2">{CATEGORY_LABEL[c.category] ?? c.category}</td>
                      <td className="px-3 py-2 text-right">{c.rides}</td>
                      <td className="px-3 py-2 text-right">{formatXof(c.revenue_xof)}</td>
                      <td className="px-3 py-2 text-right font-medium text-primary">{formatXof(c.commission_xof)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <div className="bg-muted/40 px-4 py-2 text-xs font-medium uppercase">Par chauffeur</div>
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground"><tr>
                    <th className="px-3 py-2 text-left">Chauffeur</th>
                    <th className="px-3 py-2 text-right">Courses</th>
                    <th className="px-3 py-2 text-right">CA</th>
                    <th className="px-3 py-2 text-right">Commission</th>
                  </tr></thead>
                  <tbody>
                    {result.byDriver.map((d: any) => (
                      <tr key={d.driver_id} className="border-t border-border">
                        <td className="px-3 py-2">{d.driver_name ?? d.driver_id?.slice(0, 8)}</td>
                        <td className="px-3 py-2 text-right">{d.rides}</td>
                        <td className="px-3 py-2 text-right">{formatXof(d.revenue_xof)}</td>
                        <td className="px-3 py-2 text-right font-medium text-primary">{formatXof(d.commission_xof)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PreviewBlock({ label, data, samplePrice }: { label: string; data: any; samplePrice: number }) {
  if (!data) return null;
  const sourceLbl =
    data.source === "schedule" ? "Règle planifiée existante" :
    data.source === "default" ? "Tarif par défaut catégorie" : "Aucune règle";
  const formula =
    data.commission_type === "flat"
      ? `Forfait ${formatXof(data.commission_flat_xof)}`
      : `${data.commission_rate}% × ${formatXof(samplePrice)}`;
  return (
    <div className="rounded-xl border border-border bg-card p-3 text-xs space-y-1">
      <div className="font-medium">{label}</div>
      <div className="flex justify-between"><span className="text-muted-foreground">Règle source</span><span>{sourceLbl}</span></div>
      <div className="flex justify-between"><span className="text-muted-foreground">Calcul</span><code>{formula}</code></div>
      <div className="flex justify-between"><span>Commission</span><span className="font-medium text-primary">{formatXof(data.commission_xof)}</span></div>
      <div className="flex justify-between"><span>Part chauffeur</span><span>{formatXof(data.driver_earnings_xof)}</span></div>
    </div>
  );
}

function FraudTab() {
  const [kind, setKind] = useState<string>("");
  const q = useQuery({
    queryKey: ["fraud-logs", kind],
    queryFn: async () => {
      let req = supabase.from("fraud_logs").select("*").order("created_at", { ascending: false }).limit(200);
      if (kind) req = req.eq("kind", kind);
      const { data, error } = await req;
      if (error) throw error;
      return data ?? [];
    },
  });
  const kinds = ["", "share_cooldown", "share_daily_cap", "referral_duplicate", "referral_invalid_code", "referral_self", "referral_same_phone", "duplicate_payout_attempt"];
  const sevColor = (s: string) => s === "high" ? "text-destructive" : s === "warn" ? "text-orange-600" : "text-muted-foreground";
  return (
    <div className="space-y-3 pt-4">
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground">Filtrer par type</label>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          {kinds.map((k) => <option key={k} value={k}>{k || "(tous)"}</option>)}
        </select>
        <span className="ml-auto text-xs text-muted-foreground">{q.data?.length ?? 0} événements</span>
      </div>
      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {(q.data ?? []).length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">Aucun événement.</div>}
        {(q.data ?? []).map((l: any) => (
          <div key={l.id} className="p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`font-mono text-xs font-semibold uppercase ${sevColor(l.severity)}`}>{l.severity}</span>
              <span className="font-medium">{l.kind}</span>
              {l.reference && <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-mono">{l.reference}</span>}
              <span className="ml-auto text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString("fr-FR")}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              user: <code>{l.user_id?.slice(0, 8) ?? "—"}</code>
              {l.ride_id && <> · ride: <code>{l.ride_id.slice(0, 8)}</code></>}
            </div>
            {l.details && Object.keys(l.details).length > 0 && (
              <pre className="mt-1 overflow-x-auto rounded bg-muted/50 p-2 text-xs">{JSON.stringify(l.details, null, 2)}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============ Rewards settings tab ============
function RewardsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "reward_settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("reward_settings").select("*").eq("id", true).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const [form, setForm] = useState<Record<string, number> | null>(null);
  const current = form ?? (data ? {
    driver_share_bonus_xof: data.driver_share_bonus_xof,
    driver_share_daily_cap: data.driver_share_daily_cap,
    driver_referral_bonus_xof: data.driver_referral_bonus_xof,
    driver_referral_per_ride_xof: data.driver_referral_per_ride_xof,
    passenger_referral_bonus_pts: data.passenger_referral_bonus_pts,
    passenger_ride_earn_pts: data.passenger_ride_earn_pts,
    point_value_xof: Number(data.point_value_xof),
  } : null);

  const save = useMutation({
    mutationFn: async (payload: Record<string, number>) => {
      const { error } = await supabase.from("reward_settings").update(payload as never).eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Paramètres récompenses enregistrés");
      qc.invalidateQueries({ queryKey: ["admin", "reward_settings"] });
      setForm(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !current) return <div className="py-12 text-center text-muted-foreground">Chargement…</div>;

  const fields: { key: keyof typeof current; label: string; help?: string; step?: number }[] = [
    { key: "passenger_ride_earn_pts", label: "Points gagnés par course (passager)" },
    { key: "passenger_referral_bonus_pts", label: "Bonus parrainage passager (points)" },
    { key: "point_value_xof", label: "Valeur d'1 point (XOF)", step: 0.1 },
    { key: "driver_share_bonus_xof", label: "Bonus partage chauffeur (XOF)" },
    { key: "driver_share_daily_cap", label: "Plafond partages par jour (chauffeur)" },
    { key: "driver_referral_bonus_xof", label: "Bonus parrainage chauffeur (XOF)" },
    { key: "driver_referral_per_ride_xof", label: "Bonus par course du filleul (XOF)" },
  ];

  return (
    <div className="space-y-4 rounded-3xl border border-border bg-card/40 p-4">
      <div>
        <h3 className="font-semibold">Paramètres des récompenses</h3>
        <p className="text-xs text-muted-foreground">Configurez les bonus passagers et chauffeurs ainsi que la valeur du point.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key as string} className="space-y-1">
            <Label className="text-xs">{f.label}</Label>
            <Input
              type="number"
              step={f.step ?? 1}
              value={current[f.key]}
              onChange={(e) => setForm({ ...current, [f.key]: Number(e.target.value) })}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button onClick={() => save.mutate(current)} disabled={save.isPending || !form}>
          {save.isPending ? "Enregistrement…" : "Enregistrer"}
        </Button>
        {form && (
          <Button variant="ghost" onClick={() => setForm(null)}>Annuler</Button>
        )}
      </div>
    </div>
  );
}
