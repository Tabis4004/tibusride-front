import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Couche serveur du moteur de dispatch (push-offer).
 *
 * Le détail des règles (proximité, zone d'opération, expiration, ré-essai
 * sur conducteur libéré) vit côté SQL — voir
 * supabase/migrations/20260628000000_dispatch_engine.sql. Ces fonctions ne
 * font qu'exposer/sécuriser cet accès pour le front (RLS + RPC), sans
 * dupliquer la logique métier.
 */

/** Conducteur/livreur : signale sa position courante (tant qu'il est en ligne). */
export const reportMyLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("driver_profiles")
      .update({ current_lat: data.lat, current_lng: data.lng, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true as const };
  });

/** Conducteur/livreur : récupère sa zone d'opération (s'il en a défini une). */
export const getMyZone = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("driver_zones")
      .select("*")
      .eq("driver_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  });

/** Conducteur/livreur : définit/met à jour sa zone d'opération (cercle centre + rayon). */
export const setMyZone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      centerLat: z.number().min(-90).max(90),
      centerLng: z.number().min(-180).max(180),
      radiusKm: z.number().min(0.5).max(200),
      isActive: z.boolean().default(true),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: updated, error } = await supabase
      .from("driver_zones")
      .upsert(
        {
          driver_id: userId,
          center_lat: data.centerLat,
          center_lng: data.centerLng,
          radius_km: data.radiusKm,
          is_active: data.isActive,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "driver_id" },
      )
      .select("*")
      .single();
    if (error) throw error;
    return updated;
  });

/** Conducteur/livreur : désactive sa zone (redevient disponible partout dans son pays). */
export const clearMyZone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("driver_zones").delete().eq("driver_id", userId);
    if (error) throw error;
    return { ok: true as const };
  });

/** Conducteur/livreur : offre de course actuellement en attente de sa réponse, s'il y en a une. */
export const getMyPendingOffer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("ride_offers")
      .select("*, rides:ride_id(*)")
      .eq("driver_id", userId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("offered_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  });

/** Conducteur/livreur : accepte l'offre en cours pour cette course. */
export const acceptRideOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ rideId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: ride, error } = await supabase.rpc("accept_ride_offer", { _ride_id: data.rideId });
    if (error) throw new Error(error.message);
    return ride;
  });

/** Conducteur/livreur : refuse l'offre en cours — le moteur retente avec le candidat suivant. */
export const declineRideOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ rideId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.rpc("decline_ride_offer", { _ride_id: data.rideId });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
