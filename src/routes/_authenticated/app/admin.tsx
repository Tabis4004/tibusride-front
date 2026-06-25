import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatXof } from "@/lib/pricing";
import { DELIVERY_VEHICLES, PACKAGE_TYPES, DELIVERY_EXTRAS, type DeliveryVehicle, type PackageType } from "@/lib/delivery-pricing";
import { type ReportGranularity, buildPeriodSeries } from "@/lib/reporting";
import { countriesMatch } from "@/lib/countries";
import { fetchMarketPrograms, type MarketProgramConfig } from "@/lib/country-market";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  listUsers,
  setUserBanned,
  setUserRole,
  setUserCountry,
  promoteCountryAdmin,
  ADMIN_COUNTRIES,
  updateDriverStatus,
  assignDriverEnrollment,
  uploadDriverDocument,
  getDocumentSignedUrl,
  listAuditLogs,
  listPricingSettings,
  updatePricingSetting,
  listDeliveryPricingSettings,
  updateDeliveryPricingSetting,
  listDeliveryPackagePricing,
  updateDeliveryPackagePricing,
  listDeliveryExtrasPricing,
  updateDeliveryExtrasPricing,
  listDynamicPricingSettings,
  updateDynamicPricingSetting,
  createDynamicPricingSetting,
  deleteDynamicPricingSetting,
  listMarketPrograms,
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
import { listInsuredDrivers, verifyDriverInsurance, getInsuranceDocumentSignedUrl } from "@/lib/insurance.functions";
import { INSURANCE_STATUS_LABEL, type InsuranceStatus } from "@/lib/driver-enrollment";
import { listDriverWallets, adminWalletTopup, adminWalletAdjust } from "@/lib/wallet.functions";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Car,
  Coins,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Gift,
  KeyRound,
  Lock,
  Receipt,
  Palette,
  Search,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Tag,
  Unlock,
  Upload,
  Users,
  Wallet,
} from "lucide-react";
import { RolesPermissionsTab } from "@/components/admin/RolesPermissionsTab";
import { DELIVERY_CATEGORIES, PARTNER_TYPES, RIDE_CATEGORIES, VEHICLE_TYPES } from "@/lib/driver-enrollment";

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

type AdminRole = "superadmin" | "admin" | "support";

type SectionDef = {
  key: string;
  title: string;
  description: string;
  keywords: string[];
  icon: any;
  defaultPalette: number; // index into PASTEL_PALETTE
  group: string;
  roles: AdminRole[];
  countKey?: "pendingDrivers" | "openTickets" | "fraudAlerts" | "unpaidInvoices" | "auditToday";
  countLabel?: string;
  externalHref?: string;
};

const PASTEL_PALETTE: { name: string; bg: string; iconBg: string }[] = [
  { name: "Émeraude", bg: "bg-emerald-50 border-emerald-100", iconBg: "bg-emerald-500" },
  { name: "Ciel", bg: "bg-sky-50 border-sky-100", iconBg: "bg-sky-500" },
  { name: "Ambre", bg: "bg-amber-50 border-amber-100", iconBg: "bg-amber-500" },
  { name: "Violet", bg: "bg-violet-50 border-violet-100", iconBg: "bg-violet-500" },
  { name: "Rose", bg: "bg-rose-50 border-rose-100", iconBg: "bg-rose-500" },
  { name: "Sarcelle", bg: "bg-teal-50 border-teal-100", iconBg: "bg-teal-500" },
  { name: "Citron", bg: "bg-lime-50 border-lime-100", iconBg: "bg-lime-500" },
  { name: "Indigo", bg: "bg-indigo-50 border-indigo-100", iconBg: "bg-indigo-500" },
  { name: "Orange", bg: "bg-orange-50 border-orange-100", iconBg: "bg-orange-500" },
  { name: "Magenta", bg: "bg-pink-50 border-pink-100", iconBg: "bg-pink-500" },
  { name: "Cyan", bg: "bg-cyan-50 border-cyan-100", iconBg: "bg-cyan-500" },
  { name: "Pierre", bg: "bg-stone-50 border-stone-200", iconBg: "bg-stone-500" },
];

const COLOR_STORAGE_KEY = "tibus.admin.cardColors.v1";

function AdminPage() {
  const { hasRole, roles, loading } = useAuth();
  const [section, setSection] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | AdminRole>("all");
  const [customizing, setCustomizing] = useState(false);
  const [colorOverrides, setColorOverrides] = useState<Record<string, { bg: string; iconBg: string }>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem(COLOR_STORAGE_KEY) ?? "{}"); } catch { return {}; }
  });

  const setSectionColor = (key: string, c: { bg: string; iconBg: string } | null) => {
    setColorOverrides((prev) => {
      const next = { ...prev };
      if (!c) delete next[key]; else next[key] = c;
      try { localStorage.setItem(COLOR_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const counts = useQuery({
    queryKey: ["admin-overview-counts"],
    enabled: hasRole("admin") || hasRole("support"),
    queryFn: async () => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const [drivers, tickets, fraud, invoices, audit] = await Promise.all([
        supabase.from("driver_profiles").select("user_id", { count: "exact", head: true }).in("status", ["pending", "under_review"]),
        supabase.from("support_tickets").select("id", { count: "exact", head: true }).in("status", ["open", "pending"]),
        supabase.from("fraud_logs").select("id", { count: "exact", head: true }).in("severity", ["warn", "high"]).gte("created_at", dayAgo),
        supabase.from("invoices").select("id", { count: "exact", head: true }).neq("status", "paid"),
        supabase.from("audit_logs").select("id", { count: "exact", head: true }).gte("created_at", today.toISOString()),
      ]);
      return {
        pendingDrivers: drivers.count ?? 0,
        openTickets: tickets.count ?? 0,
        fraudAlerts: fraud.count ?? 0,
        unpaidInvoices: invoices.count ?? 0,
        auditToday: audit.count ?? 0,
      };
    },
  });

  const sections: SectionDef[] = [
    { key: "drivers", title: "Chauffeurs & livreurs", description: "Enrôlement, documents, contrôle physique et catégories", keywords: ["chauffeur","livreur","driver","permis","carte grise","document","validation"], icon: Car, defaultPalette: 0, group: "Opérations", roles: ["superadmin","admin","support"], countKey: "pendingDrivers", countLabel: "à valider" },
    { key: "users", title: "Utilisateurs", description: "Comptes, statut et export", keywords: ["utilisateur","user","compte","bloquer"], icon: Users, defaultPalette: 1, group: "Opérations", roles: ["superadmin","admin"] },
    { key: "roles", title: "Rôles & permissions", description: "Rôles, mots de passe et admins pays", keywords: ["role","permission","mot de passe","password","admin pays","superadmin"], icon: KeyRound, defaultPalette: 11, group: "Sécurité", roles: ["superadmin"] },
    { key: "rides", title: "Courses", description: "Historique et détails par course", keywords: ["course","ride","trajet","historique"], icon: ScrollText, defaultPalette: 2, group: "Opérations", roles: ["superadmin","admin","support"] },
    { key: "pricing", title: "Tarifs & commissions", description: "Paliers, catégories et règles", keywords: ["tarif","prix","pricing","commission","paiement"], icon: Tag, defaultPalette: 3, group: "Finance", roles: ["superadmin","admin"] },
    { key: "commissions-report", title: "Suivi financier KPI", description: "Revenus, commissions, bonus et historique", keywords: ["rapport","report","commission","export","paiement","kpi","finance","bonus","revenu"], icon: BarChart3, defaultPalette: 4, group: "Finance", roles: ["superadmin","admin"] },
    { key: "billing", title: "Facturation", description: "Comptes corporates et factures", keywords: ["facture","invoice","facturation","paiement","corporate"], icon: Receipt, defaultPalette: 5, group: "Finance", roles: ["superadmin","admin"], countKey: "unpaidInvoices", countLabel: "factures impayées" },
    { key: "wallets", title: "Wallets", description: "Soldes et ajustements chauffeurs", keywords: ["wallet","solde","paiement","chauffeur"], icon: Wallet, defaultPalette: 6, group: "Finance", roles: ["superadmin","admin"] },
    { key: "audit", title: "Journal d'audit", description: "Historique des actions admin", keywords: ["audit","journal","historique","log"], icon: FileText, defaultPalette: 7, group: "Sécurité", roles: ["superadmin","admin"], countKey: "auditToday", countLabel: "aujourd'hui" },
    { key: "fraud", title: "Anti-fraude", description: "Signaux et alertes", keywords: ["fraude","fraud","alerte","sécurité"], icon: ShieldAlert, defaultPalette: 8, group: "Sécurité", roles: ["superadmin","admin","support"], countKey: "fraudAlerts", countLabel: "alertes 24h" },
    { key: "insurance", title: "Assurance", description: "Validation des dossiers et renouvellements chauffeurs", keywords: ["assurance","insurance","assureur","renouvellement","validation"], icon: ShieldCheck, defaultPalette: 13, group: "Sécurité", roles: ["superadmin","admin"] },
    { key: "rewards", title: "Récompenses", description: "Programmes de fidélité et bonus", keywords: ["récompense","reward","bonus","fidélité"], icon: Gift, defaultPalette: 9, group: "Croissance", roles: ["superadmin","admin"] },
    { key: "metrics", title: "Métriques", description: "Indicateurs et KPIs", keywords: ["métrique","kpi","statistique","metric"], icon: Coins, defaultPalette: 10, group: "Croissance", roles: ["superadmin","admin"] },
    { key: "manual", title: "Manuel administrateur", description: "Guide d'utilisation complet du panneau admin (PDF)", keywords: ["manuel","guide","aide","documentation","pdf","tutoriel"], icon: BookOpen, defaultPalette: 6, group: "Aide", roles: ["superadmin","admin"], externalHref: "/docs/Manuel_Administrateur_EcoTibus.pdf" },
  ];

  if (loading) return <div className="py-12 text-center text-muted-foreground">Chargement…</div>;
  if (!hasRole("admin") && !hasRole("support")) {
    return (
      <div className="rounded-3xl border border-destructive/30 bg-destructive/5 p-8 text-center">
        <h2 className="font-display text-xl font-bold text-destructive">Accès refusé</h2>
        <p className="mt-2 text-sm text-muted-foreground">Vous n'avez pas les droits administrateur.</p>
      </div>
    );
  }

  // Map current user's app roles → admin grid roles
  const myRoles: AdminRole[] = [];
  if (roles.includes("superadmin")) myRoles.push("superadmin", "admin");
  else if (roles.includes("admin")) myRoles.push("admin");
  if (roles.includes("support")) myRoles.push("support");

  const getColors = (s: SectionDef) => {
    const o = colorOverrides[s.key];
    if (o) return o;
    const p = PASTEL_PALETTE[s.defaultPalette] ?? PASTEL_PALETTE[0];
    return { bg: p.bg, iconBg: p.iconBg };
  };

  const countOf = (s: SectionDef): number | null => {
    if (!s.countKey || !counts.data) return null;
    return counts.data[s.countKey] ?? 0;
  };

  if (section) {
    const current = sections.find((s) => s.key === section);
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSection(null)} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Retour
          </Button>
          <h1 className="font-display text-2xl font-bold">{current?.title ?? "Administration"}</h1>
        </div>
        {section === "drivers" && <DriversTab />}
        {section === "users" && <UsersTab />}
        {section === "roles" && <RolesPermissionsTab />}
        {section === "rides" && <RidesTab />}
        {section === "pricing" && <PricingTab />}
        {section === "commissions-report" && <CommissionReportTab />}
        {section === "billing" && <BillingTab />}
        {section === "wallets" && <WalletsTab />}
        {section === "audit" && <AuditTab />}
        {section === "fraud" && <FraudTab />}
        {section === "insurance" && <InsuranceTab />}
        {section === "rewards" && (
          <div className="space-y-4">
            <RewardsTab />
            <DriverPenaltyRulesTab />
          </div>
        )}
        {section === "metrics" && <MetricsTab />}
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const visible = sections.filter((s) => {
    // Role filter pill
    if (roleFilter !== "all" && !s.roles.includes(roleFilter)) return false;
    // Only show modules the current user is allowed in
    if (!s.roles.some((r) => myRoles.includes(r))) return false;
    if (!q) return true;
    const hay = `${s.title} ${s.description} ${s.keywords.join(" ")}`.toLowerCase();
    return hay.includes(q);
  });

  const groups = Array.from(new Set(visible.map((s) => s.group)));
  const roleChips: { key: "all" | AdminRole; label: string }[] = [
    { key: "all", label: "Tous" },
    { key: "superadmin", label: "Super admin" },
    { key: "admin", label: "Admin" },
    { key: "support", label: "Support" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold">Panneau d'administration</h1>
        <p className="mt-1 text-sm text-muted-foreground">Pilotez la plateforme Tibus Ride depuis un seul endroit.</p>
      </div>

      {/* Search + filters toolbar */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une section, action ou page (utilisateurs, paiements, audit…)"
            className="h-11 pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {roleChips.map((r) => (
              <button
                key={r.key}
                onClick={() => setRoleFilter(r.key)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  roleFilter === r.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-accent"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Button variant={customizing ? "default" : "outline"} size="sm" onClick={() => setCustomizing((v) => !v)} className="gap-1.5">
            <Palette className="h-4 w-4" />
            {customizing ? "Terminer" : "Personnaliser les couleurs"}
          </Button>
        </div>
      </div>

      {visible.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          Aucun module ne correspond à votre recherche.
        </div>
      )}

      {groups.map((g) => (
        <section key={g} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{g}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.filter((s) => s.group === g).map((s) => {
              const Icon = s.icon;
              const c = getColors(s);
              const count = countOf(s);
              return (
                <div key={s.key} className={`relative rounded-2xl border ${c.bg} p-5 transition-all hover:-translate-y-0.5 hover:shadow-md`}>
                  <button
                    onClick={() => {
                      if (s.externalHref) {
                        window.open(s.externalHref, "_blank", "noopener,noreferrer");
                        return;
                      }
                      setSection(s.key);
                    }}
                    className="w-full text-left focus:outline-none"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className={`inline-flex h-12 w-12 items-center justify-center rounded-xl ${c.iconBg} shadow-sm`}>
                        <Icon className="h-6 w-6 text-white" />
                      </div>
                      {count !== null && count > 0 && (
                        <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-foreground shadow-sm backdrop-blur">
                          {count} {s.countLabel}
                        </span>
                      )}
                      {count === 0 && s.countLabel && (
                        <span className="rounded-full bg-white/60 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          0 {s.countLabel}
                        </span>
                      )}
                    </div>
                    <div className="mt-4 font-display text-lg font-semibold text-foreground">{s.title}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{s.description}</div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {s.roles.map((r) => (
                        <span key={r} className="rounded-md bg-white/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {r}
                        </span>
                      ))}
                    </div>
                  </button>
                  {customizing && (
                    <div className="mt-4 border-t border-white/60 pt-3">
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Couleur pastel</div>
                      <div className="flex flex-wrap gap-1.5">
                        {PASTEL_PALETTE.map((p) => {
                          const active = (colorOverrides[s.key]?.iconBg ?? PASTEL_PALETTE[s.defaultPalette]?.iconBg) === p.iconBg;
                          return (
                            <button
                              key={p.name}
                              title={p.name}
                              onClick={() => setSectionColor(s.key, p)}
                              className={`h-6 w-6 rounded-full border-2 ${p.iconBg} ${active ? "border-foreground" : "border-white/80"}`}
                            />
                          );
                        })}
                        <button
                          onClick={() => setSectionColor(s.key, null)}
                          className="rounded-md border border-border bg-white/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-white"
                        >
                          Défaut
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
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
      // Pas de FK directe driver_profiles.user_id -> profiles.id (les deux
      // référencent auth.users séparément), donc PostgREST ne peut pas faire
      // l'embed `profiles:user_id(...)` : la requête échouait silencieusement
      // (PGRST200, "no relationship found"), data restait vide -> "Aucun
      // partenaire." même quand des chauffeurs en attente existaient.
      // Fix : deux requêtes séparées + merge côté client.
      const { data: drivers, error } = await supabase
        .from("driver_profiles")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const userIds = (drivers ?? []).map((d: any) => d.user_id).filter(Boolean);
      let profilesById: Record<string, any> = {};
      if (userIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from("profiles")
          .select("id, full_name, phone, city")
          .in("id", userIds);
        if (profilesError) throw profilesError;
        profilesById = Object.fromEntries((profilesData ?? []).map((p: any) => [p.id, p]));
      }
      return (drivers ?? []).map((d: any) => ({ ...d, profiles: profilesById[d.user_id] ?? null }));
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
      type: PARTNER_TYPES.find((p) => p.value === d.partner_type)?.label ?? "",
      vehicule: VEHICLE_TYPES.find((v) => v.value === d.vehicle_type)?.label ?? "",
      ville: d.city ?? "",
      permis: d.license_number ?? "",
      categorie: d.assigned_category ?? "",
      controle_physique: d.physical_verified_at ? "oui" : "non",
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
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">Ville</th>
                <th className="px-4 py-3 text-left font-medium">Catégorie</th>
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
                  <td className="px-4 py-3">
                    <div className="text-xs">
                      {PARTNER_TYPES.find((p) => p.value === d.partner_type)?.label ?? "—"}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {VEHICLE_TYPES.find((v) => v.value === d.vehicle_type)?.label ?? ""}
                      {d.license_number ? ` · ${d.license_number}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3">{d.city ?? "—"}</td>
                  <td className="px-4 py-3 text-xs">
                    {d.assigned_category ?? "—"}
                    {d.physical_verified_at && (
                      <div className="text-[10px] text-success">Contrôle physique OK</div>
                    )}
                  </td>
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
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Aucun partenaire.</td></tr>
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
  const assignEnrollment = useServerFn(assignDriverEnrollment);
  const [nextStatus, setNextStatus] = useState<string>(driver.status);
  const [reason, setReason] = useState<string>(driver.rejection_reason ?? "");
  const [category, setCategory] = useState<string>(driver.assigned_category ?? "");
  const [physicalOk, setPhysicalOk] = useState(!!driver.physical_verified_at);
  const [notes, setNotes] = useState<string>(driver.enrollment_notes ?? "");

  const categories =
    driver.partner_type === "delivery"
      ? DELIVERY_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))
      : RIDE_CATEGORIES.map((c) => ({ value: c.value, label: c.label }));

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

  const saveEnrollment = useMutation({
    mutationFn: () =>
      assignEnrollment({
        data: {
          userId: driver.user_id,
          assigned_category: category || undefined,
          physical_verified: physicalOk,
          enrollment_notes: notes.trim() || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Contrôle physique et catégorie enregistrés");
      qc.invalidateQueries({ queryKey: ["admin-drivers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reasonRequired = nextStatus === "rejected" || nextStatus === "suspended";
  const partnerLabel = PARTNER_TYPES.find((p) => p.value === driver.partner_type)?.label;
  const vehicleLabel = VEHICLE_TYPES.find((v) => v.value === driver.vehicle_type)?.label;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{driver.profiles?.full_name ?? driver.user_id}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm">
            <div><span className="text-muted-foreground">Type :</span> {partnerLabel ?? "—"} · {vehicleLabel ?? "—"}</div>
            <div><span className="text-muted-foreground">Ville :</span> {driver.city ?? "—"} · <span className="text-muted-foreground">Permis :</span> {driver.license_number ?? "—"}</div>
            {(driver.vehicle_plate || driver.vehicle_model || driver.vehicle_color) && (
              <div><span className="text-muted-foreground">Véhicule :</span> {[driver.vehicle_model, driver.vehicle_color, driver.vehicle_plate].filter(Boolean).join(" · ")}</div>
            )}
          </div>

          <div className="rounded-xl border border-border p-3 space-y-3">
            <Label className="text-xs text-muted-foreground">Contrôle physique & catégorie</Label>
            <p className="text-xs text-muted-foreground">
              Après inspection du véhicule/moto sur place, cochez la vérification et assignez la catégorie avant d'approuver.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={physicalOk}
                onChange={(e) => setPhysicalOk(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Vérification physique effectuée
              {driver.physical_verified_at && (
                <span className="text-xs text-muted-foreground">
                  ({new Date(driver.physical_verified_at).toLocaleDateString("fr-FR")})
                </span>
              )}
            </label>
            <div>
              <Label className="text-xs">Catégorie assignée</Label>
              <Select value={category || "_none"} onValueChange={(v) => setCategory(v === "_none" ? "" : v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Choisir une catégorie" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Non assignée —</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Notes inspection</Label>
              <Textarea className="mt-1" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} placeholder="État carrosserie, équipements, conformité…" />
            </div>
            <Button size="sm" onClick={() => saveEnrollment.mutate()} disabled={saveEnrollment.isPending}>
              {saveEnrollment.isPending ? "Enregistrement…" : "Enregistrer contrôle & catégorie"}
            </Button>
          </div>

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
                  placeholder="Expliquez la décision…"
                />
              </div>
            )}
            {nextStatus === "approved" && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                L'approbation exige : permis + carte grise + photos véhicule, contrôle physique et catégorie assignée.
              </p>
            )}
            <div className="mt-3 flex justify-end">
              <Button
                onClick={async () => {
                  if (reasonRequired && !reason.trim()) {
                    toast.error("Un motif est requis.");
                    return;
                  }
                  // Le contrôle physique/catégorie/notes cochés ci-dessus ne sont
                  // que des brouillons locaux tant que "Enregistrer contrôle &
                  // catégorie" n'a pas été cliqué séparément — le serveur valide
                  // l'approbation sur les valeurs déjà persistées, pas sur ces
                  // brouillons. On les enregistre donc automatiquement avant
                  // d'appliquer un statut "approved", pour éviter une erreur
                  // déroutante alors que la case est visiblement cochée à l'écran.
                  if (nextStatus === "approved") {
                    try {
                      await saveEnrollment.mutateAsync();
                    } catch (e) {
                      toast.error((e as Error).message);
                      return;
                    }
                  }
                  status.mutate({ status: nextStatus, reason: reasonRequired ? reason.trim() : undefined });
                }}
                disabled={status.isPending || saveEnrollment.isPending}
              >
                {status.isPending || saveEnrollment.isPending ? "Mise à jour…" : "Appliquer le statut"}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-xs text-muted-foreground">Documents d'enrôlement</Label>
            <DocRow driver={driver} kind="license" label="Permis de conduire" pathOrUrl={driver.license_document_url} />
            <DocRow driver={driver} kind="vehicle" label="Carte grise" pathOrUrl={driver.vehicle_document_url} />
            <DocRow driver={driver} kind="vehicle_condition" label="État véhicule / moto" pathOrUrl={driver.vehicle_condition_url} />
            <DocRow driver={driver} kind="id" label="Pièce d'identité (optionnel)" pathOrUrl={driver.id_document_url} />
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
  kind: "id" | "license" | "vehicle" | "vehicle_condition";
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
  const { user: me, hasRole: hasAuthRole } = useAuth();
  const isSuperadmin = hasAuthRole("superadmin");
  const list = useServerFn(listUsers);
  const banFn = useServerFn(setUserBanned);
  const roleFn = useServerFn(setUserRole);
  const countryFn = useServerFn(setUserCountry);
  const countryAdminFn = useServerFn(promoteCountryAdmin);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [countryAdminUser, setCountryAdminUser] = useState<any | null>(null);
  const [countryAdminValue, setCountryAdminValue] = useState<string>(ADMIN_COUNTRIES[0]);

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
    mutationFn: (v: { userId: string; role: "superadmin" | "admin" | "driver" | "passenger" | "support" | "insurer"; grant: boolean }) => roleFn({ data: v }),
    onSuccess: () => {
      toast.success("Rôle mis à jour");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const country = useMutation({
    mutationFn: (v: { userId: string; country: string | null }) => countryFn({ data: v }),
    onSuccess: () => {
      toast.success("Pays du profil mis à jour");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const countryAdmin = useMutation({
    mutationFn: (v: { userId: string; country: string }) => countryAdminFn({ data: v }),
    onSuccess: (_d, v) => {
      toast.success(`Admin pays nommé pour ${v.country}`);
      setCountryAdminUser(null);
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
      if (countryFilter !== "all") {
        if (!u.roles.includes("admin") && !u.roles.includes("support")) return false;
        const c = u.profile?.country ?? null;
        if (countryFilter === "__none" ? c !== null : !countriesMatch(c, countryFilter)) return false;
      }
      const isBanned = u.banned_until && new Date(u.banned_until) > new Date();
      if (statusFilter === "active" && isBanned) return false;
      if (statusFilter === "banned" && !isBanned) return false;
      return true;
    });
  }, [data, q, roleFilter, statusFilter, countryFilter]);

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
      {isSuperadmin && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          Rôles, mots de passe et admins pays → menu <strong>Rôles & permissions</strong> (accueil admin).
        </div>
      )}
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
              <SelectItem value="superadmin">Superadmin</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="support">Support</SelectItem>
              <SelectItem value="driver">Chauffeur</SelectItem>
              <SelectItem value="passenger">Passager</SelectItem>
              <SelectItem value="insurer">Assureur</SelectItem>
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
        <div>
          <Label className="text-xs text-muted-foreground">Pays (profil)</Label>
          <Select value={countryFilter} onValueChange={setCountryFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              <SelectItem value="__none">Sans pays</SelectItem>
              {ADMIN_COUNTRIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
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
                <th className="px-4 py-3 text-left font-medium">Pays (profil)</th>
                <th className="px-4 py-3 text-left font-medium">Dernière connexion</th>
                <th className="px-4 py-3 text-left font-medium">Statut</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Chargement…</td></tr>}
              {!isLoading && filtered.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Aucun utilisateur.</td></tr>}
              {filtered.map((u: any) => {
                const isBanned = u.banned_until && new Date(u.banned_until) > new Date();
                const isSelf = u.id === me?.id;
                const hasSuper = u.roles.includes("superadmin");
                const hasAdmin = u.roles.includes("admin");
                const hasSupport = u.roles.includes("support");
                const hasDriver = u.roles.includes("driver");
                const hasPassenger = u.roles.includes("passenger");
                const hasInsurer = u.roles.includes("insurer");
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
                          <span
                            key={r}
                            className={
                              r === "superadmin"
                                ? "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-500/20 dark:text-amber-300"
                                : "rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                            }
                          >{r}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {hasSuper ? (
                        <span className="text-xs text-muted-foreground italic">Global (superadmin)</span>
                      ) : isSuperadmin ? (
                        <Select
                          value={u.profile?.country ?? "__none"}
                          onValueChange={(v) => country.mutate({ userId: u.id, country: v === "__none" ? null : v })}
                        >
                          <SelectTrigger className="w-[170px] h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">— Aucun —</SelectItem>
                            {ADMIN_COUNTRIES.map((c) => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs">{u.profile?.country ?? "—"}</span>
                      )}
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
                        {!isSuperadmin && !isSelf && (hasAdmin
                          ? <Button size="sm" variant="outline" onClick={() => role.mutate({ userId: u.id, role: "admin", grant: false })}><ShieldOff className="h-3.5 w-3.5 mr-1" />Retirer admin</Button>
                          : null
                        )}
                        {!isSuperadmin && !isSelf && (hasSupport
                          ? <Button size="sm" variant="outline" onClick={() => role.mutate({ userId: u.id, role: "support", grant: false })}>Retirer support</Button>
                          : <Button size="sm" variant="outline" onClick={() => role.mutate({ userId: u.id, role: "support", grant: true })}>Promouvoir support</Button>
                        )}
                        {!isSuperadmin && (hasDriver
                          ? <Button size="sm" variant="outline" onClick={() => role.mutate({ userId: u.id, role: "driver", grant: false })}>Retirer chauffeur</Button>
                          : <Button size="sm" variant="outline" onClick={() => role.mutate({ userId: u.id, role: "driver", grant: true })}>Promouvoir chauffeur</Button>
                        )}
                        {!isSuperadmin && (hasPassenger
                          ? <Button size="sm" variant="outline" onClick={() => role.mutate({ userId: u.id, role: "passenger", grant: false })}>Retirer passager</Button>
                          : <Button size="sm" variant="outline" onClick={() => role.mutate({ userId: u.id, role: "passenger", grant: true })}>Ajouter passager</Button>
                        )}
                        {!isSuperadmin && !isSelf && (hasInsurer
                          ? <Button size="sm" variant="outline" onClick={() => role.mutate({ userId: u.id, role: "insurer", grant: false })}>Retirer assureur</Button>
                          : <Button size="sm" variant="outline" onClick={() => role.mutate({ userId: u.id, role: "insurer", grant: true })}>Promouvoir assureur</Button>
                        )}
                        {!isSelf && (isBanned
                          ? <Button size="sm" onClick={() => ban.mutate({ userId: u.id, banned: false })}><Unlock className="h-3.5 w-3.5 mr-1" />Déverrouiller</Button>
                          : <Button size="sm" variant="destructive" onClick={() => askBan(u)}><Lock className="h-3.5 w-3.5 mr-1" />Bloquer</Button>
                        )}
                        {isSuperadmin && !isSelf && !hasSuper && !hasAdmin && (
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => {
                              setCountryAdminUser(u);
                              setCountryAdminValue(u.profile?.country && ADMIN_COUNTRIES.includes(u.profile.country as any)
                                ? u.profile.country
                                : ADMIN_COUNTRIES[0]);
                            }}
                          >
                            <ShieldCheck className="h-3.5 w-3.5 mr-1" />Admin pays
                          </Button>
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

      <Dialog open={!!countryAdminUser} onOpenChange={(o) => !o && setCountryAdminUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nommer admin pays</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {countryAdminUser?.profile?.full_name ?? countryAdminUser?.email} recevra le rôle <strong>admin</strong> et le pays sélectionné.
          </p>
          <div>
            <Label>Pays</Label>
            <Select value={countryAdminValue} onValueChange={setCountryAdminValue}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ADMIN_COUNTRIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCountryAdminUser(null)}>Annuler</Button>
            <Button
              onClick={() => countryAdminUser && countryAdmin.mutate({ userId: countryAdminUser.id, country: countryAdminValue })}
              disabled={countryAdmin.isPending}
            >
              Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  const usersFn = useServerFn(listUsers);
  const [q, setQ] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [onlyCountryEvents, setOnlyCountryEvents] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-audit"],
    queryFn: () => list(),
  });

  const { data: users } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => usersFn(),
  });

  const userCountryMap = useMemo(() => {
    const m = new Map<string, string | null>();
    (users ?? []).forEach((u: any) => m.set(u.id, u.profile?.country ?? null));
    return m;
  }, [users]);


  const COUNTRY_EVENT_ACTIONS = new Set([
    "user.country.set",
    "user.ban",
    "user.unban",
    "user.password.reset",
    "role.grant",
    "role.revoke",
    "driver.status.pending",
    "driver.status.under_review",
    "driver.status.approved",
    "driver.status.rejected",
    "driver.status.suspended",
    "driver.document.upload",
  ]);

  const actions = useMemo(() => {
    const set = new Set<string>();
    (data ?? []).forEach((l: any) => set.add(l.action));
    return Array.from(set).sort();
  }, [data]);

  const filtered = useMemo(() => {
    return (data ?? []).filter((l: any) => {
      if (actionFilter !== "all" && l.action !== actionFilter) return false;
      if (onlyCountryEvents && !COUNTRY_EVENT_ACTIONS.has(l.action)) return false;
      if (countryFilter !== "all") {
        const actorC = l.actor_id ? userCountryMap.get(l.actor_id) ?? null : null;
        const targetC =
          (l.target_type === "user" || l.target_type === "driver") && l.target_id
            ? userCountryMap.get(l.target_id) ?? null
            : null;
        const detailsC =
          l.details && typeof l.details === "object" ? ((l.details as any).country ?? null) : null;
        const match =
          countryFilter === "__none"
            ? actorC === null && targetC === null && detailsC === null
            : actorC === countryFilter || targetC === countryFilter || detailsC === countryFilter;
        if (!match) return false;
      }
      if (q) {
        const s = q.toLowerCase();
        const hay = `${l.actor_email ?? ""} ${l.target_label ?? ""} ${l.target_id ?? ""} ${JSON.stringify(l.details ?? {})}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [data, q, actionFilter, countryFilter, onlyCountryEvents, userCountryMap]);

  const exportCsv = () => {
    const rows = filtered.map((l: any) => ({
      date: l.created_at,
      action: l.action,
      acteur: l.actor_email ?? l.actor_id,
      acteur_pays: l.actor_id ? userCountryMap.get(l.actor_id) ?? "" : "",
      cible_type: l.target_type ?? "",
      cible: l.target_label ?? l.target_id ?? "",
      cible_pays: l.target_id ? userCountryMap.get(l.target_id) ?? "" : "",
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
        <div>
          <Label className="text-xs text-muted-foreground">Pays</Label>
          <Select value={countryFilter} onValueChange={setCountryFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              <SelectItem value="__none">Sans pays</SelectItem>
              {ADMIN_COUNTRIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant={onlyCountryEvents ? "default" : "outline"}
          onClick={() => setOnlyCountryEvents((v) => !v)}
          size="sm"
        >
          Événements pays
        </Button>
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
        Définissez les tarifs de base (prise en charge, /km, /min) de chaque catégorie. Ces valeurs sont la base du{" "}
        <strong>tarif dynamique</strong> (majoration trafic + météo, réglée juste en dessous) — c'est le calcul
        effectivement appliqué au passager. La <strong>commission</strong> appliquée à chaque course n'est plus
        définie ici ni par catégorie : elle est désormais entièrement pilotée par le programme de marché actif
        (onglet « Programmes de marché »), qui a toujours priorité sur les anciens réglages par catégorie.
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
                          commission_type: row.commission_type ?? "percent",
                          commission_rate: Number(row.commission_rate ?? 0),
                          commission_flat_xof: Number(row.commission_flat_xof ?? 0),
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
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  Aucune catégorie configurée.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <DeliveryPricingSection />
      <DeliveryPackagePricingSection />
      <DeliveryExtrasPricingSection />
      <DynamicPricingSection />
    </div>
  );
}

/* -------------------- Tarifs livraison (moto, tricycle, cargo…) -------------------- */

function DeliveryPricingSection() {
  const qc = useQueryClient();
  const listFn = useServerFn(listDeliveryPricingSettings);
  const updateFn = useServerFn(updateDeliveryPricingSetting);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "delivery-pricing"],
    queryFn: () => listFn({}),
  });
  const [drafts, setDrafts] = useState<Record<string, any>>({});

  const mutation = useMutation({
    mutationFn: (payload: any) => updateFn({ data: payload }),
    onSuccess: (_d, vars: any) => {
      toast.success(`Tarifs ${DELIVERY_VEHICLES[vars._vehicle as DeliveryVehicle]?.label ?? ""} mis à jour`);
      setDrafts((d) => {
        const { [vars.id]: _, ...rest } = d;
        return rest;
      });
      qc.invalidateQueries({ queryKey: ["admin", "delivery-pricing"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur de mise à jour"),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  const rows = (data ?? []) as any[];

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Tarifs des <strong>livraisons</strong> (deux-roues, moto, tricycle, voiture, fourgon). Même logique que les
        courses : prise en charge + /km + /min + tarif minimum, et commission par défaut.
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Véhicule</th>
              <th className="px-3 py-2 text-right">Prise en charge</th>
              <th className="px-3 py-2 text-right">Prix / km</th>
              <th className="px-3 py-2 text-right">Prix / min</th>
              <th className="px-3 py-2 text-right">Tarif min</th>
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
              const label = DELIVERY_VEHICLES[row.vehicle as DeliveryVehicle]?.label ?? row.vehicle;
              const emoji = DELIVERY_VEHICLES[row.vehicle as DeliveryVehicle]?.emoji ?? "";
              return (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{emoji} {label}</td>
                  <td className="px-3 py-2 text-right">{numInput("base_fare_xof")}</td>
                  <td className="px-3 py-2 text-right">{numInput("per_km_xof", 10)}</td>
                  <td className="px-3 py-2 text-right">{numInput("per_min_xof", 5)}</td>
                  <td className="px-3 py-2 text-right">{numInput("min_fare_xof")}</td>
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
                          _vehicle: row.vehicle,
                          id: row.id,
                          base_fare_xof: Number(current.base_fare_xof),
                          per_km_xof: Number(current.per_km_xof),
                          per_min_xof: Number(current.per_min_xof),
                          min_fare_xof: Number(current.min_fare_xof),
                          commission_type: row.commission_type ?? "percent",
                          commission_rate: Number(row.commission_rate ?? 0),
                          commission_flat_xof: Number(row.commission_flat_xof ?? 0),
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
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  Aucun véhicule de livraison configuré.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------- Types de colis (multiplicateur prix) -------------------- */
function DeliveryPackagePricingSection() {
  const qc = useQueryClient();
  const listFn = useServerFn(listDeliveryPackagePricing);
  const updateFn = useServerFn(updateDeliveryPackagePricing);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "delivery-package-pricing"],
    queryFn: () => listFn({}),
  });
  const [drafts, setDrafts] = useState<Record<string, any>>({});

  const mutation = useMutation({
    mutationFn: (payload: any) => updateFn({ data: payload }),
    onSuccess: (_d, vars: any) => {
      toast.success(`Type de colis ${PACKAGE_TYPES[vars._packageType as PackageType]?.label ?? ""} mis à jour`);
      setDrafts((d) => {
        const { [vars.id]: _, ...rest } = d;
        return rest;
      });
      qc.invalidateQueries({ queryKey: ["admin", "delivery-package-pricing"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur de mise à jour"),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  const rows = (data ?? []) as any[];

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Multiplicateur de prix selon le <strong>type de colis</strong> (appliqué au sous-total base + km + min de la livraison).
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Type de colis</th>
              <th className="px-3 py-2 text-right">Multiplicateur</th>
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
              const def = PACKAGE_TYPES[row.package_type as PackageType];
              return (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">
                    {def?.emoji ?? ""} {def?.label ?? row.package_type}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number" step={0.05} min={1} max={5}
                      className="h-8 w-24 text-right"
                      value={current.multiplier ?? 1}
                      onChange={(e) => setField("multiplier", Number(e.target.value))}
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
                          _packageType: row.package_type,
                          id: row.id,
                          multiplier: Number(current.multiplier ?? 1),
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
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  Aucun type de colis configuré.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------- Frais supplémentaires livraison (urgence, sac isotherme) -------------------- */
function DeliveryExtrasPricingSection() {
  const qc = useQueryClient();
  const listFn = useServerFn(listDeliveryExtrasPricing);
  const updateFn = useServerFn(updateDeliveryExtrasPricing);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "delivery-extras-pricing"],
    queryFn: () => listFn({}),
  });
  const [drafts, setDrafts] = useState<Record<string, any>>({});

  const extraLabel = (key: string) =>
    key === "urgent" ? DELIVERY_EXTRAS.urgent.label : key === "insulated_bag" ? DELIVERY_EXTRAS.insulated_bag.label : key;

  const mutation = useMutation({
    mutationFn: (payload: any) => updateFn({ data: payload }),
    onSuccess: (_d, vars: any) => {
      toast.success(`Frais "${extraLabel(vars._extraKey)}" mis à jour`);
      setDrafts((d) => {
        const { [vars.id]: _, ...rest } = d;
        return rest;
      });
      qc.invalidateQueries({ queryKey: ["admin", "delivery-extras-pricing"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur de mise à jour"),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  const rows = (data ?? []) as any[];

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Frais additionnels livraison : montant fixe (XOF) + pourcentage appliqué au sous-total (ex. urgence = forfait + % du sous-total).
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Option</th>
              <th className="px-3 py-2 text-right">Forfait (XOF)</th>
              <th className="px-3 py-2 text-right">% du sous-total</th>
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
              return (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{extraLabel(row.extra_key)}</td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number" step={50} min={0}
                      className="h-8 w-24 text-right"
                      value={current.fee_xof ?? 0}
                      onChange={(e) => setField("fee_xof", Number(e.target.value))}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number" step={1} min={0} max={200}
                      className="h-8 w-20 text-right"
                      value={current.percent_extra ?? 0}
                      onChange={(e) => setField("percent_extra", Number(e.target.value))}
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
                          _extraKey: row.extra_key,
                          id: row.id,
                          fee_xof: Number(current.fee_xof ?? 0),
                          percent_extra: Number(current.percent_extra ?? 0),
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
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  Aucun frais supplémentaire configuré.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------- Tarif dynamique (trafic + météo) -------------------- */
function DynamicPricingSection() {
  const qc = useQueryClient();
  const listFn = useServerFn(listDynamicPricingSettings);
  const updateFn = useServerFn(updateDynamicPricingSetting);
  const createFn = useServerFn(createDynamicPricingSetting);
  const deleteFn = useServerFn(deleteDynamicPricingSetting);
  const listProgramsFn = useServerFn(listMarketPrograms);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "dynamic-pricing"],
    queryFn: () => listFn({}),
  });
  // Réservé au superadmin côté serveur — un admin pays n'aura simplement pas
  // d'options de programme pour ajouter une dérogation (il peut toujours
  // éditer la ligne globale ci-dessous).
  const programsQ = useQuery({
    queryKey: ["admin", "market-programs", "for-dynamic-pricing"],
    queryFn: () => listProgramsFn({}),
    retry: false,
  });

  const [drafts, setDrafts] = useState<Record<string, any>>({});
  const [newProgramId, setNewProgramId] = useState<string>("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "dynamic-pricing"] });

  const mutation = useMutation({
    mutationFn: (payload: any) => updateFn({ data: payload }),
    onSuccess: (_d, vars: any) => {
      toast.success("Coefficients mis à jour");
      setDrafts((d) => {
        const { [vars.id]: _, ...rest } = d;
        return rest;
      });
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur de mise à jour"),
  });
  const createMut = useMutation({
    mutationFn: (programId: string) => createFn({ data: { programId } }),
    onSuccess: () => { toast.success("Dérogation programme ajoutée"); setNewProgramId(""); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Dérogation supprimée"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  const rows = (data ?? []) as any[];
  const programOptions = ((programsQ.data ?? []) as any[]).filter(
    (p) => !rows.some((r) => r.program_id === p.program_id),
  );

  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-display text-lg font-bold">Tarif dynamique (trafic + météo)</h2>
        <p className="text-xs text-muted-foreground">
          Coefficients appliqués en plus du tarif de base ci-dessus selon le trafic live et la météo.
          La ligne <strong>globale</strong> s'applique partout sauf si une dérogation existe pour le programme
          du passager (white-label).
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Programme</th>
              <th className="px-3 py-2 text-right">Coef. trafic</th>
              <th className="px-3 py-2 text-right">Plafond trafic</th>
              <th className="px-3 py-2 text-right">Météo pluie ×</th>
              <th className="px-3 py-2 text-right">Météo nuage ×</th>
              <th className="px-3 py-2 text-right">Arrondi (XOF)</th>
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
              const numInput = (k: string, step = 0.01) => (
                <Input
                  type="number"
                  step={step}
                  className="h-8 w-24 text-right"
                  value={current[k] ?? 0}
                  onChange={(e) => setField(k, Number(e.target.value))}
                />
              );
              const label = row.program_id
                ? row.market_programs?.display_name ?? row.program_id
                : "Défaut global";
              return (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{label}</td>
                  <td className="px-3 py-2 text-right">{numInput("traffic_coefficient")}</td>
                  <td className="px-3 py-2 text-right">{numInput("traffic_ratio_cap")}</td>
                  <td className="px-3 py-2 text-right">{numInput("weather_rainy_multiplier")}</td>
                  <td className="px-3 py-2 text-right">{numInput("weather_cloudy_multiplier")}</td>
                  <td className="px-3 py-2 text-right">{numInput("rounding_increment_xof", 10)}</td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={!!current.active}
                      onChange={(e) => setField("active", e.target.checked)}
                    />
                  </td>
                  <td className="px-3 py-2 text-right space-x-2">
                    <Button
                      size="sm"
                      disabled={!dirty || mutation.isPending}
                      onClick={() =>
                        mutation.mutate({
                          id: row.id,
                          traffic_coefficient: Number(current.traffic_coefficient),
                          traffic_ratio_cap: Number(current.traffic_ratio_cap),
                          weather_rainy_multiplier: Number(current.weather_rainy_multiplier),
                          weather_cloudy_multiplier: Number(current.weather_cloudy_multiplier),
                          weather_sunny_multiplier: Number(current.weather_sunny_multiplier ?? 1),
                          rounding_increment_xof: Number(current.rounding_increment_xof),
                          active: !!current.active,
                        })
                      }
                    >
                      Enregistrer
                    </Button>
                    {row.program_id && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={deleteMut.isPending}
                        onClick={() => deleteMut.mutate(row.id)}
                      >
                        Supprimer
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {programOptions.length > 0 && (
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-3">
          <div className="flex-1">
            <Label className="text-xs">Ajouter une dérogation pour un programme</Label>
            <Select value={newProgramId} onValueChange={setNewProgramId}>
              <SelectTrigger><SelectValue placeholder="Choisir un programme" /></SelectTrigger>
              <SelectContent>
                {programOptions.map((p) => (
                  <SelectItem key={p.program_id} value={p.program_id}>
                    {p.display_name} ({p.country})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            disabled={!newProgramId || createMut.isPending}
            onClick={() => createMut.mutate(newProgramId)}
          >
            Ajouter
          </Button>
        </div>
      )}
    </div>
  );
}

/* -------------------- Commission schedules (period overrides) — RÉVOQUÉ --------------------
 * Ancien panneau "Commissions planifiées" : règles de commission par catégorie (sans program_id),
 * jamais réellement appliquées car la commission effective est désormais entièrement pilotée par
 * le programme de marché actif (commission_default + resolve_program_commission). Conservé en
 * commentaire de référence ; supprimer plus tard si inutile.
 */


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

// Helpers de bucketing par période partagés avec le rapport personnel
// chauffeur (driver.tsx) — voir src/lib/reporting.ts.

function CommissionReportTab() {
  const reportFn = useServerFn(commissionReport);
  const { hasRole: hasAuthRole } = useAuth();
  const isSuperadmin = hasAuthRole("superadmin");
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState(monthStart.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [category, setCategory] = useState<string>("all");
  const [driverId, setDriverId] = useState("");
  // Filtres KPI par pays/programme. Un admin pays reste cantonné à son pays
  // côté serveur de toute façon (voir scope renvoyé par commissionReport) —
  // ces sélecteurs ne lui servent qu'à filtrer par programme.
  const [country, setCountry] = useState<string>("all");
  const [programId, setProgramId] = useState<string>("all");
  const [programs, setPrograms] = useState<MarketProgramConfig[]>([]);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [granularity, setGranularity] = useState<ReportGranularity>("day");

  const run = async (overrides?: { country?: string; programId?: string }) => {
    const effCountry = overrides?.country ?? country;
    const effProgramId = overrides?.programId ?? programId;
    setLoading(true);
    try {
      const r = await reportFn({
        data: {
          from: new Date(from + "T00:00:00").toISOString(),
          to: new Date(to + "T23:59:59").toISOString(),
          category: category === "all" ? null : (category as any),
          driver_id: driverId.trim() || null,
          country: effCountry === "all" ? null : effCountry,
          program_id: effProgramId === "all" ? null : effProgramId,
        } as any,
      });
      setResult(r);
      // Admin pays : le serveur impose son propre pays quel que soit ce qui a
      // été envoyé — on aligne le sélecteur dessus pour ne pas afficher un
      // pays différent de celui dont les données sont réellement affichées.
      if (r?.scope && !r.scope.isSuper && r.scope.country) {
        setCountry(r.scope.country);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
    } finally {
      setLoading(false);
    }
  };

  // Recharge la liste des programmes disponibles quand le pays change (le
  // filtre programme dépend du pays — RPC list_market_programs le requiert).
  useEffect(() => {
    if (country === "all") {
      setPrograms([]);
      return;
    }
    let cancelled = false;
    fetchMarketPrograms(country).then((list) => {
      if (!cancelled) setPrograms(list);
    });
    return () => { cancelled = true; };
  }, [country]);

  const buildDetailRows = (rows: any[]) =>
    rows.map((r: any) => ({
      date: r.completed_at,
      categorie: CATEGORY_LABEL[r.category] ?? r.category,
      chauffeur: r.driver_name ?? r.driver_id ?? "",
      pays: r.country ?? "",
      ville: r.city,
      programme: r.program_id ?? "",
      depart: r.pickup_address,
      arrivee: r.dropoff_address,
      montant_xof: r.price_xof ?? 0,
      taux_commission: r.commission_rate ?? "",
      commission_xof: r.commission_xof ?? 0,
      bonus_xof: r.bonus_xof ?? 0,
      part_chauffeur_xof: r.driver_earnings_xof ?? 0,
    }));

  const exportRows = () => {
    if (!result) return;
    downloadCsv(`commissions-${from}_${to}.csv`, buildDetailRows(result.rows));
  };

  const exportSummary = () => {
    if (!result) return;
    const byCat = result.byCategory.map((c: any) => ({
      type: "categorie",
      cle: CATEGORY_LABEL[c.category] ?? c.category,
      courses: c.rides,
      ca_xof: c.revenue_xof,
      commission_xof: c.commission_xof,
      bonus_xof: c.bonus_xof ?? 0,
    }));
    const byDrv = result.byDriver.map((d: any) => ({
      type: "chauffeur",
      cle: d.driver_name ?? d.driver_id,
      courses: d.rides,
      ca_xof: d.revenue_xof,
      commission_xof: d.commission_xof,
      bonus_xof: d.bonus_xof ?? 0,
    }));
    downloadCsv(`commissions-synthese-${from}_${to}.csv`, [...byCat, ...byDrv]);
  };

  const downloadFullHistory = async () => {
    setHistoryLoading(true);
    try {
      const r = await reportFn({
        data: {
          from: new Date("2000-01-01T00:00:00").toISOString(),
          to: new Date().toISOString(),
          category: null,
          driver_id: null,
          country: country === "all" ? null : country,
          program_id: programId === "all" ? null : programId,
        } as any,
      });
      if (!r.rows.length) {
        toast.info("Aucune course terminée trouvée");
        return;
      }
      downloadCsv(`historique-complet-${new Date().toISOString().slice(0, 10)}.csv`, buildDetailRows(r.rows));
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
    } finally {
      setHistoryLoading(false);
    }
  };

  const series = result ? buildPeriodSeries(result.rows, granularity) : [];

  // Charge automatiquement le rapport du mois en cours à l'ouverture de
  // l'onglet, pour ne pas obliger l'admin à cliquer "Générer" avant de voir
  // les blocs (graphique, détail, totaux).
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Suivi financier KPI de la plateforme : revenus par période avec graphique, détail de chaque
        course (montant, commission, bonus) et historique complet téléchargeable.
      </div>
      <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-4 lg:grid-cols-7">
        <div>
          <Label className="text-xs">Du</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Au</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Pays</Label>
          <Select
            value={country}
            onValueChange={(v) => { setCountry(v); setProgramId("all"); }}
            disabled={!isSuperadmin}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {isSuperadmin && <SelectItem value="all">Tous</SelectItem>}
              {ADMIN_COUNTRIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Programme</Label>
          <Select value={programId} onValueChange={setProgramId} disabled={country === "all"}>
            <SelectTrigger><SelectValue placeholder={country === "all" ? "Choisir un pays" : undefined} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              {programs.map((p) => (
                <SelectItem key={p.programId} value={p.programId}>{p.displayName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          <Button onClick={() => run()} disabled={loading} className="w-full">{loading ? "Calcul…" : "Générer"}</Button>
        </div>
      </div>

      {loading && !result && (
        <p className="text-sm text-muted-foreground">Chargement du rapport…</p>
      )}

      {result && result.rows.length === 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          Aucune course terminée sur cette période. Élargissez la plage de dates ou retirez le filtre catégorie/chauffeur.
        </div>
      )}

      {result && (
        <>
          <div className="grid gap-4 sm:grid-cols-5">
            <Metric label="Courses" value={String(result.totals.rides)} />
            <Metric label="Chiffre d'affaires" value={formatXof(result.totals.revenue_xof)} />
            <Metric label="Commission plateforme" value={formatXof(result.totals.commission_xof)} highlight />
            <Metric label="Bonus chauffeurs" value={formatXof(result.totals.bonus_xof ?? 0)} />
            <Metric label="Part chauffeurs" value={formatXof(result.totals.driver_earnings_xof)} />
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-medium uppercase text-muted-foreground">Revenus par période</div>
              <div className="flex gap-1">
                {(["day", "week", "month"] as ReportGranularity[]).map((g) => (
                  <Button
                    key={g}
                    size="sm"
                    variant={granularity === g ? "default" : "outline"}
                    onClick={() => setGranularity(g)}
                  >
                    {g === "day" ? "Jour" : g === "week" ? "Semaine" : "Mois"}
                  </Button>
                ))}
              </div>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => formatXof(v)} />
                  <Legend />
                  <Bar dataKey="ca_xof" name="Chiffre d'affaires" fill="var(--chart-1, var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="commission_xof" name="Commission" fill="var(--chart-2, var(--accent))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="bonus_xof" name="Bonus" fill="var(--chart-3, var(--warning))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 text-xs font-medium uppercase text-muted-foreground">Évolution des montants (courbe)</div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => formatXof(v)} />
                  <Legend />
                  <Line type="monotone" dataKey="ca_xof" name="Chiffre d'affaires" stroke="var(--chart-1, var(--primary))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="commission_xof" name="Commission" stroke="var(--chart-2, var(--accent))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="bonus_xof" name="Bonus" stroke="var(--chart-3, var(--warning))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportRows}><Download className="h-4 w-4 mr-2" />Détail (CSV)</Button>
            <Button variant="outline" onClick={exportSummary}><Download className="h-4 w-4 mr-2" />Synthèse (CSV)</Button>
            <Button variant="outline" onClick={downloadFullHistory} disabled={historyLoading}>
              <Download className="h-4 w-4 mr-2" />{historyLoading ? "Préparation…" : "Historique complet (CSV)"}
            </Button>
          </div>

          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="bg-muted/40 px-4 py-2 text-xs font-medium uppercase">Détail des courses (montant, commission, bonus)</div>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground"><tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Catégorie</th>
                  <th className="px-3 py-2 text-left">Chauffeur</th>
                  <th className="px-3 py-2 text-right">Montant</th>
                  <th className="px-3 py-2 text-right">Commission</th>
                  <th className="px-3 py-2 text-right">Bonus</th>
                </tr></thead>
                <tbody>
                  {result.rows.map((r: any) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-3 py-2 whitespace-nowrap">{r.completed_at ? new Date(r.completed_at).toLocaleString("fr-FR") : "—"}</td>
                      <td className="px-3 py-2">{CATEGORY_LABEL[r.category] ?? r.category}</td>
                      <td className="px-3 py-2">{r.driver_name ?? r.driver_id?.slice(0, 8) ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{formatXof(r.price_xof ?? 0)}</td>
                      <td className="px-3 py-2 text-right text-primary">{formatXof(r.commission_xof ?? 0)}</td>
                      <td className="px-3 py-2 text-right text-warning">{formatXof(r.bonus_xof ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                  <th className="px-3 py-2 text-right">Bonus</th>
                </tr></thead>
                <tbody>
                  {result.byCategory.map((c: any) => (
                    <tr key={c.category} className="border-t border-border">
                      <td className="px-3 py-2">{CATEGORY_LABEL[c.category] ?? c.category}</td>
                      <td className="px-3 py-2 text-right">{c.rides}</td>
                      <td className="px-3 py-2 text-right">{formatXof(c.revenue_xof)}</td>
                      <td className="px-3 py-2 text-right font-medium text-primary">{formatXof(c.commission_xof)}</td>
                      <td className="px-3 py-2 text-right text-warning">{formatXof(c.bonus_xof ?? 0)}</td>
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
                    <th className="px-3 py-2 text-right">Bonus</th>
                  </tr></thead>
                  <tbody>
                    {result.byDriver.map((d: any) => (
                      <tr key={d.driver_id} className="border-t border-border">
                        <td className="px-3 py-2">{d.driver_name ?? d.driver_id?.slice(0, 8)}</td>
                        <td className="px-3 py-2 text-right">{d.rides}</td>
                        <td className="px-3 py-2 text-right">{formatXof(d.revenue_xof)}</td>
                        <td className="px-3 py-2 text-right font-medium text-primary">{formatXof(d.commission_xof)}</td>
                        <td className="px-3 py-2 text-right text-warning">{formatXof(d.bonus_xof ?? 0)}</td>
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

// ============ Assurance : validation des dossiers / renouvellements ============
function insuranceStatusClass(status: string) {
  if (status === "verified") return "border-success/40 bg-success/10 text-success";
  if (status === "expired") return "border-destructive/40 bg-destructive/10 text-destructive";
  return "border-warning/40 bg-warning/10 text-warning";
}

function InsuranceTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | InsuranceStatus>("all");
  const listFn = useServerFn(listInsuredDrivers);
  const verifyFn = useServerFn(verifyDriverInsurance);
  const signedUrlFn = useServerFn(getInsuranceDocumentSignedUrl);

  const q = useQuery({
    queryKey: ["admin", "insured-drivers"],
    refetchInterval: 30000,
    queryFn: () => listFn(),
  });

  const verify = useMutation({
    mutationFn: (driverId: string) => verifyFn({ data: { driverId } }),
    onSuccess: () => {
      toast.success("Assurance validée");
      qc.invalidateQueries({ queryKey: ["admin", "insured-drivers"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  const viewDoc = useMutation({
    mutationFn: (driverId: string) => signedUrlFn({ data: { driverId } }),
    onSuccess: (r: any) => window.open(r.url, "_blank", "noopener,noreferrer"),
    onError: (e: any) => toast.error(e?.message ?? "Document introuvable"),
  });

  const drivers = ((q.data ?? []) as any[]).filter((d) => filter === "all" || d.insurance_status === filter);

  return (
    <div className="space-y-4 pt-4">
      <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Dossiers d'assurance des chauffeurs : <strong>en attente</strong> (première soumission ou renouvellement),
        <strong> validés</strong>, ou <strong>expirés</strong>. Consultez le document avant de valider un
        renouvellement.
      </div>
      <div className="flex flex-wrap gap-2">
        {(["all", "pending", "verified", "expired"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f === "all" ? "Tous" : INSURANCE_STATUS_LABEL[f]}
          </Button>
        ))}
        <span className="ml-auto self-center text-xs text-muted-foreground">{drivers.length} dossier(s)</span>
      </div>
      <div className="space-y-2">
        {q.isLoading && <div className="text-sm text-muted-foreground">Chargement…</div>}
        {!q.isLoading && drivers.length === 0 && (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            Aucun chauffeur assuré dans cette catégorie.
          </div>
        )}
        {drivers.map((d) => (
          <div key={d.user_id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-4">
            <div className="min-w-0 space-y-1">
              <div className="font-medium">{d.full_name ?? "Sans nom"}</div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {d.phone && <span>{d.phone}</span>}
                {d.city && <span>{d.city}{d.country ? `, ${d.country}` : ""}</span>}
                {d.vehicle_type && <span className="capitalize">{d.vehicle_type}</span>}
              </div>
              <div className="text-xs text-muted-foreground">
                Expire le {d.insurance_expires_at ? new Date(d.insurance_expires_at).toLocaleDateString("fr-FR") : "—"}
                {typeof d.days_remaining === "number" && (
                  <span className={`ml-1 ${d.days_remaining < 0 ? "text-destructive" : d.days_remaining <= 7 ? "text-warning" : ""}`}>
                    ({d.days_remaining < 0 ? "expirée" : `${d.days_remaining} j restants`})
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${insuranceStatusClass(d.insurance_status)}`}>
                {INSURANCE_STATUS_LABEL[d.insurance_status as InsuranceStatus] ?? d.insurance_status}
              </span>
              <div className="flex gap-2">
                {d.insurance_document_url && (
                  <Button size="sm" variant="outline" disabled={viewDoc.isPending} onClick={() => viewDoc.mutate(d.user_id)}>
                    Voir le document
                  </Button>
                )}
                {d.insurance_status !== "verified" && (
                  <Button size="sm" disabled={verify.isPending} onClick={() => verify.mutate(d.user_id)}>
                    Valider
                  </Button>
                )}
              </div>
            </div>
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
    driver_point_value_xof: Number(data.driver_point_value_xof),
    driver_ride_accept_pts: data.driver_ride_accept_pts,
    driver_ride_completed_pts: data.driver_ride_completed_pts,
    driver_referral_pts: data.driver_referral_pts,
    driver_min_redeem_pts: data.driver_min_redeem_pts,
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
    { key: "driver_ride_accept_pts", label: "Points reward : course acceptée" },
    { key: "driver_ride_completed_pts", label: "Points reward : course terminée" },
    { key: "driver_referral_pts", label: "Points reward : parrainage conducteur" },
    { key: "driver_point_value_xof", label: "Valeur d'1 point reward conducteur (XOF)", step: 0.1 },
    { key: "driver_min_redeem_pts", label: "Minimum de points pour convertir" },
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

// ============ Driver penalty rules catalog (points reward) ============
type PenaltyRule = {
  id: string;
  code: string;
  label: string;
  points_penalty: number;
  dispatch_cooldown_seconds: number;
  is_active: boolean;
};

function DriverPenaltyRulesTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "driver_penalty_rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("driver_penalty_rules")
        .select("*")
        .order("code", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PenaltyRule[];
    },
  });
  const [edits, setEdits] = useState<Record<string, Partial<PenaltyRule>>>({});

  const save = useMutation({
    mutationFn: async (rule: PenaltyRule) => {
      const { error } = await supabase
        .from("driver_penalty_rules")
        .update({
          points_penalty: rule.points_penalty,
          dispatch_cooldown_seconds: rule.dispatch_cooldown_seconds,
          is_active: rule.is_active,
        } as never)
        .eq("id", rule.id);
      if (error) throw error;
    },
    onSuccess: (_data, rule) => {
      toast.success(`Règle "${rule.label}" mise à jour`);
      setEdits((e) => {
        const next = { ...e };
        delete next[rule.id];
        return next;
      });
      qc.invalidateQueries({ queryKey: ["admin", "driver_penalty_rules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="py-6 text-center text-sm text-muted-foreground">Chargement…</div>;

  return (
    <div className="space-y-4 rounded-3xl border border-border bg-card/40 p-4">
      <div>
        <h3 className="font-semibold">Catalogue des pénalités conducteurs</h3>
        <p className="text-xs text-muted-foreground">
          Points retirés du wallet reward + durée de régression dans le classement de dispatch (le conducteur passe
          après les autres pendant cette durée, même s'il est le plus proche).
        </p>
      </div>
      <div className="space-y-2">
        {(data ?? []).map((rule) => {
          const merged = { ...rule, ...edits[rule.id] };
          const dirty = !!edits[rule.id];
          return (
            <div key={rule.id} className="grid gap-2 rounded-2xl border border-border/60 p-3 sm:grid-cols-[1fr_auto_auto_auto]">
              <div>
                <div className="text-sm font-medium">{merged.label}</div>
                <div className="font-mono text-xs text-muted-foreground">{merged.code}</div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Points retirés</Label>
                <Input
                  type="number"
                  min={0}
                  className="w-28"
                  value={merged.points_penalty}
                  onChange={(e) =>
                    setEdits((s) => ({ ...s, [rule.id]: { ...s[rule.id], points_penalty: Number(e.target.value) } }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Régression dispatch (s)</Label>
                <Input
                  type="number"
                  min={0}
                  className="w-28"
                  value={merged.dispatch_cooldown_seconds}
                  onChange={(e) =>
                    setEdits((s) => ({
                      ...s,
                      [rule.id]: { ...s[rule.id], dispatch_cooldown_seconds: Number(e.target.value) },
                    }))
                  }
                />
              </div>
              <div className="flex items-end gap-2">
                <div className="flex flex-col items-center gap-1">
                  <Label className="text-xs">Active</Label>
                  <Switch
                    checked={merged.is_active}
                    onCheckedChange={(v) => setEdits((s) => ({ ...s, [rule.id]: { ...s[rule.id], is_active: v } }))}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={!dirty || save.isPending}
                  onClick={() => save.mutate(merged as PenaltyRule)}
                >
                  Enregistrer
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
