-- 028 — Adiciona 'mode_auto_reset' ao CHECK constraint de irrigation_events.origem.
--
-- Sebastião introduziu esse valor em fw 0.17.2 (setModo automatico fecha bomba+setores
-- via safeCloseAllSectors com origem='mode_auto_reset'). Backend hoje degrada pra NULL
-- com warning. Adiciona ao whitelist pra preservar info.

BEGIN;

ALTER TABLE irrigation_events DROP CONSTRAINT IF EXISTS irrigation_events_origem_check;

ALTER TABLE irrigation_events
  ADD CONSTRAINT irrigation_events_origem_check
  CHECK (origem IS NULL OR origem = ANY (ARRAY[
    'automatic'::text,
    'manual_app_local'::text,
    'manual_app_remote'::text,
    'physical_button'::text,
    'safety'::text,
    'mode_auto_reset'::text
  ]));

COMMIT;
