-- Phase 1.4 — Permet d'activer le programme Eco Tibus dans les pays autres que
-- le Sénégal (jusqu'ici le seul programme_code = 'eco_tibus' existant).
--
-- On ajoute une ligne Eco Tibus par pays, désactivée par défaut (is_active =
-- false, is_default = false — tibus_standard reste le programme par défaut
-- de chacun de ces pays). Rien ne change pour les passagers/chauffeurs tant
-- que le superadmin n'active pas explicitement le programme depuis l'onglet
-- "Programmes de marché" (toggle is_active déjà en place).
INSERT INTO public.market_programs (
  program_id, country, program_code, display_name,
  commission_default, commission_locked,
  default_language, supported_languages,
  auth_phone_otp, auth_email,
  branding, features, dispatch_mode, governance_min_notice_days,
  is_active, is_default
)
SELECT
  public.country_slug(country) || '-eco_tibus', country, 'eco_tibus', 'Eco Tibus',
  10.00, false,
  'fr', ARRAY['fr'],
  false, true,
  jsonb_build_object('app_name', 'Eco Tibus', 'tagline', 'Livraison éthique', 'partners', jsonb_build_array('Eco Tibus')),
  '{"delivery":true,"electric_moto_bonus":true,"delivery_confirmation_photo":true}'::jsonb,
  'self_assign', 90,
  false, false
FROM (VALUES
  ('Côte d''Ivoire'), ('Togo'), ('Bénin'), ('Niger'),
  ('Nigeria'), ('Mali'), ('Burkina Faso'), ('Ghana'), ('Guinée')
) AS countries(country)
ON CONFLICT (program_id) DO NOTHING;
