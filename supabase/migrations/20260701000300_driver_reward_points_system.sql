-- ============================================================================
-- Wallet Reward (points) pour conducteurs/livreurs — refonte demandée :
--
--   "Pénalité reward : NON pas de son wallet mais des points et une
--   régression dans la proposition des commandes même s'il est en tête...
--   il faut créer un wallet Reward pour les chauffeurs/coursiers, ils
--   gagnent des points en acceptant et réalisant des courses, en parrainant
--   d'autres chauffeurs. L'admin determine la valeur des points, les
--   différents types de pénalités (annuler une commande, rating < 3...) et
--   c'est convertible en argent transférable sur le wallet (wallet marchand)."
--
-- Ce fichier remplace le mécanisme de pénalité introduit dans
-- 20260701000200_driver_offer_penalty.sql (débit direct du wallet FCFA) par :
--   1. Un wallet Reward séparé, en POINTS (driver_reward_wallets/_transactions),
--      analogue à passenger_wallets mais côté conducteur.
--   2. Un catalogue de pénalités administrable (driver_penalty_rules) : code,
--      libellé, points retirés, durée de "regression" dans le dispatch.
--   3. Une régression de classement (driver_profiles.dispatch_deprioritized_
--      until) : pendant cette fenêtre, le conducteur est répondu en DERNIER
--      par dispatch_rank_candidates, même s'il est géographiquement le plus
--      proche — c'est la mesure de pression demandée.
--   4. Des gains de points : acceptation de course, course terminée,
--      parrainage d'un autre conducteur (en plus, pas à la place, du bonus
--      cash existant — voir distribute_ride_rewards/distribute_driver_referral).
--   5. Une conversion points -> FCFA créditée sur le wallet marchand existant
--      (driver_wallets), au taux fixé par l'admin (reward_settings.
--      driver_point_value_xof).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Wallet Reward (points) — table + transactions, calquées sur le modèle
--    passenger_wallets déjà en place.
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.driver_reward_tx_type AS ENUM (
    'ride_accepted', 'ride_completed', 'referral_bonus',
    'penalty', 'redeemed', 'admin_adjust'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.driver_reward_wallets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  points_balance integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_reward_wallets TO authenticated;
GRANT ALL ON public.driver_reward_wallets TO service_role;
ALTER TABLE public.driver_reward_wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Driver sees own reward wallet" ON public.driver_reward_wallets;
CREATE POLICY "Driver sees own reward wallet" ON public.driver_reward_wallets
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.driver_reward_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type public.driver_reward_tx_type NOT NULL,
  points integer NOT NULL,
  balance_after_pts integer NOT NULL,
  ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  reference text,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_reward_transactions TO authenticated;
GRANT ALL ON public.driver_reward_transactions TO service_role;
ALTER TABLE public.driver_reward_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Driver sees own reward tx" ON public.driver_reward_transactions;
CREATE POLICY "Driver sees own reward tx" ON public.driver_reward_transactions
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS driver_reward_tx_driver_idx ON public.driver_reward_transactions(driver_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.apply_driver_reward_tx(
  _driver_id uuid,
  _type public.driver_reward_tx_type,
  _points integer,
  _ride_id uuid DEFAULT NULL,
  _reference text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _actor uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_balance integer;
BEGIN
  INSERT INTO public.driver_reward_wallets(user_id, points_balance)
    VALUES (_driver_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.driver_reward_wallets
    SET points_balance = points_balance + _points,
        updated_at = now()
    WHERE user_id = _driver_id
    RETURNING points_balance INTO new_balance;

  INSERT INTO public.driver_reward_transactions(
    driver_id, type, points, balance_after_pts, ride_id, reference, notes, created_by
  ) VALUES (
    _driver_id, _type, _points, new_balance, _ride_id, _reference, _notes, _actor
  );

  RETURN new_balance;
END $$;

REVOKE ALL ON FUNCTION public.apply_driver_reward_tx(uuid, public.driver_reward_tx_type, integer, uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_driver_reward_tx(uuid, public.driver_reward_tx_type, integer, uuid, text, text, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Catalogue de pénalités, administrable (montant en points + durée de
--    regression dans le dispatch, par code). Seedé avec les exemples cités
--    par l'admin ; modifiable depuis l'UI admin sans nouvelle migration.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.driver_penalty_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  points_penalty integer NOT NULL DEFAULT 0 CHECK (points_penalty >= 0),
  dispatch_cooldown_seconds integer NOT NULL DEFAULT 0 CHECK (dispatch_cooldown_seconds >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_driver_penalty_rules_touch
  BEFORE UPDATE ON public.driver_penalty_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.driver_penalty_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone authenticated reads penalty rules" ON public.driver_penalty_rules;
CREATE POLICY "Anyone authenticated reads penalty rules"
  ON public.driver_penalty_rules FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "Admins manage penalty rules" ON public.driver_penalty_rules;
CREATE POLICY "Admins manage penalty rules"
  ON public.driver_penalty_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.driver_penalty_rules (code, label, points_penalty, dispatch_cooldown_seconds) VALUES
  ('offer_declined', 'Offre de course refusée', 10, 60),
  ('offer_expired', 'Offre de course expirée sans réponse', 15, 90),
  ('self_assign_ignored', 'Course ignorée (liste ouverte)', 10, 60),
  ('ride_cancelled_by_driver', 'Course annulée par le conducteur', 30, 300),
  ('low_rating', 'Note passager inférieure à 3', 20, 120)
ON CONFLICT (code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Réglages admin : valeur du point, gains par action.
-- ----------------------------------------------------------------------------
ALTER TABLE public.reward_settings
  ADD COLUMN IF NOT EXISTS driver_point_value_xof numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS driver_ride_accept_pts integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS driver_ride_completed_pts integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS driver_referral_pts integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS driver_min_redeem_pts integer NOT NULL DEFAULT 100;

-- ----------------------------------------------------------------------------
-- 4. Régression de classement : fenêtre de "deprioritization" par conducteur.
-- ----------------------------------------------------------------------------
ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS dispatch_deprioritized_until timestamptz;

-- ----------------------------------------------------------------------------
-- 5. Point d'entrée unique pour appliquer une pénalité par code : retire les
--    points (catalogue) ET pousse la fenêtre de régression du dispatch.
--    Idempotent (best-effort) côté appelant via `_reference`.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_driver_penalty(
  _driver_id uuid,
  _code text,
  _ride_id uuid DEFAULT NULL,
  _reference text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rule public.driver_penalty_rules;
  v_balance integer;
BEGIN
  SELECT * INTO v_rule FROM public.driver_penalty_rules WHERE code = _code AND is_active;
  IF v_rule IS NULL THEN
    SELECT points_balance INTO v_balance FROM public.driver_reward_wallets WHERE user_id = _driver_id;
    RETURN COALESCE(v_balance, 0);
  END IF;

  IF v_rule.points_penalty > 0 THEN
    v_balance := public.apply_driver_reward_tx(
      _driver_id, 'penalty'::driver_reward_tx_type, -v_rule.points_penalty, _ride_id,
      COALESCE(_reference, _code), 'Pénalité : ' || v_rule.label, NULL
    );
  ELSE
    SELECT points_balance INTO v_balance FROM public.driver_reward_wallets WHERE user_id = _driver_id;
    v_balance := COALESCE(v_balance, 0);
  END IF;

  IF v_rule.dispatch_cooldown_seconds > 0 THEN
    UPDATE public.driver_profiles
    SET dispatch_deprioritized_until = GREATEST(
      COALESCE(dispatch_deprioritized_until, now()),
      now() + (v_rule.dispatch_cooldown_seconds || ' seconds')::interval
    )
    WHERE user_id = _driver_id;
  END IF;

  RETURN v_balance;
END $$;

REVOKE ALL ON FUNCTION public.apply_driver_penalty(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_driver_penalty(uuid, text, uuid, text) TO service_role;

-- Application manuelle par un admin (ex. annulation côté conducteur signalée
-- hors-app, en attendant une UI de cancel dédiée) — vérifie le rôle en interne.
CREATE OR REPLACE FUNCTION public.admin_apply_driver_penalty(
  _driver_id uuid, _code text, _ride_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Réservé aux administrateurs';
  END IF;
  RETURN public.apply_driver_penalty(_driver_id, _code, _ride_id, 'admin:' || auth.uid()::text);
END $$;

GRANT EXECUTE ON FUNCTION public.admin_apply_driver_penalty(uuid, text, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Classement des candidats : les conducteurs en régression passent APRÈS
--    tous les autres, indépendamment de leur distance (mesure de pression).
-- ----------------------------------------------------------------------------
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
    AND NOT EXISTS (
      SELECT 1 FROM public.ride_offers ro
      WHERE ro.ride_id = _ride_id AND ro.driver_id = dp.user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.rides r2
      WHERE r2.driver_id = dp.user_id AND r2.status IN ('accepted', 'arriving', 'in_progress')
    )
    AND (dz.id IS NULL OR public.haversine_km(dz.center_lat, dz.center_lng, r.pickup_lat, r.pickup_lng) <= dz.radius_km)
  ORDER BY
    (dp.dispatch_deprioritized_until IS NOT NULL AND dp.dispatch_deprioritized_until > now()) ASC,
    public.haversine_km(dp.current_lat, dp.current_lng, r.pickup_lat, r.pickup_lng) ASC
  LIMIT 10;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Pénalités : remplacement du débit wallet (FCFA) par apply_driver_penalty
--    (points + régression), pour les 3 points d'entrée existants.
-- ----------------------------------------------------------------------------
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

  IF FOUND THEN
    PERFORM public.apply_driver_penalty(v_driver, 'offer_declined', _ride_id);
  END IF;

  PERFORM public.dispatch_offer_next(_ride_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_ride_offers()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
    UPDATE public.ride_offers
    SET status = 'expired'
    WHERE status = 'pending' AND expires_at < now()
    RETURNING ride_id, driver_id
  LOOP
    PERFORM public.apply_driver_penalty(v_row.driver_id, 'offer_expired', v_row.ride_id);
    PERFORM public.dispatch_offer_next(v_row.ride_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.penalize_self_ignored_ride(_ride_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_driver uuid := auth.uid();
  v_balance integer;
BEGIN
  IF v_driver IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.driver_reward_transactions
    WHERE driver_id = v_driver AND ride_id = _ride_id AND reference = 'self_assign_ignored'
  ) THEN
    SELECT points_balance INTO v_balance FROM public.driver_reward_wallets WHERE user_id = v_driver;
    RETURN COALESCE(v_balance, 0);
  END IF;

  RETURN public.apply_driver_penalty(v_driver, 'self_assign_ignored', _ride_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.penalize_self_ignored_ride(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. Gains de points : acceptation de course (tous modes), course terminée,
--    parrainage (en plus du bonus cash existant, pas à la place).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.award_driver_accept_points()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pts integer;
BEGIN
  IF NEW.status <> 'accepted' OR OLD.status = 'accepted' OR NEW.driver_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT driver_ride_accept_pts INTO v_pts FROM public.reward_settings WHERE id = true;
  IF v_pts IS NOT NULL AND v_pts > 0 THEN
    PERFORM public.apply_driver_reward_tx(
      NEW.driver_id, 'ride_accepted'::driver_reward_tx_type, v_pts, NEW.id,
      'ride_accepted', 'Points : course acceptée', NULL
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_award_driver_accept_points ON public.rides;
CREATE TRIGGER trg_award_driver_accept_points
AFTER UPDATE ON public.rides
FOR EACH ROW EXECUTE FUNCTION public.award_driver_accept_points();

-- distribute_ride_rewards (course terminée) : ajout des points conducteur,
-- en complément du reste du corps existant (passager + parrainage cash).
CREATE OR REPLACE FUNCTION public.distribute_ride_rewards()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.reward_settings;
  ref public.referrals;
  rides_count integer;
  is_first boolean := false;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN RETURN NEW; END IF;
  SELECT * INTO s FROM public.reward_settings WHERE id = true;

  IF NEW.passenger_id IS NOT NULL AND s.passenger_ride_earn_pts > 0 THEN
    PERFORM public.apply_passenger_wallet_tx(
      NEW.passenger_id,'ride_earn'::passenger_wallet_tx_type, s.passenger_ride_earn_pts,
      NEW.id, NULL, 'Points course'
    );
  END IF;

  IF NEW.driver_id IS NOT NULL AND s.driver_ride_completed_pts > 0 THEN
    PERFORM public.apply_driver_reward_tx(
      NEW.driver_id, 'ride_completed'::driver_reward_tx_type, s.driver_ride_completed_pts,
      NEW.id, 'ride_completed', 'Points : course terminée', NULL
    );
  END IF;

  SELECT count(*) INTO rides_count FROM public.rides
    WHERE passenger_id = NEW.passenger_id AND status='completed' AND id <> NEW.id;
  is_first := (rides_count = 0);

  SELECT * INTO ref FROM public.referrals WHERE referee_id = NEW.passenger_id;
  IF ref.id IS NOT NULL THEN
    IF is_first AND ref.status = 'pending' THEN
      IF public.has_role(ref.referrer_id,'driver') THEN
        PERFORM public.apply_wallet_transaction(
          ref.referrer_id,'referral'::wallet_tx_type, s.driver_referral_bonus_xof,
          NEW.id, 'referral:passenger', 'Bonus parrainage 1ère course', NULL
        );
        IF s.driver_referral_pts > 0 THEN
          PERFORM public.apply_driver_reward_tx(
            ref.referrer_id, 'referral_bonus'::driver_reward_tx_type, s.driver_referral_pts,
            NEW.id, 'referral:passenger', 'Points : parrainage', NULL
          );
        END IF;
        UPDATE public.referrals SET status='rewarded', validated_at=now(), rewarded_at=now(),
          reward_xof = s.driver_referral_bonus_xof WHERE id = ref.id;
      ELSE
        PERFORM public.apply_passenger_wallet_tx(
          ref.referrer_id,'referral_bonus'::passenger_wallet_tx_type, s.passenger_referral_bonus_pts,
          NEW.id, 'referral', 'Bonus parrainage 1ère course'
        );
        UPDATE public.referrals SET status='rewarded', validated_at=now(), rewarded_at=now(),
          reward_pts = s.passenger_referral_bonus_pts WHERE id = ref.id;
      END IF;
    END IF;
    IF public.has_role(ref.referrer_id,'driver') AND s.driver_referral_per_ride_xof > 0 THEN
      PERFORM public.apply_wallet_transaction(
        ref.referrer_id,'referral'::wallet_tx_type, s.driver_referral_per_ride_xof,
        NEW.id, 'referral:ride', 'Commission parrainage par course', NULL
      );
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- distribute_driver_referral (parrainage chauffeur->chauffeur) : ajout des
-- points conducteur en complément du bonus cash existant.
CREATE OR REPLACE FUNCTION public.distribute_driver_referral()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.reward_settings;
  ref public.referrals;
  done integer;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' OR NEW.driver_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO ref FROM public.referrals WHERE referee_id = NEW.driver_id AND referee_role='driver' AND status='pending';
  IF ref.id IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO done FROM public.rides WHERE driver_id = NEW.driver_id AND status='completed' AND id <> NEW.id;
  IF done > 0 THEN RETURN NEW; END IF;
  SELECT * INTO s FROM public.reward_settings WHERE id = true;
  PERFORM public.apply_wallet_transaction(
    ref.referrer_id,'referral'::wallet_tx_type, s.driver_referral_bonus_xof,
    NEW.id, 'referral:driver', 'Bonus parrainage chauffeur', NULL
  );
  IF s.driver_referral_pts > 0 THEN
    PERFORM public.apply_driver_reward_tx(
      ref.referrer_id, 'referral_bonus'::driver_reward_tx_type, s.driver_referral_pts,
      NEW.id, 'referral:driver', 'Points : parrainage chauffeur', NULL
    );
  END IF;
  UPDATE public.referrals SET status='rewarded', validated_at=now(), rewarded_at=now(),
    reward_xof = s.driver_referral_bonus_xof WHERE id = ref.id;
  RETURN NEW;
END $$;

-- ----------------------------------------------------------------------------
-- 9. Pénalité automatique sur mauvaise note (< 3) laissée par un passager à
--    un conducteur.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.penalize_low_rating()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.score < 3 AND public.has_role(NEW.ratee_id, 'driver') THEN
    PERFORM public.apply_driver_penalty(NEW.ratee_id, 'low_rating', NEW.ride_id, 'rating:' || NEW.id::text);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_penalize_low_rating ON public.ratings;
CREATE TRIGGER trg_penalize_low_rating
AFTER INSERT ON public.ratings
FOR EACH ROW EXECUTE FUNCTION public.penalize_low_rating();

-- ----------------------------------------------------------------------------
-- 10. Conversion points -> FCFA, créditée sur le wallet marchand existant
--     (driver_wallets), au taux fixé par l'admin.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_driver_points(_points integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  s public.reward_settings;
  bal integer;
  xof_credit integer;
  new_pts_balance integer;
  new_xof_balance integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF _points <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

  SELECT * INTO s FROM public.reward_settings WHERE id = true;
  IF _points < COALESCE(s.driver_min_redeem_pts, 0) THEN
    RAISE EXCEPTION 'below_minimum_redeem';
  END IF;

  SELECT points_balance INTO bal FROM public.driver_reward_wallets WHERE user_id = uid;
  IF COALESCE(bal, 0) < _points THEN RAISE EXCEPTION 'insufficient_points'; END IF;

  xof_credit := FLOOR(_points * COALESCE(s.driver_point_value_xof, 1))::integer;

  new_pts_balance := public.apply_driver_reward_tx(
    uid, 'redeemed'::driver_reward_tx_type, -_points, NULL, 'redeem', 'Conversion en FCFA', uid
  );
  new_xof_balance := public.apply_wallet_transaction(
    uid, 'adjustment'::wallet_tx_type, xof_credit, NULL, 'redeem_points', 'Conversion points reward', uid
  );

  RETURN jsonb_build_object(
    'ok', true, 'xof_credit', xof_credit,
    'points_balance', new_pts_balance, 'wallet_balance_xof', new_xof_balance
  );
END $$;

GRANT EXECUTE ON FUNCTION public.redeem_driver_points(integer) TO authenticated;

DROP TRIGGER IF EXISTS trg_distribute_ride_rewards ON public.rides;
CREATE TRIGGER trg_distribute_ride_rewards
AFTER UPDATE ON public.rides
FOR EACH ROW EXECUTE FUNCTION public.distribute_ride_rewards();

DROP TRIGGER IF EXISTS trg_driver_referral ON public.rides;
CREATE TRIGGER trg_driver_referral
AFTER UPDATE ON public.rides
FOR EACH ROW EXECUTE FUNCTION public.distribute_driver_referral();
