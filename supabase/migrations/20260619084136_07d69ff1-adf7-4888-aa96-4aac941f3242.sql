ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS driver_lat double precision,
  ADD COLUMN IF NOT EXISTS driver_lng double precision,
  ADD COLUMN IF NOT EXISTS driver_location_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS eta_seconds integer;

-- Allow assigned driver to update their own location fields on their ride
DROP POLICY IF EXISTS "Driver can update own ride location" ON public.rides;
CREATE POLICY "Driver can update own ride location"
ON public.rides
FOR UPDATE
TO authenticated
USING (auth.uid() = driver_id)
WITH CHECK (auth.uid() = driver_id);

-- Enable realtime
ALTER TABLE public.rides REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rides'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.rides';
  END IF;
END $$;