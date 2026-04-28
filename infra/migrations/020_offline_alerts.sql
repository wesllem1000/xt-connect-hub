-- E5.13 — Aviso de equipamento offline (Plano A do roadmap)
--
-- Sweeper existente (E2.3) já vira is_online=false rapidamente
-- (~3x telemetry_interval, max 15min). Aqui só rastreamos quando o
-- ALERTA por email foi enviado pra evitar enviar várias vezes durante
-- o mesmo episódio offline.
--
-- Política: 1 alerta por episódio offline. Quando o device volta
-- online (last_seen é atualizado), o próximo episódio offline pode
-- alertar de novo.
--
-- Aditiva.

BEGIN;

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS last_offline_alert_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_devices_offline_to_alert
  ON devices(last_seen)
  WHERE is_online = FALSE
    AND last_seen IS NOT NULL
    AND status IN ('associado','active');

COMMENT ON COLUMN devices.last_offline_alert_at IS
  'E5.13 — quando enviamos o último alerta de offline pro user. Comparado contra last_seen pra dedup: se last_offline_alert_at < last_seen significa que o device voltou online entre os 2, novo alerta pode disparar.';

COMMIT;
