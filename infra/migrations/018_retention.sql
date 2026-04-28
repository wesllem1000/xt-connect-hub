-- E5.11 — Retencao de telemetria (Fase 2.3 do PLANO-DE-ACAO)
--
-- Funcoes purge_*() chamadas por cron diario (Node-RED 03:00). Cada
-- uma retorna numero de rows deletadas, pra log/observabilidade.
--
-- Politica padrao por tabela:
--   device_readings   -> retencao por modelo (modelos_dispositivo.
--                        retencao_historico_horas), default 168h (7d)
--   irrigation_events -> 90 dias (historico longo pra debug/auditoria)
--   mqtt_events       -> 7 dias (log bruto pra debug recente)
--   notification_outbox (sent/failed/suppressed) -> 30 dias
--   irrigation_command_log com expires_at < now() - 7 dias -> apaga
--   notification_outbox pending sem progresso > 7 dias -> failed
--
-- Aditiva: nao destrutiva, so CREATE FUNCTION.

BEGIN;

-- ============================================================
-- 1) device_readings — retencao por modelo (ja tem coluna)
-- ============================================================
CREATE OR REPLACE FUNCTION purge_device_readings()
RETURNS TABLE(deleted BIGINT, oldest_ts TIMESTAMPTZ) AS $$
DECLARE
  total BIGINT := 0;
BEGIN
  WITH dev_horas AS (
    SELECT d.id AS device_id,
           COALESCE(m.retencao_historico_horas, 168) AS horas
      FROM devices d
      LEFT JOIN modelos_dispositivo m ON m.id = d.modelo_id
  ),
  del AS (
    DELETE FROM device_readings dr
     USING dev_horas dh
     WHERE dr.device_id = dh.device_id
       AND dr.ts < (NOW() - (dh.horas || ' hours')::INTERVAL)
     RETURNING dr.ts
  )
  SELECT COUNT(*) INTO total FROM del;

  deleted := total;
  SELECT MIN(ts) INTO oldest_ts FROM device_readings;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION purge_device_readings IS
  'E5.11 — Apaga device_readings mais antigas que retencao do modelo. Retorna numero deletado + ts mais antigo restante.';

-- ============================================================
-- 2) irrigation_events — purge por idade
-- ============================================================
CREATE OR REPLACE FUNCTION purge_irrigation_events(p_keep_days INT DEFAULT 90)
RETURNS BIGINT AS $$
DECLARE
  n BIGINT;
BEGIN
  IF p_keep_days < 1 THEN p_keep_days := 1; END IF;
  DELETE FROM irrigation_events
   WHERE ts < NOW() - (p_keep_days || ' days')::INTERVAL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 3) mqtt_events — purge por idade
-- ============================================================
CREATE OR REPLACE FUNCTION purge_mqtt_events(p_keep_days INT DEFAULT 7)
RETURNS BIGINT AS $$
DECLARE
  n BIGINT;
BEGIN
  IF p_keep_days < 1 THEN p_keep_days := 1; END IF;
  DELETE FROM mqtt_events
   WHERE received_at < NOW() - (p_keep_days || ' days')::INTERVAL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 4) notification_outbox — sent/failed/suppressed antigos
-- ============================================================
CREATE OR REPLACE FUNCTION purge_notification_outbox(p_keep_days INT DEFAULT 30)
RETURNS BIGINT AS $$
DECLARE
  n BIGINT;
BEGIN
  IF p_keep_days < 1 THEN p_keep_days := 1; END IF;
  -- Marca pending parados ha > 7 dias como failed (worker provavelmente
  -- tentou e desistiu; nao queremos eles ocupando o index pending)
  UPDATE notification_outbox
     SET status = 'failed', last_error = COALESCE(last_error, 'aged out without sending')
   WHERE status = 'pending' AND created_at < NOW() - INTERVAL '7 days';

  -- Apaga sent/failed/suppressed antigos
  DELETE FROM notification_outbox
   WHERE status IN ('sent','failed','suppressed')
     AND created_at < NOW() - (p_keep_days || ' days')::INTERVAL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5) Wrapper unico chamado pelo cron — retorna jsonb com metricas
-- ============================================================
CREATE OR REPLACE FUNCTION run_retention_purges()
RETURNS JSONB AS $$
DECLARE
  v_readings RECORD;
  v_irr_events BIGINT;
  v_mqtt BIGINT;
  v_outbox BIGINT;
  result JSONB;
BEGIN
  SELECT * INTO v_readings FROM purge_device_readings();
  v_irr_events := purge_irrigation_events();
  v_mqtt := purge_mqtt_events();
  v_outbox := purge_notification_outbox();

  result := jsonb_build_object(
    'started_at', NOW(),
    'device_readings_deleted', v_readings.deleted,
    'device_readings_oldest_remaining', v_readings.oldest_ts,
    'irrigation_events_deleted', v_irr_events,
    'mqtt_events_deleted', v_mqtt,
    'notification_outbox_deleted', v_outbox
  );
  RETURN result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION run_retention_purges IS
  'E5.11 — chamada pelo cron diario (Node-RED 03:00). Roda todas as purges e retorna jsonb com metricas.';

COMMIT;
