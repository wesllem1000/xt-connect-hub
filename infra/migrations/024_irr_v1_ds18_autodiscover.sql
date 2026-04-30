-- E5.19 — Auto-descoberta de sensores DS18B20 (firmware 0.6.1-stage5).
--
-- Firmware agora escaneia o barramento 1-Wire periodicamente e publica em
-- config/current retained:
--   - bus_rom_ids: TEXT[] com TODOS os ROM IDs presentes no momento.
--   - temperature_sensors[].presente: bool (rom_id configurado existe no bus?)
--   - temperature_sensors[].ultima_leitura_c: temperatura ao vivo do sensor.
--
-- Estado a persistir no servidor (pra UI carregar sem depender de retained MQTT
-- volátil + permitir validação no POST sensor):
--
--   irrigation_configs.bus_rom_ids TEXT[]   -- ROM IDs detectados pelo firmware
--   irrigation_temperature_sensors.presente BOOLEAN  -- atualizado pelo sync
--
-- ultima_leitura_c já existe na tabela (numeric(5,2)) — só precisa começar a
-- ser populada pelo handler config/current. Sem schema change pra ela.
--
-- Migration aditiva. Defaults seguros (false / array vazio). Compatível com
-- registros existentes.

BEGIN;

ALTER TABLE irrigation_configs
  ADD COLUMN IF NOT EXISTS bus_rom_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

COMMENT ON COLUMN irrigation_configs.bus_rom_ids IS
  'ROM IDs DS18B20 detectados pelo firmware via scan periodico do barramento 1-Wire. '
  'Atualizado quando ESP republica config/current. Usado pelo painel pra mostrar '
  '"sensores detectados — clique pra configurar" e pra validar POST de sensor.';

ALTER TABLE irrigation_temperature_sensors
  ADD COLUMN IF NOT EXISTS presente BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN irrigation_temperature_sensors.presente IS
  'TRUE quando o rom_id configurado esta presente no barramento agora (segundo '
  'ultimo config/current). FALSE quando o sensor esta desconectado fisicamente.';

COMMIT;
