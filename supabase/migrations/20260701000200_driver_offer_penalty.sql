-- ============================================================================
-- Pénalité reward (wallet) quand un chauffeur ignore ou laisse expirer une
-- offre de course, dans les deux modes de dispatch :
--   - 'proximity' : offre poussée via ride_offers -> decline_ride_offer() /
--     expire_ride_offers() (balayage pg_cron existant).
--   - 'self_assign' : popup informatif côté client (pas de réservation
--     exclusive en base) -> nouvelle RPC self-appelable par le chauffeur,
--     déclenchée par le front quand il clique "Ignorer" ou que le compte à
--     rebours du popup arrive à zéro.
-- Montant configurable par les admins via reward_settings.driver_offer_penalty_xof.
-- ============================================================================

ALTER TYPE public.wallet_tx_type ADD VALUE IF NOT EXISTS 'penalty';

ALTER TABLE public.reward_settings
  ADD COLUMN IF NOT EXISTS driver_offer_penalty_xof integer NOT NULL DEFAULT 200;

-- ----------------------------------------------------------------------------
-- 1. Mode 'proximity' : pénalité sur refus explicite.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decline_ride_offer(_ride_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_driver uuid := auth.uid();
  v_penalty integer;
BEGIN
  IF v_driver IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  UPDATE public.ride_offers SET status = 'declined', responded_at = now()
  WHERE ride_id = _ride_id AND driver_id = v_driver AND status = 'pending';

  IF FOUND THEN
    SELECT driver_offer_penalty_xof INTO v_penalty FROM public.reward_settings WHERE id = true;
    IF v_penalty IS NOT NULL AND v_penalty > 0 THEN
      PERFORM public.apply_wallet_transaction(
        v_driver, 'penalty'::wallet_tx_type, -v_penalty, _ride_id,
        'offer_declined', 'Pénalité : offre de course refusée', NULL
      );
    END IF;
  END IF;

  PERFORM public.dispatch_offer_next(_ride_id);
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Mode 'proximity' : pénalité sur expiration sans réponse (balayage cron).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_ride_offers()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row record;
  v_penalty integer;
BEGIN
  SELECT driver_offer_penalty_xof INTO v_penalty FROM public.reward_settings WHERE id = true;

  FOR v_row IN
    UPDATE public.ride_offers
    SET status = 'expired'
    WHERE status = 'pending' AND expires_at < now()
    RETURNING ride_id, driver_id
  LOOP
    IF v_penalty IS NOT NULL AND v_penalty > 0 THEN
      PERFORM public.apply_wallet_transaction(
        v_row.driver_id, 'penalty'::wallet_tx_type, -v_penalty, v_row.ride_id,
        'offer_expired', 'Pénalité : offre de course expirée sans réponse', NULL
      );
    END IF;
    PERFORM public.dispatch_offer_next(v_row.ride_id);
  END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Mode 'self_assign' : aucune réservation exclusive en base, donc pas de
--    ligne ride_offers à faire expirer côté serveur. Le front appelle cette
--    RPC quand le chauffeur clique "Ignorer" sur le popup, ou que le compte à
--    rebours arrive à zéro sans action. Idempotent par (driver_id, ride_id)
--    via la colonne `reference` pour éviter une double pénalité.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.penalize_self_ignored_ride(_ride_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_driver uuid := auth.uid();
  v_penalty integer;
  v_balance integer;
BEGIN
  IF v_driver IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE driver_id = v_driver AND ride_id = _ride_id AND reference = 'self_assign_ignored'
  ) THEN
    SELECT balance_xof INTO v_balance FROM public.driver_wallets WHERE user_id = v_driver;
    RETURN COALESCE(v_balance, 0);
  END IF;

  SELECT driver_offer_penalty_xof INTO v_penalty FROM public.reward_settings WHERE id = true;
  IF v_penalty IS NULL OR v_penalty <= 0 THEN
    SELECT balance_xof INTO v_balance FROM public.driver_wallets WHERE user_id = v_driver;
    RETURN COALESCE(v_balance, 0);
  END IF;

  v_balance := public.apply_wallet_transaction(
    v_driver, 'penalty'::wallet_tx_type, -v_penalty, _ride_id,
    'self_assign_ignored', 'Pénalité : course ignorée (liste ouverte)', v_driver
  );
  RETURN v_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.penalize_self_ignored_ride(uuid) TO authenticated;
