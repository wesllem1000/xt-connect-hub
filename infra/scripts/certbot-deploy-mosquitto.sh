#!/usr/bin/env bash
# Post-renewal hook: ajusta perms dos certs pra mosquitto conseguir ler
# e recarrega o broker sem derrubar conexões (SIGHUP).
set -euo pipefail

DOMAIN="hub.xtconect.online"
LE_LIVE="/opt/xtconect/letsencrypt/live/${DOMAIN}"
LE_ARCHIVE="/opt/xtconect/letsencrypt/archive/${DOMAIN}"

# Ajusta perms no archive (alvo real dos symlinks)
if [ -d "$LE_ARCHIVE" ]; then
  chgrp 1883 "$LE_ARCHIVE"/privkey*.pem 2>/dev/null || true
  chmod 0640 "$LE_ARCHIVE"/privkey*.pem 2>/dev/null || true
  chmod 0644 "$LE_ARCHIVE"/{cert,chain,fullchain}*.pem 2>/dev/null || true
fi

# Ajusta perms no live (os symlinks em si têm perms do próprio link, mas por garantia)
if [ -d "$LE_LIVE" ]; then
  chgrp 1883 "$LE_LIVE" 2>/dev/null || true
  chmod 0755 "$LE_LIVE" 2>/dev/null || true
fi

# Restart do mosquitto: garante leitura do novo privkey/cert do disco.
# Mosquitto 2.0.x não tem hot-reload confiável de certs TLS via SIGHUP.
# Downtime ~2-3s; clientes MQTT reconectam automaticamente.
if docker ps --format '{{.Names}}' | grep -q '^xtconect-mosquitto-1$'; then
  logger -t certbot-deploy-hook "Restarting mosquitto to load renewed certs..."
  docker restart xtconect-mosquitto-1 >/dev/null 2>&1 || true
  # Aguarda o listener voltar antes de sair (health check leve)
  for i in $(seq 1 15); do
    if docker exec xtconect-mosquitto-1 nc -z 127.0.0.1 8883 2>/dev/null; then
      logger -t certbot-deploy-hook "Mosquitto back online after ${i}s"
      break
    fi
    sleep 1
  done
fi

# Reload do nginx também
if docker ps --format '{{.Names}}' | grep -q '^xtconect-nginx-1$'; then
  docker exec xtconect-nginx-1 nginx -s reload >/dev/null 2>&1 || true
fi

logger -t certbot-deploy-hook "Deploy hook executado para ${DOMAIN} em $(date -Iseconds)"
exit 0
