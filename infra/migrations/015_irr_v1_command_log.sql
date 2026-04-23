-- E4.2A — command log pra rastreabilidade + correlação de ack (refs #71)
--
-- Cada POST /api/dispositivos/:id/irrigacao/comandos insere uma row aqui
-- antes de publicar no MQTT. Quando o firmware responde via
-- devices/+/commands/ack, o subscriber atualiza a mesma row
-- correlacionando via cmd_id.

BEGIN;

CREATE TABLE IF NOT EXISTS irrigation_command_log (
  cmd_id UUID PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  cmd TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,

  -- Preenchidos quando o ack chega (NULL = aguardando ou timeout silencioso)
  ack_status TEXT CHECK (ack_status IS NULL OR ack_status IN ('accepted','executed','refused','expired')),
  ack_reason TEXT,
  ack_received_at TIMESTAMPTZ,
  result_payload JSONB
);

CREATE INDEX IF NOT EXISTS idx_irr_cmdlog_device_issued
  ON irrigation_command_log (device_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_irr_cmdlog_pending
  ON irrigation_command_log (device_id, expires_at)
  WHERE ack_status IS NULL;

COMMENT ON TABLE irrigation_command_log IS
  'E4.2A — auditoria de comandos. cmd_id gerado pelo server; UUID na resposta pro webapp correlacionar ack via MQTT.';

COMMIT;
