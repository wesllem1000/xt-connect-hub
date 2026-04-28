-- E5.12 — Motor de regras de automacao (Fase 2.4 do PLANO-DE-ACAO)
--
-- Regra = trigger (quando) + condicoes (se) + acoes (faz). Engine
-- avaliado server-side no Node-RED. Acoes suportadas no MVP:
--   - send_email: enfileira em notification_outbox com template/texto
--     custom + lista de destinatarios extras (alem do dono/shares).
--   - publish_command: publica MQTT cmd em devices/<serial>/commands
--     (pump_off, safe_closure, sector_close, sector_open, mode_set).
--
-- Triggers iniciais:
--   - irrigation_alarm_created (com filtro opcional por alarm_tipo)
--   - device_offline (com offline_minutes, futuro — Bloco offline)
--   - manual (disparado por endpoint POST /automacoes/:id/run)
--
-- Aditiva: nao destrutiva, so CREATE TABLE.

BEGIN;

-- ============================================================
-- 1) automation_rules
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    -- NULL = aplica a todos os devices do owner

  nome TEXT NOT NULL,
  descricao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,

  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'irrigation_alarm_created',
    'device_offline',
    'manual'
  )),
  trigger_params JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- ex: {"alarm_tipo": "temperature_high"}
    -- ex: {"offline_minutes": 30}

  -- Condicoes adicionais (alem do trigger). Array de objetos.
  -- MVP: ignorado pelo engine. Reservado pra evolucao.
  -- Ex futuro: [{"field":"hora","op":"between","value":["20:00","06:00"]}]
  condicoes JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Acoes a executar quando dispara. Array de objetos.
  -- type='send_email' -> {type, recipients[], template, vars, subject_override}
  -- type='publish_command' -> {type, cmd, params}
  acoes JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Cooldown: nao redispara antes de N minutos. 0 = sem cooldown.
  cooldown_minutes INT NOT NULL DEFAULT 0
    CHECK (cooldown_minutes BETWEEN 0 AND 10080),

  last_fired_at TIMESTAMPTZ,
  last_status TEXT
    CHECK (last_status IS NULL OR last_status IN ('success','partial','failed','skipped_cooldown')),

  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_owner
  ON automation_rules(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_device
  ON automation_rules(device_id) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_automation_rules_active
  ON automation_rules(trigger_type) WHERE ativo;

CREATE TRIGGER trg_automation_rules_updated
  BEFORE UPDATE ON automation_rules
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

COMMENT ON TABLE automation_rules IS
  'E5.12 — regras de automacao. Engine no Node-RED. trigger+condicoes+acoes.';

-- ============================================================
-- 2) automation_executions — log
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL
    CHECK (status IN ('success','partial','failed','skipped_cooldown')),
  acoes_executadas JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- array de {type, ok, error?}
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_automation_executions_rule
  ON automation_executions(rule_id, triggered_at DESC);

COMMENT ON TABLE automation_executions IS
  'E5.12 — log de execucoes de regras. Util pra debug e auditoria.';

COMMIT;
