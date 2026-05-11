-- 027 — Registra event_types da fw 0.16 (Web Updater + cmds novos) e fw 0.17 (VFD events).
--
-- Sem isso, INSERT em irrigation_events com esses event_types dispara
-- trigger validate_event_type_for_model() que rejeita com check_violation.
--
-- Idempotente via ON CONFLICT DO NOTHING.

BEGIN;

INSERT INTO device_event_types (modelo_id, event_type)
SELECT m.id, e.event_type
FROM modelos_dispositivo m
CROSS JOIN unnest(ARRAY[
  -- fw 0.17 — VFD events (Sebastião shipped 0.17.0+0.17.1)
  'vfd_comm_lost',
  'vfd_comm_restored',
  'vfd_setpoint_failed',
  'vfd_brownout',

  -- fw 0.16 — eventos novos que ainda não estavam cadastrados
  'factory_reset_executed',
  'firmware_update_attempted',
  'firmware_update_succeeded',
  'firmware_update_failed',
  'firmware_update_validated',
  'timer_run_now',
  'timer_skip_armed',
  'timer_skipped',
  'burst_ended'
]) AS e(event_type)
WHERE m.prefixo = 'IRR' AND m.major_version = 'V1'
ON CONFLICT DO NOTHING;

COMMIT;
