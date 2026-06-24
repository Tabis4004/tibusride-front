-- Tarification dynamique (DB) des types de colis et des frais supplémentaires
-- livraison (urgence, sac isotherme), pour ne plus dépendre de constantes
-- codées en dur dans delivery-pricing.ts. Même schéma de gouvernance que
-- pricing_settings / delivery_pricing_settings (lecture publique, gestion
-- réservée aux admins).

CREATE TABLE IF NOT EXISTS public.delivery_package_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_type text NOT NULL UNIQUE CHECK (package_type IN ('documents','small','medium','large','food','fragile')),
  multiplier numeric(5,2) NOT NULL DEFAULT 1.00 CHECK (multiplier >= 1 AND multiplier <= 5),
  active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.delivery_package_pricing ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.delivery_package_pricing TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.delivery_package_pricing TO authenticated;

DROP POLICY IF EXISTS "delivery_package_pricing_select" ON public.delivery_package_pricing;
CREATE POLICY "delivery_package_pricing_select" ON public.delivery_package_pricing
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "delivery_package_pricing_manage" ON public.delivery_package_pricing;
CREATE POLICY "delivery_package_pricing_manage" ON public.delivery_package_pricing
  FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.is_superadmin(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_superadmin(auth.uid()));

DROP TRIGGER IF EXISTS touch_delivery_package_pricing ON public.delivery_package_pricing;
CREATE TRIGGER touch_delivery_package_pricing
  BEFORE UPDATE ON public.delivery_package_pricing
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.delivery_package_pricing (package_type, multiplier) VALUES
  ('documents', 1.00),
  ('small',     1.00),
  ('medium',    1.15),
  ('large',     1.35),
  ('food',      1.10),
  ('fragile',   1.20)
ON CONFLICT (package_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.delivery_extras_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extra_key text NOT NULL UNIQUE CHECK (extra_key IN ('urgent','insulated_bag')),
  fee_xof integer NOT NULL DEFAULT 0 CHECK (fee_xof >= 0),
  percent_extra numeric(5,2) NOT NULL DEFAULT 0 CHECK (percent_extra >= 0 AND percent_extra <= 200),
  active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.delivery_extras_pricing ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.delivery_extras_pricing TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.delivery_extras_pricing TO authenticated;

DROP POLICY IF EXISTS "delivery_extras_pricing_select" ON public.delivery_extras_pricing;
CREATE POLICY "delivery_extras_pricing_select" ON public.delivery_extras_pricing
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "delivery_extras_pricing_manage" ON public.delivery_extras_pricing;
CREATE POLICY "delivery_extras_pricing_manage" ON public.delivery_extras_pricing
  FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.is_superadmin(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_superadmin(auth.uid()));

DROP TRIGGER IF EXISTS touch_delivery_extras_pricing ON public.delivery_extras_pricing;
CREATE TRIGGER touch_delivery_extras_pricing
  BEFORE UPDATE ON public.delivery_extras_pricing
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- fee_xof = montant fixe ; percent_extra = pourcentage additionnel appliqué
-- au sous-total (ex. urgence : 800 XOF fixe + 25% du sous-total).
INSERT INTO public.delivery_extras_pricing (extra_key, fee_xof, percent_extra) VALUES
  ('urgent',        800, 25.00),
  ('insulated_bag', 350, 0.00)
ON CONFLICT (extra_key) DO NOTHING;

-- Sac isotherme déclaré par le livreur (moto/deux-roues/tricycle) à
-- l'enrôlement — permet de filtrer/afficher les livreurs équipés pour les
-- commandes avec option "sac isotherme".
ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS has_insulated_bag boolean NOT NULL DEFAULT false;
