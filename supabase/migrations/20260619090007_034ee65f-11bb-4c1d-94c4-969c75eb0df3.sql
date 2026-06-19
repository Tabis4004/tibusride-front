
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
