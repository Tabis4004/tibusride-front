import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

async function applyTx(args: {
  driver_id: string;
  type: "topup" | "commission" | "adjustment" | "refund";
  amount_xof: number;
  ride_id?: string | null;
  reference?: string | null;
  notes?: string | null;
  actor: string;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("apply_wallet_transaction", {
    _driver_id: args.driver_id,
    _type: args.type,
    _amount_xof: args.amount_xof,
    _ride_id: args.ride_id ?? undefined,
    _reference: args.reference ?? undefined,
    _notes: args.notes ?? undefined,
    _actor: args.actor,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export const getMyWallet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // ensure wallet row exists
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("driver_wallets")
      .upsert({ user_id: context.userId }, { onConflict: "user_id", ignoreDuplicates: true });

    const { data: wallet } = await context.supabase
      .from("driver_wallets")
      .select("balance_xof, updated_at")
      .eq("user_id", context.userId)
      .maybeSingle();

    const { data: txs } = await context.supabase
      .from("wallet_transactions")
      .select("*")
      .eq("driver_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);

    return {
      balance_xof: wallet?.balance_xof ?? 0,
      updated_at: wallet?.updated_at ?? null,
      transactions: txs ?? [],
    };
  });

export const listDriverWallets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: wallets, error } = await supabaseAdmin
      .from("driver_wallets")
      .select("user_id, balance_xof, updated_at");
    if (error) throw new Error(error.message);

    const ids = (wallets ?? []).map((w: any) => w.user_id);
    if (ids.length === 0) return [];

    const { data: profiles } = await supabaseAdmin
      .from("profiles").select("id, full_name, phone").in("id", ids);
    const map = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    return (wallets ?? []).map((w: any) => ({
      ...w,
      profile: map.get(w.user_id) ?? null,
    }));
  });

export const adminWalletTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      driver_id: z.string().uuid(),
      amount_xof: z.number().int().min(1),
      reference: z.string().max(200).optional().nullable(),
      notes: z.string().max(1000).optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const balance = await applyTx({
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
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      driver_id: z.string().uuid(),
      amount_xof: z.number().int(), // can be negative
      notes: z.string().max(1000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const balance = await applyTx({
      driver_id: data.driver_id,
      type: "adjustment",
      amount_xof: data.amount_xof,
      notes: data.notes,
      actor: context.userId,
    });
    return { balance_xof: balance };
  });
