-- Permet à l'assureur (et à l'admin) de consulter le document d'assurance
-- d'un chauffeur (URL signée temporaire), sans élargir les policies RLS sur
-- driver_profiles — même approche que list_insured_drivers/verify_driver_insurance.
CREATE OR REPLACE FUNCTION public.get_insurance_document_path(_driver_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  doc_path text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'insurer') OR public.has_role(auth.uid(), 'admin') OR public.is_superadmin(auth.uid())) THEN
    RAISE EXCEPTION 'Forbidden: insurer role required';
  END IF;

  SELECT insurance_document_url INTO doc_path
  FROM public.driver_profiles
  WHERE user_id = _driver_id;

  RETURN doc_path;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_insurance_document_path(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_insurance_document_path(uuid) TO authenticated;
