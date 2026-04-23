-- ============================================================================
-- Migration 005 — E-mail verification tokens (E2.1)
-- ============================================================================
-- Gaps e decisões vs. plano E2.1:
--   - FK referencia `app_users(id)` (e nao `users(id)` como no texto do plano).
--   - `email_verified` em app_users ja foi adicionado pela migration 004 (no-op aqui).
--   - Coluna gen_random_uuid() depende de extensao pgcrypto — verificada/criada se faltar.
-- ============================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('signup','password_reset')),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user
  ON email_verification_tokens (user_id);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_expires
  ON email_verification_tokens (expires_at) WHERE used_at IS NULL;

DO $$
DECLARE v_users INT; v_unverified INT;
BEGIN
  SELECT COUNT(*) INTO v_users FROM app_users;
  SELECT COUNT(*) INTO v_unverified FROM app_users WHERE NOT email_verified;
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Migration 005 aplicada com sucesso.';
  RAISE NOTICE '  - Total users:        %', v_users;
  RAISE NOTICE '  - Nao verificados:    %', v_unverified;
  RAISE NOTICE '  - Tabela criada:      email_verification_tokens';
  RAISE NOTICE '============================================================';
END $$;

COMMIT;
