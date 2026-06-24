import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  ADMIN_COUNTRIES,
  listUsers,
  promoteCountryAdmin,
  setUserCountry,
  setUserPassword,
  setUserRole,
} from "@/lib/admin.functions";
import { KeyRound, ShieldCheck, ShieldOff, UserCog } from "lucide-react";

type AppRole = "superadmin" | "admin" | "support" | "insurer" | "driver" | "passenger";

const ROLE_META: { key: AppRole; label: string; desc: string; superOnly?: boolean }[] = [
  { key: "passenger", label: "Passager", desc: "Commander des courses" },
  { key: "driver", label: "Chauffeur", desc: "Accepter et conduire" },
  { key: "support", label: "Support", desc: "Inbox et assistance" },
  { key: "insurer", label: "Assureur", desc: "Dashboard assurance — liste des chauffeurs assurés, validation" },
  { key: "admin", label: "Admin", desc: "Panneau admin (périmètre pays si assigné)" },
  { key: "superadmin", label: "Superadmin", desc: "Accès global à la plateforme", superOnly: true },
];

export function RolesPermissionsTab() {
  const qc = useQueryClient();
  const { user: me, hasRole } = useAuth();
  const isSuperadmin = hasRole("superadmin");
  const list = useServerFn(listUsers);
  const roleFn = useServerFn(setUserRole);
  const pwdFn = useServerFn(setUserPassword);
  const countryFn = useServerFn(setUserCountry);
  const countryAdminFn = useServerFn(promoteCountryAdmin);

  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pwdValue, setPwdValue] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [countryAdminValue, setCountryAdminValue] = useState<string>(ADMIN_COUNTRIES[0]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => list(),
  });

  const role = useMutation({
    mutationFn: (v: { userId: string; role: AppRole; grant: boolean }) => roleFn({ data: v }),
    onSuccess: () => {
      toast.success("Rôle mis à jour");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pwd = useMutation({
    mutationFn: (v: { userId: string; password: string }) => pwdFn({ data: v }),
    onSuccess: () => {
      toast.success("Mot de passe mis à jour");
      setPwdValue("");
      setPwdConfirm("");
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const country = useMutation({
    mutationFn: (v: { userId: string; country: string | null }) => countryFn({ data: v }),
    onSuccess: () => {
      toast.success("Pays mis à jour");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const countryAdmin = useMutation({
    mutationFn: (v: { userId: string; country: string }) => countryAdminFn({ data: v }),
    onSuccess: (_d, v) => {
      toast.success(`Admin pays nommé pour ${v.country}`);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data ?? []).filter((u: any) => {
      if (!s) return true;
      const hay = `${u.email ?? ""} ${u.profile?.full_name ?? ""} ${(u.roles ?? []).join(" ")}`.toLowerCase();
      return hay.includes(s);
    });
  }, [data, q]);

  const selected = filtered.find((u: any) => u.id === selectedId) ?? (data ?? []).find((u: any) => u.id === selectedId) ?? null;

  const countryAdmins = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const c of ADMIN_COUNTRIES) map.set(c, []);
    for (const u of data ?? []) {
      if (!u.roles?.includes("admin") || u.roles?.includes("superadmin")) continue;
      const c = u.profile?.country;
      if (c && map.has(c)) map.get(c)!.push(u.profile?.full_name ?? u.email ?? u.id);
    }
    return [...map.entries()].filter(([, names]) => names.length > 0);
  }, [data]);

  if (!isSuperadmin) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">
        Réservé aux superadmins.
      </div>
    );
  }

  const toggleRole = (u: any, r: AppRole, has: boolean) => {
    if (u.id === me?.id && !has && (r === "admin" || r === "superadmin")) {
      toast.error("Vous ne pouvez pas retirer votre propre rôle élevé.");
      return;
    }
    if (r === "superadmin" && has && !confirm("Retirer le rôle superadmin ?")) return;
    if (r === "superadmin" && !has && !confirm("Promouvoir ce compte superadmin (accès global) ?")) return;
    role.mutate({ userId: u.id, role: r, grant: !has });
  };

  const submitPassword = () => {
    if (!selected) return;
    if (pwdValue.length < 8) {
      toast.error("Mot de passe trop court — minimum 8 caractères.");
      return;
    }
    if (pwdValue !== pwdConfirm) {
      toast.error("Les mots de passe ne correspondent pas.");
      return;
    }
    pwd.mutate({ userId: selected.id, password: pwdValue });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <UserCog className="h-5 w-5 text-primary" />
          Admins par pays
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Vue d'ensemble des administrateurs rattachés à chaque pays.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {countryAdmins.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun admin pays nommé pour l'instant.</p>
          )}
          {countryAdmins.map(([c, names]) => (
            <div key={c} className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm">
              <div className="font-medium">{c}</div>
              <div className="text-xs text-muted-foreground">{names.join(" · ")}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_1fr]">
        <div className="rounded-2xl border border-border bg-card p-4">
          <Label className="text-xs text-muted-foreground">Rechercher un utilisateur</Label>
          <Input
            className="mt-1"
            placeholder="Email, nom, rôle…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="mt-3 max-h-[420px] space-y-1 overflow-y-auto">
            {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Chargement…</p>}
            {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
            {filtered.map((u: any) => {
              const active = u.id === selectedId;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => { setSelectedId(u.id); setPwdValue(""); setPwdConfirm(""); }}
                  className={[
                    "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                    active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                  ].join(" ")}
                >
                  <div className="truncate text-sm font-medium">{u.profile?.full_name ?? "—"}</div>
                  <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(u.roles ?? []).map((r: string) => (
                      <span key={r} className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{r}</span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          {!selected ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center text-muted-foreground">
              <UserCog className="mb-3 h-10 w-10 opacity-40" />
              <p className="text-sm">Sélectionnez un utilisateur pour gérer ses rôles et son mot de passe.</p>
            </div>
          ) : (
            <>
              <div className="border-b border-border pb-4">
                <h3 className="font-display text-lg font-semibold">{selected.profile?.full_name ?? "Utilisateur"}</h3>
                <p className="text-sm text-muted-foreground">{selected.email}</p>
                {selected.profile?.phone && <p className="text-xs text-muted-foreground">{selected.profile.phone}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  Pays profil : {selected.profile?.country ?? "—"}
                  {selected.last_sign_in_at && ` · Dernière connexion ${new Date(selected.last_sign_in_at).toLocaleString("fr-FR")}`}
                </p>
              </div>

              <Tabs defaultValue="roles" className="mt-4">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="roles">Rôles</TabsTrigger>
                  <TabsTrigger value="password">Mot de passe</TabsTrigger>
                  <TabsTrigger value="country">Admin pays</TabsTrigger>
                </TabsList>

                <TabsContent value="roles" className="mt-4 space-y-3">
                  {ROLE_META.map((meta) => {
                    const has = selected.roles?.includes(meta.key);
                    const isSelf = selected.id === me?.id;
                    if (meta.key === "superadmin" && !selected.roles?.includes("admin") && !has) return null;
                    return (
                      <div key={meta.key} className="flex items-center justify-between rounded-xl border border-border p-3">
                        <div>
                          <div className="text-sm font-medium">{meta.label}</div>
                          <div className="text-xs text-muted-foreground">{meta.desc}</div>
                        </div>
                        <Button
                          size="sm"
                          variant={has ? "outline" : "default"}
                          disabled={isSelf && has && (meta.key === "admin" || meta.key === "superadmin")}
                          onClick={() => toggleRole(selected, meta.key, has)}
                        >
                          {has ? <><ShieldOff className="mr-1 h-3.5 w-3.5" />Retirer</> : <><ShieldCheck className="mr-1 h-3.5 w-3.5" />Accorder</>}
                        </Button>
                      </div>
                    );
                  })}
                  {!selected.roles?.includes("superadmin") && (
                    <div className="rounded-xl border border-border bg-muted/20 p-3">
                      <Label className="text-xs">Pays du profil</Label>
                      <p className="mb-1.5 text-[11px] text-muted-foreground">Pays d&apos;origine / zone de service de l&apos;utilisateur.</p>
                      <Select
                        value={selected.profile?.country ?? "__none"}
                        onValueChange={(v) => country.mutate({ userId: selected.id, country: v === "__none" ? null : v })}
                      >
                        <SelectTrigger className="mt-1.5"><SelectValue placeholder="Choisir un pays" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">— Aucun —</SelectItem>
                          {ADMIN_COUNTRIES.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="password" className="mt-4 space-y-4">
                  <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                    <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                      Définissez un nouveau mot de passe pour ce compte (min. <strong>8 caractères</strong>).
                      Fonctionne aussi pour les comptes créés via Google.
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="rp-pwd">Nouveau mot de passe</Label>
                    <Input
                      id="rp-pwd"
                      type="password"
                      className="mt-1"
                      value={pwdValue}
                      onChange={(e) => setPwdValue(e.target.value)}
                      minLength={8}
                      autoComplete="new-password"
                    />
                  </div>
                  <div>
                    <Label htmlFor="rp-pwd2">Confirmation</Label>
                    <Input
                      id="rp-pwd2"
                      type="password"
                      className="mt-1"
                      value={pwdConfirm}
                      onChange={(e) => setPwdConfirm(e.target.value)}
                      minLength={8}
                      autoComplete="new-password"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">{pwdValue.length}/8 caractères minimum</p>
                  </div>
                  <Button onClick={submitPassword} disabled={pwd.isPending || pwdValue.length < 8}>
                    {pwd.isPending ? "Enregistrement…" : "Enregistrer le mot de passe"}
                  </Button>
                </TabsContent>

                <TabsContent value="country" className="mt-4 space-y-4">
                  {selected.roles?.includes("superadmin") ? (
                    <p className="text-sm text-muted-foreground">Un superadmin est global — pas de pays à assigner.</p>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Nomme cet utilisateur <strong>admin</strong> et lui assigne un pays en une seule étape.
                      </p>
                      <div>
                        <Label>Pays à administrer</Label>
                        <Select value={countryAdminValue} onValueChange={setCountryAdminValue}>
                          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ADMIN_COUNTRIES.map((c) => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        onClick={() => countryAdmin.mutate({ userId: selected.id, country: countryAdminValue })}
                        disabled={countryAdmin.isPending || selected.id === me?.id}
                      >
                        {countryAdmin.isPending ? "Nomination…" : `Nommer admin ${countryAdminValue}`}
                      </Button>
                      {selected.roles?.includes("admin") && selected.profile?.country && (
                        <p className="text-xs text-success">
                          Déjà admin pour {selected.profile.country}.
                        </p>
                      )}
                    </>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
