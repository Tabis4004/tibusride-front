import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * GeniusPay webhook endpoint.
 *
 * Headers:
 *   X-Webhook-Signature: HMAC-SHA256(timestamp + "." + raw_body, GENIUSPAY_WEBHOOK_SECRET)
 *   X-Webhook-Timestamp: unix seconds
 *   X-Webhook-Event:     payment.success | payment.failed | payment.cancelled | ...
 *
 * Payload identifies our topup via data.metadata.topup_id (wallet points
 * passager, topup_orders/confirm_topup) OR data.metadata.driver_topup_id
 * (wallet FCFA livreur, self-service — driver_topup_orders/confirm_driver_topup,
 * voir courrier_livreur + Edge Function geniuspay-driver-topup). Les deux
 * flux partagent ce même webhook GeniusPay, distingués par la clé de
 * metadata présente dans le payload.
 *
 * Legacy shared-secret fallback (TOPUP_WEBHOOK_SECRET via x-webhook-secret) is kept
 * for other providers (TabisPay, manual confirmation).
 */
export const Route = createFileRoute("/api/public/webhooks/topup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const sigHeader = request.headers.get("x-webhook-signature");
        const tsHeader = request.headers.get("x-webhook-timestamp");
        const event = request.headers.get("x-webhook-event") ?? "";

        const geniusSecret = process.env.GENIUSPAY_WEBHOOK_SECRET;
        const fallbackSecret = process.env.TOPUP_WEBHOOK_SECRET;

        let authorized = false;

        if (sigHeader && tsHeader && geniusSecret) {
          // Replay protection: 5 min window
          const ts = Number(tsHeader);
          if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
            return new Response("Timestamp too old", { status: 400 });
          }
          const expected = createHmac("sha256", geniusSecret)
            .update(`${tsHeader}.${raw}`)
            .digest("hex");
          const a = Buffer.from(sigHeader);
          const b = Buffer.from(expected);
          if (a.length === b.length && timingSafeEqual(a, b)) {
            authorized = true;
          }
        }

        if (!authorized && fallbackSecret) {
          const got = request.headers.get("x-webhook-secret");
          if (got === fallbackSecret) authorized = true;
        }

        if (!authorized) return new Response("Unauthorized", { status: 401 });

        let body: any;
        try {
          body = JSON.parse(raw);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        // Resolve topup_id (GeniusPay → metadata.topup_id ; legacy → top-level)
        // et driverTopupId séparément (wallet FCFA livreur, self-service).
        const driverTopupId: string | undefined = body?.data?.metadata?.driver_topup_id;
        const topupId: string | undefined =
          body?.data?.metadata?.topup_id ?? body?.topup_id;
        const providerRef: string | undefined =
          body?.data?.reference ?? body?.provider_reference;

        if (!driverTopupId && !topupId) {
          return new Response("Missing topup_id", { status: 400 });
        }

        // Derive status
        let status: "paid" | "failed" | "cancelled" | null = null;
        const evt = event || body?.event || "";
        if (evt === "payment.success" || body?.data?.status === "completed" || body?.status === "paid") {
          status = "paid";
        } else if (evt === "payment.failed" || body?.data?.status === "failed" || body?.status === "failed") {
          status = "failed";
        } else if (evt === "payment.cancelled" || evt === "payment.expired" || body?.data?.status === "cancelled" || body?.status === "cancelled") {
          status = "cancelled";
        } else if (evt === "webhook.test") {
          return new Response(JSON.stringify({ ok: true, test: true }), {
            headers: { "content-type": "application/json" },
          });
        }

        if (!status) {
          return new Response(JSON.stringify({ ok: true, ignored: evt }), {
            headers: { "content-type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const table = driverTopupId ? "driver_topup_orders" : "topup_orders";
        const id = (driverTopupId ?? topupId)!;
        const confirmRpc = driverTopupId ? "confirm_driver_topup" : "confirm_topup";

        if (status === "paid") {
          const { data, error } = await supabaseAdmin.rpc(confirmRpc, {
            _topup_id: id,
            _provider_ref: providerRef ?? undefined,
          });
          if (error)
            return new Response(JSON.stringify({ ok: false, error: error.message }), {
              status: 500,
              headers: { "content-type": "application/json" },
            });
          return new Response(JSON.stringify({ ok: true, result: data }), {
            headers: { "content-type": "application/json" },
          });
        }

        const { error } = await supabaseAdmin
          .from(table)
          .update({ status, provider_reference: providerRef ?? null })
          .eq("id", id);
        if (error)
          return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
