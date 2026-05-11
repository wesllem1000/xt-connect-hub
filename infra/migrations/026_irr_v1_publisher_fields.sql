-- 026 — Campos de versão, last_modified_by e inversor para irrigation_configs.
--
-- Contexto (bug fix IRR-V1-00008):
--   buildConfigPushMsg precisa de version (incrementado a cada push) e
--   last_modified_by para que o firmware detecte config/push mais novo que o
--   flash. Campos pump_* persistem os 5 parâmetros do inversor usando os MESMOS
--   nomes que o firmware publica em bomba.{pump_power_pct,P0_10_Hz,direction,
--   accel_s,decel_s} — evita mismatch de nomes entre DB, Node-RED e ESP.
--
-- Nenhuma coluna é NOT NULL sem DEFAULT — não quebra rows existentes.
-- Backfill via current_pinout JSONB que já tem o estado real mais recente.

BEGIN;

-- version: contador de publicações.
ALTER TABLE irrigation_configs
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN irrigation_configs.version IS
  'Contador de versão do config/push. Incrementado pelo Node-RED a cada publicação.
   O firmware compara com o version em flash para detectar config novo.';

-- last_modified_by: identificador de quem disparou o último push.
ALTER TABLE irrigation_configs
  ADD COLUMN IF NOT EXISTS last_modified_by TEXT;

COMMENT ON COLUMN irrigation_configs.last_modified_by IS
  'user_id ou serial do dispositivo que disparou o último push. Enviado no payload
   para rastreabilidade no firmware e logs. NULL = nunca modificado via app.';

-- Campos do inversor de frequência.
-- Nomes seguem o firmware: pump_power_pct, pump_p0_10_hz, pump_direction,
-- pump_accel_s, pump_decel_s. Prefixo pump_ é convenção de coluna DB.
-- Somente relevantes quando tipo_bomba = 'inverter'.

ALTER TABLE irrigation_configs
  ADD COLUMN IF NOT EXISTS pump_power_pct NUMERIC(5,2);

COMMENT ON COLUMN irrigation_configs.pump_power_pct IS
  'Potência da bomba em % (campo pump_power_pct do firmware). Só usado quando tipo_bomba=inverter.';

ALTER TABLE irrigation_configs
  ADD COLUMN IF NOT EXISTS pump_p0_10_hz NUMERIC(6,2);

COMMENT ON COLUMN irrigation_configs.pump_p0_10_hz IS
  'Frequência de referência P0_10 em Hz (campo P0_10_Hz do firmware). Só usado quando tipo_bomba=inverter.';

ALTER TABLE irrigation_configs
  ADD COLUMN IF NOT EXISTS pump_direction TEXT;

COMMENT ON COLUMN irrigation_configs.pump_direction IS
  'Sentido de rotação do motor (campo direction do firmware): fwd ou rev.';

ALTER TABLE irrigation_configs
  ADD COLUMN IF NOT EXISTS pump_accel_s NUMERIC(5,2);

COMMENT ON COLUMN irrigation_configs.pump_accel_s IS
  'Rampa de aceleração em segundos (campo accel_s do firmware).';

ALTER TABLE irrigation_configs
  ADD COLUMN IF NOT EXISTS pump_decel_s NUMERIC(5,2);

COMMENT ON COLUMN irrigation_configs.pump_decel_s IS
  'Rampa de desaceleração em segundos (campo decel_s do firmware).';

-- Backfill inversor: aproveita current_pinout JSONB que guarda o último estado real
-- reportado pelo firmware. Converte P0_10_Hz (maiúsculas no JSON) com ->> cast.
UPDATE irrigation_configs ic
SET
  pump_power_pct  = (ic.current_pinout->'bomba'->>'pump_power_pct')::NUMERIC,
  pump_p0_10_hz   = (ic.current_pinout->'bomba'->>'P0_10_Hz')::NUMERIC,
  pump_direction  = ic.current_pinout->'bomba'->>'direction',
  pump_accel_s    = (ic.current_pinout->'bomba'->>'accel_s')::NUMERIC,
  pump_decel_s    = (ic.current_pinout->'bomba'->>'decel_s')::NUMERIC
WHERE
  ic.current_pinout->'bomba' IS NOT NULL
  AND ic.tipo_bomba = 'inverter';

-- Backfill version: lê o version já confirmado pelo firmware em current_pinout.
-- Garante que o próximo config/push emita version=N+1 (não version=1 para ESP em v=7).
UPDATE irrigation_configs ic
SET version = COALESCE(NULLIF(ic.current_pinout->>'version','')::INTEGER, 0)
WHERE ic.current_pinout->>'version' IS NOT NULL;

COMMIT;
