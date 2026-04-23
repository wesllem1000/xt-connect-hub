-- E4.2A — current_pinout espelhado do firmware (R6) — refs #71
--
-- Firmware é autoridade absoluta do pinout real (§16.1 + R6). Quando
-- reforco_rele_ativo=true, o firmware remapeia o relé do Setor 1 pra
-- próxima saída livre; server apenas espelha o mapeamento que chega via
-- MQTT retained em devices/<serial>/config/current.
--
-- Coluna nullable: antes da primeira mensagem do firmware, fica NULL.
-- Shape esperado (exemplo):
--   {
--     "protocol_version": 1,
--     "ts": "2026-04-23T00:00:00Z",
--     "pump_gpio": 4,
--     "sector_gpios": {"1":17,"2":18,"3":19,"4":21,"5":22,"6":23,"7":25,"8":26},
--     "reforco_rele_active": true,
--     "one_wire_gpio": 15
--   }
--
-- O shape não é travado no server (JSONB livre) — o contrato fica no
-- firmware + docs/specs/IRR-V1.md. Validação frontend apenas pra render.

BEGIN;

ALTER TABLE irrigation_configs
  ADD COLUMN IF NOT EXISTS current_pinout JSONB,
  ADD COLUMN IF NOT EXISTS current_pinout_received_at TIMESTAMPTZ;

COMMENT ON COLUMN irrigation_configs.current_pinout IS
  'E4.2A — mapeamento real de GPIOs reportado pelo firmware via config/current (R6). Server espelha, não decide.';
COMMENT ON COLUMN irrigation_configs.current_pinout_received_at IS
  'E4.2A — timestamp da última mensagem config/current recebida.';

COMMIT;
