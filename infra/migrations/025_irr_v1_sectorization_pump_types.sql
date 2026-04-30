-- E5.20 — sectorization_enabled (modo bomba standalone) + expansao de tipos de bomba.
--
-- Firmware 0.6.x agora oferece ao usuario um interruptor pra trabalhar sem
-- setorização — bomba pura, sem valvulas. Quando false, painel esconde a aba
-- Setores e a grade do dashboard, e o card da bomba para de exigir "setor
-- aberto" antes de ligar.
--
-- Tipos de bomba: ESP local oferece 4 tipos (monofasica/bifasica/trifasica/
-- inverter). Hoje banco aceita so 2 (monofasica/inverter). Expansao do CHECK
-- pra os 4. Default segue 'monofasica'.

BEGIN;

-- 1) sectorization_enabled — default true preserva comportamento atual pra
-- todos devices ja provisionados.
ALTER TABLE irrigation_configs
  ADD COLUMN IF NOT EXISTS sectorization_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN irrigation_configs.sectorization_enabled IS
  'TRUE = comportamento padrao (bomba + setores 1..8). FALSE = modo bomba '
  'standalone: painel esconde grade/aba de setores e nao exige setor aberto '
  'antes de ligar a bomba. ESP eh fonte de verdade — flag vem do config/current.';

-- 2) Expandir CHECK de tipo_bomba pra aceitar 4 tipos.
ALTER TABLE irrigation_configs
  DROP CONSTRAINT IF EXISTS irrigation_configs_tipo_bomba_check;

ALTER TABLE irrigation_configs
  ADD CONSTRAINT irrigation_configs_tipo_bomba_check
    CHECK (tipo_bomba IN ('monofasica','bifasica','trifasica','inverter'));

COMMENT ON COLUMN irrigation_configs.tipo_bomba IS
  'Tipo eletrico da bomba: monofasica/bifasica/trifasica/inverter. Influencia '
  'logica de partida/parada do firmware (inverter = controle por inversor de '
  'frequencia, sem ramp direto da rede).';

COMMIT;
