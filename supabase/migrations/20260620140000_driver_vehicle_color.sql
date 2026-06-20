-- Couleur véhicule (affichée au passager à l'arrivée du chauffeur)

ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS vehicle_color text;

COMMENT ON COLUMN public.driver_profiles.vehicle_color IS 'Couleur du véhicule — visible passager lors de l''arrivée';

-- PostgreSQL n'autorise pas CREATE OR REPLACE si le type de retour TABLE change
DROP FUNCTION IF EXISTS public.get_ride_driver_public(uuid);

CREATE FUNCTION public.get_ride_driver_public(_ride_id uuid)
RETURNS TABLE (
  full_name text,
  avatar_url text,
  phone text,
  vehicle_plate text,
  vehicle_model text,
  vehicle_color text,
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
  SELECT p.full_name, p.avatar_url, p.phone, dp.vehicle_plate, dp.vehicle_model, dp.vehicle_color, dp.rating_avg
    FROM public.profiles p
    LEFT JOIN public.driver_profiles dp ON dp.user_id = p.id
    WHERE p.id = r.driver_id;
END $$;

REVOKE ALL ON FUNCTION public.get_ride_driver_public(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ride_driver_public(uuid) TO authenticated;
