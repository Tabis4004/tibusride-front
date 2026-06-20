-- ============================================================
-- Étape 1 — Voir les comptes existants (exécutez d'abord)
-- ============================================================
SELECT id, email, created_at
FROM auth.users
ORDER BY created_at DESC;

-- ============================================================
-- Étape 2 — Promouvoir superadmin
-- Remplacez l'email par celui affiché à l'étape 1
-- (compte créé sur http://localhost:8086/auth)
-- ============================================================

-- ⚠️  PRÉREQUIS : exécutez d'abord scripts/apply-all-migrations.sql
--     Sinon erreur : relation "public.user_roles" does not exist

DO $$
DECLARE
  target_email text := 'isidoretabati@gmail.com';  -- ← modifiez si besoin
  uid uuid;
BEGIN
  SELECT id INTO uid FROM auth.users WHERE email = target_email LIMIT 1;

  IF uid IS NULL THEN
    RAISE EXCEPTION 'Aucun utilisateur avec l''email "%". Créez le compte sur /auth puis relancez.', target_email;
  END IF;

  INSERT INTO public.profiles (id, full_name)
  VALUES (uid, 'Super Admin')
  ON CONFLICT (id) DO UPDATE
    SET full_name = 'Super Admin', country = NULL;

  DELETE FROM public.user_roles WHERE user_id = uid;
  INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'superadmin');

  RAISE NOTICE 'Superadmin accordé à % (id: %)', target_email, uid;
END $$;
