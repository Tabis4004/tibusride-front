import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertServiceCountry } from "@/lib/countries";
import { defaultCityForCountry } from "@/lib/pricing";

const rideIdInput = (d: unknown) => z.object({ rideId: z.string().uuid() }).parse(d);

/** Load the full tracking history for a ride (status changes + driver positions). */
export const getRideHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(rideIdInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: ride, error: rErr } = await supabase
      .from("rides").select("*").eq("id", data.rideId).maybeSingle();
    if (rErr) throw rErr;
    if (!ride) throw new Error("Course introuvable");
    if (ride.passenger_id !== userId && ride.driver_id !== userId) {
      const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
      if (!isAdmin) throw new Error("Accès refusé");
    }
    const { data: events, error: eErr } = await supabase
      .from("ride_tracking_events").select("*").eq("ride_id", data.rideId)
      .order("created_at", { ascending: true });
    if (eErr) throw eErr;
    return { ride, events: events ?? [] };
  });

/** Build a CSV string of all tracking events for a ride. */
export const exportRideHistoryCsv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(rideIdInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: ride } = await supabase.from("rides").select("passenger_id,driver_id").eq("id", data.rideId).maybeSingle();
    if (!ride) throw new Error("Course introuvable");
    if (ride.passenger_id !== userId && ride.driver_id !== userId) {
      const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
      if (!isAdmin) throw new Error("Accès refusé");
    }
    const { data: events } = await supabase
      .from("ride_tracking_events").select("*").eq("ride_id", data.rideId)
      .order("created_at", { ascending: true });
    const header = "timestamp,type,status,lat,lng,actor_id,details";
    const rows = (events ?? []).map((e: any) => [
      e.created_at, e.event_type, e.status ?? "", e.lat ?? "", e.lng ?? "",
      e.actor_id ?? "", JSON.stringify(e.details ?? {}).replace(/"/g, '""'),
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    return { csv: [header, ...rows].join("\n") };
  });

/** Toggle the caller's phone-share flag on a ride. Logs the change. */
export const toggleContactShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ rideId: z.string().uuid(), share: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: ride } = await supabase.from("rides").select("passenger_id,driver_id").eq("id", data.rideId).maybeSingle();
    if (!ride) throw new Error("Course introuvable");
    const isPassenger = ride.passenger_id === userId;
    const isDriver = ride.driver_id === userId;
    if (!isPassenger && !isDriver) throw new Error("Accès refusé");
    const patch = isPassenger ? { passenger_shares_phone: data.share } : { driver_shares_phone: data.share };
    const { error } = await supabase.from("rides").update(patch).eq("id", data.rideId);
    if (error) throw error;
    await supabase.from("ride_tracking_events").insert({
      ride_id: data.rideId, event_type: "contact_toggle", actor_id: userId,
      details: { role: isPassenger ? "passenger" : "driver", share: data.share },
    });
    return { ok: true };
  });

/** Log that a contact phone was viewed (consent traceability). */
export const logContactView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ rideId: z.string().uuid(), target: z.enum(["passenger", "driver"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await context.supabase.from("ride_tracking_events").insert({
      ride_id: data.rideId, event_type: "contact_view", actor_id: context.userId,
      details: { target: data.target },
    });
    return { ok: true };
  });

/** Get or create notification preferences for the current user. */
export const getNotificationPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase.from("notification_prefs").select("*").eq("user_id", userId).maybeSingle();
    if (data) return data;
    const { data: inserted, error } = await supabase
      .from("notification_prefs").insert({ user_id: userId }).select().single();
    if (error) throw error;
    return inserted;
  });

export const updateNotificationPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      notify_status_change: z.boolean().optional(),
      notify_driver_arriving: z.boolean().optional(),
      notify_driver_nearby: z.boolean().optional(),
      notify_new_ride: z.boolean().optional(),
      channel_toast: z.boolean().optional(),
      channel_system: z.boolean().optional(),
      sound_enabled: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("notification_prefs")
      .upsert({ user_id: userId, ...data, updated_at: new Date().toISOString() });
    if (error) throw error;
    return { ok: true };
  });

function parseCountryField(country: string) {
  return assertServiceCountry(country);
}

/** Allow a user to change their country after sign-up. Re-scopes which rides they see. */
export const updateMyCountry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => {
    const parsed = z.object({ country: z.string().min(1) }).parse(d);
    return { country: parseCountryField(parsed.country) };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isSuper } = await supabase.rpc("has_role", { _user_id: userId, _role: "superadmin" });
    if (isSuper) throw new Error("Un superadmin ne peut pas être rattaché à un pays.");
    const country = assertServiceCountry(data.country);
    const { error } = await supabase.from("profiles")
      .update({ country, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (error) throw error;
    return { ok: true, country };
  });

/** Compléter le profil après inscription Google (pays, téléphone, nom). */
export const completeMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => {
    const parsed = z.object({
      country: z.string().min(1),
      phone: z.string().trim().min(8, "Téléphone requis").max(20),
      full_name: z.string().trim().min(2, "Nom requis").max(80),
    }).parse(d);
    return { ...parsed, country: parseCountryField(parsed.country) };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isSuper } = await supabase.rpc("has_role", { _user_id: userId, _role: "superadmin" });
    if (isSuper) throw new Error("Profil superadmin déjà complet.");
    const country = assertServiceCountry(data.country);
    const city = defaultCityForCountry(country);
    const { error } = await supabase.from("profiles").update({
      country,
      city: city ?? null,
      phone: data.phone,
      full_name: data.full_name,
      updated_at: new Date().toISOString(),
    }).eq("id", userId);
    if (error) throw error;
    return { ok: true, country };
  });
