-- =============================================================================
-- Tibus Ride — Schéma PostgreSQL pour Supabase
-- =============================================================================
-- Exécution (projet Supabase vierge) :
--   1. Supabase Dashboard → SQL Editor → New query
--   2. Coller ce script et cliquer Run
--   3. Ou : psql "$DATABASE_URL" -f scripts/supabase-init.sql
--
-- Auth : Supabase Auth (auth.users natif, auth.uid() natif).
-- Fichiers : bucket Storage "driver-documents".
-- Temps réel : publication supabase_realtime sur public.rides.
--
-- Après exécution, configurez dans Vercel (frontend) :
--   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE public.app_role AS ENUM ('passenger', 'driver', 'admin', 'support');
CREATE TYPE public.vehicle_category AS ENUM ('taxi', 'eco', 'confort', 'confort_plus', 'vip');
CREATE TYPE public.driver_status AS ENUM ('pending', 'under_review', 'approved', 'rejected', 'suspended');
CREATE TYPE public.ride_status AS ENUM ('requested', 'accepted', 'arriving', 'in_progress', 'completed', 'cancelled');
CREATE TYPE public.payment_method AS ENUM ('mobile_money', 'cash', 'card');
CREATE TYPE public.payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded');
CREATE TYPE public.invoice_status AS ENUM ('draft', 'issued', 'paid', 'cancelled');
CREATE TYPE public.payment_method_type AS ENUM ('bank_transfer', 'mobile_money', 'cash', 'card', 'other');
CREATE TYPE public.wallet_tx_type AS ENUM ('topup', 'commission', 'adjustment', 'refund', 'reward', 'referral');
CREATE TYPE public.passenger_wallet_tx_type AS ENUM ('topup', 'ride_earn', 'referral_bonus', 'ride_redeem', 'adjustment', 'refund');
CREATE TYPE public.referral_status AS ENUM ('pending', 'validated', 'rewarded', 'cancelled');
CREATE TYPE public.topup_status AS ENUM ('pending', 'paid', 'failed', 'cancelled');
CREATE TYPE public.commission_kind AS ENUM ('percent', 'flat');
CREATE TYPE public.ride_payout_status AS ENUM ('paid', 'failed', 'skipped');
CREATE TYPE public.ticket_status AS ENUM ('open', 'pending', 'resolved', 'closed');
CREATE TYPE public.ticket_priority AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE public.ticket_category AS ENUM ('account', 'payment', 'ride', 'driver', 'passenger', 'technical', 'other');

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT, phone TEXT, city TEXT DEFAULT 'Dakar', language TEXT DEFAULT 'fr',
  avatar_url TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(user_id, role)
);

CREATE TABLE public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category public.vehicle_category NOT NULL, brand TEXT, model TEXT, color TEXT,
  plate TEXT NOT NULL, year INT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.driver_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.driver_status NOT NULL DEFAULT 'pending', is_online BOOLEAN NOT NULL DEFAULT false,
  license_number TEXT, city TEXT, current_lat DOUBLE PRECISION, current_lng DOUBLE PRECISION,
  rating_avg NUMERIC(3,2) DEFAULT 5.00, rides_count INT NOT NULL DEFAULT 0,
  total_earnings NUMERIC(12,2) NOT NULL DEFAULT 0,
  id_document_url TEXT, license_document_url TEXT, vehicle_document_url TEXT,
  rejection_reason TEXT, status_updated_at TIMESTAMPTZ, status_updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  pickup_address TEXT NOT NULL, pickup_lat DOUBLE PRECISION, pickup_lng DOUBLE PRECISION,
  dropoff_address TEXT NOT NULL, dropoff_lat DOUBLE PRECISION, dropoff_lng DOUBLE PRECISION,
  city TEXT NOT NULL DEFAULT 'Dakar', category public.vehicle_category NOT NULL DEFAULT 'taxi',
  distance_km NUMERIC(6,2), duration_min INT, price_xof INT NOT NULL, currency TEXT NOT NULL DEFAULT 'XOF',
  status public.ride_status NOT NULL DEFAULT 'requested',
  payment_method public.payment_method NOT NULL DEFAULT 'cash',
  passenger_phone TEXT, notes TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), accepted_at TIMESTAMPTZ, started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ,
  commission_rate NUMERIC(5,2), commission_xof INTEGER, driver_earnings_xof INTEGER,
  driver_lat DOUBLE PRECISION, driver_lng DOUBLE PRECISION, driver_location_updated_at TIMESTAMPTZ,
  eta_seconds INTEGER, passenger_shares_phone BOOLEAN NOT NULL DEFAULT true,
  driver_shares_phone BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rides_status ON public.rides(status);
CREATE INDEX idx_rides_passenger ON public.rides(passenger_id);
CREATE INDEX idx_rides_driver ON public.rides(driver_id);

CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  amount_xof INT NOT NULL, method public.payment_method NOT NULL,
  status public.payment_status NOT NULL DEFAULT 'pending',
  provider TEXT, provider_ref TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  rater_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ratee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score INT NOT NULL CHECK (score BETWEEN 1 AND 5), comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(ride_id, rater_id)
);

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), actor_id UUID NOT NULL, actor_email TEXT,
  action TEXT NOT NULL, target_type TEXT, target_id TEXT, target_label TEXT, details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX audit_logs_actor_idx ON public.audit_logs (actor_id);
CREATE INDEX audit_logs_target_idx ON public.audit_logs (target_type, target_id);

CREATE TABLE public.pricing_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), category public.vehicle_category NOT NULL UNIQUE,
  base_fare_xof INTEGER NOT NULL DEFAULT 500, per_km_xof INTEGER NOT NULL DEFAULT 250,
  per_min_xof INTEGER NOT NULL DEFAULT 50, min_fare_xof INTEGER NOT NULL DEFAULT 1000,
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 20.00, active BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID REFERENCES auth.users(id), commission_type public.commission_kind NOT NULL DEFAULT 'percent',
  commission_flat_xof INTEGER NOT NULL DEFAULT 0 CHECK (commission_flat_xof >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT commission_rate_range CHECK (commission_rate >= 0 AND commission_rate <= 100)
);

CREATE TABLE public.corporate_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, contact_name TEXT, email TEXT,
  phone TEXT, address TEXT, city TEXT, tax_id TEXT, notes TEXT, active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE public.invoice_number_seq;

CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), number TEXT UNIQUE,
  corporate_id UUID NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE RESTRICT,
  period_start DATE, period_end DATE, subtotal_xof INTEGER NOT NULL DEFAULT 0,
  vat_rate NUMERIC(5,2) NOT NULL DEFAULT 18.00, vat_xof INTEGER NOT NULL DEFAULT 0,
  total_xof INTEGER NOT NULL DEFAULT 0, paid_xof INTEGER NOT NULL DEFAULT 0,
  status public.invoice_status NOT NULL DEFAULT 'draft', notes TEXT,
  issued_at TIMESTAMPTZ, due_date DATE, paid_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
  description TEXT NOT NULL, quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price_xof INTEGER NOT NULL DEFAULT 0, total_xof INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.invoice_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount_xof INTEGER NOT NULL, method public.payment_method_type NOT NULL,
  reference TEXT, paid_on DATE NOT NULL DEFAULT current_date, notes TEXT,
  recorded_by UUID REFERENCES auth.users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.driver_wallets (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_xof INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type public.wallet_tx_type NOT NULL, amount_xof INTEGER NOT NULL, balance_after_xof INTEGER NOT NULL,
  ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
  reference TEXT, notes TEXT, created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX wallet_tx_driver_idx ON public.wallet_transactions(driver_id, created_at DESC);

CREATE TABLE public.commission_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), category public.vehicle_category NOT NULL,
  commission_type public.commission_kind NOT NULL DEFAULT 'percent',
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (commission_rate >= 0 AND commission_rate <= 100),
  commission_flat_xof INTEGER NOT NULL DEFAULT 0 CHECK (commission_flat_xof >= 0),
  starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ, priority INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true, notes TEXT, created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX commission_schedules_lookup ON public.commission_schedules (category, active, priority DESC, starts_at DESC);

CREATE TABLE public.ride_tracking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, status public.ride_status,
  lat DOUBLE PRECISION, lng DOUBLE PRECISION, actor_id UUID, details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ride_tracking_events_ride ON public.ride_tracking_events(ride_id, created_at);

CREATE TABLE public.notification_prefs (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  notify_status_change BOOLEAN NOT NULL DEFAULT true, notify_driver_arriving BOOLEAN NOT NULL DEFAULT true,
  notify_driver_nearby BOOLEAN NOT NULL DEFAULT true, sound_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.reward_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  driver_share_bonus_xof INTEGER NOT NULL DEFAULT 500, driver_share_daily_cap INTEGER NOT NULL DEFAULT 1,
  driver_referral_bonus_xof INTEGER NOT NULL DEFAULT 5000, driver_referral_per_ride_xof INTEGER NOT NULL DEFAULT 100,
  passenger_referral_bonus_pts INTEGER NOT NULL DEFAULT 1000, passenger_ride_earn_pts INTEGER NOT NULL DEFAULT 50,
  point_value_xof NUMERIC NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.passenger_wallets (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_pts INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.passenger_wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type public.passenger_wallet_tx_type NOT NULL, amount_pts INTEGER NOT NULL, balance_after_pts INTEGER NOT NULL,
  ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
  reference TEXT, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.passenger_wallet_transactions(user_id, created_at DESC);

CREATE TABLE public.referral_codes (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referee_role public.app_role NOT NULL, status public.referral_status NOT NULL DEFAULT 'pending',
  validated_at TIMESTAMPTZ, rewarded_at TIMESTAMPTZ, reward_xof INTEGER DEFAULT 0, reward_pts INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (referee_id)
);
CREATE INDEX ON public.referrals(referrer_id);

CREATE TABLE public.share_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL, rewarded BOOLEAN NOT NULL DEFAULT false, reward_xof INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.share_events(user_id, created_at DESC);

CREATE TABLE public.topup_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_xof INTEGER NOT NULL CHECK (amount_xof > 0), provider TEXT NOT NULL,
  status public.topup_status NOT NULL DEFAULT 'pending', provider_reference TEXT, payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), paid_at TIMESTAMPTZ
);
CREATE INDEX ON public.topup_orders(user_id, created_at DESC);

CREATE TABLE public.fraud_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info', ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
  reference TEXT, details JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fraud_logs_user_idx ON public.fraud_logs(user_id, created_at DESC);
CREATE INDEX fraud_logs_kind_idx ON public.fraud_logs(kind, created_at DESC);

CREATE TABLE public.ride_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL UNIQUE REFERENCES public.rides(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gross_xof INTEGER NOT NULL DEFAULT 0, commission_xof INTEGER NOT NULL DEFAULT 0, net_xof INTEGER NOT NULL DEFAULT 0,
  status public.ride_payout_status NOT NULL DEFAULT 'paid', error TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ride_payouts_driver_idx ON public.ride_payouts(driver_id, processed_at DESC);

CREATE TABLE public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 3 AND 200),
  category public.ticket_category NOT NULL DEFAULT 'other',
  priority public.ticket_priority NOT NULL DEFAULT 'normal',
  status public.ticket_status NOT NULL DEFAULT 'open',
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(), closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_support_tickets_owner ON public.support_tickets(created_by, last_message_at DESC);
CREATE INDEX idx_support_tickets_status ON public.support_tickets(status, last_message_at DESC);

CREATE TABLE public.ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  is_internal BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ticket_messages_ticket ON public.ticket_messages(ticket_id, created_at);

-- Métadonnées documents chauffeur (fichiers dans Storage bucket driver-documents)
CREATE TABLE public.driver_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('id', 'license', 'vehicle')),
  blob_url TEXT NOT NULL, file_name TEXT, mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_driver_documents_driver ON public.driver_documents(driver_id, doc_type);

-- ---------------------------------------------------------------------------
-- Fonctions métier
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(COALESCE(NEW.email,''), '@', 1)),
    NEW.raw_user_meta_data->>'phone'
  );
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

CREATE OR REPLACE FUNCTION public.assign_invoice_number()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.number IS NULL THEN
    NEW.number := 'INV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.apply_wallet_transaction(
  _driver_id uuid, _type public.wallet_tx_type, _amount_xof integer,
  _ride_id uuid DEFAULT NULL, _reference text DEFAULT NULL, _notes text DEFAULT NULL, _actor uuid DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance integer;
BEGIN
  INSERT INTO public.driver_wallets(user_id, balance_xof) VALUES(_driver_id, 0) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.driver_wallets SET balance_xof = balance_xof + _amount_xof, updated_at = now()
    WHERE user_id = _driver_id RETURNING balance_xof INTO new_balance;
  INSERT INTO public.wallet_transactions(driver_id, type, amount_xof, balance_after_xof, ride_id, reference, notes, created_by)
    VALUES (_driver_id, _type, _amount_xof, new_balance, _ride_id, _reference, _notes, _actor);
  RETURN new_balance;
END $$;

CREATE OR REPLACE FUNCTION public.resolve_commission(_category public.vehicle_category, _at timestamptz)
RETURNS TABLE(commission_type public.commission_kind, commission_rate numeric, commission_flat_xof integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM (
    SELECT s.commission_type, s.commission_rate, s.commission_flat_xof
    FROM public.commission_schedules s
    WHERE s.category = _category AND s.active = true AND s.starts_at <= _at
      AND (s.ends_at IS NULL OR s.ends_at > _at)
    ORDER BY s.priority DESC, s.starts_at DESC LIMIT 1
  ) sched
  UNION ALL
  SELECT * FROM (
    SELECT p.commission_type, p.commission_rate, p.commission_flat_xof
    FROM public.pricing_settings p WHERE p.category = _category AND p.active = true LIMIT 1
  ) defaults LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.compute_ride_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; c_amount integer;
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

CREATE OR REPLACE FUNCTION public.debit_commission_on_ride_complete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE commission integer;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed')
     AND NEW.driver_id IS NOT NULL AND COALESCE(NEW.commission_xof, 0) > 0 THEN
    commission := NEW.commission_xof;
    PERFORM public.apply_wallet_transaction(
      NEW.driver_id, 'commission'::public.wallet_tx_type, -commission, NEW.id,
      NULL, 'Commission course #' || substr(NEW.id::text, 1, 8), NULL
    );
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.log_ride_tracking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

CREATE OR REPLACE FUNCTION public.apply_passenger_wallet_tx(
  _user_id uuid, _type public.passenger_wallet_tx_type, _amount_pts integer,
  _ride_id uuid DEFAULT NULL, _reference text DEFAULT NULL, _notes text DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance integer;
BEGIN
  INSERT INTO public.passenger_wallets(user_id, balance_pts) VALUES (_user_id, 0) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.passenger_wallets SET balance_pts = balance_pts + _amount_pts, updated_at = now()
    WHERE user_id = _user_id RETURNING balance_pts INTO new_balance;
  IF new_balance < 0 THEN RAISE EXCEPTION 'Insufficient points balance'; END IF;
  INSERT INTO public.passenger_wallet_transactions(user_id,type,amount_pts,balance_after_pts,ride_id,reference,notes)
    VALUES (_user_id,_type,_amount_pts,new_balance,_ride_id,_reference,_notes);
  RETURN new_balance;
END $$;

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
    EXCEPTION WHEN unique_violation THEN CONTINUE;
    END;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.claim_driver_share_reward(_channel text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid(); s public.reward_settings; count_today integer; last_at timestamptz; bonus integer; new_bal integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.has_role(uid,'driver') THEN RAISE EXCEPTION 'driver_only'; END IF;
  SELECT * INTO s FROM public.reward_settings WHERE id = true;
  SELECT max(created_at) INTO last_at FROM public.share_events WHERE user_id = uid;
  IF last_at IS NOT NULL AND last_at > now() - interval '60 seconds' THEN
    INSERT INTO public.fraud_logs(user_id,kind,severity,details) VALUES (uid,'share_cooldown','warn',jsonb_build_object('channel',_channel));
    RETURN jsonb_build_object('rewarded',false,'reason','cooldown');
  END IF;
  SELECT count(*) INTO count_today FROM public.share_events WHERE user_id = uid AND rewarded = true AND created_at > now() - interval '1 day';
  IF count_today >= s.driver_share_daily_cap THEN
    INSERT INTO public.share_events(user_id,channel,rewarded) VALUES (uid,_channel,false);
    RETURN jsonb_build_object('rewarded',false,'reason','daily_cap');
  END IF;
  bonus := s.driver_share_bonus_xof;
  INSERT INTO public.share_events(user_id,channel,rewarded,reward_xof) VALUES (uid,_channel,true,bonus);
  new_bal := public.apply_wallet_transaction(uid,'reward'::public.wallet_tx_type,bonus,NULL,'share:'||_channel,'Bonus partage app',uid);
  RETURN jsonb_build_object('rewarded',true,'bonus_xof',bonus,'balance_xof',new_bal);
END $$;

CREATE OR REPLACE FUNCTION public.register_referral(_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid(); ref_user uuid; role_val public.app_role; my_phone text; ref_phone text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referee_id = uid) THEN
    RETURN jsonb_build_object('ok',false,'reason','already_referred');
  END IF;
  SELECT user_id INTO ref_user FROM public.referral_codes WHERE code = upper(_code);
  IF ref_user IS NULL OR ref_user = uid THEN RETURN jsonb_build_object('ok',false,'reason','invalid_code'); END IF;
  SELECT phone INTO my_phone FROM public.profiles WHERE id = uid;
  SELECT phone INTO ref_phone FROM public.profiles WHERE id = ref_user;
  IF my_phone IS NOT NULL AND ref_phone IS NOT NULL
     AND regexp_replace(my_phone,'\D','','g') = regexp_replace(ref_phone,'\D','','g') THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_code');
  END IF;
  SELECT role INTO role_val FROM public.user_roles WHERE user_id = uid ORDER BY role LIMIT 1;
  INSERT INTO public.referrals(referrer_id,referee_id,referee_role,status)
    VALUES (ref_user, uid, COALESCE(role_val,'passenger'), 'pending');
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.confirm_topup(_topup_id uuid, _provider_ref text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.topup_orders; s public.reward_settings; pts integer; new_bal integer;
BEGIN
  SELECT * INTO o FROM public.topup_orders WHERE id = _topup_id FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF o.status = 'paid' THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;
  SELECT * INTO s FROM public.reward_settings WHERE id = true;
  pts := floor(o.amount_xof / NULLIF(s.point_value_xof,0))::integer;
  UPDATE public.topup_orders SET status='paid', paid_at=now(), provider_reference = COALESCE(_provider_ref, provider_reference) WHERE id = _topup_id;
  new_bal := public.apply_passenger_wallet_tx(o.user_id,'topup'::public.passenger_wallet_tx_type, pts, NULL, o.provider, 'Recharge wallet');
  RETURN jsonb_build_object('ok',true,'pts_added',pts,'balance_pts',new_bal);
END $$;

CREATE OR REPLACE FUNCTION public.redeem_points_for_ride(_ride_id uuid, _pts integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r public.rides; s public.reward_settings; bal integer; xof_credit integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF _pts <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  SELECT * INTO r FROM public.rides WHERE id = _ride_id;
  IF r.passenger_id <> uid THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF r.status NOT IN ('requested','accepted','arriving') THEN RAISE EXCEPTION 'ride_not_redeemable'; END IF;
  SELECT balance_pts INTO bal FROM public.passenger_wallets WHERE user_id = uid;
  IF COALESCE(bal,0) < _pts THEN RAISE EXCEPTION 'insufficient_points'; END IF;
  SELECT * INTO s FROM public.reward_settings WHERE id = true;
  xof_credit := LEAST((_pts * s.point_value_xof)::integer, r.price_xof);
  PERFORM public.apply_passenger_wallet_tx(uid,'ride_redeem'::public.passenger_wallet_tx_type, -_pts, _ride_id, NULL, 'Crédit course');
  UPDATE public.rides SET price_xof = GREATEST(price_xof - xof_credit, 0), updated_at = now() WHERE id = _ride_id;
  RETURN jsonb_build_object('ok',true,'xof_credit',xof_credit);
END $$;

CREATE OR REPLACE FUNCTION public.distribute_ride_rewards()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.reward_settings; ref public.referrals; rides_count integer; is_first boolean := false;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN RETURN NEW; END IF;
  SELECT * INTO s FROM public.reward_settings WHERE id = true;
  IF NEW.passenger_id IS NOT NULL AND s.passenger_ride_earn_pts > 0 THEN
    PERFORM public.apply_passenger_wallet_tx(NEW.passenger_id,'ride_earn'::public.passenger_wallet_tx_type, s.passenger_ride_earn_pts, NEW.id, NULL, 'Points course');
  END IF;
  SELECT count(*) INTO rides_count FROM public.rides WHERE passenger_id = NEW.passenger_id AND status='completed' AND id <> NEW.id;
  is_first := (rides_count = 0);
  SELECT * INTO ref FROM public.referrals WHERE referee_id = NEW.passenger_id;
  IF ref.id IS NOT NULL AND is_first AND ref.status = 'pending' THEN
    IF public.has_role(ref.referrer_id,'driver') THEN
      PERFORM public.apply_wallet_transaction(ref.referrer_id,'referral'::public.wallet_tx_type, s.driver_referral_bonus_xof, NEW.id, 'referral:passenger', 'Bonus parrainage 1ère course', NULL);
      UPDATE public.referrals SET status='rewarded', validated_at=now(), rewarded_at=now(), reward_xof = s.driver_referral_bonus_xof WHERE id = ref.id;
    ELSE
      PERFORM public.apply_passenger_wallet_tx(ref.referrer_id,'referral_bonus'::public.passenger_wallet_tx_type, s.passenger_referral_bonus_pts, NEW.id, 'referral', 'Bonus parrainage 1ère course');
      UPDATE public.referrals SET status='rewarded', validated_at=now(), rewarded_at=now(), reward_pts = s.passenger_referral_bonus_pts WHERE id = ref.id;
    END IF;
  END IF;
  IF ref.id IS NOT NULL AND public.has_role(ref.referrer_id,'driver') AND s.driver_referral_per_ride_xof > 0 THEN
    PERFORM public.apply_wallet_transaction(ref.referrer_id,'referral'::public.wallet_tx_type, s.driver_referral_per_ride_xof, NEW.id, 'referral:ride', 'Commission parrainage par course', NULL);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.distribute_driver_referral()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.reward_settings; ref public.referrals; done integer;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' OR NEW.driver_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO ref FROM public.referrals WHERE referee_id = NEW.driver_id AND referee_role='driver' AND status='pending';
  IF ref.id IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO done FROM public.rides WHERE driver_id = NEW.driver_id AND status='completed' AND id <> NEW.id;
  IF done > 0 THEN RETURN NEW; END IF;
  SELECT * INTO s FROM public.reward_settings WHERE id = true;
  PERFORM public.apply_wallet_transaction(ref.referrer_id,'referral'::public.wallet_tx_type, s.driver_referral_bonus_xof, NEW.id, 'referral:driver', 'Bonus parrainage chauffeur', NULL);
  UPDATE public.referrals SET status='rewarded', validated_at=now(), rewarded_at=now(), reward_xof = s.driver_referral_bonus_xof WHERE id = ref.id;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.log_ride_payout_on_complete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing uuid;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' OR NEW.driver_id IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO existing FROM public.ride_payouts WHERE ride_id = NEW.id;
  IF existing IS NOT NULL THEN
    INSERT INTO public.fraud_logs(user_id, kind, severity, ride_id, details)
    VALUES (NEW.driver_id, 'duplicate_payout_attempt', 'warn', NEW.id, jsonb_build_object('existing_payout_id', existing));
    RETURN NEW;
  END IF;
  INSERT INTO public.ride_payouts(ride_id, driver_id, gross_xof, commission_xof, net_xof, status)
  VALUES (NEW.id, NEW.driver_id, COALESCE(NEW.price_xof,0), COALESCE(NEW.commission_xof,0),
          COALESCE(NEW.driver_earnings_xof, COALESCE(NEW.price_xof,0) - COALESCE(NEW.commission_xof,0)), 'paid');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.ride_payouts(ride_id, driver_id, gross_xof, commission_xof, net_xof, status, error)
  VALUES (NEW.id, NEW.driver_id, COALESCE(NEW.price_xof,0), COALESCE(NEW.commission_xof,0),
          COALESCE(NEW.driver_earnings_xof,0), 'failed', SQLERRM);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.get_ride_driver_public(_ride_id uuid)
RETURNS TABLE (full_name text, avatar_url text, phone text, vehicle_plate text, vehicle_model text, rating_avg numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r public.rides;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO r FROM public.rides WHERE id = _ride_id;
  IF r.id IS NULL OR (r.passenger_id <> uid AND r.driver_id <> uid AND NOT public.has_role(uid,'admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF r.driver_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT p.full_name, p.avatar_url, p.phone, v.plate, v.model, dp.rating_avg
  FROM public.profiles p
  LEFT JOIN public.driver_profiles dp ON dp.user_id = p.id
  LEFT JOIN LATERAL (
    SELECT plate, model FROM public.vehicles WHERE driver_id = r.driver_id ORDER BY created_at DESC LIMIT 1
  ) v ON true
  WHERE p.id = r.driver_id;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_ride_driver_update_cols()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN NEW; END IF;
  IF public.has_role(uid,'admin') THEN RETURN NEW; END IF;
  IF uid = OLD.passenger_id THEN
    IF NEW.passenger_id IS DISTINCT FROM OLD.passenger_id OR NEW.driver_id IS DISTINCT FROM OLD.driver_id
       OR NEW.price_xof IS DISTINCT FROM OLD.price_xof OR NEW.commission_xof IS DISTINCT FROM OLD.commission_xof
       OR NEW.commission_rate IS DISTINCT FROM OLD.commission_rate OR NEW.driver_earnings_xof IS DISTINCT FROM OLD.driver_earnings_xof
       OR NEW.distance_km IS DISTINCT FROM OLD.distance_km OR NEW.duration_min IS DISTINCT FROM OLD.duration_min
       OR NEW.pickup_lat IS DISTINCT FROM OLD.pickup_lat OR NEW.pickup_lng IS DISTINCT FROM OLD.pickup_lng
       OR NEW.dropoff_lat IS DISTINCT FROM OLD.dropoff_lat OR NEW.dropoff_lng IS DISTINCT FROM OLD.dropoff_lng
       OR NEW.city IS DISTINCT FROM OLD.city OR NEW.category IS DISTINCT FROM OLD.category THEN
      RAISE EXCEPTION 'Passengers cannot modify these ride fields';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.passenger_id IS DISTINCT FROM OLD.passenger_id OR NEW.price_xof IS DISTINCT FROM OLD.price_xof
     OR NEW.commission_xof IS DISTINCT FROM OLD.commission_xof OR NEW.commission_rate IS DISTINCT FROM OLD.commission_rate
     OR NEW.driver_earnings_xof IS DISTINCT FROM OLD.driver_earnings_xof OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.passenger_phone IS DISTINCT FROM OLD.passenger_phone OR NEW.pickup_address IS DISTINCT FROM OLD.pickup_address
     OR NEW.dropoff_address IS DISTINCT FROM OLD.dropoff_address OR NEW.pickup_lat IS DISTINCT FROM OLD.pickup_lat
     OR NEW.pickup_lng IS DISTINCT FROM OLD.pickup_lng OR NEW.dropoff_lat IS DISTINCT FROM OLD.dropoff_lat
     OR NEW.dropoff_lng IS DISTINCT FROM OLD.dropoff_lng OR NEW.distance_km IS DISTINCT FROM OLD.distance_km
     OR NEW.duration_min IS DISTINCT FROM OLD.duration_min OR NEW.city IS DISTINCT FROM OLD.city OR NEW.category IS DISTINCT FROM OLD.category THEN
    RAISE EXCEPTION 'Drivers cannot modify these ride fields';
  END IF;
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    IF NEW.driver_id IS NOT NULL AND NEW.driver_id <> uid THEN RAISE EXCEPTION 'Drivers may only assign themselves to a ride'; END IF;
    IF OLD.driver_id IS NOT NULL AND OLD.driver_id <> uid THEN RAISE EXCEPTION 'Ride already assigned to another driver'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_ticket_owner_cols()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN NEW; END IF;
  IF public.has_role(uid,'support') OR public.has_role(uid,'admin') THEN RETURN NEW; END IF;
  IF uid = OLD.created_by THEN
    IF NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
       OR NEW.priority IS DISTINCT FROM OLD.priority OR NEW.category IS DISTINCT FROM OLD.category
       OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('closed','open')) THEN
      RAISE EXCEPTION 'Owners cannot modify these ticket fields';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.bump_ticket_last_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.support_tickets SET last_message_at = NEW.created_at, updated_at = now(),
    status = CASE WHEN status = 'closed' THEN status WHEN NEW.author_id = created_by THEN 'open' ELSE 'pending' END
  WHERE id = NEW.ticket_id;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_driver_profiles_touch BEFORE UPDATE ON public.driver_profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_rides_touch BEFORE UPDATE ON public.rides FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER pricing_settings_touch BEFORE UPDATE ON public.pricing_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER corporate_accounts_touch BEFORE UPDATE ON public.corporate_accounts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER invoices_touch BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER invoices_number BEFORE INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.assign_invoice_number();
CREATE TRIGGER commission_schedules_touch BEFORE UPDATE ON public.commission_schedules FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER rides_compute_commission BEFORE UPDATE ON public.rides FOR EACH ROW EXECUTE FUNCTION public.compute_ride_commission();
CREATE TRIGGER rides_debit_commission AFTER UPDATE OF status ON public.rides FOR EACH ROW EXECUTE FUNCTION public.debit_commission_on_ride_complete();
CREATE TRIGGER trg_log_ride_tracking AFTER UPDATE ON public.rides FOR EACH ROW EXECUTE FUNCTION public.log_ride_tracking();
CREATE TRIGGER trg_distribute_ride_rewards AFTER UPDATE ON public.rides FOR EACH ROW EXECUTE FUNCTION public.distribute_ride_rewards();
CREATE TRIGGER trg_driver_referral AFTER UPDATE ON public.rides FOR EACH ROW EXECUTE FUNCTION public.distribute_driver_referral();
CREATE TRIGGER trg_log_ride_payout AFTER UPDATE OF status ON public.rides FOR EACH ROW EXECUTE FUNCTION public.log_ride_payout_on_complete();
CREATE TRIGGER a_enforce_ride_driver_cols BEFORE UPDATE ON public.rides FOR EACH ROW EXECUTE FUNCTION public.enforce_ride_driver_update_cols();
CREATE TRIGGER tg_support_tickets_touch BEFORE UPDATE ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tg_support_tickets_enforce BEFORE UPDATE ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION public.enforce_ticket_owner_cols();
CREATE TRIGGER tg_ticket_messages_bump AFTER INSERT ON public.ticket_messages FOR EACH ROW EXECUTE FUNCTION public.bump_ticket_last_message();

-- ---------------------------------------------------------------------------
-- RLS + GRANTS
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passenger_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passenger_wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topup_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fraud_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_documents ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON public.pricing_settings TO anon;

CREATE POLICY "Profiles read self admin or ride participant" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin') OR EXISTS (
    SELECT 1 FROM public.rides r WHERE (r.passenger_id = auth.uid() AND r.driver_id = profiles.id)
      OR (r.driver_id = auth.uid() AND r.passenger_id = profiles.id)));
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Driver manages own vehicles" ON public.vehicles FOR ALL TO authenticated
  USING (auth.uid() = driver_id) WITH CHECK (auth.uid() = driver_id);
CREATE POLICY "Admins manage all vehicles" ON public.vehicles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Driver reads own profile" ON public.driver_profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Driver manages own profile" ON public.driver_profiles FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins manage drivers" ON public.driver_profiles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Passenger sees own rides" ON public.rides FOR SELECT TO authenticated USING (auth.uid() = passenger_id);
CREATE POLICY "Driver sees assigned or open rides" ON public.rides FOR SELECT TO authenticated
  USING (auth.uid() = driver_id OR (status = 'requested' AND public.has_role(auth.uid(),'driver')));
CREATE POLICY "Admin sees all rides" ON public.rides FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Passenger creates rides" ON public.rides FOR INSERT TO authenticated WITH CHECK (auth.uid() = passenger_id);
CREATE POLICY "Passenger updates own pending rides" ON public.rides FOR UPDATE TO authenticated USING (auth.uid() = passenger_id);
CREATE POLICY "Driver updates assigned or claims open ride" ON public.rides FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'driver') AND (driver_id IS NULL OR driver_id = auth.uid()));
CREATE POLICY "Admin updates rides" ON public.rides FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Driver can update own ride location" ON public.rides FOR UPDATE TO authenticated
  USING (auth.uid() = driver_id) WITH CHECK (auth.uid() = driver_id);

CREATE POLICY "Payments visible to ride participants" ON public.payments FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid()))
  OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Passenger or admin write payments" ON public.payments FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.passenger_id = auth.uid()) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.passenger_id = auth.uid()) OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "Ratings visible to ride participants or admin" ON public.ratings FOR SELECT TO authenticated
  USING (auth.uid() = rater_id OR auth.uid() = ratee_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Ride participants rate the other party" ON public.ratings FOR INSERT TO authenticated WITH CHECK (
  auth.uid() = rater_id AND EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ratings.ride_id
    AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
    AND (r.passenger_id = ratings.ratee_id OR r.driver_id = ratings.ratee_id)
    AND r.passenger_id IS DISTINCT FROM r.driver_id AND r.status = 'completed'));

CREATE POLICY "Admins read audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert audit logs" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND auth.uid() = actor_id);

CREATE POLICY "Anyone can view pricing" ON public.pricing_settings FOR SELECT USING (true);
CREATE POLICY "Admins manage pricing" ON public.pricing_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage corporates" ON public.corporate_accounts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage invoices" ON public.invoices FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage invoice items" ON public.invoice_items FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage invoice payments" ON public.invoice_payments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Driver sees own wallet" ON public.driver_wallets FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Driver sees own tx" ON public.wallet_transactions FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins view commission schedules" ON public.commission_schedules FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins manage commission schedules" ON public.commission_schedules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Parties can view tracking events" ON public.ride_tracking_events FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_tracking_events.ride_id AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid()))
  OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Parties can insert tracking events" ON public.ride_tracking_events FOR INSERT TO authenticated WITH CHECK (
  actor_id = auth.uid() AND EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_tracking_events.ride_id
    AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())));

CREATE POLICY "Users manage their notification prefs" ON public.notification_prefs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "everyone reads settings" ON public.reward_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin updates settings" ON public.reward_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin inserts settings" ON public.reward_settings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "own wallet read" ON public.passenger_wallets FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin manages wallets" ON public.passenger_wallets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "own tx read" ON public.passenger_wallet_transactions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Read own referral code" ON public.referral_codes FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "own code insert" ON public.referral_codes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "see my referrals" ON public.referrals FOR SELECT TO authenticated
  USING (referrer_id = auth.uid() OR referee_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "self-referral insert" ON public.referrals FOR INSERT TO authenticated WITH CHECK (referee_id = auth.uid());
CREATE POLICY "own share read" ON public.share_events FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "own share insert" ON public.share_events FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own topup read" ON public.topup_orders FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "own topup insert" ON public.topup_orders FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins read fraud logs" ON public.fraud_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Driver or admin read payouts" ON public.ride_payouts FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "Ticket visible to owner, support, admin" ON public.support_tickets FOR SELECT TO authenticated
  USING (auth.uid() = created_by OR public.has_role(auth.uid(),'support') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Authenticated users open their own tickets" ON public.support_tickets FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Support and admin update tickets" ON public.support_tickets FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'support') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'support') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Owner updates own ticket" ON public.support_tickets FOR UPDATE TO authenticated
  USING (auth.uid() = created_by) WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Read ticket messages" ON public.ticket_messages FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_messages.ticket_id
    AND (t.created_by = auth.uid() OR public.has_role(auth.uid(),'support') OR public.has_role(auth.uid(),'admin')))
  AND (is_internal = false OR public.has_role(auth.uid(),'support') OR public.has_role(auth.uid(),'admin')));
CREATE POLICY "Post ticket messages" ON public.ticket_messages FOR INSERT TO authenticated WITH CHECK (
  author_id = auth.uid() AND EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_messages.ticket_id
    AND t.status <> 'closed' AND (t.created_by = auth.uid() OR public.has_role(auth.uid(),'support') OR public.has_role(auth.uid(),'admin')))
  AND (is_internal = false OR public.has_role(auth.uid(),'support') OR public.has_role(auth.uid(),'admin')));

CREATE POLICY "Driver manages own documents" ON public.driver_documents FOR ALL TO authenticated
  USING (driver_id = auth.uid()) WITH CHECK (driver_id = auth.uid());
CREATE POLICY "Admins manage driver documents" ON public.driver_documents FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Revokes sécurité (SECURITY DEFINER)
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.debit_commission_on_ride_complete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_ride_commission() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_commission(public.vehicle_category, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_topup(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_passenger_wallet_tx(uuid, public.passenger_wallet_tx_type, integer, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_ticket_owner_cols() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_ticket_last_message() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_ride_driver_update_cols() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_wallet_transaction(uuid, public.wallet_tx_type, integer, uuid, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_topup(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_passenger_wallet_tx(uuid, public.passenger_wallet_tx_type, integer, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ride_driver_public(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_driver_share_reward(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_referral(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_points_for_ride(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_referral_code(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Données initiales
-- ---------------------------------------------------------------------------
INSERT INTO public.pricing_settings (category, base_fare_xof, per_km_xof, per_min_xof, min_fare_xof, commission_rate) VALUES
  ('taxi',         500,  200, 40, 1000, 15.00),
  ('eco',          600,  250, 50, 1200, 18.00),
  ('confort',      800,  300, 60, 1500, 20.00),
  ('confort_plus', 1000, 400, 80, 2000, 22.00),
  ('vip',          2000, 600, 120, 3500, 25.00);

INSERT INTO public.reward_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Supabase Storage : documents chauffeur
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'driver-documents',
  'driver-documents',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

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

DROP POLICY IF EXISTS "Drivers delete own documents" ON storage.objects;
CREATE POLICY "Drivers delete own documents" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'driver-documents' AND owner = auth.uid());

DROP POLICY IF EXISTS "Drivers update own documents" ON storage.objects;
CREATE POLICY "Drivers update own documents" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'driver-documents' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'driver-documents' AND owner = auth.uid());

-- ---------------------------------------------------------------------------
-- Supabase Storage : annonces vocales pré-générées (cache TTS cloud)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tts-announcements',
  'tts-announcements',
  true,
  2097152,
  ARRAY['audio/mpeg']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read tts-announcements" ON storage.objects;
CREATE POLICY "Public read tts-announcements" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'tts-announcements');

DROP POLICY IF EXISTS "Service role manages tts-announcements" ON storage.objects;
CREATE POLICY "Service role manages tts-announcements" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'tts-announcements')
  WITH CHECK (bucket_id = 'tts-announcements');

-- ---------------------------------------------------------------------------
-- Supabase Realtime : suivi des courses en direct
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'rides'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
  END IF;
END $$;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

COMMIT;

-- =============================================================================
-- Fin du script. Vérifier :
--   SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';
--   SELECT id FROM storage.buckets WHERE id = 'driver-documents';
-- =============================================================================
