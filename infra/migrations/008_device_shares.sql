-- E2.4 — Compartilhamento user-to-user de dispositivos
--
-- Estende dispositivo_compartilhado (criada vazia em 003) com:
--  • email_convidado (citext) → suporta convite pra email sem conta ainda
--  • status (pendente|ativo|revogado) → fluxo de aceite + auditoria
--  • token_convite → link de aceite enviado por email
--  • aceito_em / revogado_em → timestamps de auditoria
-- Permissão usa o enum existente permissao_compartilhamento{leitura,controle},
-- que mapeia 1:1 para viewer/operator do design (E2.4).

CREATE EXTENSION IF NOT EXISTS citext;

-- 1. Tornar com_usuario_id nullable: convites pendentes não têm user ainda
ALTER TABLE dispositivo_compartilhado
  ALTER COLUMN com_usuario_id DROP NOT NULL;

-- 2. Novas colunas
ALTER TABLE dispositivo_compartilhado
  ADD COLUMN IF NOT EXISTS email_convidado CITEXT,
  ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('pendente','ativo','revogado')),
  ADD COLUMN IF NOT EXISTS token_convite   TEXT,
  ADD COLUMN IF NOT EXISTS aceito_em       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revogado_em     TIMESTAMPTZ;

-- email_convidado obrigatório a partir de agora (tabela está vazia, ok)
UPDATE dispositivo_compartilhado SET email_convidado = '' WHERE email_convidado IS NULL;
ALTER TABLE dispositivo_compartilhado
  ALTER COLUMN email_convidado SET NOT NULL;

-- 3. Trocar a UNIQUE antiga por índices parciais que permitem re-convite
--    após revogação mas bloqueiam dois convites ativos pro mesmo email/device.
ALTER TABLE dispositivo_compartilhado
  DROP CONSTRAINT IF EXISTS dispositivo_compartilhado_dispositivo_id_com_usuario_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_compart_email_ativo
  ON dispositivo_compartilhado (dispositivo_id, email_convidado)
  WHERE status <> 'revogado';

CREATE UNIQUE INDEX IF NOT EXISTS uq_compart_token
  ON dispositivo_compartilhado (token_convite)
  WHERE token_convite IS NOT NULL;

-- 4. Índices de lookup
CREATE INDEX IF NOT EXISTS ix_compart_email_pend
  ON dispositivo_compartilhado (email_convidado)
  WHERE status = 'pendente';

CREATE INDEX IF NOT EXISTS ix_compart_user_ativo
  ON dispositivo_compartilhado (com_usuario_id)
  WHERE status = 'ativo';

CREATE INDEX IF NOT EXISTS ix_compart_dispositivo_ativo
  ON dispositivo_compartilhado (dispositivo_id)
  WHERE status <> 'revogado';

COMMENT ON TABLE  dispositivo_compartilhado IS
  'Compartilhamentos user-to-user. status: pendente (email sem conta), ativo, revogado. Owner = devices.user_id.';
COMMENT ON COLUMN dispositivo_compartilhado.permissao IS
  'leitura = viewer (só visualiza); controle = operator (visualiza + manda comandos)';

-- 5. View: todos os dispositivos visíveis pra um usuário, com origem (owner|shared)
--    e permissão efetiva. Owner sempre tem permissão "controle" (operator).
DROP VIEW IF EXISTS dispositivos_visiveis;
CREATE VIEW dispositivos_visiveis AS
  -- Próprios devices
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
  UNION ALL
  -- Compartilhados ativos
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
  WHERE s.status = 'ativo' AND s.com_usuario_id IS NOT NULL;

COMMENT ON VIEW dispositivos_visiveis IS
  'Lookup unificado: dispositivos próprios + compartilhamentos ativos. Filtrar por viewer_id.';
