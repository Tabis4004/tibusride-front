-- Tibus Ride — toutes les migrations (tibus-frontend)
-- Projet : bjtklpjdsmqmzhncfflu
-- Supabase Dashboard → SQL Editor → New query → Run

-- ========== 20260619073803_2e8158c4-f578-442f-8ca4-7e4986c6e235.sql ==========

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

-- ========== 20260619073836_7252131c-4c52-43fd-8f91-932029cf1b00.sql ==========

REVOKE EXECUTE ON FUNCTION public.has_role(UUID, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ========== 20260619074851_1c4f1a4e-c7fc-4592-9c69-449f0b451cf0.sql ==========

ALTER TABLE public.rides ALTER COLUMN category DROP DEFAULT;
ALTER TABLE public.vehicles ALTER COLUMN category DROP DEFAULT;
ALTER TABLE public.rides ALTER COLUMN category TYPE text;
ALTER TABLE public.vehicles ALTER COLUMN category TYPE text;
DROP TYPE IF EXISTS public.vehicle_category;
CREATE TYPE public.vehicle_category AS ENUM ('taxi','eco','confort','confort_plus','vip');
ALTER TABLE public.rides ALTER COLUMN category TYPE public.vehicle_category USING 'taxi'::public.vehicle_category;
ALTER TABLE public.vehicles ALTER COLUMN category TYPE public.vehicle_category USING 'taxi'::public.vehicle_category;
ALTER TABLE public.rides ALTER COLUMN category SET DEFAULT 'taxi'::public.vehicle_category;

-- ========== 20260619075820_dc5a28fa-a95b-437f-a56c-234e6f1702e4.sql ==========

ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS id_document_url text,
  ADD COLUMN IF NOT EXISTS license_document_url text,
  ADD COLUMN IF NOT EXISTS vehicle_document_url text;

-- ========== 20260619080259_814282e1-7b92-4e40-a20c-bd17c1afb841.sql ==========

-- 1) Extend driver_status enum with under_review
ALTER TYPE public.driver_status ADD VALUE IF NOT EXISTS 'under_review' BEFORE 'approved';

-- 2) Rejection reason on driver_profiles
ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS status_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_updated_by uuid;

-- 3) Audit logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  actor_email text,
  action text NOT NULL,
  target_type text,
  target_id text,
  target_label text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read audit logs" ON public.audit_logs;
CREATE POLICY "Admins read audit logs" ON public.audit_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins insert audit logs" ON public.audit_logs;
CREATE POLICY "Admins insert audit logs" ON public.audit_logs
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') AND auth.uid() = actor_id);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON public.audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS audit_logs_target_idx ON public.audit_logs (target_type, target_id);

-- 4) Storage policies for driver-documents bucket: admin full access, driver own files read/write
DROP POLICY IF EXISTS "Admins manage driver-documents" ON storage.objects;
CREATE POLICY "Admins manage driver-documents" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'driver-documents' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'driver-documents' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Drivers read own driver-documents" ON storage.objects;
CREATE POLICY "Drivers read own driver-documents" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'driver-documents' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Drivers write own driver-documents" ON storage.objects;
CREATE POLICY "Drivers write own driver-documents" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'driver-documents' AND auth.uid()::text = (storage.foldername(name))[1]);

-- ========== 20260619081315_bf0cc7af-71dd-4545-9b4f-d37c020b17f0.sql ==========

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

-- ========== 20260619081725_2b3026c3-60bd-45eb-806d-3ae1ffdebc1f.sql ==========

CREATE TYPE invoice_status AS ENUM ('draft','issued','paid','cancelled');
CREATE TYPE payment_method_type AS ENUM ('bank_transfer','mobile_money','cash','card','other');

CREATE TABLE public.corporate_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_name text,
  email text,
  phone text,
  address text,
  city text,
  tax_id text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_accounts TO authenticated;
GRANT ALL ON public.corporate_accounts TO service_role;
ALTER TABLE public.corporate_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage corporates" ON public.corporate_accounts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER corporate_accounts_touch BEFORE UPDATE ON public.corporate_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE SEQUENCE public.invoice_number_seq;

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text UNIQUE,
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE RESTRICT,
  period_start date,
  period_end date,
  subtotal_xof integer NOT NULL DEFAULT 0,
  vat_rate numeric(5,2) NOT NULL DEFAULT 18.00,
  vat_xof integer NOT NULL DEFAULT 0,
  total_xof integer NOT NULL DEFAULT 0,
  paid_xof integer NOT NULL DEFAULT 0,
  status invoice_status NOT NULL DEFAULT 'draft',
  notes text,
  issued_at timestamptz,
  due_date date,
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage invoices" ON public.invoices
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER invoices_touch BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.assign_invoice_number()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.number IS NULL THEN
    NEW.number := 'INV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoices_number BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.assign_invoice_number();

CREATE TABLE public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  unit_price_xof integer NOT NULL DEFAULT 0,
  total_xof integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_items TO authenticated;
GRANT ALL ON public.invoice_items TO service_role;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage invoice items" ON public.invoice_items
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount_xof integer NOT NULL,
  method payment_method_type NOT NULL,
  reference text,
  paid_on date NOT NULL DEFAULT current_date,
  notes text,
  recorded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_payments TO authenticated;
GRANT ALL ON public.invoice_payments TO service_role;
ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage invoice payments" ON public.invoice_payments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ========== 20260619082130_12f3f087-6fdc-4be4-8557-41fd79a6aa66.sql ==========

CREATE TYPE wallet_tx_type AS ENUM ('topup','commission','adjustment','refund');

CREATE TABLE public.driver_wallets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_xof integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_wallets TO authenticated;
GRANT ALL ON public.driver_wallets TO service_role;
ALTER TABLE public.driver_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Driver sees own wallet" ON public.driver_wallets
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE TABLE public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type wallet_tx_type NOT NULL,
  amount_xof integer NOT NULL,
  balance_after_xof integer NOT NULL,
  ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  reference text,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wallet_transactions TO authenticated;
GRANT ALL ON public.wallet_transactions TO service_role;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Driver sees own tx" ON public.wallet_transactions
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE INDEX wallet_tx_driver_idx ON public.wallet_transactions(driver_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.apply_wallet_transaction(
  _driver_id uuid,
  _type wallet_tx_type,
  _amount_xof integer,
  _ride_id uuid DEFAULT NULL,
  _reference text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _actor uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_balance integer;
BEGIN
  INSERT INTO public.driver_wallets(user_id, balance_xof)
    VALUES(_driver_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.driver_wallets
    SET balance_xof = balance_xof + _amount_xof,
        updated_at = now()
    WHERE user_id = _driver_id
    RETURNING balance_xof INTO new_balance;

  INSERT INTO public.wallet_transactions(
    driver_id, type, amount_xof, balance_after_xof, ride_id, reference, notes, created_by
  ) VALUES (
    _driver_id, _type, _amount_xof, new_balance, _ride_id, _reference, _notes, _actor
  );

  RETURN new_balance;
END $$;

REVOKE ALL ON FUNCTION public.apply_wallet_transaction(uuid, wallet_tx_type, integer, uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_wallet_transaction(uuid, wallet_tx_type, integer, uuid, text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.debit_commission_on_ride_complete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  commission integer;
BEGIN
  IF NEW.status = 'completed'
     AND (OLD.status IS DISTINCT FROM 'completed')
     AND NEW.driver_id IS NOT NULL
     AND COALESCE(NEW.commission_xof, 0) > 0 THEN
    commission := NEW.commission_xof;
    PERFORM public.apply_wallet_transaction(
      NEW.driver_id, 'commission'::wallet_tx_type, -commission, NEW.id,
      NULL, 'Commission course #' || substr(NEW.id::text, 1, 8), NULL
    );
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER rides_debit_commission
  AFTER UPDATE OF status ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.debit_commission_on_ride_complete();

-- ========== 20260619082141_2a795f1c-b646-4e23-8bc2-48d7ebe37566.sql ==========
REVOKE ALL ON FUNCTION public.debit_commission_on_ride_complete() FROM PUBLIC, anon, authenticated;
-- ========== 20260619082725_3d7999f4-ea6c-4f0a-b4c2-5d5d24319c7f.sql ==========

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

-- ========== 20260619082735_b5902d5a-f622-43cd-8ab9-3a571df576e0.sql ==========
REVOKE EXECUTE ON FUNCTION public.resolve_commission(vehicle_category, timestamptz) FROM authenticated;
-- ========== 20260619084136_07d69ff1-adf7-4888-aa96-4aac941f3242.sql ==========
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
-- ========== 20260619084656_31e2129b-7623-4786-85fd-861e175e658a.sql ==========
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
-- ========== 20260619090007_034ee65f-11bb-4c1d-94c4-969c75eb0df3.sql ==========

-- 1. Extend wallet_tx_type for driver wallet
ALTER TYPE public.wallet_tx_type ADD VALUE IF NOT EXISTS 'reward';
ALTER TYPE public.wallet_tx_type ADD VALUE IF NOT EXISTS 'referral';

-- 2. Passenger wallet tx type
DO $$ BEGIN
  CREATE TYPE public.passenger_wallet_tx_type AS ENUM ('topup','ride_earn','referral_bonus','ride_redeem','adjustment','refund');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Referral status
DO $$ BEGIN
  CREATE TYPE public.referral_status AS ENUM ('pending','validated','rewarded','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Topup status
DO $$ BEGIN
  CREATE TYPE public.topup_status AS ENUM ('pending','paid','failed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ reward_settings (single-row config) ============
CREATE TABLE public.reward_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  driver_share_bonus_xof integer NOT NULL DEFAULT 500,
  driver_share_daily_cap integer NOT NULL DEFAULT 1,
  driver_referral_bonus_xof integer NOT NULL DEFAULT 5000,
  driver_referral_per_ride_xof integer NOT NULL DEFAULT 100,
  passenger_referral_bonus_pts integer NOT NULL DEFAULT 1000,
  passenger_ride_earn_pts integer NOT NULL DEFAULT 50,
  point_value_xof numeric NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.reward_settings TO authenticated;
GRANT ALL ON public.reward_settings TO service_role;
ALTER TABLE public.reward_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "everyone reads settings" ON public.reward_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin updates settings" ON public.reward_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin inserts settings" ON public.reward_settings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
INSERT INTO public.reward_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- ============ passenger_wallets ============
CREATE TABLE public.passenger_wallets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_pts integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.passenger_wallets TO authenticated;
GRANT ALL ON public.passenger_wallets TO service_role;
ALTER TABLE public.passenger_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own wallet read" ON public.passenger_wallets FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin manages wallets" ON public.passenger_wallets FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ passenger_wallet_transactions ============
CREATE TABLE public.passenger_wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type public.passenger_wallet_tx_type NOT NULL,
  amount_pts integer NOT NULL,
  balance_after_pts integer NOT NULL,
  ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  reference text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.passenger_wallet_transactions TO authenticated;
GRANT ALL ON public.passenger_wallet_transactions TO service_role;
CREATE INDEX ON public.passenger_wallet_transactions(user_id, created_at DESC);
ALTER TABLE public.passenger_wallet_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own tx read" ON public.passenger_wallet_transactions FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- ============ referral_codes ============
CREATE TABLE public.referral_codes (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.referral_codes TO authenticated;
GRANT ALL ON public.referral_codes TO service_role;
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own code rw" ON public.referral_codes FOR SELECT TO authenticated USING (true);
CREATE POLICY "own code insert" ON public.referral_codes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- ============ referrals ============
CREATE TABLE public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referee_role public.app_role NOT NULL,
  status public.referral_status NOT NULL DEFAULT 'pending',
  validated_at timestamptz,
  rewarded_at timestamptz,
  reward_xof integer DEFAULT 0,
  reward_pts integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referee_id)
);
GRANT SELECT, INSERT ON public.referrals TO authenticated;
GRANT ALL ON public.referrals TO service_role;
CREATE INDEX ON public.referrals(referrer_id);
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "see my referrals" ON public.referrals FOR SELECT TO authenticated USING (referrer_id = auth.uid() OR referee_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "self-referral insert" ON public.referrals FOR INSERT TO authenticated WITH CHECK (referee_id = auth.uid());

-- ============ share_events ============
CREATE TABLE public.share_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel text NOT NULL,
  rewarded boolean NOT NULL DEFAULT false,
  reward_xof integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.share_events TO authenticated;
GRANT ALL ON public.share_events TO service_role;
CREATE INDEX ON public.share_events(user_id, created_at DESC);
ALTER TABLE public.share_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own share read" ON public.share_events FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "own share insert" ON public.share_events FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- ============ topup_orders ============
CREATE TABLE public.topup_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_xof integer NOT NULL CHECK (amount_xof > 0),
  provider text NOT NULL,
  status public.topup_status NOT NULL DEFAULT 'pending',
  provider_reference text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
GRANT SELECT, INSERT ON public.topup_orders TO authenticated;
GRANT ALL ON public.topup_orders TO service_role;
CREATE INDEX ON public.topup_orders(user_id, created_at DESC);
ALTER TABLE public.topup_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own topup read" ON public.topup_orders FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "own topup insert" ON public.topup_orders FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- ============ Functions ============

-- Passenger wallet tx
CREATE OR REPLACE FUNCTION public.apply_passenger_wallet_tx(
  _user_id uuid, _type public.passenger_wallet_tx_type, _amount_pts integer,
  _ride_id uuid DEFAULT NULL, _reference text DEFAULT NULL, _notes text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance integer;
BEGIN
  INSERT INTO public.passenger_wallets(user_id, balance_pts) VALUES (_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.passenger_wallets
    SET balance_pts = balance_pts + _amount_pts, updated_at = now()
    WHERE user_id = _user_id
    RETURNING balance_pts INTO new_balance;
  IF new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient points balance';
  END IF;
  INSERT INTO public.passenger_wallet_transactions(user_id,type,amount_pts,balance_after_pts,ride_id,reference,notes)
    VALUES (_user_id,_type,_amount_pts,new_balance,_ride_id,_reference,_notes);
  RETURN new_balance;
END $$;

-- Generate unique referral code
CREATE OR REPLACE FUNCTION public.get_or_create_referral_code(_user_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c text;
BEGIN
  SELECT code INTO c FROM public.referral_codes WHERE user_id = _user_id;
  IF c IS NOT NULL THEN RETURN c; END IF;
  LOOP
    c := upper(substr(translate(encode(gen_random_bytes(6),'base64'),'+/=',''), 1, 8));
    BEGIN
      INSERT INTO public.referral_codes(user_id,code) VALUES (_user_id,c);
      RETURN c;
    EXCEPTION WHEN unique_violation THEN
      CONTINUE;
    END;
  END LOOP;
END $$;

-- Claim share reward (driver only, daily cap)
CREATE OR REPLACE FUNCTION public.claim_driver_share_reward(_channel text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  s public.reward_settings;
  count_today integer;
  bonus integer;
  new_bal integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.has_role(uid,'driver') THEN
    RAISE EXCEPTION 'driver_only';
  END IF;
  SELECT * INTO s FROM public.reward_settings WHERE id = true;
  SELECT count(*) INTO count_today FROM public.share_events
    WHERE user_id = uid AND rewarded = true AND created_at > now() - interval '1 day';
  IF count_today >= s.driver_share_daily_cap THEN
    INSERT INTO public.share_events(user_id,channel,rewarded) VALUES (uid,_channel,false);
    RETURN jsonb_build_object('rewarded',false,'reason','daily_cap');
  END IF;
  bonus := s.driver_share_bonus_xof;
  INSERT INTO public.share_events(user_id,channel,rewarded,reward_xof) VALUES (uid,_channel,true,bonus);
  new_bal := public.apply_wallet_transaction(uid,'reward'::wallet_tx_type,bonus,NULL,'share:'||_channel,'Bonus partage app',uid);
  RETURN jsonb_build_object('rewarded',true,'bonus_xof',bonus,'balance_xof',new_bal);
END $$;

-- Register a referral when current user signs up with a code
CREATE OR REPLACE FUNCTION public.register_referral(_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  ref_user uuid;
  role_val public.app_role;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referee_id = uid) THEN
    RETURN jsonb_build_object('ok',false,'reason','already_referred');
  END IF;
  SELECT user_id INTO ref_user FROM public.referral_codes WHERE code = upper(_code);
  IF ref_user IS NULL OR ref_user = uid THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_code');
  END IF;
  SELECT role INTO role_val FROM public.user_roles WHERE user_id = uid ORDER BY role LIMIT 1;
  INSERT INTO public.referrals(referrer_id,referee_id,referee_role,status)
    VALUES (ref_user, uid, COALESCE(role_val,'passenger'), 'pending');
  RETURN jsonb_build_object('ok',true);
END $$;

-- Confirm a topup (admin or webhook)
CREATE OR REPLACE FUNCTION public.confirm_topup(_topup_id uuid, _provider_ref text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o public.topup_orders;
  s public.reward_settings;
  pts integer;
  new_bal integer;
BEGIN
  SELECT * INTO o FROM public.topup_orders WHERE id = _topup_id FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF o.status = 'paid' THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;
  SELECT * INTO s FROM public.reward_settings WHERE id = true;
  pts := floor(o.amount_xof / NULLIF(s.point_value_xof,0))::integer;
  UPDATE public.topup_orders SET status='paid', paid_at=now(),
    provider_reference = COALESCE(_provider_ref, provider_reference)
    WHERE id = _topup_id;
  new_bal := public.apply_passenger_wallet_tx(
    o.user_id,'topup'::passenger_wallet_tx_type, pts, NULL, o.provider, 'Recharge wallet'
  );
  RETURN jsonb_build_object('ok',true,'pts_added',pts,'balance_pts',new_bal);
END $$;

-- Apply wallet credit to a ride (passenger redeems pts)
CREATE OR REPLACE FUNCTION public.redeem_points_for_ride(_ride_id uuid, _pts integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  r public.rides;
  s public.reward_settings;
  bal integer;
  xof_credit integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF _pts <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  SELECT * INTO r FROM public.rides WHERE id = _ride_id;
  IF r.passenger_id <> uid THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF r.status NOT IN ('requested','accepted','arriving') THEN
    RAISE EXCEPTION 'ride_not_redeemable';
  END IF;
  SELECT balance_pts INTO bal FROM public.passenger_wallets WHERE user_id = uid;
  IF COALESCE(bal,0) < _pts THEN RAISE EXCEPTION 'insufficient_points'; END IF;
  SELECT * INTO s FROM public.reward_settings WHERE id = true;
  xof_credit := LEAST((_pts * s.point_value_xof)::integer, r.price_xof);
  PERFORM public.apply_passenger_wallet_tx(uid,'ride_redeem'::passenger_wallet_tx_type, -_pts, _ride_id, NULL, 'Crédit course');
  UPDATE public.rides SET price_xof = GREATEST(price_xof - xof_credit, 0), updated_at = now()
    WHERE id = _ride_id;
  RETURN jsonb_build_object('ok',true,'xof_credit',xof_credit);
END $$;

-- Trigger: on ride completed, distribute rewards
CREATE OR REPLACE FUNCTION public.distribute_ride_rewards()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.reward_settings;
  ref public.referrals;
  rides_count integer;
  is_first boolean := false;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN RETURN NEW; END IF;
  SELECT * INTO s FROM public.reward_settings WHERE id = true;

  -- Passenger earns points per ride
  IF NEW.passenger_id IS NOT NULL AND s.passenger_ride_earn_pts > 0 THEN
    PERFORM public.apply_passenger_wallet_tx(
      NEW.passenger_id,'ride_earn'::passenger_wallet_tx_type, s.passenger_ride_earn_pts,
      NEW.id, NULL, 'Points course'
    );
  END IF;

  -- Check if first completed ride for this passenger
  SELECT count(*) INTO rides_count FROM public.rides
    WHERE passenger_id = NEW.passenger_id AND status='completed' AND id <> NEW.id;
  is_first := (rides_count = 0);

  -- Referral handling
  SELECT * INTO ref FROM public.referrals WHERE referee_id = NEW.passenger_id;
  IF ref.id IS NOT NULL THEN
    -- First-ride bonus for the referrer
    IF is_first AND ref.status = 'pending' THEN
      IF public.has_role(ref.referrer_id,'driver') THEN
        PERFORM public.apply_wallet_transaction(
          ref.referrer_id,'referral'::wallet_tx_type, s.driver_referral_bonus_xof,
          NEW.id, 'referral:passenger', 'Bonus parrainage 1ère course', NULL
        );
        UPDATE public.referrals SET status='rewarded', validated_at=now(), rewarded_at=now(),
          reward_xof = s.driver_referral_bonus_xof WHERE id = ref.id;
      ELSE
        PERFORM public.apply_passenger_wallet_tx(
          ref.referrer_id,'referral_bonus'::passenger_wallet_tx_type, s.passenger_referral_bonus_pts,
          NEW.id, 'referral', 'Bonus parrainage 1ère course'
        );
        UPDATE public.referrals SET status='rewarded', validated_at=now(), rewarded_at=now(),
          reward_pts = s.passenger_referral_bonus_pts WHERE id = ref.id;
      END IF;
    END IF;
    -- Per-ride kickback to driver referrer (recurring)
    IF public.has_role(ref.referrer_id,'driver') AND s.driver_referral_per_ride_xof > 0 THEN
      PERFORM public.apply_wallet_transaction(
        ref.referrer_id,'referral'::wallet_tx_type, s.driver_referral_per_ride_xof,
        NEW.id, 'referral:ride', 'Commission parrainage par course', NULL
      );
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_distribute_ride_rewards ON public.rides;
CREATE TRIGGER trg_distribute_ride_rewards
AFTER UPDATE ON public.rides
FOR EACH ROW EXECUTE FUNCTION public.distribute_ride_rewards();

-- Validate driver referral when referee_role=driver completes first ride (as driver)
CREATE OR REPLACE FUNCTION public.distribute_driver_referral()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.reward_settings;
  ref public.referrals;
  done integer;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' OR NEW.driver_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO ref FROM public.referrals WHERE referee_id = NEW.driver_id AND referee_role='driver' AND status='pending';
  IF ref.id IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO done FROM public.rides WHERE driver_id = NEW.driver_id AND status='completed' AND id <> NEW.id;
  IF done > 0 THEN RETURN NEW; END IF;
  SELECT * INTO s FROM public.reward_settings WHERE id = true;
  PERFORM public.apply_wallet_transaction(
    ref.referrer_id,'referral'::wallet_tx_type, s.driver_referral_bonus_xof,
    NEW.id, 'referral:driver', 'Bonus parrainage chauffeur', NULL
  );
  UPDATE public.referrals SET status='rewarded', validated_at=now(), rewarded_at=now(),
    reward_xof = s.driver_referral_bonus_xof WHERE id = ref.id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_driver_referral ON public.rides;
CREATE TRIGGER trg_driver_referral
AFTER UPDATE ON public.rides
FOR EACH ROW EXECUTE FUNCTION public.distribute_driver_referral();

-- ========== 20260619092350_71cdb868-5dc7-4a36-ad42-6378a8f4eb7e.sql ==========

-- ============ fraud_logs ============
CREATE TABLE IF NOT EXISTS public.fraud_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  reference text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.fraud_logs TO authenticated;
GRANT ALL ON public.fraud_logs TO service_role;
ALTER TABLE public.fraud_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read fraud logs" ON public.fraud_logs;
CREATE POLICY "Admins read fraud logs" ON public.fraud_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS fraud_logs_user_idx ON public.fraud_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fraud_logs_kind_idx ON public.fraud_logs(kind, created_at DESC);

-- ============ ride_payouts ============
DO $$ BEGIN
  CREATE TYPE public.ride_payout_status AS ENUM ('paid','failed','skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.ride_payouts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ride_id uuid NOT NULL UNIQUE REFERENCES public.rides(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gross_xof integer NOT NULL DEFAULT 0,
  commission_xof integer NOT NULL DEFAULT 0,
  net_xof integer NOT NULL DEFAULT 0,
  status public.ride_payout_status NOT NULL DEFAULT 'paid',
  error text,
  processed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ride_payouts TO authenticated;
GRANT ALL ON public.ride_payouts TO service_role;
ALTER TABLE public.ride_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Driver or admin read payouts" ON public.ride_payouts;
CREATE POLICY "Driver or admin read payouts" ON public.ride_payouts FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS ride_payouts_driver_idx ON public.ride_payouts(driver_id, processed_at DESC);

-- ============ Trigger: log payout on ride completion ============
CREATE OR REPLACE FUNCTION public.log_ride_payout_on_complete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing uuid;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' OR NEW.driver_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT id INTO existing FROM public.ride_payouts WHERE ride_id = NEW.id;
  IF existing IS NOT NULL THEN
    INSERT INTO public.fraud_logs(user_id, kind, severity, ride_id, details)
    VALUES (NEW.driver_id, 'duplicate_payout_attempt', 'warn', NEW.id,
            jsonb_build_object('existing_payout_id', existing));
    RETURN NEW;
  END IF;
  INSERT INTO public.ride_payouts(ride_id, driver_id, gross_xof, commission_xof, net_xof, status)
  VALUES (NEW.id, NEW.driver_id,
          COALESCE(NEW.price_xof,0),
          COALESCE(NEW.commission_xof,0),
          COALESCE(NEW.driver_earnings_xof, COALESCE(NEW.price_xof,0) - COALESCE(NEW.commission_xof,0)),
          'paid');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.ride_payouts(ride_id, driver_id, gross_xof, commission_xof, net_xof, status, error)
  VALUES (NEW.id, NEW.driver_id,
          COALESCE(NEW.price_xof,0), COALESCE(NEW.commission_xof,0),
          COALESCE(NEW.driver_earnings_xof,0), 'failed', SQLERRM);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_ride_payout ON public.rides;
CREATE TRIGGER trg_log_ride_payout
  AFTER UPDATE OF status ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.log_ride_payout_on_complete();

-- ============ Tighten claim_driver_share_reward (cooldown + log) ============
CREATE OR REPLACE FUNCTION public.claim_driver_share_reward(_channel text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  s public.reward_settings;
  count_today integer;
  last_at timestamptz;
  bonus integer;
  new_bal integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.has_role(uid,'driver') THEN
    RAISE EXCEPTION 'driver_only';
  END IF;
  SELECT * INTO s FROM public.reward_settings WHERE id = true;

  -- Cooldown 60s between any attempt
  SELECT max(created_at) INTO last_at FROM public.share_events WHERE user_id = uid;
  IF last_at IS NOT NULL AND last_at > now() - interval '60 seconds' THEN
    INSERT INTO public.fraud_logs(user_id,kind,severity,details)
    VALUES (uid,'share_cooldown','warn',jsonb_build_object('channel',_channel));
    RETURN jsonb_build_object('rewarded',false,'reason','cooldown');
  END IF;

  SELECT count(*) INTO count_today FROM public.share_events
    WHERE user_id = uid AND rewarded = true AND created_at > now() - interval '1 day';
  IF count_today >= s.driver_share_daily_cap THEN
    INSERT INTO public.share_events(user_id,channel,rewarded) VALUES (uid,_channel,false);
    INSERT INTO public.fraud_logs(user_id,kind,severity,details)
    VALUES (uid,'share_daily_cap','info',jsonb_build_object('channel',_channel,'count_today',count_today));
    RETURN jsonb_build_object('rewarded',false,'reason','daily_cap');
  END IF;

  bonus := s.driver_share_bonus_xof;
  INSERT INTO public.share_events(user_id,channel,rewarded,reward_xof) VALUES (uid,_channel,true,bonus);
  new_bal := public.apply_wallet_transaction(uid,'reward'::wallet_tx_type,bonus,NULL,'share:'||_channel,'Bonus partage app',uid);
  RETURN jsonb_build_object('rewarded',true,'bonus_xof',bonus,'balance_xof',new_bal);
END $$;

-- ============ Tighten register_referral (anti self-referral by phone + log) ============
CREATE OR REPLACE FUNCTION public.register_referral(_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  ref_user uuid;
  role_val public.app_role;
  my_phone text;
  ref_phone text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  IF EXISTS (SELECT 1 FROM public.referrals WHERE referee_id = uid) THEN
    INSERT INTO public.fraud_logs(user_id,kind,severity,reference,details)
    VALUES (uid,'referral_duplicate','warn',_code,jsonb_build_object('reason','already_referred'));
    RETURN jsonb_build_object('ok',false,'reason','already_referred');
  END IF;

  SELECT user_id INTO ref_user FROM public.referral_codes WHERE code = upper(_code);
  IF ref_user IS NULL THEN
    INSERT INTO public.fraud_logs(user_id,kind,severity,reference,details)
    VALUES (uid,'referral_invalid_code','info',_code,'{}'::jsonb);
    RETURN jsonb_build_object('ok',false,'reason','invalid_code');
  END IF;
  IF ref_user = uid THEN
    INSERT INTO public.fraud_logs(user_id,kind,severity,reference,details)
    VALUES (uid,'referral_self','high',_code,'{}'::jsonb);
    RETURN jsonb_build_object('ok',false,'reason','invalid_code');
  END IF;

  -- Same-phone abuse detection
  SELECT phone INTO my_phone FROM public.profiles WHERE id = uid;
  SELECT phone INTO ref_phone FROM public.profiles WHERE id = ref_user;
  IF my_phone IS NOT NULL AND ref_phone IS NOT NULL
     AND regexp_replace(my_phone,'\D','','g') = regexp_replace(ref_phone,'\D','','g') THEN
    INSERT INTO public.fraud_logs(user_id,kind,severity,reference,details)
    VALUES (uid,'referral_same_phone','high',_code,
            jsonb_build_object('referrer_id',ref_user));
    RETURN jsonb_build_object('ok',false,'reason','invalid_code');
  END IF;

  SELECT role INTO role_val FROM public.user_roles WHERE user_id = uid ORDER BY role LIMIT 1;
  INSERT INTO public.referrals(referrer_id,referee_id,referee_role,status)
    VALUES (ref_user, uid, COALESCE(role_val,'passenger'), 'pending');
  RETURN jsonb_build_object('ok',true);
END $$;

-- ========== 20260619095119_a5a04622-f614-43b3-bf61-46b5a38e7133.sql ==========

-- 1) profiles: restrict SELECT to self / admin / current ride participant
DROP POLICY IF EXISTS "Profiles selectable by everyone authenticated" ON public.profiles;
CREATE POLICY "Profiles read self admin or ride participant"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.rides r
      WHERE (r.passenger_id = auth.uid() AND r.driver_id = profiles.id)
         OR (r.driver_id = auth.uid() AND r.passenger_id = profiles.id)
    )
  );

-- 2) driver_profiles: restrict SELECT to own + admin only (drop passenger clause)
DROP POLICY IF EXISTS "Driver reads own profile" ON public.driver_profiles;
CREATE POLICY "Driver reads own profile"
  ON public.driver_profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Public-safe RPC for ride passengers to fetch their driver's vehicle info
CREATE OR REPLACE FUNCTION public.get_ride_driver_public(_ride_id uuid)
RETURNS TABLE (
  full_name text,
  avatar_url text,
  phone text,
  vehicle_plate text,
  vehicle_model text,
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
  SELECT p.full_name, p.avatar_url, p.phone, dp.vehicle_plate, dp.vehicle_model, dp.rating_avg
    FROM public.profiles p
    LEFT JOIN public.driver_profiles dp ON dp.user_id = p.id
    WHERE p.id = r.driver_id;
END $$;
REVOKE ALL ON FUNCTION public.get_ride_driver_public(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ride_driver_public(uuid) TO authenticated;

-- 3) rides: column-level UPDATE restriction for drivers via trigger
CREATE OR REPLACE FUNCTION public.enforce_ride_driver_update_cols()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  -- Skip enforcement when no auth context (system / trigger cascades) or admin/passenger
  IF uid IS NULL THEN RETURN NEW; END IF;
  IF public.has_role(uid,'admin') THEN RETURN NEW; END IF;
  IF uid = OLD.passenger_id THEN RETURN NEW; END IF;
  -- Acting as driver (or unauthorized) → lock down mutable columns
  IF NEW.passenger_id    IS DISTINCT FROM OLD.passenger_id
     OR NEW.price_xof       IS DISTINCT FROM OLD.price_xof
     OR NEW.commission_xof  IS DISTINCT FROM OLD.commission_xof
     OR NEW.commission_rate IS DISTINCT FROM OLD.commission_rate
     OR NEW.driver_earnings_xof IS DISTINCT FROM OLD.driver_earnings_xof
     OR NEW.payment_method  IS DISTINCT FROM OLD.payment_method
     OR NEW.passenger_phone IS DISTINCT FROM OLD.passenger_phone
     OR NEW.pickup_address  IS DISTINCT FROM OLD.pickup_address
     OR NEW.dropoff_address IS DISTINCT FROM OLD.dropoff_address
     OR NEW.pickup_lat      IS DISTINCT FROM OLD.pickup_lat
     OR NEW.pickup_lng      IS DISTINCT FROM OLD.pickup_lng
     OR NEW.dropoff_lat     IS DISTINCT FROM OLD.dropoff_lat
     OR NEW.dropoff_lng     IS DISTINCT FROM OLD.dropoff_lng
     OR NEW.distance_km     IS DISTINCT FROM OLD.distance_km
     OR NEW.duration_min    IS DISTINCT FROM OLD.duration_min
     OR NEW.city            IS DISTINCT FROM OLD.city
     OR NEW.category        IS DISTINCT FROM OLD.category
  THEN
    RAISE EXCEPTION 'Drivers cannot modify these ride fields';
  END IF;
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    IF NEW.driver_id IS NOT NULL AND NEW.driver_id <> uid THEN
      RAISE EXCEPTION 'Drivers may only assign themselves to a ride';
    END IF;
    IF OLD.driver_id IS NOT NULL AND OLD.driver_id <> uid THEN
      RAISE EXCEPTION 'Ride already assigned to another driver';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS a_enforce_ride_driver_cols ON public.rides;
CREATE TRIGGER a_enforce_ride_driver_cols
  BEFORE UPDATE ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ride_driver_update_cols();

-- 4) referral_codes: restrict SELECT to own + admin
DROP POLICY IF EXISTS "own code rw" ON public.referral_codes;
CREATE POLICY "Read own referral code"
  ON public.referral_codes FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- 5) commission_schedules: admins only
DROP POLICY IF EXISTS "view commission schedules" ON public.commission_schedules;
CREATE POLICY "Admins view commission schedules"
  ON public.commission_schedules FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- 6) storage policies for driver-documents: owner can delete/update own files
DROP POLICY IF EXISTS "Drivers delete own documents" ON storage.objects;
CREATE POLICY "Drivers delete own documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'driver-documents' AND owner = auth.uid());

DROP POLICY IF EXISTS "Drivers update own documents" ON storage.objects;
CREATE POLICY "Drivers update own documents"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'driver-documents' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'driver-documents' AND owner = auth.uid());

-- ========== 20260619095132_2ea55f4c-4b1f-4fc4-a6f6-e39ba601fcc2.sql ==========

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef=true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon', r.nspname, r.proname, r.args);
  END LOOP;
END $$;

-- ========== 20260619100743_1d328785-e2fe-4a58-8508-f0570e913e6c.sql ==========
REVOKE EXECUTE ON FUNCTION public.confirm_topup(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_topup(uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.apply_passenger_wallet_tx(uuid, public.passenger_wallet_tx_type, integer, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_passenger_wallet_tx(uuid, public.passenger_wallet_tx_type, integer, uuid, text, text)
  TO service_role;

DROP POLICY IF EXISTS "Users write their own ratings" ON public.ratings;
CREATE POLICY "Ride participants rate the other party"
ON public.ratings
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = rater_id
  AND EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = ratings.ride_id
      AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
      AND (r.passenger_id = ratings.ratee_id OR r.driver_id = ratings.ratee_id)
      AND r.passenger_id IS DISTINCT FROM r.driver_id
      AND r.status = 'completed'
  )
);

CREATE OR REPLACE FUNCTION public.enforce_ride_driver_update_cols()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN NEW; END IF;
  IF public.has_role(uid,'admin') THEN RETURN NEW; END IF;

  IF uid = OLD.passenger_id THEN
    IF NEW.passenger_id        IS DISTINCT FROM OLD.passenger_id
       OR NEW.driver_id        IS DISTINCT FROM OLD.driver_id
       OR NEW.price_xof        IS DISTINCT FROM OLD.price_xof
       OR NEW.commission_xof   IS DISTINCT FROM OLD.commission_xof
       OR NEW.commission_rate  IS DISTINCT FROM OLD.commission_rate
       OR NEW.driver_earnings_xof IS DISTINCT FROM OLD.driver_earnings_xof
       OR NEW.distance_km      IS DISTINCT FROM OLD.distance_km
       OR NEW.duration_min     IS DISTINCT FROM OLD.duration_min
       OR NEW.pickup_lat       IS DISTINCT FROM OLD.pickup_lat
       OR NEW.pickup_lng       IS DISTINCT FROM OLD.pickup_lng
       OR NEW.dropoff_lat      IS DISTINCT FROM OLD.dropoff_lat
       OR NEW.dropoff_lng      IS DISTINCT FROM OLD.dropoff_lng
       OR NEW.city             IS DISTINCT FROM OLD.city
       OR NEW.category         IS DISTINCT FROM OLD.category
    THEN
      RAISE EXCEPTION 'Passengers cannot modify these ride fields';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.passenger_id    IS DISTINCT FROM OLD.passenger_id
     OR NEW.price_xof       IS DISTINCT FROM OLD.price_xof
     OR NEW.commission_xof  IS DISTINCT FROM OLD.commission_xof
     OR NEW.commission_rate IS DISTINCT FROM OLD.commission_rate
     OR NEW.driver_earnings_xof IS DISTINCT FROM OLD.driver_earnings_xof
     OR NEW.payment_method  IS DISTINCT FROM OLD.payment_method
     OR NEW.passenger_phone IS DISTINCT FROM OLD.passenger_phone
     OR NEW.pickup_address  IS DISTINCT FROM OLD.pickup_address
     OR NEW.dropoff_address IS DISTINCT FROM OLD.dropoff_address
     OR NEW.pickup_lat      IS DISTINCT FROM OLD.pickup_lat
     OR NEW.pickup_lng      IS DISTINCT FROM OLD.pickup_lng
     OR NEW.dropoff_lat     IS DISTINCT FROM OLD.dropoff_lat
     OR NEW.dropoff_lng     IS DISTINCT FROM OLD.dropoff_lng
     OR NEW.distance_km     IS DISTINCT FROM OLD.distance_km
     OR NEW.duration_min    IS DISTINCT FROM OLD.duration_min
     OR NEW.city            IS DISTINCT FROM OLD.city
     OR NEW.category        IS DISTINCT FROM OLD.category
  THEN
    RAISE EXCEPTION 'Drivers cannot modify these ride fields';
  END IF;
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    IF NEW.driver_id IS NOT NULL AND NEW.driver_id <> uid THEN
      RAISE EXCEPTION 'Drivers may only assign themselves to a ride';
    END IF;
    IF OLD.driver_id IS NOT NULL AND OLD.driver_id <> uid THEN
      RAISE EXCEPTION 'Ride already assigned to another driver';
    END IF;
  END IF;
  RETURN NEW;
END $$;
-- ========== 20260619101057_7dc094db-df83-409c-b69e-757e73c2c27f.sql ==========
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'support';
-- ========== 20260619101131_f7fec7c4-8106-4ddb-aa72-db3c9c829b8f.sql ==========
DO $$ BEGIN
  CREATE TYPE public.ticket_status AS ENUM ('open','pending','resolved','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.ticket_priority AS ENUM ('low','normal','high','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.ticket_category AS ENUM ('account','payment','ride','driver','passenger','technical','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 3 AND 200),
  category public.ticket_category NOT NULL DEFAULT 'other',
  priority public.ticket_priority NOT NULL DEFAULT 'normal',
  status public.ticket_status NOT NULL DEFAULT 'open',
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.support_tickets TO authenticated;
GRANT ALL ON public.support_tickets TO service_role;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ticket visible to owner, support, admin"
ON public.support_tickets FOR SELECT TO authenticated
USING (
  auth.uid() = created_by
  OR public.has_role(auth.uid(),'support')
  OR public.has_role(auth.uid(),'admin')
);

CREATE POLICY "Authenticated users open their own tickets"
ON public.support_tickets FOR INSERT TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Support and admin update tickets"
ON public.support_tickets FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(),'support') OR public.has_role(auth.uid(),'admin'))
WITH CHECK (public.has_role(auth.uid(),'support') OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "Owner updates own ticket"
ON public.support_tickets FOR UPDATE TO authenticated
USING (auth.uid() = created_by)
WITH CHECK (auth.uid() = created_by);

CREATE TRIGGER tg_support_tickets_touch
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_ticket_owner_cols()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN NEW; END IF;
  IF public.has_role(uid,'support') OR public.has_role(uid,'admin') THEN RETURN NEW; END IF;
  IF uid = OLD.created_by THEN
    IF NEW.created_by  IS DISTINCT FROM OLD.created_by
       OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
       OR NEW.priority   IS DISTINCT FROM OLD.priority
       OR NEW.category   IS DISTINCT FROM OLD.category
       OR (NEW.status   IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('closed','open'))
    THEN
      RAISE EXCEPTION 'Owners cannot modify these ticket fields';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tg_support_tickets_enforce
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ticket_owner_cols();

CREATE INDEX IF NOT EXISTS idx_support_tickets_owner ON public.support_tickets(created_by, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  is_internal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.ticket_messages TO authenticated;
GRANT ALL ON public.ticket_messages TO service_role;
ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read ticket messages"
ON public.ticket_messages FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE t.id = ticket_messages.ticket_id
      AND (
        t.created_by = auth.uid()
        OR public.has_role(auth.uid(),'support')
        OR public.has_role(auth.uid(),'admin')
      )
  )
  AND (
    is_internal = false
    OR public.has_role(auth.uid(),'support')
    OR public.has_role(auth.uid(),'admin')
  )
);

CREATE POLICY "Post ticket messages"
ON public.ticket_messages FOR INSERT TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE t.id = ticket_messages.ticket_id
      AND t.status <> 'closed'
      AND (
        t.created_by = auth.uid()
        OR public.has_role(auth.uid(),'support')
        OR public.has_role(auth.uid(),'admin')
      )
  )
  AND (
    is_internal = false
    OR public.has_role(auth.uid(),'support')
    OR public.has_role(auth.uid(),'admin')
  )
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON public.ticket_messages(ticket_id, created_at);

CREATE OR REPLACE FUNCTION public.bump_ticket_last_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.support_tickets
    SET last_message_at = NEW.created_at,
        updated_at = now(),
        status = CASE
          WHEN status = 'closed' THEN status
          WHEN NEW.author_id = created_by THEN 'open'
          ELSE 'pending'
        END
  WHERE id = NEW.ticket_id;
  RETURN NEW;
END $$;

CREATE TRIGGER tg_ticket_messages_bump
  AFTER INSERT ON public.ticket_messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_ticket_last_message();
-- ========== 20260619101145_d330f05e-74d6-4644-83da-56c50d225be8.sql ==========
REVOKE EXECUTE ON FUNCTION public.enforce_ticket_owner_cols() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_ticket_last_message() FROM PUBLIC, anon, authenticated;
-- ========== 20260619172226_2ec26bb1-1427-468f-ac08-df1e7e9c54fd.sql ==========
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country text;
COMMENT ON COLUMN public.profiles.country IS 'Pays de rattachement (utilisé notamment pour les administrateurs scopés par pays).';
CREATE INDEX IF NOT EXISTS profiles_country_idx ON public.profiles(country);
-- ========== 20260619174822_a521e0bb-98ed-4c02-8632-caa6d44bae2f.sql ==========
ALTER TABLE public.corporate_accounts ADD COLUMN IF NOT EXISTS country text;
CREATE INDEX IF NOT EXISTS corporate_accounts_country_idx ON public.corporate_accounts(country);
-- ========== 20260619190038_42266b23-48eb-4931-8e74-5cbffcff7d89.sql ==========

-- 1) Add new enum value (must be committed before use)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'superadmin';

-- ========== 20260619190054_db55520c-fbae-45df-b88d-d591c0c06e78.sql ==========

-- Backfill superadmin role for existing admins without a country
INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT ur.user_id, 'superadmin'::public.app_role
FROM public.user_roles ur
LEFT JOIN public.profiles p ON p.id = ur.user_id
WHERE ur.role = 'admin'::public.app_role
  AND (p.country IS NULL OR p.country = '')
ON CONFLICT (user_id, role) DO NOTHING;

-- Trigger: prevent assigning a country to a superadmin
CREATE OR REPLACE FUNCTION public.prevent_country_for_superadmin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.country IS NOT NULL AND NEW.country <> '' THEN
    IF EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = NEW.id AND role = 'superadmin'::public.app_role
    ) THEN
      RAISE EXCEPTION 'Un superadmin ne peut pas être rattaché à un pays.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_prevent_country_for_superadmin ON public.profiles;
CREATE TRIGGER trg_prevent_country_for_superadmin
BEFORE INSERT OR UPDATE OF country ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_country_for_superadmin();

-- Trigger: when granting superadmin, ensure user also has admin and clear country
CREATE OR REPLACE FUNCTION public.sync_superadmin_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'superadmin'::public.app_role THEN
    INSERT INTO public.user_roles(user_id, role)
      VALUES (NEW.user_id, 'admin'::public.app_role)
      ON CONFLICT (user_id, role) DO NOTHING;
    UPDATE public.profiles SET country = NULL WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_superadmin_grant ON public.user_roles;
CREATE TRIGGER trg_sync_superadmin_grant
AFTER INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.sync_superadmin_grant();

-- ========== 20260619191151_254d90f3-c06a-4cc4-9669-a51aadf06a66.sql ==========

-- 1) Helpers
CREATE OR REPLACE FUNCTION public.is_superadmin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'superadmin'::public.app_role)
$$;

CREATE OR REPLACE FUNCTION public.admin_country(_uid uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT country FROM public.profiles WHERE id = _uid
$$;

-- 2) Denormalize country onto rides
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS country text;
CREATE INDEX IF NOT EXISTS rides_country_idx ON public.rides(country);

UPDATE public.rides r
SET country = p.country
FROM public.profiles p
WHERE p.id = r.passenger_id AND r.country IS NULL AND p.country IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_ride_country()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.country IS NULL AND NEW.passenger_id IS NOT NULL THEN
    SELECT country INTO NEW.country FROM public.profiles WHERE id = NEW.passenger_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS set_ride_country_trg ON public.rides;
CREATE TRIGGER set_ride_country_trg
BEFORE INSERT ON public.rides
FOR EACH ROW EXECUTE FUNCTION public.set_ride_country();

-- 3) Profiles: scope admin reads to same country
DROP POLICY IF EXISTS "Profiles read self admin or ride participant" ON public.profiles;
CREATE POLICY "Profiles read scoped"
ON public.profiles FOR SELECT
USING (
  auth.uid() = id
  OR public.is_superadmin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND profiles.country IS NOT DISTINCT FROM public.admin_country(auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.rides r
    WHERE (r.passenger_id = auth.uid() AND r.driver_id = profiles.id)
       OR (r.driver_id   = auth.uid() AND r.passenger_id = profiles.id)
  )
);

-- 4) Driver profiles
DROP POLICY IF EXISTS "Admins manage drivers" ON public.driver_profiles;
CREATE POLICY "Admins manage drivers scoped"
ON public.driver_profiles FOR ALL
USING (
  public.is_superadmin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND (SELECT country FROM public.profiles WHERE id = driver_profiles.user_id)
        IS NOT DISTINCT FROM public.admin_country(auth.uid())
  )
)
WITH CHECK (
  public.is_superadmin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND (SELECT country FROM public.profiles WHERE id = driver_profiles.user_id)
        IS NOT DISTINCT FROM public.admin_country(auth.uid())
  )
);

-- Also refine the existing driver SELECT policy to keep admin country scope consistent
DROP POLICY IF EXISTS "Driver reads own profile" ON public.driver_profiles;
CREATE POLICY "Driver reads own or admin scoped"
ON public.driver_profiles FOR SELECT
USING (
  auth.uid() = user_id
  OR public.is_superadmin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND (SELECT country FROM public.profiles WHERE id = driver_profiles.user_id)
        IS NOT DISTINCT FROM public.admin_country(auth.uid())
  )
);

-- 5) Rides
DROP POLICY IF EXISTS "Admin sees all rides" ON public.rides;
DROP POLICY IF EXISTS "Admin updates rides" ON public.rides;

CREATE POLICY "Admin sees rides scoped"
ON public.rides FOR SELECT
USING (
  public.is_superadmin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND rides.country IS NOT DISTINCT FROM public.admin_country(auth.uid())
  )
);

CREATE POLICY "Admin updates rides scoped"
ON public.rides FOR UPDATE
USING (
  public.is_superadmin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND rides.country IS NOT DISTINCT FROM public.admin_country(auth.uid())
  )
);

-- 6) Payments
DROP POLICY IF EXISTS "Passenger or admin write payments" ON public.payments;
DROP POLICY IF EXISTS "Payments visible to ride participants" ON public.payments;

CREATE POLICY "Payments select scoped"
ON public.payments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = payments.ride_id
      AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
  )
  OR public.is_superadmin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND (SELECT country FROM public.rides WHERE id = payments.ride_id)
        IS NOT DISTINCT FROM public.admin_country(auth.uid())
  )
);

CREATE POLICY "Payments write scoped"
ON public.payments FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = payments.ride_id AND r.passenger_id = auth.uid()
  )
  OR public.is_superadmin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND (SELECT country FROM public.rides WHERE id = payments.ride_id)
        IS NOT DISTINCT FROM public.admin_country(auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = payments.ride_id AND r.passenger_id = auth.uid()
  )
  OR public.is_superadmin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND (SELECT country FROM public.rides WHERE id = payments.ride_id)
        IS NOT DISTINCT FROM public.admin_country(auth.uid())
  )
);

-- 7) Invoices
DROP POLICY IF EXISTS "Admins manage invoices" ON public.invoices;
CREATE POLICY "Admins manage invoices scoped"
ON public.invoices FOR ALL
USING (
  public.is_superadmin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND (SELECT country FROM public.corporate_accounts WHERE id = invoices.corporate_id)
        IS NOT DISTINCT FROM public.admin_country(auth.uid())
  )
)
WITH CHECK (
  public.is_superadmin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND (SELECT country FROM public.corporate_accounts WHERE id = invoices.corporate_id)
        IS NOT DISTINCT FROM public.admin_country(auth.uid())
  )
);

-- 8) Corporate accounts
DROP POLICY IF EXISTS "Admins manage corporates" ON public.corporate_accounts;
CREATE POLICY "Admins manage corporates scoped"
ON public.corporate_accounts FOR ALL
USING (
  public.is_superadmin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND corporate_accounts.country IS NOT DISTINCT FROM public.admin_country(auth.uid())
  )
)
WITH CHECK (
  public.is_superadmin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND corporate_accounts.country IS NOT DISTINCT FROM public.admin_country(auth.uid())
  )
);

-- 9) User roles: superadmin only for admin/superadmin grants; country admins limited
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
CREATE POLICY "Roles managed by scoped admin"
ON public.user_roles FOR ALL
USING (
  public.is_superadmin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND user_roles.role NOT IN ('admin'::public.app_role, 'superadmin'::public.app_role)
    AND (SELECT country FROM public.profiles WHERE id = user_roles.user_id)
        IS NOT DISTINCT FROM public.admin_country(auth.uid())
  )
)
WITH CHECK (
  public.is_superadmin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND user_roles.role NOT IN ('admin'::public.app_role, 'superadmin'::public.app_role)
    AND (SELECT country FROM public.profiles WHERE id = user_roles.user_id)
        IS NOT DISTINCT FROM public.admin_country(auth.uid())
  )
);

-- 10) Audit logs: direct read restricted to superadmin (country admins go via server fn)
DROP POLICY IF EXISTS "Admins read audit logs" ON public.audit_logs;
CREATE POLICY "Superadmins read audit logs"
ON public.audit_logs FOR SELECT
USING (public.is_superadmin(auth.uid()));

-- ========== 20260619191655_2ffc5630-8b2a-4a9c-a04d-cd0be5f49c54.sql ==========

-- Update handle_new_user to persist country from signup metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _country text;
BEGIN
  _country := NULLIF(NEW.raw_user_meta_data->>'country', '');

  INSERT INTO public.profiles (id, full_name, phone, country)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)),
    NEW.raw_user_meta_data->>'phone',
    _country
  );

  IF NEW.raw_user_meta_data->>'role' = 'driver' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'driver');
    INSERT INTO public.driver_profiles (user_id) VALUES (NEW.id);
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'passenger');
  END IF;

  RETURN NEW;
END $$;

-- Enforce ride.country NOT NULL after the set_ride_country trigger has filled it.
CREATE OR REPLACE FUNCTION public.enforce_ride_country()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.country IS NULL OR NEW.country = '' THEN
    RAISE EXCEPTION 'Le pays est obligatoire. Merci de renseigner votre pays dans votre profil avant de commander une course.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS enforce_ride_country_trg ON public.rides;
CREATE CONSTRAINT TRIGGER enforce_ride_country_trg
AFTER INSERT ON public.rides
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_ride_country();

-- ========== 20260619200732_94fcb5d9-ede3-4f43-8d14-dc11248304f8.sql ==========

ALTER TABLE public.notification_prefs
  ADD COLUMN IF NOT EXISTS notify_new_ride boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS channel_toast boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS channel_system boolean NOT NULL DEFAULT true;

