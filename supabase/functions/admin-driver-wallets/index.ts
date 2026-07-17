import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Admin — vue/recharge/ajustement des wallets FCFA livreur (tâche #32).
// Contrairement aux autres tâches admin de cette session (drivers,
// pricing), driver_wallets/wallet_transactions n'ont AUCUNE policy RLS
// d'écriture (même pour un admin) et apply_wallet_transaction est
// SECURITY DEFINER sans contrôle interne (verrouillé cette session, voir
// migration lock_down_wallet_credit_rpcs) — donc pas d'accès direct
// possible depuis Flutter, contrairement à pricing_settings. Cette Edge
// Function reproduit exactement listDriverWallets/adminWalletTopup/
// adminWalletAdjust (wallet.functions.ts, tibusride-front) : vérifie le
// rôle admin/superadmin via le client scopé JWT de l'appelant, puis utilise
// le service_role pour lire/écrire (même contrat que web, qui passe par
// supabaseAdmin après assertAdmin()).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    // Client scopé JWT — sert uniquement à identifier l'appelant et vérifier
    // son rôle, jamais à lire/écrire les wallets (RLS ne le permettrait pas
    // de toute façon pour l'écriture).
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const callerId = userData.user.id;

    const { data: isSuper } = await callerClient.rpc("is_superadmin", { _uid: callerId });
    if (!isSuper) {
      const { data: isAdmin } = await callerClient.rpc("has_role", { _user_id: callerId, _role: "admin" });
      if (!isAdmin) return json({ error: "Forbidden: admin role required" }, 403);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    if (action === "list") {
      const { data: wallets, error } = await admin.from("driver_wallets").select("user_id, balance_xof, updated_at");
      if (error) return json({ error: error.message }, 400);
      const ids = (wallets ?? []).map((w: any) => w.user_id);
      let profiles: any[] = [];
      if (ids.length > 0) {
        const { data } = await admin.from("profiles").select("id, full_name, phone").in("id", ids);
        profiles = data ?? [];
      }
      const map = new Map(profiles.map((p) => [p.id, p]));
      const result = (wallets ?? []).map((w: any) => ({ ...w, profile: map.get(w.user_id) ?? null }));
      return json({ wallets: result });
    }

    if (action === "topup" || action === "adjust") {
      const driverId = String(body?.driver_id ?? "");
      const amountXof = Number(body?.amount_xof);
      const notes = body?.notes ? String(body.notes) : null;
      if (!driverId) return json({ error: "driver_id requis" }, 400);
      if (!Number.isFinite(amountXof) || amountXof === 0) return json({ error: "amount_xof invalide" }, 400);
      if (action === "topup" && amountXof < 1) return json({ error: "amount_xof doit être positif pour une recharge" }, 400);

      const { data: newBalance, error } = await admin.rpc("apply_wallet_transaction", {
        _driver_id: driverId,
        _type: action === "topup" ? "topup" : "adjustment",
        _amount_xof: amountXof,
        _notes: notes,
        _actor: callerId,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, balance_xof: newBalance });
    }

    return json({ error: "action inconnue (attendu: list, topup, adjust)" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
