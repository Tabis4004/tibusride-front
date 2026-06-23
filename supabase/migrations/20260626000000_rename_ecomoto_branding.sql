-- Phase 1.3 — Corrige les données de marque restées en "EcoMoto".
--
-- La migration 20260623000000 a renommé la VALEUR D'ENUM 'ecomoto' -> 'eco_tibus'
-- (public.market_program), mais n'a jamais touché aux COLONNES de la ligne
-- Sénégal elle-même. Cette ligne a été créée en seed (20260622000000) avec :
--   display_name        = 'EcoMoto by Tibus'
--   branding.app_name   = 'EcoMoto'
--   branding.partners   = ['EcoMoto', 'LigdiCash']
-- Résultat : côté admin (onglet "Programmes de marché"), rien n'affichait
-- "Eco Tibus" — le programme s'appelait toujours littéralement "EcoMoto",
-- en violation directe de la règle produit (jamais "EcoMoto" en dur, marque
-- pilotée par branding.app_name = "Eco Tibus").
UPDATE public.market_programs
SET
  display_name = 'Eco Tibus',
  branding = jsonb_set(
    jsonb_set(branding, '{app_name}', '"Eco Tibus"'::jsonb),
    '{partners}', '["Eco Tibus","LigdiCash"]'::jsonb
  )
WHERE country = 'Sénégal' AND program_code = 'eco_tibus';
