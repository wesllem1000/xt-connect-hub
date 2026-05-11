-- Migration 029 — firmware_releases
-- Date: 2026-05-11
-- Purpose: Tabela de releases de firmware servidas pra OTA remoto via cmd: ota_pull.
--          Pipeline drop-in: Wesllem coloca .bin em ~xtadmin/teste winscp/firmware-uploads/<hw_target>/<version>.bin,
--          scanner do Node-RED (Migration aplica + Node-RED faz INSERT idempotente) reconcilia
--          com a pasta servida pelo nginx em /opt/xtconect/www/firmware/<hw_target>/<version>.bin
--          → URL pública https://hub.xtconect.online/firmware/<hw_target>/<version>.bin
--
-- Schema combinado com Sebastião (Entrada #6 + Entrada #7):
-- - status default 'published' (drop-in não tem etapa de revisão; arquivo na pasta = publicado)
-- - status 'invalid' permitido pra arquivos que falharam validação de magic byte
-- - uploaded_by nullable (scanner não tem usuário associado)
-- - sha256 lowercase obrigatório (driver Node calcula sempre lower-hex)

BEGIN;

CREATE TABLE IF NOT EXISTS firmware_releases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version         VARCHAR(64) NOT NULL,
  hw_target       VARCHAR(32) NOT NULL,
  url             TEXT NOT NULL,
  sha256          CHAR(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes      INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 4194304),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by     UUID REFERENCES app_users(id) ON DELETE SET NULL,
  release_notes   TEXT,
  status          VARCHAR(16) NOT NULL DEFAULT 'published'
                  CHECK (status IN ('published','deprecated','invalid')),
  CONSTRAINT firmware_releases_hw_version_unique UNIQUE (hw_target, version)
);

CREATE INDEX IF NOT EXISTS idx_firmware_releases_hw_status_version
  ON firmware_releases (hw_target, status, version DESC);

CREATE INDEX IF NOT EXISTS idx_firmware_releases_sha256
  ON firmware_releases (sha256);

COMMENT ON TABLE firmware_releases IS
  'Releases de firmware servidas em /firmware/<hw_target>/<version>.bin via nginx do hub. Origem dos params do cmd: ota_pull.';
COMMENT ON COLUMN firmware_releases.hw_target IS
  'lower(prefixo || ''-'' || major_version) do modelos_dispositivo. Ex: irr-v1, int-v2.';
COMMENT ON COLUMN firmware_releases.url IS
  'URL HTTPS pública pro ESP baixar. Convenção: https://hub.xtconect.online/firmware/<hw_target>/<version>.bin';
COMMENT ON COLUMN firmware_releases.sha256 IS
  'SHA-256 lowercase do .bin. Validação obrigatória client (firmware) + server (scanner).';
COMMENT ON COLUMN firmware_releases.status IS
  'published = visível na aba Atualizar; deprecated = histórico/arquivo removido; invalid = magic byte falhou.';

-- Bootstrap: registrar 0.18.0 (.bin já no ar em /opt/xtconect/www/firmware/irr-v1/0.18.0.bin)
-- Idempotente: ON CONFLICT pra rerodada
INSERT INTO firmware_releases (version, hw_target, url, sha256, size_bytes, release_notes, status)
VALUES (
  '0.18.0',
  'irr-v1',
  'https://hub.xtconect.online/firmware/irr-v1/0.18.0.bin',
  '2fa14be51f61b82a247908537ae048d96976ab574c0650c050f40b9aef472501',
  1199584,
  E'# IRR-V1 Firmware 0.18.0\n\n**Data:** 2026-05-11\n**Hardware target:** irr-v1 (ESP32 DOIT V1, 8 setores)\n\n## Destaque\n\n🎯 **OTA remoto via MQTT.** Primeiro release com `cmd: ota_pull`. A partir desta versão, dispositivos podem ser atualizados remotamente pelo painel XT Connect Hub sem necessidade de acesso físico ou rede local.\n\n## Novidades\n\n### Comando MQTT novo\n- **`cmd: ota_pull`** com params `{url, sha256, target_version, size_bytes}`. Baixa firmware HTTPS, valida SHA-256 incremental, grava em partição OTA dual com rotação automática.\n\n### Eventos novos / atualizados\n- **`firmware_update_progress`** (NOVO) emitido a cada 5% ou 5s durante o download.\n- **`firmware_update_succeeded`** ganhou campo `target_version` explícito.\n- **`firmware_update_failed`** payload padronizado.\n\n### Validações pré-OTA\n12 reasons `refused/*` ACK: `missing_url`, `url_not_https`, `invalid_sha256_format`, `missing_target_version`, `size_too_small`, `size_too_large`, `version_already_current`, `ota_in_progress`, `pump_on`, `sector_open`, `alarm_active`, `task_spawn_fail`.\n\n## Pré-requisitos pro ESP aceitar `cmd: ota_pull`\n\n1. Bomba desligada\n2. Nenhum setor aberto\n3. Alarme de temperatura desativado\n4. Versão alvo diferente da atual\n5. Wi-Fi STA conectado\n\n## Como atualizar pra 0.18.0\n\n**Devices em 0.17.x:** primeira atualização tem que ser via Web Updater LAN ou cabo USB. A partir de 0.18.0 em diante, todas as próximas viram OTA remoto.\n\n## Compatibilidade\n\n- ✅ Retrocompat com VPS rodando v0.17.x\n- ✅ Sem mudanças breaking\n- ✅ Mantém campos legacy\n\n## Roadmap próximo\n\n- **0.18.1** — flag `gSectorPowerPctOverride[]` + `payload.motivo`\n- **0.18.2** — threshold brownout VFD + `vfd_brownout_cleared`\n- **0.19** — rollback automático completo via bootloader',
  'published'
)
ON CONFLICT (hw_target, version) DO NOTHING;

COMMIT;
