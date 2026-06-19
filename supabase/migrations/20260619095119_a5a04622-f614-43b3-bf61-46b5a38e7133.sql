
-- 1) profiles: restrict SELECT to self / admin / current ride participant
DROP POLICY IF EXISTS "Profiles selectable by everyone authenticated" ON public.profiles;
CREATE POLICY "Profiles read self admin or ride participant"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.rides r
      WHERE (r.passenger_id = auth.uid() AND r.driver_id = profiles.id)
         OR (r.driver_id = auth.uid() AND r.passenger_id = profiles.id)
    )
  );

-- 2) driver_profiles: restrict SELECT to own + admin only (drop passenger clause)
DROP POLICY IF EXISTS "Driver reads own profile" ON public.driver_profiles;
CREATE POLICY "Driver reads own profile"
  ON public.driver_profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Public-safe RPC for ride passengers to fetch their driver's vehicle info
CREATE OR REPLACE FUNCTION public.get_ride_driver_public(_ride_id uuid)
RETURNS TABLE (
  full_name text,
  avatar_url text,
  phone text,
  vehicle_plate text,
  vehicle_model text,
  rating_avg numeric
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  r public.rides;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO r FROM public.rides WHERE id = _ride_id;
  IF r.id IS NULL OR (r.passenger_id <> uid AND r.driver_id <> uid AND NOT public.has_role(uid,'admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF r.driver_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT p.full_name, p.avatar_url, p.phone, dp.vehicle_plate, dp.vehicle_model, dp.rating_avg
    FROM public.profiles p
    LEFT JOIN public.driver_profiles dp ON dp.user_id = p.id
    WHERE p.id = r.driver_id;
END $$;
REVOKE ALL ON FUNCTION public.get_ride_driver_public(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ride_driver_public(uuid) TO authenticated;

-- 3) rides: column-level UPDATE restriction for drivers via trigger
CREATE OR REPLACE FUNCTION public.enforce_ride_driver_update_cols()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  -- Skip enforcement when no auth context (system / trigger cascades) or admin/passenger
  IF uid IS NULL THEN RETURN NEW; END IF;
  IF public.has_role(uid,'admin') THEN RETURN NEW; END IF;
  IF uid = OLD.passenger_id THEN RETURN NEW; END IF;
  -- Acting as driver (or unauthorized) → lock down mutable columns
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

DROP TRIGGER IF EXISTS a_enforce_ride_driver_cols ON public.rides;
CREATE TRIGGER a_enforce_ride_driver_cols
  BEFORE UPDATE ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ride_driver_update_cols();

-- 4) referral_codes: restrict SELECT to own + admin
DROP POLICY IF EXISTS "own code rw" ON public.referral_codes;
CREATE POLICY "Read own referral code"
  ON public.referral_codes FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- 5) commission_schedules: admins only
DROP POLICY IF EXISTS "view commission schedules" ON public.commission_schedules;
CREATE POLICY "Admins view commission schedules"
  ON public.commission_schedules FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- 6) storage policies for driver-documents: owner can delete/update own files
DROP POLICY IF EXISTS "Drivers delete own documents" ON storage.objects;
CREATE POLICY "Drivers delete own documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'driver-documents' AND owner = auth.uid());

DROP POLICY IF EXISTS "Drivers update own documents" ON storage.objects;
CREATE POLICY "Drivers update own documents"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'driver-documents' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'driver-documents' AND owner = auth.uid());
