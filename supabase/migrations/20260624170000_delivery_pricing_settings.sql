-- Tarifs livraison (deux-roues, moto, tricycle, voiture, fourgon) — jusqu'ici
-- codés en dur dans delivery-pricing.ts (DELIVERY_VEHICLES) et invisibles côté
-- admin. Cette table mirrore pricing_settings (courses) mais clé sur le type
-- de véhicule livraison, qui n'appartient pas à l'enum vehicle_category.
CREATE TABLE IF NOT EXISTS public.delivery_pricing_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle text NOT NULL UNIQUE CHECK (vehicle IN ('two_wheel','motorcycle','tricycle','car','van')),
  base_fare_xof integer NOT NULL DEFAULT 500,
  per_km_xof integer NOT NULL DEFAULT 250,
  per_min_xof integer NOT NULL DEFAULT 40,
  min_fare_xof integer NOT NULL DEFAULT 500,
  commission_type public.commission_kind NOT NULL DEFAULT 'percent',
  commission_rate numeric(5,2) NOT NULL DEFAULT 18.00 CHECK (commission_rate >= 0 AND commission_rate <= 100),
  commission_flat_xof integer NOT NULL DEFAULT 0 CHECK (commission_flat_xof >= 0),
  active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.delivery_pricing_settings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.delivery_pricing_settings TO authenticated;
GRANT ALL ON public.delivery_pricing_settings TO service_role;

ALTER TABLE public.delivery_pricing_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view delivery pricing" ON public.delivery_pricing_settings;
CREATE POLICY "Anyone can view delivery pricing" ON public.delivery_pricing_settings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins manage delivery pricing" ON public.delivery_pricing_settings;
CREATE POLICY "Admins manage delivery pricing" ON public.delivery_pricing_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS delivery_pricing_settings_touch ON public.delivery_pricing_settings;
CREATE TRIGGER delivery_pricing_settings_touch
  BEFORE UPDATE ON public.delivery_pricing_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.delivery_pricing_settings (vehicle, base_fare_xof, per_km_xof, per_min_xof, min_fare_xof, commission_rate)
VALUES
  ('two_wheel', 400,  175, 26, 400,  18.00),
  ('motorcycle',500,  220, 32, 500,  18.00),
  ('tricycle',  600,  240, 35, 600,  18.00),
  ('car',       800,  280, 40, 800,  20.00),
  ('van',       1200, 350, 48, 1200, 20.00)
ON CONFLICT (vehicle) DO NOTHING;
