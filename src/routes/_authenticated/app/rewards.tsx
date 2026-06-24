import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Copy, Gift, Share2, Wallet, Users, Sparkles, Plus, ArrowDownToLine, ArrowUpFromLine, CheckCircle2, Award } from "lucide-react";
import { formatXof } from "@/lib/pricing";
import { createGeniuspayTopup } from "@/lib/geniuspay.functions";
import { getMyRewardWallet, redeemDriverPoints } from "@/lib/driver-reward.functions";

export const Route = createFileRoute("/_authenticated/app/rewards")({
  head: () => ({ meta: [{ title: "Récompenses & Wallet — Tibus Ride" }] }),
  component: RewardsPage,
});

const PROVIDERS = [
  { value: "geniuspay", label: "GeniusPay (Mobile Money)" },
  { value: "tabispay", label: "TabisPay (Mobile Money)" },
  { value: "card", label: "Carte bancaire" },
];

function RewardsPage() {
  const { user, primaryRole, roles } = useAuth();
  const qc = useQueryClient();
  const isDriver = roles.includes("driver");

  // Settings (for display: point value, bonuses)
  const settingsQ = useQuery({
    queryKey: ["reward-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("reward_settings").select("*").eq("id", true).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Referral code
  const codeQ = useQuery({
    queryKey: ["referral-code", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_or_create_referral_code", { _user_id: user!.id });
      if (error) throw error;
      return data as string;
    },
  });

  // Driver wallet
  const driverWalletQ = useQuery({
    queryKey: ["driver-wallet", user?.id],
    enabled: !!user && isDriver,
    queryFn: async () => {
      const { data } = await supabase.from("driver_wallets").select("*").eq("user_id", user!.id).maybeSingle();
      return data ?? { balance_xof: 0 };
    },
  });

  const driverTxQ = useQuery({
    queryKey: ["driver-tx", user?.id],
    enabled: !!user && isDriver,
    queryFn: async () => {
      const { data } = await supabase
        .from("wallet_transactions")
        .select("*")
        .eq("driver_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  // Driver reward points wallet (distinct from FCFA wallet above)
  const getRewardFn = useServerFn(getMyRewardWallet);
  const rewardWalletQ = useQuery({
    queryKey: ["my-reward-wallet", user?.id],
    enabled: !!user && isDriver,
    queryFn: () => getRewardFn(),
  });

  const redeemFn = useServerFn(redeemDriverPoints);
  const [redeemAmount, setRedeemAmount] = useState(0);
  const redeemMut = useMutation({
    mutationFn: (points: number) => redeemFn({ data: { points } }),
    onSuccess: (res) => {
      toast.success(`${res.xof_credit} XOF crédités sur votre wallet chauffeur`);
      setRedeemAmount(0);
      qc.invalidateQueries({ queryKey: ["my-reward-wallet"] });
      qc.invalidateQueries({ queryKey: ["driver-wallet"] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Erreur"),
  });

  // Passenger wallet
  const paxWalletQ = useQuery({
    queryKey: ["pax-wallet", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("passenger_wallets").select("*").eq("user_id", user!.id).maybeSingle();
      return data ?? { balance_pts: 0 };
    },
  });

  const paxTxQ = useQuery({
    queryKey: ["pax-tx", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("passenger_wallet_transactions")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  // Referrals
  const refsQ = useQuery({
    queryKey: ["my-referrals", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("referrals")
        .select("*")
        .eq("referrer_id", user!.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  // Shares
  const sharesQ = useQuery({
    queryKey: ["my-shares", user?.id],
    enabled: !!user && isDriver,
    queryFn: async () => {
      const { data } = await supabase
        .from("share_events")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });

  const settings = settingsQ.data;
  const code = codeQ.data ?? "";
  const inviteUrl = typeof window !== "undefined" ? `${window.location.origin}/auth?ref=${code}` : "";

  // Share + claim reward (driver)
  const shareMutation = useMutation({
    mutationFn: async (channel: string) => {
      // Use Web Share API if available
      if (typeof navigator !== "undefined" && (navigator as any).share) {
        try {
          await (navigator as any).share({
            title: "Tibus Ride",
            text: `Rejoins-moi sur Tibus Ride avec mon code ${code} et profite de tes premiers trajets !`,
            url: inviteUrl,
          });
        } catch { /* user cancelled */ }
      } else {
        await navigator.clipboard.writeText(inviteUrl);
        toast.success("Lien copié");
      }
      if (isDriver) {
        const { data, error } = await supabase.rpc("claim_driver_share_reward", { _channel: channel });
        if (error) throw error;
        return data as { rewarded: boolean; bonus_xof?: number; reason?: string };
      }
      return { rewarded: false };
    },
    onSuccess: (res) => {
      if (res?.rewarded) {
        toast.success(`+${res.bonus_xof} XOF crédités sur votre wallet !`);
        qc.invalidateQueries({ queryKey: ["driver-wallet"] });
        qc.invalidateQueries({ queryKey: ["driver-tx"] });
        qc.invalidateQueries({ queryKey: ["my-shares"] });
      } else if ((res as any)?.reason === "daily_cap") {
        toast.info("Limite quotidienne atteinte — réessayez demain.");
      }
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  // Register a referral code
  const [refCodeInput, setRefCodeInput] = useState("");
  const registerRefMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("register_referral", { _code: refCodeInput.trim().toUpperCase() });
      if (error) throw error;
      return data as { ok: boolean; reason?: string };
    },
    onSuccess: (r) => {
      if (r.ok) {
        toast.success("Code de parrainage enregistré 🎉");
        setRefCodeInput("");
        qc.invalidateQueries({ queryKey: ["my-referrals"] });
      } else {
        toast.error(r.reason === "invalid_code" ? "Code invalide" : r.reason === "already_referred" ? "Déjà parrainé" : "Erreur");
      }
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  // Topup
  const [topupAmount, setTopupAmount] = useState(2000);
  const [provider, setProvider] = useState("geniuspay");
  const createGeniusFn = useServerFn(createGeniuspayTopup);

  // Detect return from GeniusPay checkout (?topup=success|error)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const u = new URL(window.location.href);
    const t = u.searchParams.get("topup");
    if (t === "success") {
      toast.success("Paiement confirmé — points crédités sous quelques instants.");
      qc.invalidateQueries({ queryKey: ["pax-wallet"] });
      qc.invalidateQueries({ queryKey: ["pax-tx"] });
      qc.invalidateQueries({ queryKey: ["topup-orders"] });
      u.searchParams.delete("topup");
      window.history.replaceState({}, "", u.toString());
    } else if (t === "error") {
      toast.error("Paiement non finalisé. Vous pouvez réessayer.");
      u.searchParams.delete("topup");
      window.history.replaceState({}, "", u.toString());
    }
  }, [qc]);

  const createTopupMut = useMutation({
    mutationFn: async () => {
      if (provider === "geniuspay") {
        const origin = window.location.origin;
        const back = `${origin}/app/rewards`;
        const res = await createGeniusFn({
          data: {
            amount_xof: topupAmount,
            success_url: `${back}?topup=success`,
            error_url: `${back}?topup=error`,
          },
        });
        // Redirect to GeniusPay hosted checkout
        window.location.href = res.checkout_url;
        return res;
      }
      const { data, error } = await supabase
        .from("topup_orders")
        .insert({ user_id: user!.id, amount_xof: topupAmount, provider, status: "pending" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      if (provider !== "geniuspay") {
        toast.success(`Commande de recharge créée (${formatXof(topupAmount)}). En attente du paiement ${provider}.`);
      }
      qc.invalidateQueries({ queryKey: ["topup-orders"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  const topupsQ = useQuery({
    queryKey: ["topup-orders", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("topup_orders").select("*").eq("user_id", user!.id).order("created_at",{ascending:false}).limit(10);
      return data ?? [];
    },
  });

  const copyCode = () => {
    navigator.clipboard.writeText(code);
    toast.success("Code copié");
  };
  const copyLink = () => {
    navigator.clipboard.writeText(inviteUrl);
    toast.success("Lien copié");
  };

  const pts = paxWalletQ.data?.balance_pts ?? 0;
  const ptValue = settings?.point_value_xof ?? 1;
  const ptsAsXof = Math.floor(pts * ptValue);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Sparkles className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Récompenses & Wallet</h1>
          <p className="text-sm text-muted-foreground">Partagez, parrainez, gagnez.</p>
        </div>
      </div>

      {/* Wallets */}
      <div className="grid gap-4 md:grid-cols-2">
        {isDriver && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-5 w-5" />Wallet Chauffeur</CardTitle>
              <CardDescription>Solde utilisable pour vos commissions de course</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{formatXof(driverWalletQ.data?.balance_xof ?? 0)}</div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Gift className="h-5 w-5" />Wallet Passager</CardTitle>
            <CardDescription>Points convertibles en crédit course</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{pts.toLocaleString()} pts</div>
            <div className="text-sm text-muted-foreground">≈ {formatXof(ptsAsXof)} de crédit</div>
          </CardContent>
        </Card>
      </div>

      {/* Driver reward points wallet */}
      {isDriver && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Award className="h-5 w-5" />Wallet Reward (points)</CardTitle>
            <CardDescription>
              Gagnés en acceptant/terminant des courses et en parrainant des conducteurs. Perdus en cas de pénalité
              (offre ignorée/refusée, course annulée, mauvaise note…). Convertibles en FCFA sur votre wallet chauffeur.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-3xl font-bold">{(rewardWalletQ.data?.points_balance ?? 0).toLocaleString()} pts</div>
            <div className="text-sm text-muted-foreground">
              1 pt ≈ {formatXof(rewardWalletQ.data?.point_value_xof ?? 1)} · minimum {rewardWalletQ.data?.min_redeem_pts ?? 0} pts pour convertir
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label className="text-xs">Points à convertir</Label>
                <Input
                  type="number"
                  min={0}
                  className="w-32"
                  value={redeemAmount}
                  onChange={(e) => setRedeemAmount(Number(e.target.value))}
                />
              </div>
              <Button
                onClick={() => redeemMut.mutate(redeemAmount)}
                disabled={
                  redeemMut.isPending ||
                  redeemAmount < (rewardWalletQ.data?.min_redeem_pts ?? 1) ||
                  redeemAmount > (rewardWalletQ.data?.points_balance ?? 0)
                }
              >
                Convertir en FCFA
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Referral code */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Mon code de parrainage</CardTitle>
          <CardDescription>
            {isDriver
              ? `Parrainez un chauffeur : +${formatXof(settings?.driver_referral_bonus_xof ?? 0)} à sa 1ère course. Parrainez un passager : +${formatXof(settings?.driver_referral_per_ride_xof ?? 0)} sur chacune de ses courses.`
              : `Invitez un ami : il gagne ${settings?.passenger_referral_bonus_pts ?? 0} pts à sa 1ère course.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-md border-2 border-dashed border-primary/40 bg-primary/5 px-4 py-2 font-mono text-xl font-bold tracking-widest">
              {code || "…"}
            </div>
            <Button variant="outline" size="sm" onClick={copyCode}><Copy className="h-4 w-4 mr-1" />Copier le code</Button>
            <Button variant="outline" size="sm" onClick={copyLink}><Copy className="h-4 w-4 mr-1" />Copier le lien</Button>
            <Button size="sm" onClick={() => shareMutation.mutate("native")} disabled={shareMutation.isPending}>
              <Share2 className="h-4 w-4 mr-1" />Partager
              {isDriver && settings ? ` (+${formatXof(settings.driver_share_bonus_xof)})` : ""}
            </Button>
          </div>
          {isDriver && (
            <p className="text-xs text-muted-foreground">
              Bonus partage limité à {settings?.driver_share_daily_cap ?? 1}× par jour.
            </p>
          )}

          {/* Enter a code */}
          <div className="border-t pt-4">
            <Label className="text-xs">J'ai un code de parrainage</Label>
            <div className="mt-1 flex gap-2">
              <Input value={refCodeInput} onChange={(e) => setRefCodeInput(e.target.value)} placeholder="Ex: AB12CD34" maxLength={12} />
              <Button onClick={() => registerRefMut.mutate()} disabled={!refCodeInput || registerRefMut.isPending}>Valider</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Topup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" />Recharger mon wallet passager</CardTitle>
          <CardDescription>1 XOF = {(1 / (settings?.point_value_xof ?? 1)).toFixed(0)} pt — utilisable sur vos prochaines courses</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr,1fr,auto]">
            <div>
              <Label className="text-xs">Montant (XOF)</Label>
              <Input type="number" min={500} step={500} value={topupAmount} onChange={(e) => setTopupAmount(Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs">Moyen de paiement</Label>
              <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={provider} onChange={(e) => setProvider(e.target.value)}>
                {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <Button onClick={() => createTopupMut.mutate()} disabled={createTopupMut.isPending || topupAmount < 500} className="w-full">
                Recharger
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Les recharges sont confirmées automatiquement via webhook une fois le paiement validé par votre prestataire.
          </p>
          {topupsQ.data && topupsQ.data.length > 0 && (
            <div className="space-y-1 border-t pt-3">
              <div className="text-xs font-medium text-muted-foreground">Dernières recharges</div>
              {topupsQ.data.map((t: any) => (
                <div key={t.id} className="flex items-center justify-between text-sm">
                  <span>{formatXof(t.amount_xof)} · {t.provider}</span>
                  <Badge variant={t.status === "paid" ? "default" : t.status === "pending" ? "secondary" : "destructive"}>
                    {t.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <Tabs defaultValue={isDriver ? "driver" : "pax"}>
        <TabsList>
          {isDriver && <TabsTrigger value="driver">Transactions chauffeur</TabsTrigger>}
          {isDriver && <TabsTrigger value="reward">Transactions reward</TabsTrigger>}
          <TabsTrigger value="pax">Transactions passager</TabsTrigger>
          <TabsTrigger value="refs">Mes filleuls ({refsQ.data?.length ?? 0})</TabsTrigger>
          {isDriver && <TabsTrigger value="shares">Partages</TabsTrigger>}
        </TabsList>

        {isDriver && (
          <TabsContent value="driver">
            <Card><CardContent className="pt-6 space-y-2">
              {(driverTxQ.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Aucune transaction.</p>}
              {(driverTxQ.data ?? []).map((t: any) => (
                <div key={t.id} className="flex items-center justify-between border-b pb-2 text-sm last:border-0">
                  <div className="flex items-center gap-2">
                    {t.amount_xof >= 0 ? <ArrowDownToLine className="h-4 w-4 text-green-600" /> : <ArrowUpFromLine className="h-4 w-4 text-orange-600" />}
                    <div>
                      <div className="font-medium capitalize">{t.type} {t.notes && <span className="text-muted-foreground font-normal">— {t.notes}</span>}</div>
                      <div className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                  <div className={`font-semibold ${t.amount_xof >= 0 ? "text-green-600" : "text-orange-600"}`}>
                    {t.amount_xof >= 0 ? "+" : ""}{formatXof(t.amount_xof)}
                  </div>
                </div>
              ))}
            </CardContent></Card>
          </TabsContent>
        )}

        {isDriver && (
          <TabsContent value="reward">
            <Card><CardContent className="pt-6 space-y-2">
              {(rewardWalletQ.data?.transactions ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">Aucune transaction.</p>
              )}
              {(rewardWalletQ.data?.transactions ?? []).map((t: any) => (
                <div key={t.id} className="flex items-center justify-between border-b pb-2 text-sm last:border-0">
                  <div>
                    <div className="font-medium capitalize">{t.type?.replace(/_/g, " ")} {t.notes && <span className="text-muted-foreground font-normal">— {t.notes}</span>}</div>
                    <div className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</div>
                  </div>
                  <div className={`font-semibold ${t.points >= 0 ? "text-green-600" : "text-orange-600"}`}>
                    {t.points >= 0 ? "+" : ""}{t.points} pts
                  </div>
                </div>
              ))}
            </CardContent></Card>
          </TabsContent>
        )}

        <TabsContent value="pax">
          <Card><CardContent className="pt-6 space-y-2">
            {(paxTxQ.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Aucune transaction.</p>}
            {(paxTxQ.data ?? []).map((t: any) => (
              <div key={t.id} className="flex items-center justify-between border-b pb-2 text-sm last:border-0">
                <div>
                  <div className="font-medium capitalize">{t.type.replace("_"," ")} {t.notes && <span className="text-muted-foreground font-normal">— {t.notes}</span>}</div>
                  <div className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</div>
                </div>
                <div className={`font-semibold ${t.amount_pts >= 0 ? "text-green-600" : "text-orange-600"}`}>
                  {t.amount_pts >= 0 ? "+" : ""}{t.amount_pts} pts
                </div>
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="refs">
          <Card><CardContent className="pt-6 space-y-2">
            {(refsQ.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Aucun filleul pour le moment. Partagez votre code !</p>}
            {(refsQ.data ?? []).map((r: any) => (
              <div key={r.id} className="flex items-center justify-between border-b pb-2 text-sm last:border-0">
                <div>
                  <div className="font-medium capitalize">{r.referee_role}</div>
                  <div className="text-xs text-muted-foreground">Inscrit le {new Date(r.created_at).toLocaleDateString()}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={r.status === "rewarded" ? "default" : "secondary"}>{r.status}</Badge>
                  {r.reward_xof > 0 && <span className="text-xs text-green-600 font-medium">+{formatXof(r.reward_xof)}</span>}
                  {r.reward_pts > 0 && <span className="text-xs text-green-600 font-medium">+{r.reward_pts} pts</span>}
                </div>
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>

        {isDriver && (
          <TabsContent value="shares">
            <Card><CardContent className="pt-6 space-y-2">
              {(sharesQ.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Aucun partage.</p>}
              {(sharesQ.data ?? []).map((s: any) => (
                <div key={s.id} className="flex items-center justify-between border-b pb-2 text-sm last:border-0">
                  <div>
                    <div className="font-medium">{s.channel}</div>
                    <div className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleString()}</div>
                  </div>
                  <Badge variant={s.rewarded ? "default" : "secondary"}>
                    {s.rewarded ? `+${formatXof(s.reward_xof)}` : "Non récompensé"}
                  </Badge>
                </div>
              ))}
            </CardContent></Card>
          </TabsContent>
        )}
      </Tabs>

      <p className="text-xs text-muted-foreground">
        Astuce : depuis <Link to="/app/passenger" className="text-primary underline">Commander</Link>, vous pourrez bientôt utiliser vos points pour réduire le prix d'une course.
      </p>
    </div>
  );
}
