import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  amount_xof: z.number().int().min(200),
  success_url: z.string().url(),
  error_url: z.string().url(),
  customer_phone: z.string().optional(),
  customer_name: z.string().optional(),
  customer_email: z.string().email().optional(),
});

export const createGeniuspayTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const pk = process.env.GENIUSPAY_PUBLIC_KEY;
    const sk = process.env.GENIUSPAY_API_KEY;
    if (!pk || !sk) throw new Error("GeniusPay keys not configured");

    const { supabase, userId } = context;

    // 1. Create the topup_orders row (pending)
    const { data: order, error: orderErr } = await supabase
      .from("topup_orders")
      .insert({
        user_id: userId,
        amount_xof: data.amount_xof,
        provider: "geniuspay",
        status: "pending",
      })
      .select()
      .single();
    if (orderErr) throw new Error(orderErr.message);

    // 2. Call GeniusPay to obtain a checkout_url (hosted page)
    const res = await fetch("https://geniuspay.ci/api/v1/merchant/payments", {
      method: "POST",
      headers: {
        "X-API-Key": pk,
        "X-API-Secret": sk,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        amount: data.amount_xof,
        currency: "XOF",
        description: `Recharge wallet Tibus Ride`,
        success_url: data.success_url,
        error_url: data.error_url,
        customer: {
          name: data.customer_name,
          email: data.customer_email,
          phone: data.customer_phone,
        },
        metadata: { topup_id: order.id, user_id: userId },
      }),
    });

    const payload: any = await res.json().catch(() => ({}));
    if (!res.ok || !payload?.success) {
      const msg = payload?.error?.message || `GeniusPay error (${res.status})`;
      // Mark the order as failed for traceability
      await supabase
        .from("topup_orders")
        .update({ status: "failed" })
        .eq("id", order.id);
      throw new Error(msg);
    }

    const checkoutUrl: string | undefined =
      payload.data?.checkout_url || payload.data?.payment_url;
    const reference: string | undefined = payload.data?.reference;
    if (!checkoutUrl) throw new Error("GeniusPay: missing checkout_url");

    // Store provider reference for reconciliation
    await supabase
      .from("topup_orders")
      .update({ provider_reference: reference ?? null })
      .eq("id", order.id);

    return { checkout_url: checkoutUrl, reference, topup_id: order.id };
  });
