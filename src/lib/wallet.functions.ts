import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/integrations/vercel/auth-middleware";
import { hasRole } from "@/integrations/vercel/auth";
import { ensureDriverWallet, serviceApplyWalletTx } from "@/lib/app-data.functions";
import { queryOne, queryRows } from "@/integrations/vercel/db";
import { z } from "zod";

export const getMyWallet = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await ensureDriverWallet(context.userId);
    const wallet = await queryOne<{ balance_xof: number; updated_at: string }>(
      context.userId,
      `SELECT balance_xof, updated_at FROM public.driver_wallets WHERE user_id = $1`,
      [context.userId],
    );
    const txs = await queryRows(
      context.userId,
      `SELECT * FROM public.wallet_transactions WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [context.userId],
    );
    return {
      balance_xof: wallet?.balance_xof ?? 0,
      updated_at: wallet?.updated_at ?? null,
      transactions: txs,
    };
  });

export const listDriverWallets = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    if (!(await hasRole(context.userId, "admin"))) throw new Error("Forbidden: admin role required");
    const wallets = await queryRows(
      context.userId,
      `SELECT user_id, balance_xof, updated_at FROM public.driver_wallets`,
      [],
    );
    if (wallets.length === 0) return [];
    const ids = wallets.map((w) => (w as { user_id: string }).user_id);
    const profiles = await queryRows(
      context.userId,
      `SELECT id, full_name, phone FROM public.profiles WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    const map = new Map(profiles.map((p) => [(p as { id: string }).id, p]));
    return wallets.map((w) => ({
      ...w,
      profile: map.get((w as { user_id: string }).user_id) ?? null,
    }));
  });

export const adminWalletTopup = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z.object({
      driver_id: z.string().uuid(),
      amount_xof: z.number().int().min(1),
      reference: z.string().max(200).optional().nullable(),
      notes: z.string().max(1000).optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await hasRole(context.userId, "admin"))) throw new Error("Forbidden");
    const balance = await serviceApplyWalletTx({
      driver_id: data.driver_id,
      type: "topup",
      amount_xof: data.amount_xof,
      reference: data.reference,
      notes: data.notes,
      actor: context.userId,
    });
    return { balance_xof: balance };
  });

export const adminWalletAdjust = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z.object({
      driver_id: z.string().uuid(),
      amount_xof: z.number().int(),
      notes: z.string().max(1000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await hasRole(context.userId, "admin"))) throw new Error("Forbidden");
    const balance = await serviceApplyWalletTx({
      driver_id: data.driver_id,
      type: "adjustment",
      amount_xof: data.amount_xof,
      notes: data.notes,
      actor: context.userId,
    });
    return { balance_xof: balance };
  });
