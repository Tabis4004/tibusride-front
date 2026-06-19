#!/usr/bin/env python3
"""Generate scripts/supabase-init.sql — Tibus Ride schema for Supabase Postgres."""

from pathlib import Path

HEADER = """\
-- =============================================================================
-- Tibus Ride — Schéma PostgreSQL pour Supabase
-- =============================================================================
-- Exécution (projet Supabase vierge) :
--   1. Supabase Dashboard → SQL Editor → New query
--   2. Coller ce script et cliquer Run
--   3. Ou : psql "$DATABASE_URL" -f scripts/supabase-init.sql
--
-- Auth : Supabase Auth (auth.users natif, auth.uid() natif).
-- Fichiers : bucket Storage "driver-documents".
-- Temps réel : publication supabase_realtime sur public.rides.
--
-- Après exécution, configurez dans Vercel (frontend) :
--   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
"""

ENUMS = """
CREATE TYPE public.app_role AS ENUM ('passenger', 'driver', 'admin', 'support');
CREATE TYPE public.vehicle_category AS ENUM ('taxi', 'eco', 'confort', 'confort_plus', 'vip');
CREATE TYPE public.driver_status AS ENUM ('pending', 'under_review', 'approved', 'rejected', 'suspended');
CREATE TYPE public.ride_status AS ENUM ('requested', 'accepted', 'arriving', 'in_progress', 'completed', 'cancelled');
CREATE TYPE public.payment_method AS ENUM ('mobile_money', 'cash', 'card');
CREATE TYPE public.payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded');
CREATE TYPE public.invoice_status AS ENUM ('draft', 'issued', 'paid', 'cancelled');
CREATE TYPE public.payment_method_type AS ENUM ('bank_transfer', 'mobile_money', 'cash', 'card', 'other');
CREATE TYPE public.wallet_tx_type AS ENUM ('topup', 'commission', 'adjustment', 'refund', 'reward', 'referral');
CREATE TYPE public.passenger_wallet_tx_type AS ENUM ('topup', 'ride_earn', 'referral_bonus', 'ride_redeem', 'adjustment', 'refund');
CREATE TYPE public.referral_status AS ENUM ('pending', 'validated', 'rewarded', 'cancelled');
CREATE TYPE public.topup_status AS ENUM ('pending', 'paid', 'failed', 'cancelled');
CREATE TYPE public.commission_kind AS ENUM ('percent', 'flat');
CREATE TYPE public.ride_payout_status AS ENUM ('paid', 'failed', 'skipped');
CREATE TYPE public.ticket_status AS ENUM ('open', 'pending', 'resolved', 'closed');
CREATE TYPE public.ticket_priority AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE public.ticket_category AS ENUM ('account', 'payment', 'ride', 'driver', 'passenger', 'technical', 'other');
"""

UTILS = """
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
"""

SUPABASE_TAIL = """
-- ---------------------------------------------------------------------------
-- Supabase Storage : documents chauffeur
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'driver-documents',
  'driver-documents',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

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

DROP POLICY IF EXISTS "Drivers delete own documents" ON storage.objects;
CREATE POLICY "Drivers delete own documents" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'driver-documents' AND owner = auth.uid());

DROP POLICY IF EXISTS "Drivers update own documents" ON storage.objects;
CREATE POLICY "Drivers update own documents" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'driver-documents' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'driver-documents' AND owner = auth.uid());

-- ---------------------------------------------------------------------------
-- Supabase Realtime : suivi des courses en direct
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'rides'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
  END IF;
END $$;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

COMMIT;

-- =============================================================================
-- Fin du script. Vérifier :
--   SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';
--   SELECT id FROM storage.buckets WHERE id = 'driver-documents';
-- =============================================================================
"""


def main() -> None:
    root = Path(__file__).parent
    body = (root / "_vercel_schema_body.sql").read_text()
    body = body.replace(
        "-- Documents chauffeur (remplace Supabase Storage)",
        "-- Métadonnées documents chauffeur (fichiers dans Storage bucket driver-documents)",
    )
    out = root / "supabase-init.sql"
    out.write_text(HEADER + ENUMS + UTILS + body + SUPABASE_TAIL)
    print(f"Wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
