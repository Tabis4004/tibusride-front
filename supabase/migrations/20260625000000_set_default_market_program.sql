-- Phase 1.2 — Permet de changer le programme par défaut d'un pays.
--
-- Jusqu'ici, market_programs.is_default n'avait pas de fonction d'écriture :
-- un seul programme par pays a is_default = true (index unique partiel
-- market_programs_one_default_per_country sur (country) WHERE is_default),
-- mais aucune RPC ne permettait de transférer ce statut à un autre programme.
-- Cela bloquait silencieusement le garde-fou de désactivation (qui refuse de
-- désactiver le programme par défaut tant qu'aucun autre n'est désigné) sans
-- offrir de moyen de le résoudre.
CREATE OR REPLACE FUNCTION public.set_default_market_program(_country text, _program_id text)
RETURNS public.market_programs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target public.market_programs;
  result public.market_programs;
BEGIN
  -- Fonction SECURITY DEFINER : elle contourne RLS, donc le contrôle d'accès
  -- doit être fait explicitement ici. Réservé au superadmin (cf. l'accès à
  -- l'onglet "Programmes de marché" côté admin, restreint au superadmin).
  IF NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: superadmin role required';
  END IF;

  SELECT * INTO target FROM public.market_programs WHERE program_id = _program_id;

  IF target IS NULL THEN
    RAISE EXCEPTION 'Programme introuvable : %', _program_id;
  END IF;

  IF target.country IS DISTINCT FROM _country THEN
    RAISE EXCEPTION 'Le programme % appartient à % et non à %', _program_id, target.country, _country;
  END IF;

  IF NOT target.is_active THEN
    RAISE EXCEPTION 'Impossible de définir un programme inactif comme programme par défaut. Réactivez-le d''abord.';
  END IF;

  IF target.is_default THEN
    RETURN target;
  END IF;

  -- L'index unique partiel sur (country) WHERE is_default interdit d'avoir
  -- temporairement deux défauts simultanés : on désactive l'ancien d'abord
  -- dans la même transaction.
  UPDATE public.market_programs
  SET is_default = false
  WHERE country = _country AND is_default;

  UPDATE public.market_programs
  SET is_default = true
  WHERE program_id = _program_id
  RETURNING * INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.set_default_market_program(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_default_market_program(text, text) TO authenticated;
