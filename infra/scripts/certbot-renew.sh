#!/usr/bin/env bash
# Wrapper: executa certbot renew em container one-shot e dispara o deploy-hook
# no host somente quando algum certificado foi efetivamente renovado.
set -euo pipefail

FLAG=/opt/xtconect/letsencrypt/.renewed
HOOK=/opt/xtconect/scripts/certbot-deploy-mosquitto.sh

rm -f "$FLAG"

docker run --rm \
  -v /opt/xtconect/letsencrypt:/etc/letsencrypt \
  -v /opt/xtconect/letsencrypt/www:/var/www/certbot \
  certbot/certbot renew \
    --webroot -w /var/www/certbot \
    --deploy-hook "touch /etc/letsencrypt/.renewed" \
    --quiet

if [ -f "$FLAG" ]; then
  logger -t certbot-renew "cert renovado, disparando deploy-hook"
  "$HOOK"
  rm -f "$FLAG"
else
  logger -t certbot-renew "nenhum cert a renovar"
fi
