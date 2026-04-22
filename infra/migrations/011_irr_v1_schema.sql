-- E4.1 — IRR-V1 schema (refs #71)
--
-- 6 tabelas novas FK em devices(id) ON DELETE CASCADE.
-- Não-destrutiva (só ADD TABLE), sem impacto em E3 atual.
-- Tudo em uma transação única.

BEGIN;

-- ============================================================
-- 1) irrigation_configs — 1:1 com devices
-- ============================================================
CREATE TABLE IF NOT EXISTS irrigation_configs (
  device_id UUID PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  protocol_version INT NOT NULL DEFAULT 1,

  -- Modo operacional
  modo_operacao TEXT NOT NULL DEFAULT 'manual'
    CHECK (modo_operacao IN ('manual','automatico')),

  -- Bomba
  tipo_bomba TEXT NOT NULL DEFAULT 'monofasica'
    CHECK (tipo_bomba IN ('monofasica','inverter')),
  reforco_rele_ativo BOOLEAN NOT NULL DEFAULT FALSE,
  nivel_ativo_bomba TEXT NOT NULL DEFAULT 'high'
    CHECK (nivel_ativo_bomba IN ('high','low')),

  -- Timings de segurança (§15)
  atraso_abrir_valvula_antes_bomba_s INT NOT NULL DEFAULT 3
    CHECK (atraso_abrir_valvula_antes_bomba_s BETWEEN 0 AND 60),
  tempo_bomba_desligada_antes_fechar_valvula_s INT NOT NULL DEFAULT 2
    CHECK (tempo_bomba_desligada_antes_fechar_valvula_s BETWEEN 0 AND 60),
  atraso_religar_bomba_apos_fechamento_s INT NOT NULL DEFAULT 5
    CHECK (atraso_religar_bomba_apos_fechamento_s BETWEEN 0 AND 60),

  -- Proteções de runtime
  tempo_max_continuo_bomba_min INT NOT NULL DEFAULT 120
    CHECK (tempo_max_continuo_bomba_min BETWEEN 1 AND 1440),
  tempo_max_manual_local_min INT NOT NULL DEFAULT 60
    CHECK (tempo_max_manual_local_min BETWEEN 1 AND 1440),
  tempo_max_manual_remoto_sem_internet_min INT NOT NULL DEFAULT 60
    CHECK (tempo_max_manual_remoto_sem_internet_min BETWEEN 1 AND 1440),

  -- Botão físico da bomba
  botao_fisico_tipo TEXT NOT NULL DEFAULT 'pulso_alterna'
    CHECK (botao_fisico_tipo IN ('pulso_alterna','pulso_liga','pulso_desliga','retentivo')),
  botao_debounce_ms INT NOT NULL DEFAULT 50
    CHECK (botao_debounce_ms BETWEEN 0 AND 1000),
  botao_assume_manual BOOLEAN NOT NULL DEFAULT TRUE,

  -- Barramento 1-Wire (DS18B20)
  gpio_1wire INT NOT NULL DEFAULT 15
    CHECK (gpio_1wire BETWEEN 0 AND 39),

  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_irrigation_configs_updated
  BEFORE UPDATE ON irrigation_configs
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

COMMENT ON TABLE irrigation_configs IS
  'E4.1 — config geral do modelo IRR-V1, 1:1 com devices. Firmware é autoridade sobre as regras.';

-- ============================================================
-- 2) irrigation_sectors — até 8 por device (pré-montados)
-- ============================================================
CREATE TABLE IF NOT EXISTS irrigation_sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  numero INT NOT NULL CHECK (numero BETWEEN 1 AND 8),
  nome TEXT NOT NULL,
  habilitado BOOLEAN NOT NULL DEFAULT FALSE,
  pausado BOOLEAN NOT NULL DEFAULT FALSE,

  -- Relé do setor
  gpio_rele INT NOT NULL CHECK (gpio_rele BETWEEN 0 AND 39),
  nivel_ativo_rele TEXT NOT NULL DEFAULT 'high'
    CHECK (nivel_ativo_rele IN ('high','low')),

  -- Botão físico opcional do setor
  tipo_botao_fisico TEXT
    CHECK (tipo_botao_fisico IS NULL OR
           tipo_botao_fisico IN ('pulso_alterna','pulso_liga','pulso_desliga','retentivo')),
  gpio_botao INT
    CHECK (gpio_botao IS NULL OR (gpio_botao BETWEEN 0 AND 39)),
  debounce_ms INT NOT NULL DEFAULT 50
    CHECK (debounce_ms BETWEEN 0 AND 1000),

  -- Estado volátil (atualizado via MQTT data; informativo, firmware é autoridade)
  ultimo_acionamento_em TIMESTAMPTZ,
  ultima_duracao_s INT,
  proxima_execucao_em TIMESTAMPTZ,

  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (device_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_irrigation_sectors_device
  ON irrigation_sectors (device_id);

CREATE TRIGGER trg_irrigation_sectors_updated
  BEFORE UPDATE ON irrigation_sectors
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

COMMENT ON TABLE irrigation_sectors IS
  'E4.1 — 8 setores pré-montados por device (todos habilitado=false ao provisionar; user ativa na UI técnica).';

-- ============================================================
-- 3) irrigation_timers — até 10 por alvo
-- ============================================================
CREATE TABLE IF NOT EXISTS irrigation_timers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,

  -- Alvo do timer: bomba (alvo_id NULL) ou setor específico (alvo_id = sector.id)
  alvo_tipo TEXT NOT NULL CHECK (alvo_tipo IN ('pump','sector')),
  alvo_id UUID REFERENCES irrigation_sectors(id) ON DELETE CASCADE,

  tipo TEXT NOT NULL
    CHECK (tipo IN ('fixed','cyclic_window','cyclic_continuous')),

  nome TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  pausado BOOLEAN NOT NULL DEFAULT FALSE,

  -- Janela temporal
  hora_inicio TIME,
  hora_fim TIME,           -- usado em cyclic_window
  duracao_min INT
    CHECK (duracao_min IS NULL OR duracao_min BETWEEN 1 AND 1440),

  -- Ciclos on/off (cyclic_window + cyclic_continuous)
  on_minutes INT CHECK (on_minutes IS NULL OR on_minutes BETWEEN 1 AND 1440),
  off_minutes INT CHECK (off_minutes IS NULL OR off_minutes BETWEEN 1 AND 1440),

  -- Bitmask 7-bit dia da semana (bit 0 = domingo)
  dias_semana SMALLINT NOT NULL CHECK (dias_semana BETWEEN 0 AND 127),

  -- Flags de conflito
  overlap_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    -- true = user confirmou overlap com alvo diferente (warning §16.10)

  observacao TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Consistência: alvo_tipo='sector' exige alvo_id; 'pump' exige alvo_id NULL
  CONSTRAINT timer_alvo_consistente CHECK (
    (alvo_tipo = 'pump'   AND alvo_id IS NULL) OR
    (alvo_tipo = 'sector' AND alvo_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_irrigation_timers_device
  ON irrigation_timers (device_id);
CREATE INDEX IF NOT EXISTS idx_irrigation_timers_alvo
  ON irrigation_timers (device_id, alvo_tipo, alvo_id);

CREATE TRIGGER trg_irrigation_timers_updated
  BEFORE UPDATE ON irrigation_timers
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

-- Trigger enforce 10 timers/alvo
CREATE OR REPLACE FUNCTION enforce_timer_limit_per_target()
RETURNS TRIGGER AS $$
DECLARE
  n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM irrigation_timers
  WHERE device_id = NEW.device_id
    AND alvo_tipo = NEW.alvo_tipo
    AND alvo_id IS NOT DISTINCT FROM NEW.alvo_id;
  IF n >= 10 THEN
    RAISE EXCEPTION 'limit_reached:10_timers_per_target'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_irrigation_timers_limit_per_target
  BEFORE INSERT ON irrigation_timers
  FOR EACH ROW EXECUTE FUNCTION enforce_timer_limit_per_target();

COMMENT ON TABLE irrigation_timers IS
  'E4.1 — até 10 timers por alvo (bomba ou setor). 3 tipos: fixed, cyclic_window, cyclic_continuous.';

-- ============================================================
-- 4) irrigation_temperature_sensors — até 4 por device
-- ============================================================
CREATE TABLE IF NOT EXISTS irrigation_temperature_sensors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  rom_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('pump','inverter','custom')),
  nome_custom TEXT,  -- quando role='custom'

  -- Configuração de alarme
  limite_alarme_c NUMERIC(5,2) NOT NULL,
  histerese_c NUMERIC(4,2) NOT NULL DEFAULT 5.0
    CHECK (histerese_c >= 0 AND histerese_c <= 50),
  ack_usuario_requerido BOOLEAN NOT NULL DEFAULT TRUE,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,

  -- Estado volátil
  ultima_leitura_c NUMERIC(5,2),
  ultimo_contato_em TIMESTAMPTZ,

  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (device_id, rom_id)
);

CREATE INDEX IF NOT EXISTS idx_irrigation_sensors_device
  ON irrigation_temperature_sensors (device_id);

CREATE TRIGGER trg_irrigation_sensors_updated
  BEFORE UPDATE ON irrigation_temperature_sensors
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

-- Trigger enforce 4 sensores/device
CREATE OR REPLACE FUNCTION enforce_sensor_limit_per_device()
RETURNS TRIGGER AS $$
DECLARE
  n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM irrigation_temperature_sensors
  WHERE device_id = NEW.device_id;
  IF n >= 4 THEN
    RAISE EXCEPTION 'limit_reached:4_sensors_per_device'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_irrigation_sensors_limit_per_device
  BEFORE INSERT ON irrigation_temperature_sensors
  FOR EACH ROW EXECUTE FUNCTION enforce_sensor_limit_per_device();

COMMENT ON TABLE irrigation_temperature_sensors IS
  'E4.1 — até 4 DS18B20 por device. Sensores são diagnóstico; sensor_lost NÃO interrompe operação.';

-- ============================================================
-- 5) irrigation_events — histórico imutável, dedup natural
-- ============================================================
CREATE TABLE IF NOT EXISTS irrigation_events (
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  event_uuid UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'pump_on_manual','pump_off_manual','pump_on_auto','pump_off_auto_end',
    'pump_off_safety','sector_opened','sector_closed','safe_closure_started',
    'safe_closure_completed','last_sector_closed_pump_on','confirmation_requested',
    'confirmation_accepted','confirmation_cancelled','remote_cmd_received',
    'remote_cmd_executed','remote_cmd_refused','wifi_connected','wifi_disconnected',
    'mqtt_connected','mqtt_disconnected','time_synced','time_invalid',
    'timer_created','timer_edited','timer_paused','timer_reactivated','timer_removed',
    'temp_alarm_triggered','temp_alarm_ack_user','temp_sensor_lost',
    'physical_button_pressed','auto_shutoff_max_time'
  )),
  alvo_tipo TEXT CHECK (alvo_tipo IS NULL OR alvo_tipo IN ('pump','sector')),
  alvo_id UUID,          -- setor_id ou NULL
  origem TEXT CHECK (origem IS NULL OR origem IN (
    'automatic','manual_app_local','manual_app_remote','physical_button','safety'
  )),
  resultado TEXT,        -- ex: 'ok', 'refused', 'expired'
  duracao_s INT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ts TIMESTAMPTZ NOT NULL,      -- timestamp do device
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (device_id, event_uuid)
);

CREATE INDEX IF NOT EXISTS idx_irrigation_events_device_ts
  ON irrigation_events (device_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_irrigation_events_device_type_ts
  ON irrigation_events (device_id, event_type, ts DESC);

COMMENT ON TABLE irrigation_events IS
  'E4.1 — histórico imutável. PK (device_id, event_uuid) garante dedup de reenvio offline. Não apagada em factory_reset (R7).';

-- ============================================================
-- 6) irrigation_alarms — alarmes ativos e históricos
-- ============================================================
CREATE TABLE IF NOT EXISTS irrigation_alarms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'temperature_high','sensor_missing','pump_runtime_exceeded','communication_lost'
  )),
  sensor_rom_id TEXT,   -- quando relevante (temperature_high, sensor_missing)
  message TEXT NOT NULL,

  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acked_by_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  acked_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,

  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Índice parcial pros alarmes ativos (mais consultado)
CREATE INDEX IF NOT EXISTS idx_irrigation_alarms_device_active
  ON irrigation_alarms (device_id)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_irrigation_alarms_device_ts
  ON irrigation_alarms (device_id, triggered_at DESC);

COMMENT ON TABLE irrigation_alarms IS
  'E4.1 — alarmes. `resolved_at IS NULL` = ativo. `temperature_high` pede ack explícito + temp < limite-histerese pra liberar modal bloqueante.';

COMMIT;
