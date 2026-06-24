-- Phase 2 — Moteur de dispatch évolutif (push-offer) pour rides/livraisons.
--
-- Objectif produit (demande explicite) : réduire le temps d'attente du
-- client en proposant activement la course au conducteur/livreur le plus
-- proche, plutôt que de laisser tout le monde "se servir" dans une liste
-- ouverte (modèle self_assign actuel, conservé tel quel et inchangé).
--
-- Conçu pour être évolutif : `dispatch_mode` (déjà présent sur
-- market_programs) pilote le comportement par programme :
--   - 'self_assign'   -> AUCUN changement de comportement. Pas d'offre créée,
--                        la liste ouverte + le verrou optimiste existants
--                        (driver.tsx) continuent de fonctionner à l'identique.
--   - 'proximity'     -> moteur de push-offer implémenté ici : on calcule le
--                        conducteur disponible le plus proche (zone
--                        d'opération respectée) et on lui propose la course
--                        avec un délai de réponse (ride_offers). S'il refuse
--                        ou n'a pas répondu à temps, on passe au suivant.
--   - 'fair_rotation' -> réservé pour une implémentation future (no-op pour
--                        l'instant, se comporte comme self_assign). On
--                        ajoutera la règle ici quand le besoin marché sera
--                        confirmé, sans toucher au reste du moteur.
--
-- Toute nouvelle règle d'attribution future se branche dans
-- `dispatch_offer_next()` ci-dessous (un seul point d'entrée), ce qui rend
-- le système extensible sans réécrire le reste du pipeline (offres,
-- acceptation, expiration, ré-essai au moment où un conducteur se libère).

-- ============================================================================
-- 1. Distance à vol d'oiseau (pas de PostGIS nécessaire pour ce besoin).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.haversine_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN NULL
    ELSE 2 * 6371 * asin(sqrt(
      sin(radians(lat2 - lat1) / 2) ^ 2 +
      cos(radians(lat1)) * cos(radians(lat2)) *
      sin(radians(lng2 - lng1) / 2) ^ 2
    ))
  END;
$$;

-- ============================================================================
-- 2. Zone d'opération du conducteur/livreur (cercle centre + rayon).
--    Une zone est optionnelle : un conducteur sans zone définie n'est jamais
--    restreint géographiquement (comportement actuel inchangé par défaut).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.driver_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  center_lat double precision NOT NULL,
  center_lng double precision NOT NULL,
  radius_km numeric NOT NULL DEFAULT 5 CHECK (radius_km > 0 AND radius_km <= 200),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_driver_zones_touch
  BEFORE UPDATE ON public.driver_zones
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.driver_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers manage own zone"
  ON public.driver_zones FOR ALL
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

CREATE POLICY "Superadmins read driver zones"
  ON public.driver_zones FOR SELECT
  USING (public.is_superadmin(auth.uid()));

-- ============================================================================
-- 3. Offres de course (push-offer) : une ligne = "cette course a été
--    proposée à ce conducteur, avec une fenêtre de réponse".
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ride_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'superseded')),
  distance_km numeric,
  sequence_no integer NOT NULL DEFAULT 1,
  offered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ride_id, driver_id)
);

CREATE INDEX IF NOT EXISTS ride_offers_ride_idx ON public.ride_offers (ride_id, status);
CREATE INDEX IF NOT EXISTS ride_offers_driver_idx ON public.ride_offers (driver_id, status);
CREATE INDEX IF NOT EXISTS ride_offers_pending_expiry_idx ON public.ride_offers (expires_at) WHERE status = 'pending';

ALTER TABLE public.ride_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers see own offers"
  ON public.ride_offers FOR SELECT
  USING (driver_id = auth.uid());

CREATE POLICY "Superadmins read all offers"
  ON public.ride_offers FOR SELECT
  USING (public.is_superadmin(auth.uid()));

-- Pas de policy INSERT/UPDATE pour "authenticated" : toute écriture passe par
-- les fonctions SECURITY DEFINER ci-dessous, qui appliquent elles-mêmes les
-- contrôles d'accès nécessaires (le conducteur ne peut répondre qu'à ses
-- propres offres).

-- ============================================================================
-- 4. Configuration évolutive par programme : délai de réponse à une offre.
-- ============================================================================
ALTER TABLE public.market_programs
  ADD COLUMN IF NOT EXISTS dispatch_offer_seconds integer NOT NULL DEFAULT 25
    CHECK (dispatch_offer_seconds BETWEEN 5 AND 120);

-- ============================================================================
-- 5. Classement des candidats pour une course donnée.
--    Point d'extension : c'est ICI qu'on branchera de futures règles
--    (fair_rotation, score multi-critères, etc.) selon le dispatch_mode du
--    programme. Pour 'proximity', la règle est : le plus proche, dans sa
--    zone d'opération si définie, disponible, catégorie/pays compatibles.
-- ============================================================================
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
  SELECT dp.user_id, public.haversine_km(dp.current_lat, dp.current_lng, r.pickup_lat, r.pickup_lng)
  FROM public.driver_profiles dp
  JOIN public.profiles pr ON pr.id = dp.user_id
  LEFT JOIN public.driver_zones dz ON dz.driver_id = dp.user_id AND dz.is_active
  WHERE dp.status = 'approved'
    AND dp.is_online
    AND dp.partner_type = r.service_type
    AND dp.current_lat IS NOT NULL AND dp.current_lng IS NOT NULL
    AND (r.country IS NULL OR pr.country = r.country)
    AND (
      (r.service_type = 'delivery' AND dp.assigned_category = 'delivery_' || r.delivery_vehicle)
      OR (r.service_type <> 'delivery' AND dp.assigned_category = r.category::text)
    )
    -- Pas déjà sollicité pour cette course (peu importe le statut de l'offre)
    AND NOT EXISTS (
      SELECT 1 FROM public.ride_offers ro
      WHERE ro.ride_id = _ride_id AND ro.driver_id = dp.user_id
    )
    -- Pas déjà occupé sur une autre course active
    AND NOT EXISTS (
      SELECT 1 FROM public.rides r2
      WHERE r2.driver_id = dp.user_id AND r2.status IN ('accepted', 'arriving', 'in_progress')
    )
    -- Zone d'opération : optionnelle, respectée si définie
    AND (dz.id IS NULL OR public.haversine_km(dz.center_lat, dz.center_lng, r.pickup_lat, r.pickup_lng) <= dz.radius_km)
  ORDER BY public.haversine_km(dp.current_lat, dp.current_lng, r.pickup_lat, r.pickup_lng) ASC
  LIMIT 10;
END;
$$;

-- ============================================================================
-- 6. Point d'entrée unique : propose la course au meilleur candidat suivant.
--    No-op silencieux si le programme n'est pas en mode 'proximity' (ou pas
--    encore une règle implémentée) -> comportement self_assign inchangé.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.dispatch_offer_next(_ride_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mode text;
  v_offer_seconds integer;
  v_ride record;
  v_candidate record;
  v_next_seq integer;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = _ride_id;
  IF v_ride IS NULL OR v_ride.status <> 'requested' OR v_ride.driver_id IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT mp.dispatch_mode, mp.dispatch_offer_seconds
    INTO v_mode, v_offer_seconds
  FROM public.market_programs mp
  WHERE mp.program_id = v_ride.program_id;

  -- 'self_assign' et toute valeur non (encore) implémentée (ex: fair_rotation)
  -- restent un no-op explicite : on documente l'intention plutôt que de
  -- planter, pour rester évolutif sans casser les programmes existants.
  IF v_mode IS DISTINCT FROM 'proximity' THEN
    RETURN NULL;
  END IF;

  v_offer_seconds := COALESCE(v_offer_seconds, 25);

  -- Une offre en cours (encore valide) suffit : pas de double-offre simultanée.
  IF EXISTS (
    SELECT 1 FROM public.ride_offers
    WHERE ride_id = _ride_id AND status = 'pending' AND expires_at > now()
  ) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_candidate FROM public.dispatch_rank_candidates(_ride_id) LIMIT 1;
  IF v_candidate IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(MAX(sequence_no), 0) + 1 INTO v_next_seq
  FROM public.ride_offers WHERE ride_id = _ride_id;

  INSERT INTO public.ride_offers (ride_id, driver_id, distance_km, sequence_no, expires_at)
  VALUES (_ride_id, v_candidate.driver_id, v_candidate.distance_km, v_next_seq, now() + (v_offer_seconds || ' seconds')::interval);

  RETURN v_candidate.driver_id;
END;
$$;

-- ============================================================================
-- 7. Acceptation / refus d'une offre par le conducteur.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.accept_ride_offer(_ride_id uuid)
RETURNS public.rides
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_driver uuid := auth.uid();
  v_updated public.rides;
BEGIN
  IF v_driver IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ride_offers
    WHERE ride_id = _ride_id AND driver_id = v_driver AND status = 'pending' AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'Cette offre n''est plus disponible';
  END IF;

  UPDATE public.rides
  SET driver_id = v_driver, status = 'accepted', accepted_at = now()
  WHERE id = _ride_id AND status = 'requested' AND driver_id IS NULL
  RETURNING * INTO v_updated;

  IF v_updated IS NULL THEN
    UPDATE public.ride_offers SET status = 'expired', responded_at = now()
    WHERE ride_id = _ride_id AND driver_id = v_driver;
    RAISE EXCEPTION 'Course déjà prise par un autre conducteur';
  END IF;

  UPDATE public.ride_offers SET status = 'accepted', responded_at = now()
  WHERE ride_id = _ride_id AND driver_id = v_driver;

  UPDATE public.ride_offers SET status = 'superseded', responded_at = now()
  WHERE ride_id = _ride_id AND driver_id <> v_driver AND status = 'pending';

  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_ride_offer(_ride_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_driver uuid := auth.uid();
BEGIN
  IF v_driver IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  UPDATE public.ride_offers SET status = 'declined', responded_at = now()
  WHERE ride_id = _ride_id AND driver_id = v_driver AND status = 'pending';

  PERFORM public.dispatch_offer_next(_ride_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_ride_offer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_ride_offer(uuid) TO authenticated;

-- ============================================================================
-- 8. Déclencheurs : nouvelle demande -> tenter une offre immédiatement ;
--    conducteur qui se libère (course terminée/annulée) -> retenter les
--    courses encore ouvertes à proximité (c'est ce qui permet à un
--    conducteur en fin de course de se voir proposer la course suivante dès
--    qu'il devient le plus proche disponible, sans attendre).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.dispatch_after_ride_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'requested' THEN
    PERFORM public.dispatch_offer_next(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dispatch_on_ride_insert ON public.rides;
CREATE TRIGGER dispatch_on_ride_insert
  AFTER INSERT ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_after_ride_insert();

CREATE OR REPLACE FUNCTION public.dispatch_after_driver_freed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lat double precision;
  v_lng double precision;
  v_ride_id uuid;
BEGIN
  IF NEW.status NOT IN ('completed', 'cancelled') OR OLD.status = NEW.status OR NEW.driver_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Position la plus fraîche du conducteur qui vient de se libérer.
  v_lat := COALESCE(NEW.driver_lat, (SELECT current_lat FROM public.driver_profiles WHERE user_id = NEW.driver_id));
  v_lng := COALESCE(NEW.driver_lng, (SELECT current_lng FROM public.driver_profiles WHERE user_id = NEW.driver_id));

  IF v_lat IS NULL OR v_lng IS NULL THEN
    RETURN NEW;
  END IF;

  -- On garde la position à jour pour les prochains calculs de proximité.
  UPDATE public.driver_profiles SET current_lat = v_lat, current_lng = v_lng
  WHERE user_id = NEW.driver_id AND (current_lat IS DISTINCT FROM v_lat OR current_lng IS DISTINCT FROM v_lng);

  -- Courses encore ouvertes à proximité (rayon large, le classement précis
  -- reste géré par dispatch_rank_candidates) : on retente une offre pour
  -- chacune, la plus proche en premier.
  FOR v_ride_id IN
    SELECT r.id FROM public.rides r
    WHERE r.status = 'requested' AND r.driver_id IS NULL
      AND public.haversine_km(v_lat, v_lng, r.pickup_lat, r.pickup_lng) <= 15
    ORDER BY public.haversine_km(v_lat, v_lng, r.pickup_lat, r.pickup_lng) ASC
    LIMIT 5
  LOOP
    PERFORM public.dispatch_offer_next(v_ride_id);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dispatch_on_driver_freed ON public.rides;
CREATE TRIGGER dispatch_on_driver_freed
  AFTER UPDATE OF status ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_after_driver_freed();

-- ============================================================================
-- 9. Balayage périodique : expirer les offres sans réponse et relancer.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.expire_ride_offers()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride_id uuid;
BEGIN
  FOR v_ride_id IN
    UPDATE public.ride_offers
    SET status = 'expired'
    WHERE status = 'pending' AND expires_at < now()
    RETURNING ride_id
  LOOP
    PERFORM public.dispatch_offer_next(v_ride_id);
  END LOOP;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('dispatch-expire-offers');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule('dispatch-expire-offers', '10 seconds', 'SELECT public.expire_ride_offers();');

COMMENT ON FUNCTION public.dispatch_offer_next(uuid) IS
  'Point d''extension unique du moteur de dispatch. Ajouter une nouvelle règle '
  '(market_programs.dispatch_mode) ici sans modifier le reste du pipeline '
  '(offres, acceptation, expiration, ré-essai au moment où un conducteur se libère).';
