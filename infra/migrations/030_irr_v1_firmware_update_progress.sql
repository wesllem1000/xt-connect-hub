-- Migration 030 — event_type firmware_update_progress pra IRR-V1
-- Date: 2026-05-11
-- Purpose: Registrar firmware_update_progress (NOVO no fw 0.18.0) no catálogo de event_types do modelo IRR-V1.
--          Esse event é emitido pelo ESP a cada 5% ou 5s durante download OTA pull.
--          Payload: { phase, percent, bytes_downloaded, bytes_total, target_version }
--          Phases: starting, downloading, verifying, installing, rebooting

BEGIN;

INSERT INTO device_event_types (modelo_id, event_type, descricao)
SELECT id, 'firmware_update_progress', 'Progresso do download OTA pull (phase, percent, bytes). Emitido a cada 5% ou 5s pelo fw 0.18.0+.'
FROM modelos_dispositivo
WHERE prefixo = 'IRR' AND major_version = 'V1'
ON CONFLICT (modelo_id, event_type) DO NOTHING;

COMMIT;
