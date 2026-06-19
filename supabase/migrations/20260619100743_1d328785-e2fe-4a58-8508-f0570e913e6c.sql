REVOKE EXECUTE ON FUNCTION public.confirm_topup(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_topup(uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.apply_passenger_wallet_tx(uuid, public.passenger_wallet_tx_type, integer, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_passenger_wallet_tx(uuid, public.passenger_wallet_tx_type, integer, uuid, text, text)
  TO service_role;

DROP POLICY IF EXISTS "Users write their own ratings" ON public.ratings;
CREATE POLICY "Ride participants rate the other party"
ON public.ratings
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = rater_id
  AND EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = ratings.ride_id
      AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
      AND (r.passenger_id = ratings.ratee_id OR r.driver_id = ratings.ratee_id)
      AND r.passenger_id IS DISTINCT FROM r.driver_id
      AND r.status = 'completed'
  )
);

CREATE OR REPLACE FUNCTION public.enforce_ride_driver_update_cols()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN NEW; END IF;
  IF public.has_role(uid,'admin') THEN RETURN NEW; END IF;

  IF uid = OLD.passenger_id THEN
    IF NEW.passenger_id        IS DISTINCT FROM OLD.passenger_id
       OR NEW.driver_id        IS DISTINCT FROM OLD.driver_id
       OR NEW.price_xof        IS DISTINCT FROM OLD.price_xof
       OR NEW.commission_xof   IS DISTINCT FROM OLD.commission_xof
       OR NEW.commission_rate  IS DISTINCT FROM OLD.commission_rate
       OR NEW.driver_earnings_xof IS DISTINCT FROM OLD.driver_earnings_xof
       OR NEW.distance_km      IS DISTINCT FROM OLD.distance_km
       OR NEW.duration_min     IS DISTINCT FROM OLD.duration_min
       OR NEW.pickup_lat       IS DISTINCT FROM OLD.pickup_lat
       OR NEW.pickup_lng       IS DISTINCT FROM OLD.pickup_lng
       OR NEW.dropoff_lat      IS DISTINCT FROM OLD.dropoff_lat
       OR NEW.dropoff_lng      IS DISTINCT FROM OLD.dropoff_lng
       OR NEW.city             IS DISTINCT FROM OLD.city
       OR NEW.category         IS DISTINCT FROM OLD.category
    THEN
      RAISE EXCEPTION 'Passengers cannot modify these ride fields';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.passenger_id    IS DISTINCT FROM OLD.passenger_id
     OR NEW.price_xof       IS DISTINCT FROM OLD.price_xof
     OR NEW.commission_xof  IS DISTINCT FROM OLD.commission_xof
     OR NEW.commission_rate IS DISTINCT FROM OLD.commission_rate
     OR NEW.driver_earnings_xof IS DISTINCT FROM OLD.driver_earnings_xof
     OR NEW.payment_method  IS DISTINCT FROM OLD.payment_method
     OR NEW.passenger_phone IS DISTINCT FROM OLD.passenger_phone
     OR NEW.pickup_address  IS DISTINCT FROM OLD.pickup_address
     OR NEW.dropoff_address IS DISTINCT FROM OLD.dropoff_address
     OR NEW.pickup_lat      IS DISTINCT FROM OLD.pickup_lat
     OR NEW.pickup_lng      IS DISTINCT FROM OLD.pickup_lng
     OR NEW.dropoff_lat     IS DISTINCT FROM OLD.dropoff_lat
     OR NEW.dropoff_lng     IS DISTINCT FROM OLD.dropoff_lng
     OR NEW.distance_km     IS DISTINCT FROM OLD.distance_km
     OR NEW.duration_min    IS DISTINCT FROM OLD.duration_min
     OR NEW.city            IS DISTINCT FROM OLD.city
     OR NEW.category        IS DISTINCT FROM OLD.category
  THEN
    RAISE EXCEPTION 'Drivers cannot modify these ride fields';
  END IF;
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    IF NEW.driver_id IS NOT NULL AND NEW.driver_id <> uid THEN
      RAISE EXCEPTION 'Drivers may only assign themselves to a ride';
    END IF;
    IF OLD.driver_id IS NOT NULL AND OLD.driver_id <> uid THEN
      RAISE EXCEPTION 'Ride already assigned to another driver';
    END IF;
  END IF;
  RETURN NEW;
END $$;