-- Active Realtime sur la table rides (si le chauffeur ne bouge pas sur la carte)
-- Supabase Dashboard → SQL Editor → Run

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rides'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
    RAISE NOTICE 'Realtime activé sur public.rides';
  ELSE
    RAISE NOTICE 'Realtime déjà actif sur public.rides';
  END IF;
END $$;
