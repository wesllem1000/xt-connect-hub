-- ============================================================================
-- Migration 004 — Multi-tenancy base (E2.0)
-- ============================================================================
-- Gaps e decisões vs. plano E2:
--   - Tabela de usuários é `app_users` (não `users`).
--   - Owner semântico de device = devices.user_id (coluna legado; ver debts.md #1).
--   - CHECK de role expandida pra ('admin','cliente','instalador') — mantém
--     'instalador' por compat; 'user' é migrado pra 'cliente' (ver debts.md #2).
-- ============================================================================
BEGIN;

-- 1) Expandir CHECK de role: substituir 'user' por 'cliente' (manter 'instalador')
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check
  CHECK (role IN ('admin','cliente','instalador'));

-- 2) Migrar usuários existentes com role='user' para 'cliente'
UPDATE app_users SET role='cliente' WHERE role='user';

-- 3) Novo default de role passa a ser 'cliente'
ALTER TABLE app_users ALTER COLUMN role SET DEFAULT 'cliente';

-- 4) Flag de e-mail verificado (preparação pra E2.1; sem enforcement ainda)
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- 5) Wesllem (admin) já confiável; clientes criados por admin também ficarão TRUE
UPDATE app_users SET email_verified=TRUE WHERE email='wesllem1000@gmail.com';

-- 6) Consentimento técnico XT em devices (LGPD)
ALTER TABLE devices ADD COLUMN IF NOT EXISTS admin_access_level TEXT NOT NULL DEFAULT 'maintenance'
  CHECK (admin_access_level IN ('none','maintenance','full'));

-- 7) Mensagem de confirmação
DO $$
DECLARE v_admins INT; v_clientes INT; v_inst INT; v_devs INT;
BEGIN
  SELECT COUNT(*) INTO v_admins   FROM app_users WHERE role='admin';
  SELECT COUNT(*) INTO v_clientes FROM app_users WHERE role='cliente';
  SELECT COUNT(*) INTO v_inst     FROM app_users WHERE role='instalador';
  SELECT COUNT(*) INTO v_devs     FROM devices;
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Migration 004 aplicada com sucesso.';
  RAISE NOTICE '  - Admins:      %', v_admins;
  RAISE NOTICE '  - Clientes:    %', v_clientes;
  RAISE NOTICE '  - Instaladores:%', v_inst;
  RAISE NOTICE '  - Devices:     % (admin_access_level default=maintenance)', v_devs;
  RAISE NOTICE '============================================================';
END $$;

COMMIT;
