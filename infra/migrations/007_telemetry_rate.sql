-- E2.3 — Taxa de telemetria por dispositivo + burst mode
-- Cada device passa a ter seu próprio intervalo de publish, e o sweeper usa
-- 3x esse valor (clamp [60s, 900s]) pra decidir staleness (#51).

BEGIN;

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS telemetry_interval_s INTEGER NOT NULL DEFAULT 30
    CHECK (telemetry_interval_s >= 1 AND telemetry_interval_s <= 3600),
  ADD COLUMN IF NOT EXISTS burst_rate_s INTEGER NOT NULL DEFAULT 2
    CHECK (burst_rate_s >= 1 AND burst_rate_s <= 60);

CREATE INDEX IF NOT EXISTS idx_devices_telemetry_interval
  ON devices (telemetry_interval_s)
  WHERE is_online = true;

COMMENT ON COLUMN devices.telemetry_interval_s IS
  'Intervalo padrão de telemetria em segundos. Mínimo 1s, máximo 1h.';
COMMENT ON COLUMN devices.burst_rate_s IS
  'Taxa de burst mode (tempo real sob demanda). Mínimo 1s, máximo 60s.';

COMMIT;
