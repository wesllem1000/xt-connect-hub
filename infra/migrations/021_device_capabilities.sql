-- E5.14 — Schema multi-modelo (Plano C do roadmap, Fase 3.4 do
--          PLANO-DE-ACAO original).
--
-- Estado anterior: irrigation_events.event_type tinha CHECK constraint
-- hardcoded com 32 valores literais (todos do IRR-V1). Pra adicionar
-- gerador, chocadeira, etc., precisa ALTER TABLE em producao a cada
-- novo tipo — frágil.
--
-- Mudanca: tipos viram catalogo por modelo. INSERT INTO device_event_types
-- (modelo_id, event_type) ao registrar novo modelo. Trigger valida na
-- insercao do evento.
--
-- Tabelas similares pra alarmes (severidade incluida).
--
-- Aditivo + drop dos CHECK hardcoded.

BEGIN;

-- ============================================================
-- 1) device_event_types — catalogo (modelo, event_type)
-- ============================================================
CREATE TABLE IF NOT EXISTS device_event_types (
  modelo_id UUID NOT NULL REFERENCES modelos_dispositivo(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  descricao TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (modelo_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_device_event_types_type
  ON device_event_types(event_type);

COMMENT ON TABLE device_event_types IS
  'E5.14 — quais event_types cada modelo pode publicar. Replace dos CHECK constraints hardcoded.';

-- ============================================================
-- 2) device_alarm_types — catalogo (modelo, alarm_type, severidade)
-- ============================================================
CREATE TABLE IF NOT EXISTS device_alarm_types (
  modelo_id UUID NOT NULL REFERENCES modelos_dispositivo(id) ON DELETE CASCADE,
  alarm_type TEXT NOT NULL,
  severidade TEXT NOT NULL DEFAULT 'warning'
    CHECK (severidade IN ('info','warning','critical')),
  descricao TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (modelo_id, alarm_type)
);

COMMENT ON TABLE device_alarm_types IS
  'E5.14 — quais alarm_types cada modelo pode disparar, com severidade default.';

-- ============================================================
-- 3) Seed dos tipos atuais do IRR-V1
-- ============================================================
DO $$
DECLARE
  v_irr UUID;
BEGIN
  SELECT id INTO v_irr FROM modelos_dispositivo
   WHERE prefixo = 'IRR' AND major_version = 'V1' LIMIT 1;
  IF v_irr IS NULL THEN
    RAISE NOTICE 'modelo IRR-V1 nao encontrado, pulando seed';
    RETURN;
  END IF;

  INSERT INTO device_event_types (modelo_id, event_type) VALUES
    (v_irr, 'pump_on_manual'),         (v_irr, 'pump_off_manual'),
    (v_irr, 'pump_on_auto'),           (v_irr, 'pump_off_auto_end'),
    (v_irr, 'pump_off_safety'),        (v_irr, 'sector_opened'),
    (v_irr, 'sector_closed'),          (v_irr, 'safe_closure_started'),
    (v_irr, 'safe_closure_completed'), (v_irr, 'last_sector_closed_pump_on'),
    (v_irr, 'confirmation_requested'), (v_irr, 'confirmation_accepted'),
    (v_irr, 'confirmation_cancelled'), (v_irr, 'remote_cmd_received'),
    (v_irr, 'remote_cmd_executed'),    (v_irr, 'remote_cmd_refused'),
    (v_irr, 'wifi_connected'),         (v_irr, 'wifi_disconnected'),
    (v_irr, 'mqtt_connected'),         (v_irr, 'mqtt_disconnected'),
    (v_irr, 'time_synced'),            (v_irr, 'time_invalid'),
    (v_irr, 'timer_created'),          (v_irr, 'timer_edited'),
    (v_irr, 'timer_paused'),           (v_irr, 'timer_reactivated'),
    (v_irr, 'timer_removed'),          (v_irr, 'temp_alarm_triggered'),
    (v_irr, 'temp_alarm_ack_user'),    (v_irr, 'temp_sensor_lost'),
    (v_irr, 'physical_button_pressed'),(v_irr, 'auto_shutoff_max_time')
  ON CONFLICT (modelo_id, event_type) DO NOTHING;

  INSERT INTO device_alarm_types (modelo_id, alarm_type, severidade) VALUES
    (v_irr, 'temperature_high',       'critical'),
    (v_irr, 'sensor_missing',         'warning'),
    (v_irr, 'pump_runtime_exceeded',  'warning'),
    (v_irr, 'communication_lost',     'warning')
  ON CONFLICT (modelo_id, alarm_type) DO NOTHING;
END$$;

-- ============================================================
-- 4) Triggers de validacao + DROP dos CHECK hardcoded
-- ============================================================

CREATE OR REPLACE FUNCTION validate_event_type_for_model() RETURNS TRIGGER AS $$
DECLARE
  v_modelo UUID;
BEGIN
  SELECT modelo_id INTO v_modelo FROM devices WHERE id = NEW.device_id;
  IF v_modelo IS NULL THEN
    -- Device sem modelo: aceita tudo (legacy/dev)
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM device_event_types
     WHERE modelo_id = v_modelo AND event_type = NEW.event_type
  ) THEN
    RAISE EXCEPTION 'event_type "%" nao registrado pro modelo do device', NEW.event_type
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_alarm_type_for_model() RETURNS TRIGGER AS $$
DECLARE
  v_modelo UUID;
BEGIN
  SELECT modelo_id INTO v_modelo FROM devices WHERE id = NEW.device_id;
  IF v_modelo IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM device_alarm_types
     WHERE modelo_id = v_modelo AND alarm_type = NEW.tipo
  ) THEN
    RAISE EXCEPTION 'alarm tipo "%" nao registrado pro modelo do device', NEW.tipo
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop CHECKs hardcoded (continuam por trigger agora)
ALTER TABLE irrigation_events
  DROP CONSTRAINT IF EXISTS irrigation_events_event_type_check;
ALTER TABLE irrigation_alarms
  DROP CONSTRAINT IF EXISTS irrigation_alarms_tipo_check;

-- Aplica triggers
DROP TRIGGER IF EXISTS trg_validate_event_type ON irrigation_events;
CREATE TRIGGER trg_validate_event_type
  BEFORE INSERT ON irrigation_events
  FOR EACH ROW EXECUTE FUNCTION validate_event_type_for_model();

DROP TRIGGER IF EXISTS trg_validate_alarm_type ON irrigation_alarms;
CREATE TRIGGER trg_validate_alarm_type
  BEFORE INSERT ON irrigation_alarms
  FOR EACH ROW EXECUTE FUNCTION validate_alarm_type_for_model();

COMMIT;
