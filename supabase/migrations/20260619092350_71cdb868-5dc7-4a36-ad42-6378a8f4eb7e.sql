
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
