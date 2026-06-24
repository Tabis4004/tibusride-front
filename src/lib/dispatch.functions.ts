import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveServiceCity, countryForCity, countryForCoords } from "@/lib/pricing";

/**
 * Couche serveur du moteur de dispatch (push-offer).
 *
 * Le détail des règles (proximité, zone d'opération, expiration, ré-essai
 * sur conducteur libéré) vit côté SQL — voir
 * supabase/migrations/20260628000000_dispatch_engine.sql. Ces fonctions ne
 * font qu'exposer/sécuriser cet accès pour le front (RLS + RPC), sans
 * dupliquer la logique métier.
 */

/**
 * Conducteur/livreur : signale sa position courante (tant qu'il est en ligne).
 *
 * Auto-correction ville/pays : `driver_profiles.city` et `profiles.country`
 * étaient figés depuis l'enrôlement et ne reflétaient plus la position réelle
 * d'un chauffeur ayant changé de zone (ex. enrôlé à Dakar mais opérant
 * désormais à Abidjan) — résultat : le filtre pays+ville de "Courses
 * disponibles" ne matchait plus jamais aucune course. On recalcule donc ces
 * deux champs à chaque report de position via `resolveServiceCity` (qui a une
 * hystérésis : ne change de ville que si le GPS sort largement du rayon de la
 * ville enregistrée, pour éviter le flapping près d'une frontière de zone) et
 * on ne réécrit en base que si la valeur a réellement changé.
 */
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

    const [{ data: dp }, { data: profile }] = await Promise.all([
      supabase.from("driver_profiles").select("city").eq("user_id", userId).maybeSingle(),
      supabase.from("profiles").select("country").eq("id", userId).maybeSingle(),
    ]);

    const gps = { lat: data.lat, lng: data.lng };
    const resolvedCity = resolveServiceCity({ profileCity: dp?.city, profileCountry: profile?.country, gps });
    const resolvedCountry = countryForCity(resolvedCity) ?? countryForCoords(gps);

    const driverPatch: { current_lat: number; current_lng: number; updated_at: string; city?: string } = {
      current_lat: data.lat,
      current_lng: data.lng,
      updated_at: new Date().toISOString(),
    };
    if (resolvedCity && resolvedCity !== dp?.city) driverPatch.city = resolvedCity;

    const { error } = await supabase.from("driver_profiles").update(driverPatch).eq("user_id", userId);
    if (error) throw error;

    if (resolvedCountry && resolvedCountry !== profile?.country) {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ country: resolvedCountry })
        .eq("id", userId);
      if (profileError) throw profileError;
    }

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

/**
 * Conducteur/livreur : offre de course actuellement en attente de sa réponse,
 * s'il y en a une.
 *
 * IMPORTANT (confidentialité avant acceptation) : avant que le chauffeur
 * n'accepte, il ne doit voir QUE des informations minimales (distance, type
 * de véhicule/catégorie, ville) — jamais le prix, l'adresse précise de
 * départ/arrivée, ni l'identité du passager. Comme RLS ne filtre que les
 * LIGNES (pas les colonnes), un `select("*, rides:ride_id(*)")` exposerait
 * toutes ces colonnes sensibles dans la réponse réseau même si l'UI ne les
 * affiche pas (visible via les devtools réseau). On fait donc deux requêtes
 * séparées avec une projection de colonnes minimale sur `rides`.
 */
export const getMyPendingOffer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: offer, error } = await supabase
      .from("ride_offers")
      .select("id, ride_id, driver_id, distance_km, status, offered_at, expires_at")
      .eq("driver_id", userId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("offered_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!offer) return null;

    const { data: ride, error: rideError } = await supabase
      .from("rides")
      .select("id, service_type, category, delivery_vehicle, city, distance_km, duration_min")
      .eq("id", offer.ride_id)
      .maybeSingle();
    if (rideError) throw rideError;

    return { ...offer, rides: ride };
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

/**
 * Conducteur/livreur (mode self_assign) : signale qu'il a ignoré ou laissé
 * expirer le popup "nouvelle course disponible" sans réagir — applique la
 * pénalité reward EN POINTS (wallet reward séparé, pas le wallet FCFA) ainsi
 * qu'une régression temporaire dans le classement de dispatch, configurées
 * par les admins (table driver_penalty_rules, code 'self_assign_ignored').
 * Idempotent côté SQL par (driver, ride).
 */
export const penalizeSelfIgnoredRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ rideId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: balance, error } = await supabase.rpc("penalize_self_ignored_ride", { _ride_id: data.rideId });
    if (error) throw new Error(error.message);
    return { points_balance: balance as number };
  });
