-- =========================================================
-- 002 - Telemetria + tokens de auth
-- =========================================================

-- Leituras dos sensores (último valor por chave; histórico fica no Influx)
CREATE TABLE IF NOT EXISTS device_readings (
  id BIGSERIAL PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,                -- ex: devices/<mqtt_user>/data
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_readings_device_id_time
  ON device_readings(device_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_readings_received_at
  ON device_readings(received_at DESC);

-- Política simples de retenção: manter últimos 7 dias no Postgres
-- (Influx vai armazenar histórico longo; Postgres é só "última leitura rápida")
-- O purge será via cron + DELETE por received_at; não usamos pg_cron pra evitar dependência.

-- Eventos brutos (audit log de qualquer mensagem MQTT recebida)
CREATE TABLE IF NOT EXISTS mqtt_events (
  id BIGSERIAL PRIMARY KEY,
  topic TEXT NOT NULL,
  client_id TEXT,
  payload TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mqtt_events_time
  ON mqtt_events(received_at DESC);

-- Refresh tokens da auth JWT (tabela já existia: user_sessions). Apenas adiciona campo
ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS ip_address INET,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- View útil: status atual de cada device (juntando devices + última leitura)
CREATE OR REPLACE VIEW v_device_status AS
SELECT
  d.id, d.device_id AS mqtt_user, d.name, d.user_id,
  d.is_online, d.last_seen, d.status,
  r.payload AS last_payload, r.received_at AS last_payload_at
FROM devices d
LEFT JOIN LATERAL (
  SELECT payload, received_at
  FROM device_readings
  WHERE device_id = d.id
  ORDER BY received_at DESC
  LIMIT 1
) r ON TRUE;

-- Setar senha real do admin (sobrescreve placeholder do 001)
-- Hash bcrypt(10) da senha que você usar no primeiro login do app.
-- Por enquanto deixamos placeholder; o endpoint /api/auth/setup-admin
-- vai gravar a hash real no primeiro login.
