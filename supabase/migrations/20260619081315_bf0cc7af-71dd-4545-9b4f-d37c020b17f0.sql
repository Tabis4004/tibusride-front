
CREATE TABLE public.pricing_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category vehicle_category NOT NULL UNIQUE,
  base_fare_xof integer NOT NULL DEFAULT 500,
  per_km_xof integer NOT NULL DEFAULT 250,
  per_min_xof integer NOT NULL DEFAULT 50,
  min_fare_xof integer NOT NULL DEFAULT 1000,
  commission_rate numeric(5,2) NOT NULL DEFAULT 20.00,
  active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commission_rate_range CHECK (commission_rate >= 0 AND commission_rate <= 100)
);

GRANT SELECT ON public.pricing_settings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.pricing_settings TO authenticated;
GRANT ALL ON public.pricing_settings TO service_role;

ALTER TABLE public.pricing_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view pricing" ON public.pricing_settings
  FOR SELECT USING (true);

CREATE POLICY "Admins manage pricing" ON public.pricing_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER pricing_settings_touch
  BEFORE UPDATE ON public.pricing_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.pricing_settings (category, base_fare_xof, per_km_xof, per_min_xof, min_fare_xof, commission_rate) VALUES
  ('taxi',        500,  200, 40, 1000, 15.00),
  ('eco',         600,  250, 50, 1200, 18.00),
  ('confort',     800,  300, 60, 1500, 20.00),
  ('confort_plus',1000, 400, 80, 2000, 22.00),
  ('vip',         2000, 600, 120, 3500, 25.00);

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS commission_rate numeric(5,2),
  ADD COLUMN IF NOT EXISTS commission_xof integer,
  ADD COLUMN IF NOT EXISTS driver_earnings_xof integer;
