
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('passenger', 'driver', 'admin');
CREATE TYPE public.vehicle_category AS ENUM ('moto', 'tricycle', 'eco', 'berline');
CREATE TYPE public.driver_status AS ENUM ('pending', 'approved', 'rejected', 'suspended');
CREATE TYPE public.ride_status AS ENUM ('requested','accepted','arriving','in_progress','completed','cancelled');
CREATE TYPE public.payment_method AS ENUM ('mobile_money','cash','card');
CREATE TYPE public.payment_status AS ENUM ('pending','paid','failed','refunded');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  city TEXT DEFAULT 'Dakar',
  language TEXT DEFAULT 'fr',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles selectable by everyone authenticated" ON public.profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Admins manage roles
CREATE POLICY "Admins manage roles" ON public.user_roles
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ VEHICLES ============
CREATE TABLE public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category vehicle_category NOT NULL,
  brand TEXT,
  model TEXT,
  color TEXT,
  plate TEXT NOT NULL,
  year INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles TO authenticated;
GRANT ALL ON public.vehicles TO service_role;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Driver manages own vehicles" ON public.vehicles
  FOR ALL TO authenticated USING (auth.uid() = driver_id) WITH CHECK (auth.uid() = driver_id);
CREATE POLICY "Admins manage all vehicles" ON public.vehicles
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ DRIVER PROFILES ============
CREATE TABLE public.driver_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status driver_status NOT NULL DEFAULT 'pending',
  is_online BOOLEAN NOT NULL DEFAULT false,
  license_number TEXT,
  city TEXT,
  current_lat DOUBLE PRECISION,
  current_lng DOUBLE PRECISION,
  rating_avg NUMERIC(3,2) DEFAULT 5.00,
  rides_count INT NOT NULL DEFAULT 0,
  total_earnings NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_profiles TO authenticated;
GRANT ALL ON public.driver_profiles TO service_role;
ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Driver reads own profile" ON public.driver_profiles
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'passenger'));
CREATE POLICY "Driver manages own profile" ON public.driver_profiles
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins manage drivers" ON public.driver_profiles
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ RIDES ============
CREATE TABLE public.rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  pickup_address TEXT NOT NULL,
  pickup_lat DOUBLE PRECISION,
  pickup_lng DOUBLE PRECISION,
  dropoff_address TEXT NOT NULL,
  dropoff_lat DOUBLE PRECISION,
  dropoff_lng DOUBLE PRECISION,
  city TEXT NOT NULL DEFAULT 'Dakar',
  category vehicle_category NOT NULL DEFAULT 'eco',
  distance_km NUMERIC(6,2),
  duration_min INT,
  price_xof INT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'XOF',
  status ride_status NOT NULL DEFAULT 'requested',
  payment_method payment_method NOT NULL DEFAULT 'cash',
  passenger_phone TEXT,
  notes TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rides_status ON public.rides(status);
CREATE INDEX idx_rides_passenger ON public.rides(passenger_id);
CREATE INDEX idx_rides_driver ON public.rides(driver_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rides TO authenticated;
GRANT ALL ON public.rides TO service_role;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Passenger sees own rides" ON public.rides
  FOR SELECT TO authenticated USING (auth.uid() = passenger_id);
CREATE POLICY "Driver sees assigned or open rides" ON public.rides
  FOR SELECT TO authenticated USING (
    auth.uid() = driver_id
    OR (status = 'requested' AND public.has_role(auth.uid(),'driver'))
  );
CREATE POLICY "Admin sees all rides" ON public.rides
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Passenger creates rides" ON public.rides
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = passenger_id);
CREATE POLICY "Passenger updates own pending rides" ON public.rides
  FOR UPDATE TO authenticated USING (auth.uid() = passenger_id);
CREATE POLICY "Driver updates assigned or claims open ride" ON public.rides
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(),'driver') AND (driver_id IS NULL OR driver_id = auth.uid())
  );
CREATE POLICY "Admin updates rides" ON public.rides
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ============ PAYMENTS ============
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  amount_xof INT NOT NULL,
  method payment_method NOT NULL,
  status payment_status NOT NULL DEFAULT 'pending',
  provider TEXT, -- 'orange_money','wave','mtn_momo','moov_money','visa','mastercard'
  provider_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Payments visible to ride participants" ON public.payments
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid()))
    OR public.has_role(auth.uid(),'admin')
  );
CREATE POLICY "Passenger or admin write payments" ON public.payments
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.passenger_id = auth.uid())
    OR public.has_role(auth.uid(),'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.passenger_id = auth.uid())
    OR public.has_role(auth.uid(),'admin')
  );

-- ============ RATINGS ============
CREATE TABLE public.ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  rater_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ratee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score INT NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(ride_id, rater_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ratings TO authenticated;
GRANT ALL ON public.ratings TO service_role;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Ratings visible to ride participants or admin" ON public.ratings
  FOR SELECT TO authenticated USING (
    auth.uid() = rater_id OR auth.uid() = ratee_id OR public.has_role(auth.uid(),'admin')
  );
CREATE POLICY "Users write their own ratings" ON public.ratings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = rater_id);

-- ============ updated_at trigger ============
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_driver_profiles_touch BEFORE UPDATE ON public.driver_profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_rides_touch BEFORE UPDATE ON public.rides FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ Auto-create profile + default role on signup ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)),
    NEW.raw_user_meta_data->>'phone'
  );

  -- default role passenger; if metadata role = 'driver', assign that
  IF NEW.raw_user_meta_data->>'role' = 'driver' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'driver');
    INSERT INTO public.driver_profiles (user_id) VALUES (NEW.id);
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'passenger');
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
