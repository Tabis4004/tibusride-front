-- Dashboard assureur : statut de validation de l'assurance, table d'alertes
-- (préavis de chauffeur avant expiration), et fonctions RPC dédiées.
--
-- Conception : comme pour getMyPendingOffer (dispatch_engine), on évite
-- d'exposer driver_profiles/profiles via des policies RLS larges à un
-- nouveau rôle — on passe par des fonctions SECURITY DEFINER qui ne
-- projettent que les colonnes utiles à l'assureur (nom, téléphone, véhicule,
-- statut/échéance d'assurance), pas l'intégralité du profil chauffeur
-- (gains, notation, etc.).

ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS insurance_status text NOT NULL DEFAULT 'pending'
    CHECK (insurance_status IN ('pending', 'verified', 'expired')),
  ADD COLUMN IF NOT EXISTS insurance_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS insurance_verified_by uuid REFERENCES auth.users(id);

-- ============================================================================
-- 1. Alertes chauffeur (préavis d'expiration assurance, etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.driver_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  threshold_days integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS driver_alerts_driver_id_idx ON public.driver_alerts(driver_id);

ALTER TABLE public.driver_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "driver reads own alerts" ON public.driver_alerts;
CREATE POLICY "driver reads own alerts" ON public.driver_alerts
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "driver marks own alerts read" ON public.driver_alerts;
CREATE POLICY "driver marks own alerts read" ON public.driver_alerts
  FOR UPDATE TO authenticated
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

-- ============================================================================
-- 2. Génération quotidienne des préavis d'expiration assurance.
--    Seuils : 30/15/7/3/1 jours avant échéance, puis une alerte "expirée"
--    par jour tant que le document n'est pas renouvelé. Idempotent : une
--    seule alerte par (chauffeur, seuil, jour) grâce à la vérification
--    d'existence avant insertion.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.generate_insurance_alerts()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d record;
  days_left integer;
  threshold integer;
  thresholds integer[] := ARRAY[30, 15, 7, 3, 1];
  alert_title text;
  alert_body text;
BEGIN
  FOR d IN
    SELECT user_id, insurance_expires_at, insurance_status
    FROM public.driver_profiles
    WHERE insurance_expires_at IS NOT NULL
      AND status = 'approved'
  LOOP
    days_left := d.insurance_expires_at - CURRENT_DATE;

    IF days_left < 0 THEN
      IF d.insurance_status <> 'expired' THEN
        UPDATE public.driver_profiles SET insurance_status = 'expired', updated_at = now() WHERE user_id = d.user_id;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.driver_alerts
        WHERE driver_id = d.user_id AND type = 'insurance_expired' AND created_at::date = CURRENT_DATE
      ) THEN
        INSERT INTO public.driver_alerts (driver_id, type, title, body, threshold_days)
        VALUES (d.user_id, 'insurance_expired', 'Assurance expirée',
          'Votre assurance a expiré. Renouvelez-la dès que possible pour continuer à recevoir des courses.', 0);
      END IF;
      CONTINUE;
    END IF;

    FOREACH threshold IN ARRAY thresholds LOOP
      IF days_left = threshold THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.driver_alerts
          WHERE driver_id = d.user_id AND type = 'insurance_expiring' AND threshold_days = threshold
            AND created_at::date = CURRENT_DATE
        ) THEN
          alert_title := 'Assurance bientôt expirée';
          alert_body := format('Votre assurance expire dans %s jour%s. Pensez à la renouveler.', threshold, CASE WHEN threshold > 1 THEN 's' ELSE '' END);
          INSERT INTO public.driver_alerts (driver_id, type, title, body, threshold_days)
          VALUES (d.user_id, 'insurance_expiring', alert_title, alert_body, threshold);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

SELECT cron.schedule('insurance-expiry-alerts', '0 7 * * *', 'SELECT public.generate_insurance_alerts();');

-- ============================================================================
-- 3. Dashboard assureur : liste des chauffeurs assurés + contact.
--    Projection minimale (pas tout driver_profiles/profiles).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_insured_drivers()
RETURNS TABLE(
  user_id uuid,
  full_name text,
  phone text,
  country text,
  city text,
  vehicle_type text,
  partner_type text,
  insurance_status text,
  insurance_expires_at date,
  insurance_document_url text,
  days_remaining integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'insurer') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Forbidden: insurer role required';
  END IF;

  RETURN QUERY
  SELECT
    dp.user_id,
    pr.full_name,
    pr.phone,
    pr.country,
    dp.city,
    dp.vehicle_type,
    dp.partner_type,
    dp.insurance_status,
    dp.insurance_expires_at,
    dp.insurance_document_url,
    (dp.insurance_expires_at - CURRENT_DATE)::integer
  FROM public.driver_profiles dp
  JOIN public.profiles pr ON pr.id = dp.user_id
  WHERE dp.insurance_document_url IS NOT NULL OR dp.insurance_expires_at IS NOT NULL
  ORDER BY dp.insurance_expires_at ASC NULLS LAST;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_insured_drivers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_insured_drivers() TO authenticated;

-- ============================================================================
-- 4. Validation par l'assureur lors d'un renouvellement.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.verify_driver_insurance(_driver_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'insurer') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Forbidden: insurer role required';
  END IF;

  UPDATE public.driver_profiles
  SET insurance_status = 'verified',
      insurance_verified_at = now(),
      insurance_verified_by = auth.uid(),
      updated_at = now()
  WHERE user_id = _driver_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_driver_insurance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_driver_insurance(uuid) TO authenticated;

-- ============================================================================
-- 5. Renouvellement par le chauffeur : remet le dossier en attente de
--    validation assureur (insurance_status -> 'pending').
-- ============================================================================
CREATE OR REPLACE FUNCTION public.renew_my_insurance(_expires_at date)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.driver_profiles
  SET insurance_expires_at = _expires_at,
      insurance_status = 'pending',
      insurance_verified_at = NULL,
      insurance_verified_by = NULL,
      updated_at = now()
  WHERE user_id = auth.uid();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.renew_my_insurance(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_my_insurance(date) TO authenticated;
