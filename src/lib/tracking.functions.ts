import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/integrations/vercel/auth-middleware";
import { hasRole } from "@/integrations/vercel/auth";
import { queryOne, queryRows } from "@/integrations/vercel/db";

const rideIdInput = (d: unknown) => z.object({ rideId: z.string().uuid() }).parse(d);

async function assertRideAccess(userId: string, rideId: string) {
  const ride = await queryOne<{ passenger_id: string; driver_id: string | null }>(
    userId,
    `SELECT passenger_id, driver_id FROM public.rides WHERE id = $1`,
    [rideId],
  );
  if (!ride) throw new Error("Course introuvable");
  if (ride.passenger_id !== userId && ride.driver_id !== userId && !(await hasRole(userId, "admin"))) {
    throw new Error("Accès refusé");
  }
  return ride;
}

export const getRideHistory = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator(rideIdInput)
  .handler(async ({ data, context }) => {
    await assertRideAccess(context.userId, data.rideId);
    const ride = await queryOne(context.userId, `SELECT * FROM public.rides WHERE id = $1`, [data.rideId]);
    const events = await queryRows(
      context.userId,
      `SELECT * FROM public.ride_tracking_events WHERE ride_id = $1 ORDER BY created_at ASC`,
      [data.rideId],
    );
    return { ride, events };
  });

export const exportRideHistoryCsv = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator(rideIdInput)
  .handler(async ({ data, context }) => {
    await assertRideAccess(context.userId, data.rideId);
    const events = await queryRows(
      context.userId,
      `SELECT * FROM public.ride_tracking_events WHERE ride_id = $1 ORDER BY created_at ASC`,
      [data.rideId],
    );
    const header = "timestamp,type,status,lat,lng,actor_id,details";
    const rows = events.map((e) => {
      const ev = e as Record<string, unknown>;
      return [
        ev.created_at,
        ev.event_type,
        ev.status ?? "",
        ev.lat ?? "",
        ev.lng ?? "",
        ev.actor_id ?? "",
        JSON.stringify(ev.details ?? {}),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",");
    });
    return { csv: [header, ...rows].join("\n") };
  });

export const toggleContactShare = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ rideId: z.string().uuid(), share: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const ride = await assertRideAccess(context.userId, data.rideId);
    const isPassenger = ride.passenger_id === context.userId;
    const isDriver = ride.driver_id === context.userId;
    if (!isPassenger && !isDriver) throw new Error("Accès refusé");
    if (isPassenger) {
      await queryRows(
        context.userId,
        `UPDATE public.rides SET passenger_shares_phone = $2, updated_at = now() WHERE id = $1`,
        [data.rideId, data.share],
      );
    } else {
      await queryRows(
        context.userId,
        `UPDATE public.rides SET driver_shares_phone = $2, updated_at = now() WHERE id = $1`,
        [data.rideId, data.share],
      );
    }
    await queryRows(
      context.userId,
      `INSERT INTO public.ride_tracking_events (ride_id, event_type, actor_id, details)
       VALUES ($1, 'contact_toggle', $2, $3::jsonb)`,
      [
        data.rideId,
        context.userId,
        JSON.stringify({ role: isPassenger ? "passenger" : "driver", share: data.share }),
      ],
    );
    return { ok: true };
  });

export const logContactView = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ rideId: z.string().uuid(), target: z.enum(["passenger", "driver"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await queryRows(
      context.userId,
      `INSERT INTO public.ride_tracking_events (ride_id, event_type, actor_id, details)
       VALUES ($1, 'contact_view', $2, $3::jsonb)`,
      [data.rideId, context.userId, JSON.stringify({ target: data.target })],
    );
    return { ok: true };
  });

export const getNotificationPrefs = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const existing = await queryOne(
      context.userId,
      `SELECT * FROM public.notification_prefs WHERE user_id = $1`,
      [context.userId],
    );
    if (existing) return existing;
    const rows = await queryRows(
      context.userId,
      `INSERT INTO public.notification_prefs (user_id) VALUES ($1) RETURNING *`,
      [context.userId],
    );
    return rows[0];
  });

export const updateNotificationPrefs = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        notify_status_change: z.boolean().optional(),
        notify_driver_arriving: z.boolean().optional(),
        notify_driver_nearby: z.boolean().optional(),
        sound_enabled: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await queryRows(
      context.userId,
      `INSERT INTO public.notification_prefs (user_id, notify_status_change, notify_driver_arriving, notify_driver_nearby, sound_enabled)
       VALUES ($1, COALESCE($2,true), COALESCE($3,true), COALESCE($4,true), COALESCE($5,true))
       ON CONFLICT (user_id) DO UPDATE SET
         notify_status_change = COALESCE($2, notification_prefs.notify_status_change),
         notify_driver_arriving = COALESCE($3, notification_prefs.notify_driver_arriving),
         notify_driver_nearby = COALESCE($4, notification_prefs.notify_driver_nearby),
         sound_enabled = COALESCE($5, notification_prefs.sound_enabled),
         updated_at = now()`,
      [
        context.userId,
        data.notify_status_change ?? null,
        data.notify_driver_arriving ?? null,
        data.notify_driver_nearby ?? null,
        data.sound_enabled ?? null,
      ],
    );
    return { ok: true };
  });
