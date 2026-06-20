-- Livraison : types véhicule livreur, colis et options sur les courses

ALTER TABLE public.driver_profiles DROP CONSTRAINT IF EXISTS driver_profiles_vehicle_type_check;
ALTER TABLE public.driver_profiles
  ADD CONSTRAINT driver_profiles_vehicle_type_check
  CHECK (vehicle_type IS NULL OR vehicle_type IN ('car', 'motorcycle', 'van', 'tricycle', 'two_wheel'));

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS service_type text NOT NULL DEFAULT 'ride',
  ADD COLUMN IF NOT EXISTS delivery_vehicle text,
  ADD COLUMN IF NOT EXISTS package_type text,
  ADD COLUMN IF NOT EXISTS delivery_urgent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_insulated_bag boolean NOT NULL DEFAULT false;

ALTER TABLE public.rides DROP CONSTRAINT IF EXISTS rides_service_type_check;
ALTER TABLE public.rides
  ADD CONSTRAINT rides_service_type_check
  CHECK (service_type IN ('ride', 'delivery'));

COMMENT ON COLUMN public.rides.service_type IS 'ride = course passager, delivery = livraison colis';
COMMENT ON COLUMN public.rides.delivery_vehicle IS 'two_wheel, motorcycle, tricycle, car, van';
COMMENT ON COLUMN public.rides.package_type IS 'documents, small, medium, large, food, fragile';
