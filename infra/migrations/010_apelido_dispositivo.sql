-- E3.5 — Apelido humano opcional pra dispositivos (refs #65)
--
-- Novo campo local ao owner. NULL = UI usa serial como display.
-- 80 chars é um limite razoável pra caber em cards/listas sem quebrar layout.

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS apelido TEXT;

ALTER TABLE devices
  DROP CONSTRAINT IF EXISTS devices_apelido_length_check;
ALTER TABLE devices
  ADD CONSTRAINT devices_apelido_length_check
    CHECK (apelido IS NULL OR (char_length(apelido) BETWEEN 1 AND 80));

COMMENT ON COLUMN devices.apelido IS
  'E3.5 — Nome amigável definido pelo owner. NULL = UI mostra serial.';

-- View dispositivos_visiveis: expõe apelido pro frontend.
DROP VIEW IF EXISTS dispositivos_visiveis;
CREATE VIEW dispositivos_visiveis AS
  SELECT
    d.id,
    d.user_id            AS owner_id,
    d.user_id            AS viewer_id,
    'owner'::text        AS access_type,
    'controle'::permissao_compartilhamento AS permissao,
    NULL::uuid           AS share_id,
    d.device_id, d.name, d.nome_amigavel, d.apelido, d.modelo_id,
    d.is_online, d.last_seen, d.last_reading, d.last_reading_at,
    d.telemetry_interval_s, d.burst_rate_s,
    d.status, d.created_at
  FROM devices d
  WHERE d.status = 'associado' AND d.user_id IS NOT NULL
  UNION ALL
  SELECT
    d.id,
    d.user_id            AS owner_id,
    s.com_usuario_id     AS viewer_id,
    'shared'::text       AS access_type,
    s.permissao,
    s.id                 AS share_id,
    d.device_id, d.name, d.nome_amigavel, d.apelido, d.modelo_id,
    d.is_online, d.last_seen, d.last_reading, d.last_reading_at,
    d.telemetry_interval_s, d.burst_rate_s,
    d.status, d.created_at
  FROM dispositivo_compartilhado s
  JOIN devices d ON d.id = s.dispositivo_id
  WHERE d.status = 'associado'
    AND s.status = 'ativo'
    AND s.com_usuario_id IS NOT NULL;

COMMENT ON VIEW dispositivos_visiveis IS
  'E3.5 — devices associados visíveis pro user (owner + shares ativos), agora com apelido.';
