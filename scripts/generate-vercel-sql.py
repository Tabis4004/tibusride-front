#!/usr/bin/env python3
"""Generate scripts/vercel-postgres-init.sql from consolidated Tibus Ride schema."""

from pathlib import Path

HEADER = """\
-- =============================================================================
-- Tibus Ride — Schéma PostgreSQL pour Vercel Postgres (Neon)
-- =============================================================================
-- Exécution :
--   1. Vercel Dashboard → Storage → Postgres → onglet Query
--   2. Coller ce script et exécuter
--   3. Ou : psql "$POSTGRES_URL" -f scripts/vercel-postgres-init.sql
--
-- Avant chaque requête authentifiée, l'application doit définir l'utilisateur :
--   SELECT set_config('app.current_user_id', '<uuid-utilisateur>', true);
--
-- Auth : table auth.users (remplace Supabase Auth).
-- Fichiers : Vercel Blob. Temps réel : polling ou WebSocket custom.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT UNIQUE,
  encrypted_password TEXT,
  raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
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

TABLES = open(Path(__file__).parent / "_vercel_tables.sql").read() if False else ""

# Inline tables + rest in separate string files for maintainability
TABLES = Path(__file__).with_name("_vercel_schema_body.sql").read_text()

FOOTER = """
COMMIT;

-- =============================================================================
-- Fin du script. Vérifier : SELECT count(*) FROM information_schema.tables
-- WHERE table_schema = 'public';
-- =============================================================================
"""

def main() -> None:
    out = Path(__file__).parent / "vercel-postgres-init.sql"
    body_path = Path(__file__).parent / "_vercel_schema_body.sql"
    body = body_path.read_text()
    out.write_text(HEADER + ENUMS + UTILS + body + FOOTER)
    print(f"Wrote {out} ({out.stat().st_size} bytes)")

if __name__ == "__main__":
    main()
