-- Enrôlement chauffeurs & livreurs : type partenaire, véhicule, état physique, catégorie assignée

ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS partner_type text NOT NULL DEFAULT 'ride',
  ADD COLUMN IF NOT EXISTS vehicle_type text,
  ADD COLUMN IF NOT EXISTS vehicle_condition_url text,
  ADD COLUMN IF NOT EXISTS vehicle_plate text,
  ADD COLUMN IF NOT EXISTS vehicle_model text,
  ADD COLUMN IF NOT EXISTS assigned_category text,
  ADD COLUMN IF NOT EXISTS physical_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS physical_verified_by uuid,
  ADD COLUMN IF NOT EXISTS enrollment_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS enrollment_notes text;

ALTER TABLE public.driver_profiles DROP CONSTRAINT IF EXISTS driver_profiles_partner_type_check;
ALTER TABLE public.driver_profiles
  ADD CONSTRAINT driver_profiles_partner_type_check
  CHECK (partner_type IN ('ride', 'delivery'));

ALTER TABLE public.driver_profiles DROP CONSTRAINT IF EXISTS driver_profiles_vehicle_type_check;
ALTER TABLE public.driver_profiles
  ADD CONSTRAINT driver_profiles_vehicle_type_check
  CHECK (vehicle_type IS NULL OR vehicle_type IN ('car', 'motorcycle', 'van'));

COMMENT ON COLUMN public.driver_profiles.partner_type IS 'ride = chauffeur courses, delivery = livreur';
COMMENT ON COLUMN public.driver_profiles.vehicle_document_url IS 'Carte grise';
COMMENT ON COLUMN public.driver_profiles.license_document_url IS 'Permis de conduire';
COMMENT ON COLUMN public.driver_profiles.vehicle_condition_url IS 'Photos état véhicule/moto pour contrôle physique';
