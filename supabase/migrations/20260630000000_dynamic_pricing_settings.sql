-- Connecte enfin le "tarif dynamique" (trafic + météo) à la base de données.
--
-- Constat (audit) : computeDynamicPrice()/computeDeliveryPrice() utilisaient
-- des coefficients codés en dur (trafic ×0.45, plafond ×1.65, météo
-- ×1.12/×1.05/×1.00) et pricing_settings (base/km/min par catégorie) avait
-- un onglet admin complet mais n'était jamais lu au moment du calcul du prix
-- réel — donc sans effet. Cette migration ajoute la table qui porte les
-- coefficients de tarif dynamique, scoped par programme (white-label) avec
-- fallback global, suivant le même schéma de résolution que les commissions
-- planifiées (programme > défaut global > constantes de secours).

CREATE TABLE public.dynamic_pricing_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id text REFERENCES public.market_programs(program_id) ON DELETE CASCADE,
  traffic_coefficient numeric NOT NULL DEFAULT 0.45 CHECK (traffic_coefficient >= 0 AND traffic_coefficient <= 2),
  traffic_ratio_cap numeric NOT NULL DEFAULT 1.65 CHECK (traffic_ratio_cap >= 1 AND traffic_ratio_cap <= 3),
  weather_rainy_multiplier numeric NOT NULL DEFAULT 1.12 CHECK (weather_rainy_multiplier >= 1 AND weather_rainy_multiplier <= 2),
  weather_cloudy_multiplier numeric NOT NULL DEFAULT 1.05 CHECK (weather_cloudy_multiplier >= 1 AND weather_cloudy_multiplier <= 2),
  weather_sunny_multiplier numeric NOT NULL DEFAULT 1.00 CHECK (weather_sunny_multiplier >= 1 AND weather_sunny_multiplier <= 2),
  rounding_increment_xof integer NOT NULL DEFAULT 50 CHECK (rounding_increment_xof BETWEEN 1 AND 1000),
  active boolean NOT NULL DEFAULT true,
  notes text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Une seule ligne par programme, et une seule ligne globale (program_id IS NULL).
CREATE UNIQUE INDEX dynamic_pricing_settings_program_uidx
  ON public.dynamic_pricing_settings (program_id) NULLS NOT DISTINCT;

CREATE OR REPLACE FUNCTION public.touch_dynamic_pricing_settings()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dynamic_pricing_settings_touch
  BEFORE UPDATE ON public.dynamic_pricing_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_dynamic_pricing_settings();

ALTER TABLE public.dynamic_pricing_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active dynamic pricing settings"
  ON public.dynamic_pricing_settings FOR SELECT
  USING (active = true);

CREATE POLICY "Superadmins manage dynamic pricing settings"
  ON public.dynamic_pricing_settings FOR ALL
  USING (public.is_superadmin(auth.uid()))
  WITH CHECK (public.is_superadmin(auth.uid()));

-- Ligne par défaut globale, reprend les anciennes constantes codées en dur
-- de dynamic-pricing.ts / delivery-pricing.ts (comportement inchangé tant
-- qu'aucun admin ne modifie les valeurs).
INSERT INTO public.dynamic_pricing_settings (program_id, traffic_coefficient, traffic_ratio_cap, weather_rainy_multiplier, weather_cloudy_multiplier, weather_sunny_multiplier, rounding_increment_xof, active, notes)
VALUES (NULL, 0.45, 1.65, 1.12, 1.05, 1.00, 50, true, 'Défaut global — reprend les anciennes constantes codées en dur.');

-- Résolution : programme actif d'abord, sinon défaut global actif, sinon
-- valeurs de secours en dur (ne devrait jamais arriver après ce seed).
CREATE OR REPLACE FUNCTION public.resolve_dynamic_pricing_settings(_program_id text)
RETURNS public.dynamic_pricing_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result public.dynamic_pricing_settings;
BEGIN
  IF _program_id IS NOT NULL THEN
    SELECT * INTO result FROM public.dynamic_pricing_settings
    WHERE program_id = _program_id AND active = true
    LIMIT 1;
    IF FOUND THEN RETURN result; END IF;
  END IF;

  SELECT * INTO result FROM public.dynamic_pricing_settings
  WHERE program_id IS NULL AND active = true
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
  'programme avec fallback global. Lu par resolve_dynamic_pricing_settings() '
  'et exposé au front via getEffectivePricingConfig (src/lib/pricing.functions.ts) '
  'pour remplacer les constantes codées en dur de dynamic-pricing.ts / delivery-pricing.ts.';
