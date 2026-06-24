import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Wallet Reward (points) du conducteur/livreur — distinct du wallet marchand
 * (FCFA, driver_wallets/wallet.functions.ts). Les points se gagnent en
 * acceptant/terminant des courses et en parrainant d'autres conducteurs, et
 * se perdent via les pénalités configurées (driver_penalty_rules). Ils sont
 * convertibles en FCFA sur le wallet marchand via `redeem_driver_points`
 * (voir supabase/migrations/20260701000300_driver_reward_points_system.sql).
 */

export const getMyRewardWallet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("driver_reward_wallets")
      .upsert({ user_id: context.userId }, { onConflict: "user_id", ignoreDuplicates: true });

    const { data: wallet } = await context.supabase
      .from("driver_reward_wallets")
      .select("points_balance, updated_at")
      .eq("user_id", context.userId)
      .maybeSingle();

    const { data: txs } = await context.supabase
      .from("driver_reward_transactions")
      .select("*")
      .eq("driver_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);

    const { data: settings } = await context.supabase
      .from("reward_settings")
      .select("driver_point_value_xof, driver_min_redeem_pts")
      .eq("id", true)
      .maybeSingle();

    return {
      points_balance: wallet?.points_balance ?? 0,
      updated_at: wallet?.updated_at ?? null,
      transactions: txs ?? [],
      point_value_xof: Number(settings?.driver_point_value_xof ?? 1),
      min_redeem_pts: settings?.driver_min_redeem_pts ?? 0,
    };
  });

/** Convertit des points reward en FCFA, crédités sur le wallet marchand. */
export const redeemDriverPoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ points: z.number().int().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error, data: result } = await context.supabase.rpc("redeem_driver_points", { _points: data.points });
    if (error) throw new Error(error.message);
    return result as { ok: true; xof_credit: number; points_balance: number; wallet_balance_xof: number };
  });

/** Catalogue des pénalités (lecture publique, gestion réservée aux admins via admin.tsx + RLS). */
export const listDriverPenaltyRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("driver_penalty_rules")
      .select("*")
      .order("code", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Admin : applique manuellement une pénalité (ex. annulation signalée hors-app). */
export const adminApplyDriverPenalty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      driverId: z.string().uuid(),
      code: z.string().min(1),
      rideId: z.string().uuid().optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error, data: balance } = await context.supabase.rpc("admin_apply_driver_penalty", {
      _driver_id: data.driverId,
      _code: data.code,
      _ride_id: data.rideId ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { points_balance: balance as number };
  });
