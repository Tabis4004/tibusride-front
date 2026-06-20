-- À exécuter APRÈS scripts/apply-all-migrations.sql
-- Compte déjà créé sur http://localhost:8086/auth

DO $$
DECLARE
  target_email text := 'isidoretabati@gmail.com';
  uid uuid;
BEGIN
  SELECT id INTO uid FROM auth.users WHERE email = target_email LIMIT 1;

  IF uid IS NULL THEN
    RAISE EXCEPTION 'Aucun utilisateur avec l''email "%". Créez le compte sur /auth puis relancez ce script.', target_email;
  END IF;

  -- Le compte a été créé avant les migrations : pas de profil automatique
  INSERT INTO public.profiles (id, full_name)
  VALUES (uid, 'Super Admin')
  ON CONFLICT (id) DO UPDATE
    SET full_name = 'Super Admin', country = NULL;

  DELETE FROM public.user_roles WHERE user_id = uid;
  INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'superadmin');

  RAISE NOTICE 'Superadmin accordé à % (id: %)', target_email, uid;
END $$;
