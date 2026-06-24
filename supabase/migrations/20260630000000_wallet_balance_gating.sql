-- Bloque l'acceptation d'une course par un chauffeur dont le solde wallet est
-- épuisé (<= 0), quel que soit le chemin d'acceptation (liste ouverte
-- self_assign en update direct, ou accept_ride_offer en mode proximity) — un
-- seul point de contrôle, au niveau base, pour ne pas dépendre de chaque
-- chemin client.
CREATE OR REPLACE FUNCTION public.enforce_wallet_balance_on_ride_accept()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balance numeric;
BEGIN
  IF NEW.status = 'accepted' AND NEW.driver_id IS NOT NULL
     AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.driver_id IS DISTINCT FROM NEW.driver_id) THEN
    SELECT balance_xof INTO v_balance FROM public.driver_wallets WHERE user_id = NEW.driver_id;
    IF COALESCE(v_balance, 0) <= 0 THEN
      RAISE EXCEPTION 'Solde wallet insuffisant pour accepter une course. Contactez l''administration pour recharger votre wallet.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_wallet_balance_on_ride_accept ON public.rides;
CREATE TRIGGER trg_enforce_wallet_balance_on_ride_accept
  BEFORE UPDATE ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.enforce_wallet_balance_on_ride_accept();

-- Exclut du push-offer (mode 'proximity') les chauffeurs dont le wallet est
-- épuisé : ils ne doivent ni recevoir l'offre, ni la notification associée.
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
  LEFT JOIN public.driver_wallets dw ON dw.user_id = dp.user_id
  WHERE dp.status = 'approved'
    AND dp.is_online
    AND dp.partner_type = r.service_type
    AND dp.current_lat IS NOT NULL AND dp.current_lng IS NOT NULL
    AND COALESCE(dw.balance_xof, 0) > 0
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
  ORDER BY public.haversine_km(dp.current_lat, dp.current_lng, r.pickup_lat, r.pickup_lng) ASC
  LIMIT 10;
END;
$$;
