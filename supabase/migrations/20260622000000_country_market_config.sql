-- Phase 0 — Différenciation marché par pays (EcoMoto Sénégal vs Tibus standard)

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.market_program AS ENUM ('tibus_standard', 'ecomoto');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.stakeholder_role AS ENUM (
    'platform', 'association', 'payment_partner', 'insurer', 'operator'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.governance_proposal_status AS ENUM (
    'draft', 'pending_review', 'approved', 'rejected', 'applied', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.governance_proposal_type AS ENUM (
    'commission_change', 'zone_pricing', 'bonus_rule', 'feature_toggle', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.fuel_type AS ENUM ('thermal', 'electric', 'hybrid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'stakeholder';

-- ---------------------------------------------------------------------------
-- Config marché par pays
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.country_market_config (
  country               text PRIMARY KEY,
  program_code          public.market_program NOT NULL DEFAULT 'tibus_standard',
  display_name          text NOT NULL,
  is_active             boolean NOT NULL DEFAULT true,
  commission_default    numeric(5,2) NOT NULL DEFAULT 20.00
                        CHECK (commission_default >= 0 AND commission_default <= 100),
  commission_locked     boolean NOT NULL DEFAULT false,
  currency              text NOT NULL DEFAULT 'XOF',
  default_language      text NOT NULL DEFAULT 'fr',
  supported_languages   text[] NOT NULL DEFAULT ARRAY['fr'],
  auth_phone_otp        boolean NOT NULL DEFAULT false,
  auth_email            boolean NOT NULL DEFAULT true,
  branding              jsonb NOT NULL DEFAULT '{}'::jsonb,
  features              jsonb NOT NULL DEFAULT '{}'::jsonb,
  stakeholder_org_id    uuid,
  governance_min_notice_days integer NOT NULL DEFAULT 90,
  dispatch_mode         text NOT NULL DEFAULT 'self_assign'
                        CHECK (dispatch_mode IN ('self_assign', 'fair_rotation', 'proximity')),
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid REFERENCES auth.users(id)
);

COMMENT ON TABLE public.country_market_config IS
  'Configuration produit par pays. Sénégal = ecomoto, autres = tibus_standard.';

CREATE INDEX IF NOT EXISTS country_market_config_program_idx
  ON public.country_market_config (program_code) WHERE is_active;

-- ---------------------------------------------------------------------------
-- Paiements, tarifs et bonus par pays
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.country_payment_providers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country         text NOT NULL REFERENCES public.country_market_config(country) ON DELETE CASCADE,
  provider_code   text NOT NULL,
  label           text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0,
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country, provider_code)
);

CREATE INDEX IF NOT EXISTS country_payment_providers_country_idx
  ON public.country_payment_providers (country, sort_order);

CREATE TABLE IF NOT EXISTS public.country_pricing_overrides (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country         text NOT NULL REFERENCES public.country_market_config(country) ON DELETE CASCADE,
  category        public.vehicle_category NOT NULL,
  base_fare_xof   integer NOT NULL,
  per_km_xof      integer NOT NULL,
  per_min_xof     integer NOT NULL,
  min_fare_xof    integer NOT NULL,
  commission_rate numeric(5,2),
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country, category)
);

CREATE TABLE IF NOT EXISTS public.country_bonus_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country         text NOT NULL REFERENCES public.country_market_config(country) ON DELETE CASCADE,
  rule_code       text NOT NULL,
  label           text NOT NULL,
  description     text,
  threshold       numeric,
  bonus_xof       integer NOT NULL DEFAULT 0,
  bonus_percent   numeric(5,2),
  active          boolean NOT NULL DEFAULT true,
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country, rule_code)
);

-- ---------------------------------------------------------------------------
-- Gouvernance (Association, EcoMoto, LigdiCash…)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stakeholder_organizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country         text NOT NULL REFERENCES public.country_market_config(country) ON DELETE CASCADE,
  role            public.stakeholder_role NOT NULL,
  name            text NOT NULL,
  legal_name      text,
  contact_email   text,
  contact_phone   text,
  logo_url        text,
  is_active       boolean NOT NULL DEFAULT true,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.country_market_config
    ADD CONSTRAINT country_market_config_stakeholder_fk
    FOREIGN KEY (stakeholder_org_id) REFERENCES public.stakeholder_organizations(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.stakeholder_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.stakeholder_organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           text,
  can_approve_drivers     boolean NOT NULL DEFAULT false,
  can_approve_governance  boolean NOT NULL DEFAULT false,
  can_view_financials     boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.governance_proposals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country         text NOT NULL REFERENCES public.country_market_config(country) ON DELETE CASCADE,
  org_id          uuid REFERENCES public.stakeholder_organizations(id),
  proposal_type   public.governance_proposal_type NOT NULL,
  title           text NOT NULL,
  description     text,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          public.governance_proposal_status NOT NULL DEFAULT 'draft',
  notice_starts_at timestamptz,
  effective_at    timestamptz,
  submitted_by    uuid REFERENCES auth.users(id),
  reviewed_by     uuid REFERENCES auth.users(id),
  reviewed_at     timestamptz,
  applied_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.governance_votes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id     uuid NOT NULL REFERENCES public.governance_proposals(id) ON DELETE CASCADE,
  voter_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vote            boolean NOT NULL,
  comment         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, voter_id)
);

CREATE TABLE IF NOT EXISTS public.published_kpi_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country         text NOT NULL REFERENCES public.country_market_config(country) ON DELETE CASCADE,
  period_label    text NOT NULL,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  metrics         jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at    timestamptz NOT NULL DEFAULT now(),
  published_by    uuid REFERENCES auth.users(id),
  document_url    text,
  is_public       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Extensions tables existantes
-- ---------------------------------------------------------------------------
ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS fuel_type public.fuel_type DEFAULT 'thermal',
  ADD COLUMN IF NOT EXISTS insurance_document_url text,
  ADD COLUMN IF NOT EXISTS insurance_expires_at date,
  ADD COLUMN IF NOT EXISTS license_expires_at date,
  ADD COLUMN IF NOT EXISTS vehicle_doc_expires_at date,
  ADD COLUMN IF NOT EXISTS preferred_zones text[],
  ADD COLUMN IF NOT EXISTS availability_notes text;

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS delivery_confirmation_code text,
  ADD COLUMN IF NOT EXISTS delivery_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_photo_url text,
  ADD COLUMN IF NOT EXISTS market_program public.market_program;

ALTER TABLE public.commission_schedules
  ADD COLUMN IF NOT EXISTS country text;

DO $$ BEGIN
  ALTER TABLE public.commission_schedules
    ADD CONSTRAINT commission_schedules_country_fk
    FOREIGN KEY (country) REFERENCES public.country_market_config(country);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Helpers SQL
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_country_market_config(_country text)
RETURNS public.country_market_config
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.country_market_config
  WHERE country = _country AND is_active
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.resolve_country_commission(
  _country text,
  _category public.vehicle_category,
  _at timestamptz DEFAULT now()
)
RETURNS TABLE(commission_type public.commission_kind, commission_rate numeric, commission_flat_xof integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg public.country_market_config;
  rec RECORD;
BEGIN
  SELECT * INTO cfg FROM public.country_market_config WHERE country = _country AND is_active;

  SELECT s.commission_type, s.commission_rate, s.commission_flat_xof INTO rec
  FROM public.commission_schedules s
  WHERE s.active
    AND s.category = _category
    AND s.country = _country
    AND s.starts_at <= _at
    AND (s.ends_at IS NULL OR s.ends_at > _at)
  ORDER BY s.priority DESC, s.starts_at DESC
  LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT rec.commission_type, rec.commission_rate, rec.commission_flat_xof;
    RETURN;
  END IF;

  SELECT 'percent'::public.commission_kind,
         COALESCE(o.commission_rate, cfg.commission_default, 20.00),
         0 INTO rec
  FROM public.country_pricing_overrides o
  WHERE o.country = _country AND o.category = _category AND o.active
  LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT rec.commission_type, rec.commission_rate, rec.commission_flat_xof;
    RETURN;
  END IF;

  IF cfg IS NOT NULL THEN
    RETURN QUERY SELECT 'percent'::public.commission_kind, cfg.commission_default, 0::integer;
    RETURN;
  END IF;

  RETURN QUERY SELECT * FROM public.resolve_commission(_category, _at);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_ride_market_context()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cfg public.country_market_config;
BEGIN
  IF NEW.country IS NOT NULL THEN
    SELECT * INTO cfg FROM public.country_market_config
    WHERE country = NEW.country AND is_active;
    IF cfg IS NOT NULL THEN
      NEW.market_program := cfg.program_code;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_ride_market_context_trg ON public.rides;
CREATE TRIGGER set_ride_market_context_trg
BEFORE INSERT ON public.rides
FOR EACH ROW EXECUTE FUNCTION public.set_ride_market_context();

CREATE OR REPLACE FUNCTION public.compute_ride_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; c_amount integer;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    IF NEW.country IS NOT NULL THEN
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
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.country_market_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.country_payment_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.country_pricing_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.country_bonus_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stakeholder_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stakeholder_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.published_kpi_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone reads active market config" ON public.country_market_config;
CREATE POLICY "Anyone reads active market config"
  ON public.country_market_config FOR SELECT
  USING (is_active);

DROP POLICY IF EXISTS "Anyone reads active payment providers" ON public.country_payment_providers;
CREATE POLICY "Anyone reads active payment providers"
  ON public.country_payment_providers FOR SELECT
  USING (is_active);

DROP POLICY IF EXISTS "Anyone reads active pricing overrides" ON public.country_pricing_overrides;
CREATE POLICY "Anyone reads active pricing overrides"
  ON public.country_pricing_overrides FOR SELECT
  USING (active);

DROP POLICY IF EXISTS "Anyone reads active bonus rules" ON public.country_bonus_rules;
CREATE POLICY "Anyone reads active bonus rules"
  ON public.country_bonus_rules FOR SELECT
  USING (active);

DROP POLICY IF EXISTS "Anyone reads public KPI reports" ON public.published_kpi_reports;
CREATE POLICY "Anyone reads public KPI reports"
  ON public.published_kpi_reports FOR SELECT
  USING (is_public);

DROP POLICY IF EXISTS "Admins manage market config" ON public.country_market_config;
CREATE POLICY "Admins manage market config"
  ON public.country_market_config FOR ALL TO authenticated
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

DROP POLICY IF EXISTS "Admins manage payment providers" ON public.country_payment_providers;
CREATE POLICY "Admins manage payment providers"
  ON public.country_payment_providers FOR ALL TO authenticated
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

DROP POLICY IF EXISTS "Stakeholders read governance" ON public.governance_proposals;
CREATE POLICY "Stakeholders read governance"
  ON public.governance_proposals FOR SELECT TO authenticated
  USING (
    public.is_superadmin(auth.uid())
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.stakeholder_members sm
      JOIN public.stakeholder_organizations so ON so.id = sm.org_id
      WHERE sm.user_id = auth.uid()
        AND sm.is_active
        AND so.country = governance_proposals.country
    )
  );

GRANT SELECT ON public.country_market_config TO anon, authenticated;
GRANT SELECT ON public.country_payment_providers TO anon, authenticated;
GRANT SELECT ON public.country_pricing_overrides TO anon, authenticated;
GRANT SELECT ON public.country_bonus_rules TO anon, authenticated;
GRANT SELECT ON public.published_kpi_reports TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_country_market_config(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_country_market_config(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.resolve_country_commission(text, public.vehicle_category, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_country_commission(text, public.vehicle_category, timestamptz) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Seeds
-- ---------------------------------------------------------------------------
INSERT INTO public.country_market_config (
  country, program_code, display_name, commission_default, auth_phone_otp, features
) VALUES
  ('Côte d''Ivoire', 'tibus_standard', 'Tibus Ride CI', 20.00, false, '{"delivery":true}'::jsonb),
  ('Togo',           'tibus_standard', 'Tibus Ride TG', 20.00, false, '{"delivery":true}'::jsonb),
  ('Bénin',          'tibus_standard', 'Tibus Ride BJ', 20.00, false, '{"delivery":true}'::jsonb),
  ('Niger',          'tibus_standard', 'Tibus Ride NE', 20.00, false, '{"delivery":true}'::jsonb),
  ('Nigeria',        'tibus_standard', 'Tibus Ride NG', 20.00, false, '{"delivery":true}'::jsonb),
  ('Mali',           'tibus_standard', 'Tibus Ride ML', 20.00, false, '{"delivery":true}'::jsonb),
  ('Burkina Faso',   'tibus_standard', 'Tibus Ride BF', 20.00, false, '{"delivery":true}'::jsonb),
  ('Ghana',          'tibus_standard', 'Tibus Ride GH', 20.00, false, '{"delivery":true}'::jsonb),
  ('Guinée',         'tibus_standard', 'Tibus Ride GN', 20.00, false, '{"delivery":true}'::jsonb)
ON CONFLICT (country) DO NOTHING;

INSERT INTO public.country_market_config (
  country, program_code, display_name,
  commission_default, commission_locked,
  default_language, supported_languages,
  auth_phone_otp, auth_email,
  branding, features, dispatch_mode, governance_min_notice_days
) VALUES (
  'Sénégal', 'ecomoto', 'EcoMoto by Tibus',
  10.00, true,
  'fr', ARRAY['fr', 'wo', 'ar'],
  true, true,
  '{"app_name":"EcoMoto","tagline":"Livraison éthique au Sénégal","partners":["EcoMoto","LigdiCash"]}'::jsonb,
  '{
    "delivery": true,
    "fair_dispatch": false,
    "insurance_module": false,
    "b2b_portal": false,
    "governance_panel": true,
    "electric_moto_bonus": true,
    "delivery_confirmation_photo": true,
    "stakeholder_driver_approval": true
  }'::jsonb,
  'self_assign', 90
)
ON CONFLICT (country) DO UPDATE SET
  program_code = EXCLUDED.program_code,
  display_name = EXCLUDED.display_name,
  commission_default = EXCLUDED.commission_default,
  commission_locked = EXCLUDED.commission_locked,
  supported_languages = EXCLUDED.supported_languages,
  auth_phone_otp = EXCLUDED.auth_phone_otp,
  branding = EXCLUDED.branding,
  features = EXCLUDED.features,
  dispatch_mode = EXCLUDED.dispatch_mode,
  governance_min_notice_days = EXCLUDED.governance_min_notice_days;

INSERT INTO public.country_payment_providers (country, provider_code, label, sort_order) VALUES
  ('Sénégal', 'ligdicash', 'LigdiCash', 1),
  ('Sénégal', 'wave', 'Wave', 2),
  ('Sénégal', 'orange_money', 'Orange Money', 3),
  ('Sénégal', 'cash', 'Espèces', 4)
ON CONFLICT (country, provider_code) DO NOTHING;

INSERT INTO public.country_payment_providers (country, provider_code, label, sort_order) VALUES
  ('Côte d''Ivoire', 'geniuspay', 'GeniusPay / Mobile Money', 1),
  ('Côte d''Ivoire', 'cash', 'Espèces', 2)
ON CONFLICT (country, provider_code) DO NOTHING;

INSERT INTO public.country_bonus_rules (country, rule_code, label, threshold, bonus_xof) VALUES
  ('Sénégal', 'rides_count_50', '50 courses / mois', 50, 5000),
  ('Sénégal', 'acceptance_rate_80', 'Taux acceptation ≥ 80 %', 80, 3000),
  ('Sénégal', 'rating_avg_4_5', 'Note moyenne ≥ 4,5', 4.5, 2000),
  ('Sénégal', 'electric_moto', 'Moto électrique', NULL, 1500)
ON CONFLICT (country, rule_code) DO NOTHING;

DO $$
DECLARE org_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.stakeholder_organizations
    WHERE country = 'Sénégal' AND role = 'association'
  ) THEN
    INSERT INTO public.stakeholder_organizations (country, role, name, legal_name)
    VALUES ('Sénégal', 'association', 'Association des livreurs du Sénégal', 'ALS')
    RETURNING id INTO org_id;

    UPDATE public.country_market_config
    SET stakeholder_org_id = org_id
    WHERE country = 'Sénégal';
  END IF;
END $$;
