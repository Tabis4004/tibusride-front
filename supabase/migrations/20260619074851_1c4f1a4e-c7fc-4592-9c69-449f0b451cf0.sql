
ALTER TABLE public.rides ALTER COLUMN category DROP DEFAULT;
ALTER TABLE public.vehicles ALTER COLUMN category DROP DEFAULT;
ALTER TABLE public.rides ALTER COLUMN category TYPE text;
ALTER TABLE public.vehicles ALTER COLUMN category TYPE text;
DROP TYPE IF EXISTS public.vehicle_category;
CREATE TYPE public.vehicle_category AS ENUM ('taxi','eco','confort','confort_plus','vip');
ALTER TABLE public.rides ALTER COLUMN category TYPE public.vehicle_category USING 'taxi'::public.vehicle_category;
ALTER TABLE public.vehicles ALTER COLUMN category TYPE public.vehicle_category USING 'taxi'::public.vehicle_category;
ALTER TABLE public.rides ALTER COLUMN category SET DEFAULT 'taxi'::public.vehicle_category;
