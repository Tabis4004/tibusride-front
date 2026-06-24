-- Phase 2.1 — Règle de classement plus souple : un conducteur en pleine
-- course (en route vers son dépose, donc bientôt libre) peut passer devant
-- un conducteur idle mais plus loin, si sa position courante (live tracking)
-- est plus proche du point de prise en charge de la nouvelle course.
--
-- Logique : "disponibilité probable + proximité" > "disponibilité actuelle
-- mais loin". On ne change que dispatch_rank_candidates (point de classement
-- des candidats) — le reste du pipeline (offre, acceptation, expiration,
-- ré-essai) est inchangé. L'acceptation d'une offre pendant qu'une course est
-- déjà 'in_progress' fonctionne déjà : driver.tsx affiche plusieurs courses
-- actives (accepted/arriving/in_progress) pour un même conducteur — la
-- nouvelle course est simplement mise en file, prête dès qu'il termine.
--
-- Garde-fous pour ne pas suren-fourner un conducteur occupé :
--   - seul le statut 'in_progress' (déjà en route vers le dépose, donc proche
--     de se libérer) est éligible — pas 'accepted'/'arriving' (encore loin
--     d'être libre, en route vers SA prise en charge).
--   - un conducteur déjà occupé ne peut avoir qu'UNE course suivante en file
--     (status 'accepted'/'arriving' déjà existante) avant d'en recevoir une
--     autre.
--   - un conducteur ne reçoit jamais deux offres 'pending' simultanées,
--     occupé ou pas.

CREATE OR REPLACE FUNCTION public.dispatch_rank_candidates(_ride_id uuid)
RETURNS TABLE(driver_id uuid, distance_km double precision)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.rides WHERE id = _ride_id;
  IF r IS NULL OR r.status <> 'requested' OR r.driver_id IS NOT NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH effective_position AS (
    SELECT
      dp.user_id,
      -- Position effective : si le conducteur est en pleine course (en route
      -- vers son dépose), on utilise sa position live de cette course
      -- (signal le plus fiable de "où il sera bientôt libre"). Sinon, sa
      -- position idle remontée en continu.
      COALESCE(active.driver_lat, dp.current_lat) AS eff_lat,
      COALESCE(active.driver_lng, dp.current_lng) AS eff_lng,
      active.id IS NOT NULL AS is_busy_finishing
    FROM public.driver_profiles dp
    LEFT JOIN LATERAL (
      SELECT rr.id, rr.driver_lat, rr.driver_lng
      FROM public.rides rr
      WHERE rr.driver_id = dp.user_id AND rr.status = 'in_progress'
      LIMIT 1
    ) active ON true
    WHERE dp.status = 'approved'
      AND dp.is_online
      AND dp.partner_type = r.service_type
      AND (
        -- candidat disponible maintenant
        (active.id IS NULL AND dp.current_lat IS NOT NULL AND dp.current_lng IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.rides r2
           WHERE r2.driver_id = dp.user_id AND r2.status IN ('accepted', 'arriving', 'in_progress')
         ))
        OR
        -- candidat bientôt disponible : en route vers son dépose, pas déjà
        -- de course suivante en file
        (active.id IS NOT NULL AND active.driver_lat IS NOT NULL AND active.driver_lng IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.rides r3
           WHERE r3.driver_id = dp.user_id AND r3.status IN ('accepted', 'arriving')
         ))
      )
  )
  SELECT ep.user_id, public.haversine_km(ep.eff_lat, ep.eff_lng, r.pickup_lat, r.pickup_lng)
  FROM effective_position ep
  JOIN public.driver_profiles dp ON dp.user_id = ep.user_id
  JOIN public.profiles pr ON pr.id = dp.user_id
  LEFT JOIN public.driver_zones dz ON dz.driver_id = dp.user_id AND dz.is_active
  WHERE (r.country IS NULL OR pr.country = r.country)
    AND (
      (r.service_type = 'delivery' AND dp.assigned_category = 'delivery_' || r.delivery_vehicle)
      OR (r.service_type <> 'delivery' AND dp.assigned_category = r.category::text)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.ride_offers ro
      WHERE ro.ride_id = _ride_id AND ro.driver_id = dp.user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.ride_offers ro2
      WHERE ro2.driver_id = dp.user_id AND ro2.status = 'pending' AND ro2.expires_at > now()
    )
    AND (dz.id IS NULL OR public.haversine_km(dz.center_lat, dz.center_lng, r.pickup_lat, r.pickup_lng) <= dz.radius_km)
  ORDER BY public.haversine_km(ep.eff_lat, ep.eff_lng, r.pickup_lat, r.pickup_lng) ASC
  LIMIT 10;
END;
$$;

COMMENT ON FUNCTION public.dispatch_rank_candidates(uuid) IS
  'Classement des candidats pour une course : inclut les conducteurs idle '
  '(disponibles maintenant) ET les conducteurs en pleine course en route vers '
  'leur dépose (bientôt disponibles), classés ensemble par proximité réelle '
  'au point de prise en charge. Un conducteur "bientôt libre mais proche" '
  'passe devant un conducteur idle mais loin.';
