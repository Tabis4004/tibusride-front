import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/integrations/vercel/auth-middleware";
import { queryOne, queryRows } from "@/integrations/vercel/db";

const InputSchema = z.object({
  amount_xof: z.number().int().min(200),
  success_url: z.string().url(),
  error_url: z.string().url(),
  customer_phone: z.string().optional(),
  customer_name: z.string().optional(),
  customer_email: z.string().email().optional(),
});

export const createGeniuspayTopup = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const pk = process.env.GENIUSPAY_PUBLIC_KEY;
    const sk = process.env.GENIUSPAY_API_KEY;
    if (!pk || !sk) throw new Error("GeniusPay keys not configured");

    const orderRows = await queryRows(
      context.userId,
      `INSERT INTO public.topup_orders (user_id, amount_xof, provider, status)
       VALUES ($1, $2, 'geniuspay', 'pending') RETURNING *`,
      [context.userId, data.amount_xof],
    );
    const order = orderRows[0] as { id: string };

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
        metadata: { topup_id: order.id, user_id: context.userId },
      }),
    });

    const payload: any = await res.json().catch(() => ({}));
    if (!res.ok || !payload?.success) {
      const msg = payload?.error?.message || `GeniusPay error (${res.status})`;
      await queryRows(
        context.userId,
        `UPDATE public.topup_orders SET status = 'failed' WHERE id = $1`,
        [order.id],
      );
      throw new Error(msg);
    }

    const checkoutUrl: string | undefined = payload.data?.checkout_url || payload.data?.payment_url;
    const reference: string | undefined = payload.data?.reference;
    if (!checkoutUrl) throw new Error("GeniusPay: missing checkout_url");

    await queryRows(
      context.userId,
      `UPDATE public.topup_orders SET provider_reference = $2 WHERE id = $1`,
      [order.id, reference ?? null],
    );

    return { checkout_url: checkoutUrl, reference, topup_id: order.id };
  });

export const getTopupOrder = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ topupId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) =>
    queryOne(context.userId, `SELECT * FROM public.topup_orders WHERE id = $1 AND user_id = $2`, [
      data.topupId,
      context.userId,
    ]),
  );
