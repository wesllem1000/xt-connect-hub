-- Migration 031 — adicionar 'system' no CHECK de irrigation_events.alvo_tipo
-- Date: 2026-05-11
-- Reason: Sebastião usa alvo_tipo='system' pros events firmware_update_* (fw 0.18.0).
--         CHECK constraint atual rejeita 'system' → todos os events firmware silenciosamente
--         falham com check_violation no INSERT. Detectado durante smoke test OTA remoto
--         do IRR-V1-00008 (12:49 BRT 2026-05-11): 15+ events firmware_update_progress
--         + firmware_update_succeeded perdidos.

BEGIN;

ALTER TABLE irrigation_events
  DROP CONSTRAINT IF EXISTS irrigation_events_alvo_tipo_check;

ALTER TABLE irrigation_events
  ADD CONSTRAINT irrigation_events_alvo_tipo_check
  CHECK (alvo_tipo IS NULL OR alvo_tipo = ANY (ARRAY['pump'::text, 'sector'::text, 'system'::text]));

COMMENT ON CONSTRAINT irrigation_events_alvo_tipo_check ON irrigation_events IS
  'alvo_tipo pode ser pump (eventos da bomba), sector (eventos de setor), system (firmware/OTA/sistema fw 0.18+), ou NULL';

COMMIT;
