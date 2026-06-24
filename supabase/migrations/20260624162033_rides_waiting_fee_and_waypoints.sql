-- Frais d'attente/retard et arrêts intermédiaires sur une course.
-- base_price_xof conserve le prix initial (trajet sans frais additionnels)
-- pour affichage ; price_xof reste le prix total facturé, mis à jour quand
-- un arrêt est ajouté ou qu'une attente est cloturée.
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS base_price_xof integer,
  ADD COLUMN IF NOT EXISTS waypoints jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS waiting_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS waiting_minutes numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS waiting_fee_xof integer NOT NULL DEFAULT 0;

UPDATE public.rides SET base_price_xof = price_xof WHERE base_price_xof IS NULL;

COMMENT ON COLUMN public.rides.waypoints IS 'Arrêts intermédiaires ajoutés par le passager: [{address, lat, lng, added_at}]';
COMMENT ON COLUMN public.rides.waiting_started_at IS 'Horodatage de début d''attente signalée par le chauffeur (retard passager / arrêt), null si aucune attente en cours';
COMMENT ON COLUMN public.rides.waiting_minutes IS 'Cumul des minutes d''attente facturées sur la course';
COMMENT ON COLUMN public.rides.waiting_fee_xof IS 'Cumul des frais d''attente/retard déjà ajoutés à price_xof';
