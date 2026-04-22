-- E3.1 — Gestão de Frota (produtos) + Claim Flow
--
-- Pressupostos:
--  • TRUNCATE TABLE devices RESTART IDENTITY CASCADE foi executado antes
--    desta migration (fluxo destrutivo autorizado no prompt E3.1).
--  • modelos_dispositivo é preservada (1 linha legada + novas colunas).
--
-- O que esta migration faz:
--  1) devices:
--     - status passa do enum {active,inactive,maintenance} pro novo
--       {ocioso,associado,defeito,retornado}
--     - user_id (owner) vira NULLABLE
--     - mqtt_password_hash vira NULLABLE (dynsec guarda o hash; column legacy)
--     - colunas novas: claim_token, pairing_code, sequencial,
--       provisionado_em, claimed_em
--  2) modelos_dispositivo:
--     - colunas novas: prefixo (3 letras), major_version (V\d+),
--       rate_default_segundos
--     - UNIQUE(prefixo, major_version) pra permitir seed/auto-provisioning
--  3) dispositivos_visiveis:
--     - WHERE d.status='associado' (evita vazar ociosos pra cliente)

-- ================================================================
-- 1) devices: ampliação de schema
-- ================================================================

-- 1.1 status: novo vocabulário
ALTER TABLE devices
  DROP CONSTRAINT IF EXISTS devices_status_check;

ALTER TABLE devices
  ALTER COLUMN status SET DEFAULT 'ocioso';

ALTER TABLE devices
  ADD CONSTRAINT devices_status_check
    CHECK (status IN ('ocioso', 'associado', 'defeito', 'retornado'));

-- 1.2 owner nullable (produto ocioso não tem dono)
ALTER TABLE devices
  ALTER COLUMN user_id DROP NOT NULL;

-- 1.3 mqtt_password_hash nullable (dynsec guarda a credencial real)
ALTER TABLE devices
  ALTER COLUMN mqtt_password_hash DROP NOT NULL;

-- 1.4 colunas novas do fluxo de claim
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS claim_token      TEXT,
  ADD COLUMN IF NOT EXISTS pairing_code     TEXT,
  ADD COLUMN IF NOT EXISTS sequencial       INTEGER,
  ADD COLUMN IF NOT EXISTS provisionado_em  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_em       TIMESTAMPTZ;

-- 1.5 invariantes de estado
ALTER TABLE devices
  DROP CONSTRAINT IF EXISTS devices_claim_state_check;

ALTER TABLE devices
  ADD CONSTRAINT devices_claim_state_check CHECK (
    CASE status
      WHEN 'ocioso' THEN
        user_id IS NULL
        AND claimed_em IS NULL
        AND claim_token IS NOT NULL
        AND pairing_code IS NOT NULL
      WHEN 'associado' THEN
        user_id IS NOT NULL
        AND claimed_em IS NOT NULL
        AND claim_token IS NULL
        AND pairing_code IS NULL
      ELSE TRUE
    END
  );

-- 1.6 indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_claim_token
  ON devices(claim_token)
  WHERE claim_token IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_pairing_code
  ON devices(pairing_code)
  WHERE pairing_code IS NOT NULL;

-- ================================================================
-- 2) modelos_dispositivo: extensão
-- ================================================================

ALTER TABLE modelos_dispositivo
  ADD COLUMN IF NOT EXISTS prefixo                TEXT,
  ADD COLUMN IF NOT EXISTS major_version          TEXT,
  ADD COLUMN IF NOT EXISTS rate_default_segundos  INTEGER NOT NULL DEFAULT 30;

-- Limpa linha legada (preservada mas sem prefixo/major_version — não dá
-- pra provisionar em cima dela sem backfill manual do admin).
COMMENT ON COLUMN modelos_dispositivo.prefixo IS
  'Prefixo de 3 letras maiúsculas do serial (ex: IRR, INT, OFG). E3.1';
COMMENT ON COLUMN modelos_dispositivo.major_version IS
  'Major version do firmware (ex: V1, V2). E3.1';

ALTER TABLE modelos_dispositivo
  DROP CONSTRAINT IF EXISTS modelos_dispositivo_prefixo_check;
ALTER TABLE modelos_dispositivo
  ADD CONSTRAINT modelos_dispositivo_prefixo_check
    CHECK (prefixo IS NULL OR prefixo ~ '^[A-Z]{3}$');

ALTER TABLE modelos_dispositivo
  DROP CONSTRAINT IF EXISTS modelos_dispositivo_major_version_check;
ALTER TABLE modelos_dispositivo
  ADD CONSTRAINT modelos_dispositivo_major_version_check
    CHECK (major_version IS NULL OR major_version ~ '^V[0-9]+$');

CREATE UNIQUE INDEX IF NOT EXISTS uq_modelos_dispositivo_prefixo_major
  ON modelos_dispositivo(prefixo, major_version)
  WHERE prefixo IS NOT NULL AND major_version IS NOT NULL;

-- ================================================================
-- 3) devices: UNIQUE(modelo_id, sequencial) apenas quando ambos set
-- ================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_modelo_sequencial
  ON devices(modelo_id, sequencial)
  WHERE modelo_id IS NOT NULL AND sequencial IS NOT NULL;

-- ================================================================
-- 4) View dispositivos_visiveis: só devices 'associado'
-- ================================================================
DROP VIEW IF EXISTS dispositivos_visiveis;
CREATE VIEW dispositivos_visiveis AS
  -- Próprios devices (só associados)
  SELECT
    d.id,
    d.user_id            AS owner_id,
    d.user_id            AS viewer_id,
    'owner'::text        AS access_type,
    'controle'::permissao_compartilhamento AS permissao,
    NULL::uuid           AS share_id,
    d.device_id, d.name, d.nome_amigavel, d.modelo_id,
    d.is_online, d.last_seen, d.last_reading, d.last_reading_at,
    d.telemetry_interval_s, d.burst_rate_s,
    d.status, d.created_at
  FROM devices d
  WHERE d.status = 'associado' AND d.user_id IS NOT NULL
  UNION ALL
  -- Compartilhados ativos (device precisa estar associado)
  SELECT
    d.id,
    d.user_id            AS owner_id,
    s.com_usuario_id     AS viewer_id,
    'shared'::text       AS access_type,
    s.permissao,
    s.id                 AS share_id,
    d.device_id, d.name, d.nome_amigavel, d.modelo_id,
    d.is_online, d.last_seen, d.last_reading, d.last_reading_at,
    d.telemetry_interval_s, d.burst_rate_s,
    d.status, d.created_at
  FROM dispositivo_compartilhado s
  JOIN devices d ON d.id = s.dispositivo_id
  WHERE d.status = 'associado'
    AND s.status = 'ativo'
    AND s.com_usuario_id IS NOT NULL;

COMMENT ON VIEW dispositivos_visiveis IS
  'E3.1 — só devices com status=associado aparecem; ociosos não vazam pro cliente. Filtrar por viewer_id.';
