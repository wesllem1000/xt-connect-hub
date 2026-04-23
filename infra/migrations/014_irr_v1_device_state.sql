-- E4.2A — cache do state retained (refs #71)
--
-- Não é source of truth — MQTT retained é. Esta tabela espelha o último
-- payload recebido em devices/<SERIAL>/state pra consulta rápida no GET
-- /snapshot (evita browser precisar subscribe MQTT só pra ler estado
-- inicial; MQTT live continua sendo usado pras atualizações reativas).

BEGIN;

CREATE TABLE IF NOT EXISTS irrigation_device_state (
  device_id UUID PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  state_json JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_irrigation_device_state_received
  ON irrigation_device_state (received_at DESC);

COMMENT ON TABLE irrigation_device_state IS
  'E4.2A — cache do state retained (MQTT é source of truth). Upserted pelo subscriber devices/+/state no Node-RED.';

COMMIT;
