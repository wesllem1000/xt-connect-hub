-- E5.18 — Suporte a timers em segundos (firmware 0.5.2-stage4-pump-auto-couple).
--
-- Firmware do IRR-V1 agora aceita 3 campos opcionais em segundos no payload de
-- timers que vai via devices/<serial>/config/push:
--
--   duracao_s     (substitui duracao_min  no tipo 'fixed')
--   on_seconds    (substitui on_minutes  em cyclic_window/cyclic_continuous)
--   off_seconds   (substitui off_minutes em cyclic_window/cyclic_continuous)
--
-- Regra do firmware: se *_seconds > 0 usa esse, senao cai em *_minutes. Com isso
-- o usuario pode criar timers granulares (pulsos de 30s on / 15s off) sem
-- quebrar timers existentes em minutos.
--
-- Migration aditiva. Colunas nullable. Limites largos (1s..86400s = 24h).
-- Nao remove nem mexe nas colunas em minutos. Compatibilidade reversa garantida.

BEGIN;

ALTER TABLE irrigation_timers
  ADD COLUMN IF NOT EXISTS duracao_s INT
    CHECK (duracao_s IS NULL OR duracao_s BETWEEN 1 AND 86400),
  ADD COLUMN IF NOT EXISTS on_seconds INT
    CHECK (on_seconds IS NULL OR on_seconds BETWEEN 1 AND 86400),
  ADD COLUMN IF NOT EXISTS off_seconds INT
    CHECK (off_seconds IS NULL OR off_seconds BETWEEN 1 AND 86400);

COMMENT ON COLUMN irrigation_timers.duracao_s IS
  'Duracao em segundos para tipo=fixed. Tem precedencia sobre duracao_min se preenchido (>0).';
COMMENT ON COLUMN irrigation_timers.on_seconds IS
  'Janela ON em segundos para cyclic_window/cyclic_continuous. Precedencia sobre on_minutes.';
COMMENT ON COLUMN irrigation_timers.off_seconds IS
  'Janela OFF em segundos para cyclic_window/cyclic_continuous. Precedencia sobre off_minutes.';

COMMIT;
