#!/usr/bin/env bash
# restore-postgres.sh — restaurar um dump do xtconect
#
# Uso:
#   ./restore-postgres.sh /var/backups/xtconect/daily/xtconect-YYYY-MM-DD_HHMMSS.sql.gz
#
# ATENÇÃO: sobrescreve o DB xtconect atual. Pede confirmação interativa.
# Para restaurar em um DB alternativo (smoke test), ver infra/docs/restore.md.

set -euo pipefail

CONTAINER="xtconect-postgres-1"
DB_USER="xtconect"
DB_NAME="xtconect"

if [ -z "${1:-}" ]; then
  echo "Uso: $0 <caminho-do-backup.sql.gz>"
  echo ""
  echo "Backups disponíveis (mais recentes primeiro):"
  ls -lh /var/backups/xtconect/daily/ 2>/dev/null | tail -10 || echo "  (sem backups ainda em /var/backups/xtconect/daily/)"
  exit 1
fi

BACKUP_FILE="$1"
[ -f "$BACKUP_FILE" ] || { echo "Arquivo não existe: $BACKUP_FILE"; exit 1; }

echo "ATENÇÃO: isso vai APAGAR todos os dados atuais do DB '$DB_NAME'"
echo "e restaurar de: $BACKUP_FILE"
echo ""
echo "Digite 'sim' pra continuar:"
read -r CONFIRM
[ "$CONFIRM" = "sim" ] || { echo "abortado"; exit 1; }

echo "Restaurando..."
gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME"

echo ""
echo "Restore concluído. Verificar integridade:"
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c \
  "SELECT COUNT(*) AS devices FROM devices;
   SELECT COUNT(*) AS users FROM app_users;"
