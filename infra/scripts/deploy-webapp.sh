#!/usr/bin/env bash
# deploy-webapp.sh — build + deploy do frontend pra /opt/xtconect/www
# Uso: sudo /opt/xtconect/scripts/deploy-webapp.sh

set -euo pipefail

WEBAPP_DIR="/opt/xtconect/src/webapp"
WWW_DIR="/opt/xtconect/www"
BACKUP_DIR="/opt/xtconect/backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

echo "==> Verificando diretório do webapp..."
[ -d "$WEBAPP_DIR" ] || { echo "ERRO: $WEBAPP_DIR não existe"; exit 1; }

echo "==> Fazendo backup do webroot atual..."
mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/www-$TIMESTAMP.tar.gz" -C /opt/xtconect www

echo "==> Limpando backups antigos (mantém os 5 mais recentes)..."
ls -t "$BACKUP_DIR"/www-*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f

echo "==> Rodando build (pnpm)..."
cd "$WEBAPP_DIR"
sudo -u xtadmin pnpm install --frozen-lockfile
sudo -u xtadmin pnpm run build

echo "==> Sincronizando dist/ pra $WWW_DIR..."
rsync -av --delete --exclude='.well-known' "$WEBAPP_DIR/dist/" "$WWW_DIR/"

echo "==> Ajustando permissões..."
chown -R www-data:www-data "$WWW_DIR"
find "$WWW_DIR" -type d -exec chmod 755 {} \;
find "$WWW_DIR" -type f -exec chmod 644 {} \;

echo "==> Smoke test..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://hub.xtconect.online/)
if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Deploy OK — HTTP $HTTP_CODE em https://hub.xtconect.online/"
else
  echo "⚠️ Deploy concluiu mas HTTPS retornou $HTTP_CODE — verifique Nginx"
  exit 2
fi
