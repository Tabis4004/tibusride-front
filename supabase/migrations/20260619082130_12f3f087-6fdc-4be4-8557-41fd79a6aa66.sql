
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
