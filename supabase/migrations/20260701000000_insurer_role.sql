-- Nouveau rôle "insurer" (assureur) : seul ajout dans cette migration, car
-- ALTER TYPE ... ADD VALUE doit être isolé sans usage de la nouvelle valeur
-- dans la même transaction (précédent : 20260619101057_*.sql pour 'support').
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'insurer';
