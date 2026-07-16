import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Équivalent Edge Function de createGeniuspayTopup (tibusride-front,
// src/lib/geniuspay.functions.ts) — même logique exacte, portée ici car
// l'app Flutter courrier_client n'a pas de serveur à elle pour détenir la
// clé secrète GeniusPay (GENIUSPAY_API_KEY). Le webhook de confirmation
// (routes/api/public/webhooks/topup.ts, côté tibusride-front) reste
// inchangé : il résout la commande par topup_id (metadata), peu importe
// quel client (web ou mobile) l'a créée.
//
// Secrets requis (à définir via `supabase secrets set` ou le Dashboard,
// section Edge Functions > Secrets du projet Tibus Ride) :
//   GENIUSPAY_PUBLIC_KEY, GENIUSPAY_API_KEY
// SUPABASE_URL / SUPABASE_ANON_KEY sont injectées automatiquement par le
// runtime, pas besoin de les définir.
//
// Déployée via le MCP Supabase (pas de `supabase functions deploy` local
// pour l'instant) — ce fichier est la copie versionnée de ce qui tourne en
// prod sur le projet bjtklpjdsmqmzhncfflu, slug `geniuspay-topup`. En cas de
// modification, redéployer avec la même commande/outil et garder ce fichier
// synchronisé.

const GENIUSPAY_PUBLIC_KEY = Deno.env.get("GENIUSPAY_PUBLIC_KEY");
const GENIUSPAY_API_KEY = Deno.env.get("GENIUSPAY_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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
    if (!GENIUSPAY_PUBLIC_KEY || !GENIUSPAY_API_KEY) {
      return json({ error: "GeniusPay keys not configured" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    // Client scopé sur le JWT de l'appelant — RLS appliqué comme si l'app
    // Flutter faisait l'insert elle-même (pas de contournement service_role,
    // même contrat que context.supabase côté web/requireSupabaseAuth).
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const amountXof = Number(body?.amount_xof);
    const successUrl = String(body?.success_url ?? "");
    const errorUrl = String(body?.error_url ?? "");
    const customerPhone = body?.customer_phone ? String(body.customer_phone) : undefined;
    const customerName = body?.customer_name ? String(body.customer_name) : undefined;
    const customerEmail = body?.customer_email ? String(body.customer_email) : undefined;

    if (!Number.isFinite(amountXof) || amountXof < 200) {
      return json({ error: "amount_xof invalide (minimum 200)" }, 400);
    }
    if (!successUrl || !errorUrl) {
      return json({ error: "success_url/error_url requis" }, 400);
    }

    // 1. Ligne topup_orders (pending) — même contrat que createGeniuspayTopup.
    const { data: order, error: orderErr } = await supabase
      .from("topup_orders")
      .insert({ user_id: userId, amount_xof: amountXof, provider: "geniuspay", status: "pending" })
      .select()
      .single();
    if (orderErr) return json({ error: orderErr.message }, 400);

    // 2. Session de paiement hébergée GeniusPay.
    const res = await fetch("https://geniuspay.ci/api/v1/merchant/payments", {
      method: "POST",
      headers: {
        "X-API-Key": GENIUSPAY_PUBLIC_KEY,
        "X-API-Secret": GENIUSPAY_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        amount: amountXof,
        currency: "XOF",
        description: "Recharge wallet Tibus Ride",
        success_url: successUrl,
        error_url: errorUrl,
        customer: { name: customerName, email: customerEmail, phone: customerPhone },
        metadata: { topup_id: order.id, user_id: userId },
      }),
    });

    const payload: any = await res.json().catch(() => ({}));
    if (!res.ok || !payload?.success) {
      const msg = payload?.error?.message || `GeniusPay error (${res.status})`;
      // best-effort — voir note en tête de fichier sur l'absence de policy
      // UPDATE pour 'authenticated' sur topup_orders (même limitation côté web).
      await supabase.from("topup_orders").update({ status: "failed" }).eq("id", order.id);
      return json({ error: msg }, 502);
    }

    const checkoutUrl: string | undefined = payload.data?.checkout_url || payload.data?.payment_url;
    const reference: string | undefined = payload.data?.reference;
    if (!checkoutUrl) {
      await supabase.from("topup_orders").update({ status: "failed" }).eq("id", order.id);
      return json({ error: "GeniusPay: checkout_url manquant" }, 502);
    }

    await supabase.from("topup_orders").update({ provider_reference: reference ?? null }).eq("id", order.id);

    return json({ checkout_url: checkoutUrl, reference, topup_id: order.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
