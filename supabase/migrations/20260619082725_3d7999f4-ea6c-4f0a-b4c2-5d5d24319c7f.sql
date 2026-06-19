
DO $$ BEGIN
  CREATE TYPE public.commission_kind AS ENUM ('percent','flat');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.pricing_settings
  ADD COLUMN IF NOT EXISTS commission_type public.commission_kind NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS commission_flat_xof integer NOT NULL DEFAULT 0
    CHECK (commission_flat_xof >= 0);

CREATE TABLE IF NOT EXISTS public.commission_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category vehicle_category NOT NULL,
  commission_type public.commission_kind NOT NULL DEFAULT 'percent',
  commission_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (commission_rate >= 0 AND commission_rate <= 100),
  commission_flat_xof integer NOT NULL DEFAULT 0 CHECK (commission_flat_xof >= 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  priority integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.commission_schedules TO authenticated;
GRANT ALL ON public.commission_schedules TO service_role;

ALTER TABLE public.commission_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "view commission schedules" ON public.commission_schedules;
CREATE POLICY "view commission schedules" ON public.commission_schedules
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admins manage commission schedules" ON public.commission_schedules;
CREATE POLICY "admins manage commission schedules" ON public.commission_schedules
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS commission_schedules_touch ON public.commission_schedules;
CREATE TRIGGER commission_schedules_touch BEFORE UPDATE ON public.commission_schedules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS commission_schedules_lookup
  ON public.commission_schedules (category, active, priority DESC, starts_at DESC);

CREATE OR REPLACE FUNCTION public.resolve_commission(_category vehicle_category, _at timestamptz)
RETURNS TABLE(commission_type public.commission_kind, commission_rate numeric, commission_flat_xof integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM (
    SELECT s.commission_type, s.commission_rate, s.commission_flat_xof
    FROM public.commission_schedules s
    WHERE s.category = _category
      AND s.active = true
      AND s.starts_at <= _at
      AND (s.ends_at IS NULL OR s.ends_at > _at)
    ORDER BY s.priority DESC, s.starts_at DESC
    LIMIT 1
  ) sched
  UNION ALL
  SELECT * FROM (
    SELECT p.commission_type, p.commission_rate, p.commission_flat_xof
    FROM public.pricing_settings p
    WHERE p.category = _category AND p.active = true
    LIMIT 1
  ) defaults
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_commission(vehicle_category, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_commission(vehicle_category, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.compute_ride_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  c_amount integer;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    SELECT * INTO r FROM public.resolve_commission(NEW.category, COALESCE(NEW.completed_at, now())) LIMIT 1;
    IF r.commission_type = 'flat' THEN
      c_amount := LEAST(COALESCE(r.commission_flat_xof,0), COALESCE(NEW.price_xof, 0));
      NEW.commission_rate := NULL;
    ELSE
      c_amount := ROUND(COALESCE(NEW.price_xof,0) * COALESCE(r.commission_rate,0) / 100.0);
      NEW.commission_rate := r.commission_rate;
    END IF;
    NEW.commission_xof := COALESCE(c_amount, 0);
    NEW.driver_earnings_xof := GREATEST(COALESCE(NEW.price_xof,0) - COALESCE(NEW.commission_xof,0), 0);
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.compute_ride_commission() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS rides_compute_commission ON public.rides;
CREATE TRIGGER rides_compute_commission
  BEFORE UPDATE ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.compute_ride_commission();
