-- Bucket public (lecture) pour les annonces vocales pré-générées en cache
-- (4-5 phrases fixes du workflow chauffeur, ex. "Course acceptée"). Écriture
-- réservée au service_role (server functions), lecture publique directe
-- sans signed URL puisqu'aucune donnée sensible n'est stockée ici.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tts-announcements',
  'tts-announcements',
  true,
  2097152,
  ARRAY['audio/mpeg']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read tts-announcements" ON storage.objects;
CREATE POLICY "Public read tts-announcements" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'tts-announcements');

DROP POLICY IF EXISTS "Service role manages tts-announcements" ON storage.objects;
CREATE POLICY "Service role manages tts-announcements" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'tts-announcements')
  WITH CHECK (bucket_id = 'tts-announcements');
