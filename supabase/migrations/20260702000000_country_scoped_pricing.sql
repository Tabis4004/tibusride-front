-- Le système de "programmes de marché" est désactivé (un pays = un système).
-- La seule source de vérité pour les tarifs ET les commissions devient :
--   - pricing_settings (courses, par catégorie)
--   - delivery_pricing_settings (livraison, par véhicule)
--   - dynamic_pricing_settings (coefficients trafic/météo)
-- Cette migration les rend configurables PAR PAYS : une ligne globale
-- (country IS NULL) sert de défaut ; un admin peut ajouter une ligne dédiée
-- pour un pays donné, qui prévaut alors uniquement pour ce pays. Si aucune
-- ligne pays n'existe, la ligne globale s'applique automatiquement.

-- 1) pricing_settings : category devient (category, country)
ALTER TABLE public.pricing_settings ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE public.pricing_settings DROP CONSTRAINT IF EXISTS pricing_settings_category_key;
CREATE UNIQUE INDEX IF NOT EXISTS pricing_settings_category_country_uidx
  ON public.pricing_settings (category, country) NULLS NOT DISTINCT;

-- 2) delivery_pricing_settings : vehicle devient (vehicle, country)
ALTER TABLE public.delivery_pricing_settings ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE public.delivery_pricing_settings DROP CONSTRAINT IF EXISTS delivery_pricing_settings_vehicle_key;
CREATE UNIQUE INDEX IF NOT EXISTS delivery_pricing_settings_vehicle_country_uidx
  ON public.delivery_pricing_settings (vehicle, country) NULLS NOT DISTINCT;

-- 3) dynamic_pricing_settings : ajout de country, scoping par pays au lieu
-- de programme. program_id est conservé (legacy, non lu) pour réversibilité,
-- mais l'unique index est remplacé pour autoriser une ligne par pays.
ALTER TABLE public.dynamic_pricing_settings ADD COLUMN IF NOT EXISTS country text;
DROP INDEX IF EXISTS public.dynamic_pricing_settings_program_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS dynamic_pricing_settings_scope_uidx
  ON public.dynamic_pricing_settings (country, program_id) NULLS NOT DISTINCT;

-- 4) resolve_commission : ajoute le paramètre _country, cherche d'abord une
-- ligne pricing_settings dédiée au pays, sinon retombe sur la ligne globale
-- (country IS NULL). commission_schedules reste vérifié en premier par
-- compatibilité (panneau désactivé côté admin, ne devrait jamais matcher).
DROP FUNCTION IF EXISTS public.resolve_commission(vehicle_category, timestamptz);

CREATE OR REPLACE FUNCTION public.resolve_commission(_category vehicle_category, _country text, _at timestamptz)
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
    WHERE p.category = _category AND p.country = _country AND p.active = true
    LIMIT 1
  ) country_specific
  UNION ALL
  SELECT * FROM (
    SELECT p.commission_type, p.commission_rate, p.commission_flat_xof
    FROM public.pricing_settings p
    WHERE p.category = _category AND p.country IS NULL AND p.active = true
    LIMIT 1
  ) defaults
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_commission(vehicle_category, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_commission(vehicle_category, text, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.compute_ride_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  c_amount integer;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    SELECT * INTO r FROM public.resolve_commission(NEW.category, NEW.country, COALESCE(NEW.completed_at, now())) LIMIT 1;
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

-- 5) resolve_dynamic_pricing_settings : remplace la résolution par
-- programme par une résolution par pays (même signature texte, sémantique
-- changée : le paramètre est désormais un nom de pays, plus un program_id).
-- DROP requis : Postgres refuse de renommer un paramètre via CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.resolve_dynamic_pricing_settings(text);

CREATE FUNCTION public.resolve_dynamic_pricing_settings(_country text)
RETURNS public.dynamic_pricing_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result public.dynamic_pricing_settings;
BEGIN
  IF _country IS NOT NULL THEN
    SELECT * INTO result FROM public.dynamic_pricing_settings
    WHERE country = _country AND active = true
    LIMIT 1;
    IF FOUND THEN RETURN result; END IF;
  END IF;

  SELECT * INTO result FROM public.dynamic_pricing_settings
  WHERE country IS NULL AND program_id IS NULL AND active = true
  LIMIT 1;
  IF FOUND THEN RETURN result; END IF;

  result.traffic_coefficient := 0.45;
  result.traffic_ratio_cap := 1.65;
  result.weather_rainy_multiplier := 1.12;
  result.weather_cloudy_multiplier := 1.05;
  result.weather_sunny_multiplier := 1.00;
  result.rounding_increment_xof := 50;
  result.active := true;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_dynamic_pricing_settings(text) TO authenticated, anon;

COMMENT ON TABLE public.dynamic_pricing_settings IS
  'Coefficients du "tarif dynamique" (majoration trafic + météo), scoped par '
  'pays avec fallback global (country IS NULL). program_id conservé en legacy '
  'non lu. Lu par resolve_dynamic_pricing_settings(_country) et exposé au '
  'front via getEffectivePricingConfig (src/lib/pricing.functions.ts).';

COMMENT ON COLUMN public.pricing_settings.country IS
  'NULL = ligne par défaut globale. Sinon, dérogation appliquée uniquement '
  'aux courses de ce pays pour cette catégorie (fallback vers la ligne '
  'globale si absente).';

COMMENT ON COLUMN public.delivery_pricing_settings.country IS
  'NULL = ligne par défaut globale. Sinon, dérogation appliquée uniquement '
  'aux livraisons de ce pays pour ce véhicule (fallback vers la ligne '
  'globale si absente).';
