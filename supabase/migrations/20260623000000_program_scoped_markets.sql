-- Phase 1 — Bascule du scope "pays" vers le scope "programme" (market_programs)
--
-- Pourquoi : un même pays doit pouvoir héberger plusieurs offres commerciales
-- (ex. Sénégal = "Eco Tibus" co-op + "Tibus Ride" VTC standard, simultanément).
-- L'ancien modèle (country_market_config, clé primaire = country) ne permettait
-- qu'un seul programme par pays. On bascule vers market_programs (clé = program_id)
-- et on garde country_market_config comme vue de compatibilité (programme par défaut
-- du pays) pour ne rien casser côté code existant pendant la transition.
--
-- Nom de marque : on évite "ecomoto" en dur — l'enum devient 'eco_tibus' et le nom
-- affiché reste piloté par market_programs.branding.app_name (configurable, donc
-- renommable/rebrandable sans toucher au code).

-- ---------------------------------------------------------------------------
-- 0. Renommage de la valeur d'enum ecomoto -> eco_tibus
-- ---------------------------------------------------------------------------
ALTER TYPE public.market_program RENAME VALUE 'ecomoto' TO 'eco_tibus';

-- ---------------------------------------------------------------------------
-- 1. Helper de slug pays (codes courts stables, sans dépendance à `unaccent`)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.country_slug(_country text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _country
    WHEN 'Sénégal' THEN 'sn'
    WHEN 'Côte d''Ivoire' THEN 'ci'
    WHEN 'Togo' THEN 'tg'
    WHEN 'Bénin' THEN 'bj'
    WHEN 'Niger' THEN 'ne'
    WHEN 'Nigeria' THEN 'ng'
    WHEN 'Mali' THEN 'ml'
    WHEN 'Burkina Faso' THEN 'bf'
    WHEN 'Ghana' THEN 'gh'
    WHEN 'Guinée' THEN 'gn'
    ELSE lower(regexp_replace(_country, '[^a-zA-Z]+', '-', 'g'))
  END;
$$;

-- ---------------------------------------------------------------------------
-- 2. country_market_config -> market_programs (clé = program_id)
-- ---------------------------------------------------------------------------
ALTER TABLE public.country_market_config RENAME TO market_programs;

ALTER TABLE public.market_programs
  ADD COLUMN IF NOT EXISTS program_id text,
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT true;

UPDATE public.market_programs
SET program_id = public.country_slug(country) || '-' || program_code::text
WHERE program_id IS NULL;

ALTER TABLE public.market_programs
  ALTER COLUMN program_id SET NOT NULL;

-- La PK portait sur country : on bascule sur program_id, country redevient un attribut.
-- CASCADE : emporte avec elle les FK satellites qui pointaient sur country_market_config(country)
-- (country_payment_providers, country_pricing_overrides, country_bonus_rules,
-- stakeholder_organizations, governance_proposals, published_kpi_reports, commission_schedules) ;
-- elles sont recréées plus bas en version program_id.
ALTER TABLE public.market_programs DROP CONSTRAINT country_market_config_pkey CASCADE;
ALTER TABLE public.market_programs ADD CONSTRAINT market_programs_pkey PRIMARY KEY (program_id);
ALTER TABLE public.market_programs ADD CONSTRAINT market_programs_country_program_uq UNIQUE (country, program_code);

-- Un seul programme par défaut par pays (celui qui s'affiche tant qu'aucun choix explicite n'est fait).
CREATE UNIQUE INDEX IF NOT EXISTS market_programs_one_default_per_country
  ON public.market_programs (country) WHERE is_default;

DROP INDEX IF EXISTS public.country_market_config_program_idx;
CREATE INDEX IF NOT EXISTS market_programs_country_idx ON public.market_programs (country) WHERE is_active;
CREATE INDEX IF NOT EXISTS market_programs_program_code_idx ON public.market_programs (program_code) WHERE is_active;

COMMENT ON TABLE public.market_programs IS
  'Programmes commerciaux par pays (ex. Sénégal: eco_tibus + tibus_standard). country_market_config est une vue de compat (programme par défaut).';

-- ---------------------------------------------------------------------------
-- 3. Tables satellites : ajout de program_id (la vraie clé de scope désormais)
--    -> backfill AVANT d'introduire le 2e programme du Sénégal (jointure non-ambiguë).
-- ---------------------------------------------------------------------------
ALTER TABLE public.country_payment_providers
  DROP CONSTRAINT IF EXISTS country_payment_providers_country_fkey,
  ADD COLUMN IF NOT EXISTS program_id text;

ALTER TABLE public.country_pricing_overrides
  DROP CONSTRAINT IF EXISTS country_pricing_overrides_country_fkey,
  ADD COLUMN IF NOT EXISTS program_id text;

ALTER TABLE public.country_bonus_rules
  DROP CONSTRAINT IF EXISTS country_bonus_rules_country_fkey,
  ADD COLUMN IF NOT EXISTS program_id text;

ALTER TABLE public.stakeholder_organizations
  DROP CONSTRAINT IF EXISTS stakeholder_organizations_country_fkey,
  ADD COLUMN IF NOT EXISTS program_id text;

ALTER TABLE public.governance_proposals
  DROP CONSTRAINT IF EXISTS governance_proposals_country_fkey,
  ADD COLUMN IF NOT EXISTS program_id text;

ALTER TABLE public.published_kpi_reports
  DROP CONSTRAINT IF EXISTS published_kpi_reports_country_fkey,
  ADD COLUMN IF NOT EXISTS program_id text;

ALTER TABLE public.commission_schedules
  ADD COLUMN IF NOT EXISTS program_id text;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'country_payment_providers', 'country_pricing_overrides', 'country_bonus_rules',
    'stakeholder_organizations', 'governance_proposals', 'published_kpi_reports'
  ]
  LOOP
    EXECUTE format(
      'UPDATE public.%I t SET program_id = mp.program_id
       FROM public.market_programs mp
       WHERE mp.country = t.country AND mp.is_default AND t.program_id IS NULL', t
    );
  END LOOP;
END $$;

UPDATE public.commission_schedules cs
SET program_id = mp.program_id
FROM public.market_programs mp
WHERE cs.country IS NOT NULL AND mp.country = cs.country AND mp.is_default AND cs.program_id IS NULL;

ALTER TABLE public.country_payment_providers ADD CONSTRAINT country_payment_providers_program_fkey
  FOREIGN KEY (program_id) REFERENCES public.market_programs(program_id) ON DELETE CASCADE;
ALTER TABLE public.country_pricing_overrides ADD CONSTRAINT country_pricing_overrides_program_fkey
  FOREIGN KEY (program_id) REFERENCES public.market_programs(program_id) ON DELETE CASCADE;
ALTER TABLE public.country_bonus_rules ADD CONSTRAINT country_bonus_rules_program_fkey
  FOREIGN KEY (program_id) REFERENCES public.market_programs(program_id) ON DELETE CASCADE;
ALTER TABLE public.stakeholder_organizations ADD CONSTRAINT stakeholder_organizations_program_fkey
  FOREIGN KEY (program_id) REFERENCES public.market_programs(program_id) ON DELETE CASCADE;
ALTER TABLE public.governance_proposals ADD CONSTRAINT governance_proposals_program_fkey
  FOREIGN KEY (program_id) REFERENCES public.market_programs(program_id) ON DELETE CASCADE;
ALTER TABLE public.published_kpi_reports ADD CONSTRAINT published_kpi_reports_program_fkey
  FOREIGN KEY (program_id) REFERENCES public.market_programs(program_id) ON DELETE CASCADE;
ALTER TABLE public.commission_schedules ADD CONSTRAINT commission_schedules_program_fkey
  FOREIGN KEY (program_id) REFERENCES public.market_programs(program_id);

ALTER TABLE public.country_payment_providers ALTER COLUMN program_id SET NOT NULL;
ALTER TABLE public.country_pricing_overrides ALTER COLUMN program_id SET NOT NULL;
ALTER TABLE public.country_bonus_rules ALTER COLUMN program_id SET NOT NULL;

DROP INDEX IF EXISTS country_payment_providers_country_idx;
CREATE INDEX IF NOT EXISTS country_payment_providers_program_idx ON public.country_payment_providers (program_id, sort_order);

-- UNIQUE(country, provider_code) devient UNIQUE(program_id, provider_code) : deux
-- programmes du même pays peuvent avoir des partenaires de paiement différents.
ALTER TABLE public.country_payment_providers DROP CONSTRAINT IF EXISTS country_payment_providers_country_provider_code_key;
ALTER TABLE public.country_payment_providers ADD CONSTRAINT country_payment_providers_program_provider_uq UNIQUE (program_id, provider_code);

ALTER TABLE public.country_pricing_overrides DROP CONSTRAINT IF EXISTS country_pricing_overrides_country_category_key;
ALTER TABLE public.country_pricing_overrides ADD CONSTRAINT country_pricing_overrides_program_category_uq UNIQUE (program_id, category);

ALTER TABLE public.country_bonus_rules DROP CONSTRAINT IF EXISTS country_bonus_rules_country_rule_code_key;
ALTER TABLE public.country_bonus_rules ADD CONSTRAINT country_bonus_rules_program_rule_uq UNIQUE (program_id, rule_code);

-- ---------------------------------------------------------------------------
-- 4. driver_profiles & rides : un acteur/une course appartient à un programme
-- ---------------------------------------------------------------------------
ALTER TABLE public.driver_profiles ADD COLUMN IF NOT EXISTS program_id text
  REFERENCES public.market_programs(program_id);

UPDATE public.driver_profiles dp
SET program_id = mp.program_id
FROM public.profiles p
JOIN public.market_programs mp ON mp.country = p.country AND mp.is_default
WHERE dp.user_id = p.id AND dp.program_id IS NULL;

ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS program_id text
  REFERENCES public.market_programs(program_id);

UPDATE public.rides r
SET program_id = mp.program_id
FROM public.market_programs mp
WHERE r.country IS NOT NULL AND mp.country = r.country AND mp.is_default AND r.program_id IS NULL;

CREATE INDEX IF NOT EXISTS rides_program_idx ON public.rides (program_id);
CREATE INDEX IF NOT EXISTS driver_profiles_program_idx ON public.driver_profiles (program_id);

-- ---------------------------------------------------------------------------
-- 5. Maintenant qu'on a backfillé en 1:1, on peut introduire le 2e programme
--    du Sénégal : l'offre VTC standard, en plus de Eco Tibus.
-- ---------------------------------------------------------------------------
INSERT INTO public.market_programs (
  program_id, country, program_code, display_name,
  commission_default, commission_locked,
  default_language, supported_languages,
  auth_phone_otp, auth_email,
  branding, features, dispatch_mode, governance_min_notice_days, is_default
) VALUES (
  'sn-tibus_standard', 'Sénégal', 'tibus_standard', 'Tibus Ride Sénégal',
  20.00, false,
  'fr', ARRAY['fr'],
  false, true,
  '{"app_name":"Tibus Ride","tagline":"VTC standard au Sénégal"}'::jsonb,
  '{"delivery":true}'::jsonb,
  'self_assign', 90, false
)
ON CONFLICT (program_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Fonctions "programme" (nouvelle API)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_default_market_program(_country text)
RETURNS public.market_programs
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.market_programs
  WHERE country = _country AND is_default AND is_active
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_market_program(_program_id text)
RETURNS public.market_programs
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.market_programs
  WHERE program_id = _program_id AND is_active
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.list_market_programs(_country text)
RETURNS SETOF public.market_programs
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.market_programs
  WHERE country = _country AND is_active
  ORDER BY is_default DESC, display_name;
$$;

CREATE OR REPLACE FUNCTION public.resolve_program_commission(
  _program_id text,
  _category public.vehicle_category,
  _at timestamptz DEFAULT now()
)
RETURNS TABLE(commission_type public.commission_kind, commission_rate numeric, commission_flat_xof integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  prog public.market_programs;
  rec RECORD;
BEGIN
  SELECT * INTO prog FROM public.market_programs WHERE program_id = _program_id AND is_active;

  SELECT s.commission_type, s.commission_rate, s.commission_flat_xof INTO rec
  FROM public.commission_schedules s
  WHERE s.active
    AND s.category = _category
    AND s.program_id = _program_id
    AND s.starts_at <= _at
    AND (s.ends_at IS NULL OR s.ends_at > _at)
  ORDER BY s.priority DESC, s.starts_at DESC
  LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT rec.commission_type, rec.commission_rate, rec.commission_flat_xof;
    RETURN;
  END IF;

  SELECT 'percent'::public.commission_kind,
         COALESCE(o.commission_rate, prog.commission_default, 20.00),
         0 INTO rec
  FROM public.country_pricing_overrides o
  WHERE o.program_id = _program_id AND o.category = _category AND o.active
  LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT rec.commission_type, rec.commission_rate, rec.commission_flat_xof;
    RETURN;
  END IF;

  IF prog IS NOT NULL THEN
    RETURN QUERY SELECT 'percent'::public.commission_kind, prog.commission_default, 0::integer;
    RETURN;
  END IF;

  RETURN QUERY SELECT * FROM public.resolve_commission(_category, _at);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Compat layer : country_market_config (vue) + fonctions historiques
--    -> rien ne casse côté code pas encore migré sur l'API "programme".
-- ---------------------------------------------------------------------------
CREATE VIEW public.country_market_config AS
SELECT
  country, program_code, display_name, is_active, commission_default, commission_locked,
  currency, default_language, supported_languages, auth_phone_otp, auth_email,
  branding, features, stakeholder_org_id, governance_min_notice_days, dispatch_mode,
  notes, created_at, updated_at, updated_by, program_id
FROM public.market_programs
WHERE is_default;

-- L'ancienne fonction retournait le type ligne de la TABLE country_market_config ;
-- celle-ci est maintenant une VUE avec un type ligne différent (même nom, OID composite
-- différent) -> CREATE OR REPLACE échoue avec "cannot change return type" (42P13).
-- On la supprime explicitement avant de la recréer sur le nouveau type.
DROP FUNCTION IF EXISTS public.get_country_market_config(text);

CREATE FUNCTION public.get_country_market_config(_country text)
RETURNS public.country_market_config
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.country_market_config WHERE country = _country AND is_active LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.resolve_country_commission(
  _country text,
  _category public.vehicle_category,
  _at timestamptz DEFAULT now()
)
RETURNS TABLE(commission_type public.commission_kind, commission_rate numeric, commission_flat_xof integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE prog public.market_programs;
BEGIN
  SELECT * INTO prog FROM public.market_programs WHERE country = _country AND is_default AND is_active;
  IF prog IS NULL THEN
    RETURN QUERY SELECT * FROM public.resolve_commission(_category, _at);
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public.resolve_program_commission(prog.program_id, _category, _at);
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Triggers rides : résolution programme (explicite sinon défaut du pays)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_ride_market_context()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prog public.market_programs;
BEGIN
  IF NEW.program_id IS NOT NULL THEN
    SELECT * INTO prog FROM public.market_programs WHERE program_id = NEW.program_id AND is_active;
  ELSIF NEW.country IS NOT NULL THEN
    SELECT * INTO prog FROM public.market_programs WHERE country = NEW.country AND is_default AND is_active;
    IF prog IS NOT NULL THEN
      NEW.program_id := prog.program_id;
    END IF;
  END IF;

  IF prog IS NOT NULL THEN
    NEW.market_program := prog.program_code;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_ride_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; c_amount integer;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    IF NEW.program_id IS NOT NULL THEN
      SELECT * INTO r FROM public.resolve_program_commission(
        NEW.program_id, NEW.category, COALESCE(NEW.completed_at, now())
      ) LIMIT 1;
    ELSIF NEW.country IS NOT NULL THEN
      SELECT * INTO r FROM public.resolve_country_commission(
        NEW.country, NEW.category, COALESCE(NEW.completed_at, now())
      ) LIMIT 1;
    ELSE
      SELECT * INTO r FROM public.resolve_commission(
        NEW.category, COALESCE(NEW.completed_at, now())
      ) LIMIT 1;
    END IF;

    IF r.commission_type = 'flat' THEN
      c_amount := LEAST(COALESCE(r.commission_flat_xof, 0), COALESCE(NEW.price_xof, 0));
      NEW.commission_rate := NULL;
    ELSE
      c_amount := ROUND(COALESCE(NEW.price_xof, 0) * COALESCE(r.commission_rate, 0) / 100.0);
      NEW.commission_rate := r.commission_rate;
    END IF;
    NEW.commission_xof := COALESCE(c_amount, 0);
    NEW.driver_earnings_xof := GREATEST(COALESCE(NEW.price_xof, 0) - COALESCE(NEW.commission_xof, 0), 0);
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.market_programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone reads active market config" ON public.market_programs;
CREATE POLICY "Anyone reads active market programs"
  ON public.market_programs FOR SELECT
  USING (is_active);

DROP POLICY IF EXISTS "Admins manage market config" ON public.market_programs;
CREATE POLICY "Admins manage market programs"
  ON public.market_programs FOR ALL TO authenticated
  USING (
    public.is_superadmin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      AND country IS NOT DISTINCT FROM public.admin_country(auth.uid())
    )
  )
  WITH CHECK (
    public.is_superadmin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      AND country IS NOT DISTINCT FROM public.admin_country(auth.uid())
    )
  );

GRANT SELECT ON public.market_programs TO anon, authenticated;
GRANT SELECT ON public.country_market_config TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_default_market_program(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_default_market_program(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_market_program(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_market_program(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_market_programs(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_market_programs(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_program_commission(text, public.vehicle_category, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_program_commission(text, public.vehicle_category, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_country_market_config(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_country_market_config(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_country_commission(text, public.vehicle_category, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_country_commission(text, public.vehicle_category, timestamptz) TO authenticated, service_role;
