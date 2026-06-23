-- Phase 1.1 — Corrige resolve_program_commission : désactiver un programme
-- (market_programs.is_active = false) doit le rendre invisible aux nouveaux
-- usagers (déjà géré par list_market_programs / get_default_market_program /
-- get_market_program / RLS), mais ne doit PAS changer la commission appliquée
-- aux courses déjà rattachées à ce programme (ex. une course "eco_tibus" en
-- cours quand l'admin désactive le programme ne doit pas basculer sur le taux
-- générique 20% à la complétion).
--
-- L'ancienne version filtrait `AND is_active` sur la ligne de programme
-- utilisée comme dernier recours pour le taux par défaut -> si le programme
-- est désactivé, ce filtre renvoie NULL et fait perdre le taux verrouillé.
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
  -- Pas de filtre is_active ici : une course déjà attachée à _program_id garde
  -- les règles de commission de ce programme même s'il vient d'être désactivé.
  SELECT * INTO prog FROM public.market_programs WHERE program_id = _program_id;

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
