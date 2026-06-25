-- Bucket public (lecture) pour les photos de profil chauffeur/voyageur.
-- Sécurité : le voyageur doit pouvoir identifier visuellement son chauffeur
-- à l'arrivée, la photo est donc accessible en lecture publique directe
-- (sans signed URL). Écriture réservée au service_role (server functions) ;
-- côté UI, la capture est imposée via la caméra (pas d'upload galerie) dans
-- le flux d'enrôlement chauffeur.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  4194304,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read avatars" ON storage.objects;
CREATE POLICY "Public read avatars" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Service role manages avatars" ON storage.objects;
CREATE POLICY "Service role manages avatars" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'avatars')
  WITH CHECK (bucket_id = 'avatars');
