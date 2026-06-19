-- 1) Visibility prefs on rides
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS passenger_shares_phone boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS driver_shares_phone boolean NOT NULL DEFAULT true;

-- 2) Tracking events table
CREATE TABLE IF NOT EXISTS public.ride_tracking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  event_type text NOT NULL, -- 'status_change' | 'location' | 'contact_view' | 'contact_toggle'
  status public.ride_status,
  lat double precision,
  lng double precision,
  actor_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ride_tracking_events_ride ON public.ride_tracking_events(ride_id, created_at);

GRANT SELECT, INSERT ON public.ride_tracking_events TO authenticated;
GRANT ALL ON public.ride_tracking_events TO service_role;

ALTER TABLE public.ride_tracking_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parties can view tracking events"
ON public.ride_tracking_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = ride_tracking_events.ride_id
      AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
  )
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Parties can insert tracking events"
ON public.ride_tracking_events
FOR INSERT
TO authenticated
WITH CHECK (
  actor_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = ride_tracking_events.ride_id
      AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
  )
);

-- 3) Triggers: status changes + location updates
CREATE OR REPLACE FUNCTION public.log_ride_tracking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.ride_tracking_events(ride_id, event_type, status, lat, lng, actor_id)
    VALUES (NEW.id, 'status_change', NEW.status, NEW.driver_lat, NEW.driver_lng, COALESCE(NEW.driver_id, NEW.passenger_id));
  END IF;
  IF (NEW.driver_lat IS DISTINCT FROM OLD.driver_lat OR NEW.driver_lng IS DISTINCT FROM OLD.driver_lng)
     AND NEW.driver_lat IS NOT NULL AND NEW.driver_lng IS NOT NULL THEN
    INSERT INTO public.ride_tracking_events(ride_id, event_type, lat, lng, actor_id)
    VALUES (NEW.id, 'location', NEW.driver_lat, NEW.driver_lng, NEW.driver_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_ride_tracking ON public.rides;
CREATE TRIGGER trg_log_ride_tracking
AFTER UPDATE ON public.rides
FOR EACH ROW EXECUTE FUNCTION public.log_ride_tracking();

-- 4) Notification prefs
CREATE TABLE IF NOT EXISTS public.notification_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  notify_status_change boolean NOT NULL DEFAULT true,
  notify_driver_arriving boolean NOT NULL DEFAULT true,
  notify_driver_nearby boolean NOT NULL DEFAULT true,
  sound_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.notification_prefs TO authenticated;
GRANT ALL ON public.notification_prefs TO service_role;

ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their notification prefs"
ON public.notification_prefs FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);