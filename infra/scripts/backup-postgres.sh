#!/usr/bin/env bash
# backup-postgres.sh — pg_dump diário do xtconect
#
# Gera um dump compactado em /var/backups/xtconect/daily/, copiando para
# weekly/ aos domingos e monthly/ no dia 1. Rotaciona por mtime:
#   daily   → 7 dias
#   weekly  → 30 dias
#   monthly → 365 dias
#
# Agendado via cron às 03:00 diariamente. Ver infra/docs/restore.md.

set -euo pipefail

BACKUP_ROOT="/var/backups/xtconect"
DAILY_DIR="${BACKUP_ROOT}/daily"
WEEKLY_DIR="${BACKUP_ROOT}/weekly"
MONTHLY_DIR="${BACKUP_ROOT}/monthly"
LOG_FILE="${BACKUP_ROOT}/backup.log"

CONTAINER="xtconect-postgres-1"
DB_USER="xtconect"
DB_NAME="xtconect"

mkdir -p "$DAILY_DIR" "$WEEKLY_DIR" "$MONTHLY_DIR"

TS=$(date +%Y-%m-%d_%H%M%S)
DOW=$(date +%u)   # 1-7, 7=Sunday
DOM=$(date +%d)   # 01-31

DAILY_FILE="${DAILY_DIR}/xtconect-${TS}.sql.gz"

echo "[$(date -Iseconds)] starting backup -> ${DAILY_FILE}" >> "$LOG_FILE"

if ! docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists \
     | gzip > "${DAILY_FILE}.tmp"; then
  echo "[$(date -Iseconds)] FAIL pg_dump" >> "$LOG_FILE"
  rm -f "${DAILY_FILE}.tmp"
  exit 1
fi

mv "${DAILY_FILE}.tmp" "${DAILY_FILE}"
chmod 600 "${DAILY_FILE}"

SIZE=$(du -h "${DAILY_FILE}" | cut -f1)
echo "[$(date -Iseconds)] OK ${DAILY_FILE} (${SIZE})" >> "$LOG_FILE"

if [ "$DOW" = "7" ]; then
  cp "${DAILY_FILE}" "${WEEKLY_DIR}/"
  echo "[$(date -Iseconds)] weekly snapshot" >> "$LOG_FILE"
fi

if [ "$DOM" = "01" ]; then
  cp "${DAILY_FILE}" "${MONTHLY_DIR}/"
  echo "[$(date -Iseconds)] monthly snapshot" >> "$LOG_FILE"
fi

find "$DAILY_DIR"   -name "xtconect-*.sql.gz" -mtime +7   -delete
find "$WEEKLY_DIR"  -name "xtconect-*.sql.gz" -mtime +30  -delete
find "$MONTHLY_DIR" -name "xtconect-*.sql.gz" -mtime +365 -delete

echo "[$(date -Iseconds)] rotation done" >> "$LOG_FILE"
