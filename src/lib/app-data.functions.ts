import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/integrations/vercel/auth-middleware";
import { hasRole } from "@/integrations/vercel/auth";
import { queryOne, queryRows, serviceOne, sql, withUserContext } from "@/integrations/vercel/db";

async function assertRole(userId: string, role: string) {
  if (!(await hasRole(userId, role))) throw new Error(`Forbidden: ${role} role required`);
}

// ---------------------------------------------------------------------------
// Rides
// ---------------------------------------------------------------------------
export const listRecentRides = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) =>
    queryRows(
      context.userId,
      `SELECT id, pickup_address, dropoff_address, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
              city, category, created_at, status
       FROM public.rides
       WHERE passenger_id = $1 AND status IN ('completed','cancelled')
       ORDER BY created_at DESC LIMIT 5`,
      [context.userId],
    ),
  );

export const getCurrentRide = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) =>
    queryOne(
      context.userId,
      `SELECT * FROM public.rides
       WHERE passenger_id = $1 AND status IN ('requested','accepted','arriving','in_progress')
       ORDER BY created_at DESC LIMIT 1`,
      [context.userId],
    ),
  );

export const getRideById = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ rideId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) =>
    queryOne(context.userId, `SELECT * FROM public.rides WHERE id = $1`, [data.rideId]),
  );

export const createRide = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        pickup_address: z.string().min(3).max(200),
        dropoff_address: z.string().min(3).max(200),
        pickup_lat: z.number().nullable(),
        pickup_lng: z.number().nullable(),
        dropoff_lat: z.number().nullable(),
        dropoff_lng: z.number().nullable(),
        city: z.string(),
        category: z.string(),
        distance_km: z.number(),
        duration_min: z.number(),
        price_xof: z.number().int(),
        payment_method: z.enum(["mobile_money", "cash", "card"]),
        passenger_phone: z.string().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = await queryRows(
      context.userId,
      `INSERT INTO public.rides (
        passenger_id, pickup_address, dropoff_address, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
        city, category, distance_km, duration_min, price_xof, payment_method, passenger_phone, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::public.vehicle_category,$10,$11,$12,$13::public.payment_method,$14,'requested')
      RETURNING *`,
      [
        context.userId,
        data.pickup_address,
        data.dropoff_address,
        data.pickup_lat,
        data.pickup_lng,
        data.dropoff_lat,
        data.dropoff_lng,
        data.city,
        data.category,
        data.distance_km,
        data.duration_min,
        data.price_xof,
        data.payment_method,
        data.passenger_phone,
      ],
    );
    return rows[0];
  });

export const cancelRide = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ rideId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await queryRows(
      context.userId,
      `UPDATE public.rides SET status = 'cancelled', cancelled_at = now(), updated_at = now()
       WHERE id = $1 AND passenger_id = $2 RETURNING id`,
      [data.rideId, context.userId],
    );
    return { ok: true };
  });

export const listMyRides = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const asPassenger = await queryRows(
      context.userId,
      `SELECT * FROM public.rides WHERE passenger_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [context.userId],
    );
    const asDriver = await hasRole(context.userId, "driver")
      ? await queryRows(
          context.userId,
          `SELECT * FROM public.rides WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 50`,
          [context.userId],
        )
      : [];
    return { asPassenger, asDriver };
  });

export const getRideDriverPublic = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ rideId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const rows = await queryRows(
      context.userId,
      `SELECT * FROM public.get_ride_driver_public($1::uuid)`,
      [data.rideId],
    );
    return rows[0] ?? null;
  });

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------
export const getDriverProfile = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) =>
    queryOne(context.userId, `SELECT * FROM public.driver_profiles WHERE user_id = $1`, [context.userId]),
  );

export const upsertDriverProfile = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z.object({ city: z.string().optional(), license_number: z.string().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await queryRows(
      context.userId,
      `INSERT INTO public.driver_profiles (user_id, status) VALUES ($1, 'pending')
       ON CONFLICT (user_id) DO NOTHING`,
      [context.userId],
    );
    const rows = await queryRows(
      context.userId,
      `UPDATE public.driver_profiles SET city = COALESCE($2, city), license_number = COALESCE($3, license_number), updated_at = now()
       WHERE user_id = $1 RETURNING *`,
      [context.userId, data.city ?? null, data.license_number ?? null],
    );
    return rows[0];
  });

export const setDriverOnline = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ online: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await queryRows(
      context.userId,
      `UPDATE public.driver_profiles SET is_online = $2, updated_at = now() WHERE user_id = $1`,
      [context.userId, data.online],
    );
    return { ok: true };
  });

export const listOpenRides = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ city: z.string().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertRole(context.userId, "driver");
    if (data.city) {
      return queryRows(
        context.userId,
        `SELECT * FROM public.rides WHERE status = 'requested' AND city = $1 ORDER BY requested_at ASC LIMIT 20`,
        [data.city],
      );
    }
    return queryRows(
      context.userId,
      `SELECT * FROM public.rides WHERE status = 'requested' ORDER BY requested_at ASC LIMIT 20`,
      [],
    );
  });

export const claimRide = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ rideId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertRole(context.userId, "driver");
    const rows = await queryRows(
      context.userId,
      `UPDATE public.rides SET driver_id = $2, status = 'accepted', accepted_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'requested' AND driver_id IS NULL RETURNING *`,
      [data.rideId, context.userId],
    );
    if (!rows[0]) throw new Error("Course déjà prise ou indisponible");
    return rows[0];
  });

export const updateRideStatus = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        rideId: z.string().uuid(),
        status: z.enum(["arriving", "in_progress", "completed"]),
        driver_lat: z.number().optional(),
        driver_lng: z.number().optional(),
        eta_seconds: z.number().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { status: data.status };
    if (data.status === "in_progress") patch.started_at = new Date().toISOString();
    if (data.status === "completed") patch.completed_at = new Date().toISOString();
    const rows = await queryRows(
      context.userId,
      `UPDATE public.rides SET status = $2::public.ride_status,
        started_at = CASE WHEN $2 = 'in_progress' AND started_at IS NULL THEN now() ELSE started_at END,
        completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE completed_at END,
        driver_lat = COALESCE($3, driver_lat), driver_lng = COALESCE($4, driver_lng),
        eta_seconds = COALESCE($5, eta_seconds), updated_at = now()
       WHERE id = $1 AND driver_id = $6 RETURNING *`,
      [data.rideId, data.status, data.driver_lat ?? null, data.driver_lng ?? null, data.eta_seconds ?? null, context.userId],
    );
    if (!rows[0]) throw new Error("Mise à jour impossible");
    return rows[0];
  });

export const updateDriverLocation = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z.object({ rideId: z.string().uuid(), lat: z.number(), lng: z.number(), eta_seconds: z.number().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await queryRows(
      context.userId,
      `UPDATE public.rides SET driver_lat = $2, driver_lng = $3, driver_location_updated_at = now(),
        eta_seconds = COALESCE($4, eta_seconds), updated_at = now()
       WHERE id = $1 AND driver_id = $5`,
      [data.rideId, data.lat, data.lng, data.eta_seconds ?? null, context.userId],
    );
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Profiles & rewards
// ---------------------------------------------------------------------------
export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) =>
    queryOne(context.userId, `SELECT full_name, phone FROM public.profiles WHERE id = $1`, [data.userId]),
  );

export const getRewardSettings = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) =>
    queryOne(context.userId, `SELECT * FROM public.reward_settings WHERE id = true`, []),
  );

export const getReferralCode = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const rows = await queryRows(
      context.userId,
      `SELECT public.get_or_create_referral_code($1::uuid) AS code`,
      [context.userId],
    );
    return (rows[0] as { code: string }).code;
  });

export const claimShareReward = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ channel: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const rows = await queryRows(
      context.userId,
      `SELECT public.claim_driver_share_reward($1) AS result`,
      [data.channel],
    );
    return (rows[0] as { result: unknown }).result;
  });

export const registerReferral = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ code: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const rows = await queryRows(
      context.userId,
      `SELECT public.register_referral($1) AS result`,
      [data.code.trim().toUpperCase()],
    );
    return (rows[0] as { result: unknown }).result;
  });

export const getPassengerWallet = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) =>
    queryOne(context.userId, `SELECT * FROM public.passenger_wallets WHERE user_id = $1`, [context.userId]),
  );

export const getDriverWallet = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) =>
    queryOne(context.userId, `SELECT * FROM public.driver_wallets WHERE user_id = $1`, [context.userId]),
  );

export const listPassengerWalletTx = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) =>
    queryRows(
      context.userId,
      `SELECT * FROM public.passenger_wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [context.userId],
    ),
  );

export const listDriverWalletTx = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) =>
    queryRows(
      context.userId,
      `SELECT * FROM public.wallet_transactions WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [context.userId],
    ),
  );

export const listReferrals = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) =>
    queryRows(
      context.userId,
      `SELECT * FROM public.referrals WHERE referrer_id = $1 OR referee_id = $1 ORDER BY created_at DESC`,
      [context.userId],
    ),
  );

export const listTopupOrders = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) =>
    queryRows(
      context.userId,
      `SELECT * FROM public.topup_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [context.userId],
    ),
  );

export const createPendingTopup = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z.object({ amount_xof: z.number().int().positive(), provider: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) =>
    queryOne(
      context.userId,
      `INSERT INTO public.topup_orders (user_id, amount_xof, provider, status)
       VALUES ($1, $2, $3, 'pending') RETURNING *`,
      [context.userId, data.amount_xof, data.provider],
    ),
  );

export const listShareEvents = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) =>
    queryRows(
      context.userId,
      `SELECT * FROM public.share_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [context.userId],
    ),
  );

export const getRidePayout = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ rideId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) =>
    queryOne(context.userId, `SELECT * FROM public.ride_payouts WHERE ride_id = $1`, [data.rideId]),
  );

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------
export const listMyTickets = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) =>
    queryRows(
      context.userId,
      `SELECT * FROM public.support_tickets WHERE created_by = $1 ORDER BY last_message_at DESC`,
      [context.userId],
    ),
  );

export const listSupportInbox = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ filter: z.string().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    if (!(await hasRole(context.userId, "support")) && !(await hasRole(context.userId, "admin"))) {
      throw new Error("Forbidden");
    }
    const filter = data.filter ?? "active";
    if (filter === "active") {
      return queryRows(
        context.userId,
        `SELECT * FROM public.support_tickets WHERE status IN ('open','pending') ORDER BY last_message_at DESC LIMIT 100`,
        [],
      );
    }
    if (filter === "all") {
      return queryRows(context.userId, `SELECT * FROM public.support_tickets ORDER BY last_message_at DESC LIMIT 100`, []);
    }
    return queryRows(
      context.userId,
      `SELECT * FROM public.support_tickets WHERE status = $1::public.ticket_status ORDER BY last_message_at DESC LIMIT 100`,
      [filter],
    );
  });

export const getTicket = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ ticketId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) =>
    queryOne(context.userId, `SELECT * FROM public.support_tickets WHERE id = $1`, [data.ticketId]),
  );

export const listTicketMessages = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ ticketId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) =>
    queryRows(
      context.userId,
      `SELECT * FROM public.ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [data.ticketId],
    ),
  );

export const createTicket = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        subject: z.string().min(3).max(200),
        category: z.string(),
        body: z.string().min(1).max(4000),
        ride_id: z.string().uuid().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const tickets = await queryRows(
      context.userId,
      `INSERT INTO public.support_tickets (created_by, subject, category, ride_id)
       VALUES ($1, $2, $3::public.ticket_category, $4) RETURNING *`,
      [context.userId, data.subject, data.category, data.ride_id ?? null],
    );
    const ticket = tickets[0] as { id: string };
    await queryRows(
      context.userId,
      `INSERT INTO public.ticket_messages (ticket_id, author_id, body) VALUES ($1, $2, $3)`,
      [ticket.id, context.userId, data.body],
    );
    return tickets[0];
  });

export const postTicketMessage = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z.object({ ticketId: z.string().uuid(), body: z.string().min(1).max(4000), is_internal: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await queryRows(
      context.userId,
      `INSERT INTO public.ticket_messages (ticket_id, author_id, body, is_internal)
       VALUES ($1, $2, $3, $4)`,
      [data.ticketId, context.userId, data.body, data.is_internal ?? false],
    );
    return { ok: true };
  });

export const updateTicket = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ticketId: z.string().uuid(),
        status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        assigned_to: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = await queryRows(
      context.userId,
      `UPDATE public.support_tickets SET
        status = COALESCE($2::public.ticket_status, status),
        priority = COALESCE($3::public.ticket_priority, priority),
        assigned_to = COALESCE($4, assigned_to),
        updated_at = now(),
        closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE closed_at END
       WHERE id = $1 RETURNING *`,
      [data.ticketId, data.status ?? null, data.priority ?? null, data.assigned_to ?? null],
    );
    return rows[0];
  });

// ---------------------------------------------------------------------------
// Admin reads (simple)
// ---------------------------------------------------------------------------
export const adminListDrivers = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await assertRole(context.userId, "admin");
    return queryRows(
      context.userId,
      `SELECT dp.*, json_build_object('full_name', p.full_name, 'phone', p.phone, 'city', p.city) AS profiles
       FROM public.driver_profiles dp
       LEFT JOIN public.profiles p ON p.id = dp.user_id
       ORDER BY dp.created_at DESC LIMIT 500`,
      [],
    );
  });

export const adminListRides = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await assertRole(context.userId, "admin");
    return queryRows(context.userId, `SELECT * FROM public.rides ORDER BY created_at DESC LIMIT 100`, []);
  });

export const adminDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await assertRole(context.userId, "admin");
    const [total, completed, revenue, drivers] = await Promise.all([
      queryOne<{ count: string }>(context.userId, `SELECT count(*)::text AS count FROM public.rides`, []),
      queryOne<{ count: string }>(context.userId, `SELECT count(*)::text AS count FROM public.rides WHERE status = 'completed'`, []),
      queryOne<{ sum: string }>(
        context.userId,
        `SELECT COALESCE(sum(price_xof),0)::text AS sum FROM public.rides WHERE status = 'completed'`,
        [],
      ),
      queryOne<{ count: string }>(
        context.userId,
        `SELECT count(*)::text AS count FROM public.driver_profiles WHERE status = 'approved'`,
        [],
      ),
    ]);
    return {
      totalRides: Number(total?.count ?? 0),
      completedRides: Number(completed?.count ?? 0),
      revenueXof: Number(revenue?.sum ?? 0),
      approvedDrivers: Number(drivers?.count ?? 0),
    };
  });

export const adminListFraudLogs = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ kind: z.string().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertRole(context.userId, "admin");
    if (data.kind) {
      return queryRows(
        context.userId,
        `SELECT * FROM public.fraud_logs WHERE kind = $1 ORDER BY created_at DESC LIMIT 200`,
        [data.kind],
      );
    }
    return queryRows(context.userId, `SELECT * FROM public.fraud_logs ORDER BY created_at DESC LIMIT 200`, []);
  });

export const adminUpdateRewardSettings = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.record(z.unknown()).parse(d))
  .handler(async ({ data, context }) => {
    await assertRole(context.userId, "admin");
    const allowed = [
      "driver_share_bonus_xof",
      "driver_share_daily_cap",
      "driver_referral_bonus_xof",
      "driver_referral_per_ride_xof",
      "passenger_referral_bonus_pts",
      "passenger_ride_earn_pts",
      "point_value_xof",
    ] as const;
    const sets: string[] = [];
    const vals: unknown[] = [context.userId];
    let i = 2;
    for (const key of allowed) {
      if (key in data) {
        sets.push(`${key} = $${i}`);
        vals.push(data[key]);
        i++;
      }
    }
    if (sets.length === 0) throw new Error("Nothing to update");
    sets.push("updated_at = now()");
    await queryRows(
      context.userId,
      `UPDATE public.reward_settings SET ${sets.join(", ")} WHERE id = true RETURNING *`,
      vals.slice(1),
    );
    return { ok: true };
  });

/** Webhook: confirm topup without user session */
export const serviceConfirmTopup = async (topupId: string, providerRef?: string) => {
  const rows = await serviceOne<{ result: unknown }>(
    `SELECT public.confirm_topup($1::uuid, $2) AS result`,
    [topupId, providerRef ?? null],
  );
  return rows?.result;
};

export const serviceApplyWalletTx = async (args: {
  driver_id: string;
  type: string;
  amount_xof: number;
  ride_id?: string | null;
  reference?: string | null;
  notes?: string | null;
  actor?: string | null;
}) => {
  const rows = await serviceOne<{ balance: number }>(
    `SELECT public.apply_wallet_transaction($1::uuid, $2::public.wallet_tx_type, $3, $4::uuid, $5, $6, $7::uuid) AS balance`,
    [
      args.driver_id,
      args.type,
      args.amount_xof,
      args.ride_id ?? null,
      args.reference ?? null,
      args.notes ?? null,
      args.actor ?? null,
    ],
  );
  return rows?.balance;
};

export const ensureDriverWallet = async (userId: string) => {
  await withUserContext(userId, async () => {
    await sql`
      INSERT INTO public.driver_wallets (user_id, balance_xof) VALUES (${userId}::uuid, 0)
      ON CONFLICT (user_id) DO NOTHING
    `;
  });
};
