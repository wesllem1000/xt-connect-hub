-- ============================================================================
-- Migration 018 — Suporte ao firmware 0.16+ (refs: alinhamento v0.15.6 Fase 0)
-- ============================================================================
-- Quatro mudanças aditivas, todas retrocompatíveis com 0.15.5:
--
--   1. irrigation_sectors.divergence_detected_at TIMESTAMPTZ NULL
--      Marca quando o backend detectou divergência DB ↔ state real do device.
--      NULL = sem divergência conhecida.
--
--   2. irrigation_sectors.power_pct INT NULL  [0..100]
--      Override por setor de potência da bomba (inverter). NULL = usar default
--      global do device (irrigation_configs). Só relevante quando
--      tipo_bomba = 'inverter'.
--
--   3. irrigation_timers.power_pct_override INT NULL  [0..100]
--      Override por timer, sobrepõe irrigation_sectors.power_pct se informado.
--      NULL = herda do setor ou config global. Hierarquia:
--        timer.power_pct_override > sector.power_pct > config global.
--
--   4. irrigation_timers.id  UUID → VARCHAR(64)
--      Firmware 0.16 envia IDs próprios (até 64 chars, ex.: "sec1-t001").
--      UUIDs existentes continuam válidos como string (formato UUID cabe em 36).
--      A coluna alvo_id em irrigation_timers (FK → irrigation_sectors.id)
--      permanece UUID, pois sectors continuam com UUID gerado pelo server.
--
-- Idempotência: ALTER TABLE ADD COLUMN IF NOT EXISTS (Postgres 9.6+).
--               ALTER COLUMN TYPE usa USING cast e é reentrante via DO-block
--               (checa pg_typeof antes de alterar).
--
-- NÃO HÁ FKs externas apontando para irrigation_timers.id:
--   - irrigation_timers.alvo_id → irrigation_sectors.id  (FK de timers → sectors,
--     não o inverso; não afetada pela mudança de tipo em timers.id)
--   - Nenhuma outra tabela referencia irrigation_timers.id.
--
-- Rollback: ver seção ROLLBACK ao final deste arquivo (comentada).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. irrigation_sectors.divergence_detected_at
-- ============================================================================
ALTER TABLE irrigation_sectors
  ADD COLUMN IF NOT EXISTS divergence_detected_at TIMESTAMPTZ;
  -- NULL = nenhuma divergência detectada. Backend seta quando detecta que
  -- o DB diverge do state real (ex.: setor marcado como aberto no DB mas
  -- o firmware reporta fechado sem evento de closure correspondente).
  -- Backend limpa para NULL quando a divergência é resolvida (sync bem-sucedido
  -- ou ack explícito do firmware).

COMMENT ON COLUMN irrigation_sectors.divergence_detected_at IS
  '018 — Timestamp em que o backend detectou divergência entre o DB e o state
  real reportado pelo firmware (MQTT retained). NULL = em sync. Backend seta
  ao processar devices/+/state; limpa ao confirmar reconciliação.';

-- ============================================================================
-- 2. irrigation_sectors.power_pct
-- ============================================================================
ALTER TABLE irrigation_sectors
  ADD COLUMN IF NOT EXISTS power_pct INT;
  -- Override de potência da bomba por setor (0..100 %). NULL = usar config
  -- global do device. Só tem efeito quando tipo_bomba = 'inverter'.
  -- Firmware 0.16 lê este campo via config/push e aplica no PWM do inversor.

DO $$
BEGIN
  -- Adiciona CHECK apenas se a constraint ainda não existe (idempotência)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'irrigation_sectors_power_pct_range'
       AND conrelid = 'irrigation_sectors'::regclass
  ) THEN
    ALTER TABLE irrigation_sectors
      ADD CONSTRAINT irrigation_sectors_power_pct_range
        CHECK (power_pct IS NULL OR (power_pct BETWEEN 0 AND 100));
  END IF;
END $$;

COMMENT ON COLUMN irrigation_sectors.power_pct IS
  '018 — Override de potência da bomba (inverter) por setor, em % (0..100).
  NULL = herdar config global de potência do device. Firmware é autoridade
  na aplicação; backend publica via config/push quando o valor muda.';

-- ============================================================================
-- 3. irrigation_timers.power_pct_override
-- ============================================================================
ALTER TABLE irrigation_timers
  ADD COLUMN IF NOT EXISTS power_pct_override INT;
  -- Override de potência por timer, nível mais granular.
  -- Hierarquia de precedência (maior → menor):
  --   timer.power_pct_override > sector.power_pct > config global do device.
  -- NULL em qualquer nível = cair pro próximo na hierarquia.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'irrigation_timers_power_pct_override_range'
       AND conrelid = 'irrigation_timers'::regclass
  ) THEN
    ALTER TABLE irrigation_timers
      ADD CONSTRAINT irrigation_timers_power_pct_override_range
        CHECK (power_pct_override IS NULL OR (power_pct_override BETWEEN 0 AND 100));
  END IF;
END $$;

COMMENT ON COLUMN irrigation_timers.power_pct_override IS
  '018 — Override de potência por timer (0..100 %). Sobrepõe irrigation_sectors.power_pct
  quando informado. NULL = herdar do setor ou do config global. Hierarquia:
  timer.power_pct_override > sector.power_pct > config global.';

-- ============================================================================
-- 4. irrigation_timers.id  UUID → VARCHAR(64)
-- ============================================================================
-- Firmware 0.16 quer enviar IDs arbitrários (ex.: "sec2-cyclic-001") com até
-- 64 chars. UUIDs existentes (36 chars) continuam válidos como strings.
--
-- Não há FK externa apontando para irrigation_timers.id, portanto a alteração
-- não afeta outras tabelas.
--
-- A alteração é feita dentro de um DO-block que checa o tipo atual primeiro
-- (idempotência): se a coluna já for VARCHAR/TEXT, o bloco é no-op.
-- O DEFAULT gen_random_uuid()::text substitui o DEFAULT UUID original.
-- ============================================================================

DO $$
DECLARE
  col_type TEXT;
BEGIN
  SELECT data_type INTO col_type
    FROM information_schema.columns
   WHERE table_name = 'irrigation_timers'
     AND column_name = 'id';

  IF col_type = 'uuid' THEN
    -- Remove default antes do ALTER (obrigatório pra mudar tipo com default UUID)
    ALTER TABLE irrigation_timers ALTER COLUMN id DROP DEFAULT;

    -- Converte UUID → VARCHAR(64) usando cast ::text (sem perda de dados)
    ALTER TABLE irrigation_timers
      ALTER COLUMN id TYPE VARCHAR(64) USING id::text;

    -- Restaura default: gen_random_uuid()::text produz UUID v4 como string
    ALTER TABLE irrigation_timers
      ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

    RAISE NOTICE '018 — irrigation_timers.id convertido de UUID para VARCHAR(64).';
  ELSE
    RAISE NOTICE '018 — irrigation_timers.id já é % — nenhuma ação necessária.', col_type;
  END IF;
END $$;

COMMENT ON COLUMN irrigation_timers.id IS
  '018 — Alterado de UUID para VARCHAR(64). Firmware 0.16 pode enviar IDs arbitrários
  (ex.: "sec1-t001"). UUIDs legados continuam válidos (36 chars). Default: gen_random_uuid()::text.';

-- ============================================================================
-- Verificação final
-- ============================================================================
DO $$
DECLARE
  col_div   TEXT;
  col_spct  TEXT;
  col_tpct  TEXT;
  col_tid   TEXT;
BEGIN
  SELECT data_type INTO col_div  FROM information_schema.columns WHERE table_name='irrigation_sectors' AND column_name='divergence_detected_at';
  SELECT data_type INTO col_spct FROM information_schema.columns WHERE table_name='irrigation_sectors' AND column_name='power_pct';
  SELECT data_type INTO col_tpct FROM information_schema.columns WHERE table_name='irrigation_timers'  AND column_name='power_pct_override';
  SELECT data_type INTO col_tid  FROM information_schema.columns WHERE table_name='irrigation_timers'  AND column_name='id';

  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Migration 018 — firmware 0.16 columns';
  RAISE NOTICE '  irrigation_sectors.divergence_detected_at : %', COALESCE(col_div,  'AUSENTE — ERRO');
  RAISE NOTICE '  irrigation_sectors.power_pct              : %', COALESCE(col_spct, 'AUSENTE — ERRO');
  RAISE NOTICE '  irrigation_timers.power_pct_override      : %', COALESCE(col_tpct, 'AUSENTE — ERRO');
  RAISE NOTICE '  irrigation_timers.id (tipo atual)         : %', COALESCE(col_tid,  'AUSENTE — ERRO');
  RAISE NOTICE '============================================================';
END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK (NÃO executar sem aprovação explícita e backup verificado)
-- ============================================================================
-- Para reverter cada mudança individualmente:
--
-- -- 1. divergence_detected_at
-- ALTER TABLE irrigation_sectors DROP COLUMN IF EXISTS divergence_detected_at;
--
-- -- 2. irrigation_sectors.power_pct
-- ALTER TABLE irrigation_sectors DROP CONSTRAINT IF EXISTS irrigation_sectors_power_pct_range;
-- ALTER TABLE irrigation_sectors DROP COLUMN IF EXISTS power_pct;
--
-- -- 3. irrigation_timers.power_pct_override
-- ALTER TABLE irrigation_timers DROP CONSTRAINT IF EXISTS irrigation_timers_power_pct_override_range;
-- ALTER TABLE irrigation_timers DROP COLUMN IF EXISTS power_pct_override;
--
-- -- 4. Reverter id VARCHAR(64) → UUID
-- --    ATENÇÃO: falha se houver rows cujo id não seja UUID válido (firmware 0.16 já inseriu).
-- --    Exige que TODAS as rows tenham id no formato UUID antes de executar.
-- --    Verificar antes: SELECT id FROM irrigation_timers WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
-- ALTER TABLE irrigation_timers ALTER COLUMN id DROP DEFAULT;
-- ALTER TABLE irrigation_timers ALTER COLUMN id TYPE UUID USING id::uuid;
-- ALTER TABLE irrigation_timers ALTER COLUMN id SET DEFAULT gen_random_uuid();
-- ============================================================================
