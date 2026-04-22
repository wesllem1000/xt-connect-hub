-- E2.2 — Ingestão MQTT
-- Adiciona colunas para rastrear última leitura no próprio device e ts (timestamp do device)
-- em device_readings. Reaproveita colunas já existentes:
--   devices.is_online (BOOLEAN)  e  devices.last_seen (TIMESTAMPTZ)
-- já vindas das migrations anteriores.

BEGIN;

-- 1) Última leitura embutida no device (pra dashboards renderizarem sem JOIN)
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_reading JSONB;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_reading_at TIMESTAMPTZ;

-- 2) Coluna ts (timestamp originado pelo device) em device_readings.
--    A coluna existente received_at é o instante em que o backend gravou.
--    A tabela está vazia hoje; podemos adicionar NOT NULL com default temporário e remover o default depois.
ALTER TABLE device_readings ADD COLUMN IF NOT EXISTS ts TIMESTAMPTZ;

-- Backfill seguro caso já existam linhas
UPDATE device_readings SET ts = received_at WHERE ts IS NULL;

ALTER TABLE device_readings ALTER COLUMN ts SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_device_readings_device_ts ON device_readings (device_id, ts DESC);

COMMIT;
