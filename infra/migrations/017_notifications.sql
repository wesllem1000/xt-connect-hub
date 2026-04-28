-- E5.8 — Notificações por e-mail (Fase 2.1 do PLANO-DE-ACAO)
--
-- Tabela única `notification_outbox` — fila durável de e-mails saindo.
-- Quando um alarme é criado em `irrigation_alarms`, o handler do Node-RED
-- enfileira aqui (1 row por (user_id, dedup_key)). Worker processa a cada
-- 30s, envia via SMTP existente, marca status sent/failed.
--
-- Tabelas mais ricas (channels, preferences) ficam pra Fase 2.2 quando
-- houver UI de preferências. Por ora cada user recebe no email do app_users
-- automaticamente (todos opt-in).
--
-- Não-destrutiva: só ADD TABLE.

BEGIN;

CREATE TABLE IF NOT EXISTS notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  dest_email TEXT NOT NULL,
  category TEXT NOT NULL,
    -- 'irrigation_alarm', 'device_offline', 'share_invite', etc.
  severity TEXT NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info','warning','critical')),
  subject TEXT NOT NULL,
  template_name TEXT,
  template_vars JSONB NOT NULL DEFAULT '{}'::jsonb,
  body_text TEXT,
    -- fallback se template_name não existir; gerado pelo dispatcher

  -- Deduplicação: se o mesmo evento dispara várias vezes (alarme oscilando),
  -- só cria 1 row enquanto a primeira ainda não saiu.
  dedup_key TEXT,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed','suppressed')),
  retry_count INT NOT NULL DEFAULT 0,
  last_error TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,

  -- Dedup forte: 1 entrada por (user, key) enquanto pending. Quando sent,
  -- key continua na linha (histórico). Vamos usar partial unique pra
  -- permitir reenviar depois.
  CONSTRAINT notification_outbox_dedup UNIQUE (user_id, dedup_key, status)
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending
  ON notification_outbox (created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_notification_outbox_user_recent
  ON notification_outbox (user_id, created_at DESC);

COMMENT ON TABLE notification_outbox IS
  'E5.8 Fase 2.1 — fila durável de notificações. Worker pega pending e envia via SMTP. Categorias futuras: device_offline, share_invite, etc.';

COMMIT;
