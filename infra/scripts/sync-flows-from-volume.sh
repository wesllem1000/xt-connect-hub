#!/usr/bin/env bash
# sync-flows-from-volume.sh — One-way sync: volume Node-RED → repo.
#
# Por que existe:
#   O flows.json em produção (volume `/opt/xtconect/nodered/data/flows.json`)
#   é a fonte da verdade. Injetores idempotentes em infra/scripts/ (E052-E055)
#   modificam direto o volume, então o repo fica defasado.
#   Esse script puxa o volume pro repo pra evidenciar mudanças no git.
#
# IMPORTANTE: One-way. Nunca o oposto. Editar no volume, sincronizar pra cá.
#   Se você precisa "testar" um flow no repo antes de subir, edite o volume
#   numa sessão de teste e sincronize só quando confirmar.
#
# Uso:
#   bash infra/scripts/sync-flows-from-volume.sh           # mostra diff stat
#   bash infra/scripts/sync-flows-from-volume.sh --commit  # já cria commit

set -euo pipefail

REPO_FLOWS="$(cd "$(dirname "$0")/../nodered" && pwd)/flows.json"
VOLUME_FLOWS="/opt/xtconect/nodered/data/flows.json"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$REPO_FLOWS.bak-pre-sync-$TIMESTAMP"

if [[ ! -r "$VOLUME_FLOWS" ]]; then
  echo "ERRO: volume não acessível em $VOLUME_FLOWS" >&2
  exit 1
fi

if cmp -s "$VOLUME_FLOWS" "$REPO_FLOWS"; then
  echo "Sem diferença — repo já está sincronizado com o volume."
  exit 0
fi

cp "$REPO_FLOWS" "$BACKUP"
cp "$VOLUME_FLOWS" "$REPO_FLOWS"

VOLUME_NODES="$(jq '. | length' "$VOLUME_FLOWS")"
REPO_NODES_PREV="$(jq '. | length' "$BACKUP")"

echo "Backup: $BACKUP"
echo "Nodes anterior (repo): $REPO_NODES_PREV"
echo "Nodes novo    (volume): $VOLUME_NODES"
echo ""
echo "Diff stat:"
git -C "$(dirname "$REPO_FLOWS")/../.." diff --stat -- "infra/nodered/flows.json" || true

if [[ "${1:-}" == "--commit" ]]; then
  git -C "$(dirname "$REPO_FLOWS")/../.." add "infra/nodered/flows.json"
  git -C "$(dirname "$REPO_FLOWS")/../.." commit -m "chore(nodered): sync flows.json do volume ($TIMESTAMP)"
  echo "Commit criado."
fi
