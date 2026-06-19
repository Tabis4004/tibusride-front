
-- 1) Extend driver_status enum with under_review
ALTER TYPE public.driver_status ADD VALUE IF NOT EXISTS 'under_review' BEFORE 'approved';

-- 2) Rejection reason on driver_profiles
ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS status_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_updated_by uuid;

-- 3) Audit logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  actor_email text,
  action text NOT NULL,
  target_type text,
  target_id text,
  target_label text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read audit logs" ON public.audit_logs;
CREATE POLICY "Admins read audit logs" ON public.audit_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins insert audit logs" ON public.audit_logs;
CREATE POLICY "Admins insert audit logs" ON public.audit_logs
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') AND auth.uid() = actor_id);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON public.audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS audit_logs_target_idx ON public.audit_logs (target_type, target_id);

-- 4) Storage policies for driver-documents bucket: admin full access, driver own files read/write
DROP POLICY IF EXISTS "Admins manage driver-documents" ON storage.objects;
CREATE POLICY "Admins manage driver-documents" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'driver-documents' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'driver-documents' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Drivers read own driver-documents" ON storage.objects;
CREATE POLICY "Drivers read own driver-documents" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'driver-documents' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Drivers write own driver-documents" ON storage.objects;
CREATE POLICY "Drivers write own driver-documents" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'driver-documents' AND auth.uid()::text = (storage.foldername(name))[1]);
