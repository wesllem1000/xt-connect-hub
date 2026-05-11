-- E5.3 — Adiciona coluna severity em irrigation_alarms
--
-- Motivação: o banner de alarme (AlarmBanner.tsx) precisa diferenciar
-- 'critico' (vermelho) de 'aviso' (amarelo). A tabela original (011)
-- só tinha `tipo` (kind). Adicionamos `severity` como coluna separada
-- para que o backend possa ser autority sobre criticidade sem acoplamento
-- com o tipo de alarme.
--
-- Mapeamento padrão de tipo → severity quando null (migration data patch):
--   temperature_high     → critico
--   sensor_missing       → aviso
--   pump_runtime_exceeded → critico
--   communication_lost   → aviso
--
-- NÃO-DESTRUTIVA: ADD COLUMN ... DEFAULT + UPDATE + NOT NULL posterior.
-- IDEMPOTENTE: IF NOT EXISTS.
-- ROLLBACK: ALTER TABLE irrigation_alarms DROP COLUMN severity;

BEGIN;

ALTER TABLE irrigation_alarms
  ADD COLUMN IF NOT EXISTS severity TEXT
    CHECK (severity IN ('critico', 'aviso'));

-- Preenche histórico baseado no tipo
UPDATE irrigation_alarms
  SET severity = CASE tipo
    WHEN 'temperature_high'      THEN 'critico'
    WHEN 'pump_runtime_exceeded' THEN 'critico'
    WHEN 'sensor_missing'        THEN 'aviso'
    WHEN 'communication_lost'    THEN 'aviso'
    ELSE 'aviso'
  END
WHERE severity IS NULL;

-- Agora garante NOT NULL para novos registros
-- (não usa ALTER COLUMN SET NOT NULL com check de existência pois IF NOT EXISTS
--  cobre a idempotência acima; o DEFAULT garante novos inserts sem severity)
ALTER TABLE irrigation_alarms
  ALTER COLUMN severity SET DEFAULT 'aviso';

COMMENT ON COLUMN irrigation_alarms.severity IS
  'E5.3 — criticidade do alarme: critico (banner vermelho) ou aviso (banner amarelo).';

COMMIT;
