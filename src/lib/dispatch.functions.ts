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

/**
 * Conducteur/livreur : son propre rapport de gains (équivalent personnel du
 * "Suivi financier KPI" admin) — CA, commission plateforme, bonus et part
 * chauffeur, par course, sur une période. Toujours filtré sur `userId` issu
 * du contexte d'auth (jamais d'un paramètre client) : aucun autre chauffeur
 * ne peut être consulté via cette fonction. Utilise `supabaseAdmin` pour lire
 * `ride_payouts`/`reward_settings`/`driver_reward_transactions` sans dépendre
 * des policies RLS (qui ne sont pas garanties d'autoriser ces lectures pour
 * un chauffeur simple), exactement comme `getMyWallet`.
 */
export const myEarningsReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      from: z.string(),
      to: z.string(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: payouts, error } = await supabaseAdmin
      .from("ride_payouts")
      .select("ride_id, gross_xof, commission_xof, net_xof, processed_at, status")
      .eq("driver_id", userId)
      .eq("status", "paid")
      .gte("processed_at", data.from)
      .lte("processed_at", data.to)
      .order("processed_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);

    const rideIds = (payouts ?? []).map((p) => p.ride_id);
    const rideMap = new Map<string, any>();
    if (rideIds.length) {
      const { data: rides } = await supabaseAdmin
        .from("rides")
        .select("id, category, city, pickup_address, dropoff_address, completed_at")
        .in("id", rideIds);
      for (const r of rides ?? []) rideMap.set(r.id, r);
    }

    const bonusByRide = new Map<string, number>();
    if (rideIds.length) {
      const { data: settings } = await supabaseAdmin
        .from("reward_settings")
        .select("driver_point_value_xof")
        .eq("id", true)
        .maybeSingle();
      const pointValueXof = Number(settings?.driver_point_value_xof ?? 1);

      const { data: rewardTx } = await supabaseAdmin
        .from("driver_reward_transactions")
        .select("ride_id, points, type")
        .eq("driver_id", userId)
        .in("ride_id", rideIds)
        .in("type", ["ride_accepted", "ride_completed", "referral_bonus"]);

      for (const tx of rewardTx ?? []) {
        if (!tx.ride_id) continue;
        const prev = bonusByRide.get(tx.ride_id) ?? 0;
        bonusByRide.set(tx.ride_id, prev + Math.round((tx.points ?? 0) * pointValueXof));
      }
    }

    const rows = (payouts ?? []).map((p) => {
      const ride = rideMap.get(p.ride_id);
      return {
        ride_id: p.ride_id,
        completed_at: ride?.completed_at ?? p.processed_at,
        category: ride?.category ?? null,
        city: ride?.city ?? null,
        pickup_address: ride?.pickup_address ?? null,
        dropoff_address: ride?.dropoff_address ?? null,
        price_xof: p.gross_xof ?? 0,
        commission_xof: p.commission_xof ?? 0,
        driver_earnings_xof: p.net_xof ?? 0,
        bonus_xof: bonusByRide.get(p.ride_id) ?? 0,
      };
    });

    const totals = {
      rides: rows.length,
      revenue_xof: rows.reduce((s, r) => s + r.price_xof, 0),
      commission_xof: rows.reduce((s, r) => s + r.commission_xof, 0),
      driver_earnings_xof: rows.reduce((s, r) => s + r.driver_earnings_xof, 0),
      bonus_xof: rows.reduce((s, r) => s + r.bonus_xof, 0),
    };

    return { rows, totals };
  });
