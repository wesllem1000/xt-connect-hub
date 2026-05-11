# infra/nodered/

## flows.json — espelho one-way do volume de produção

**Fonte da verdade:** `/opt/xtconect/nodered/data/flows.json` (volume Docker do Node-RED em produção).

Este `flows.json` no repo é apenas um **espelho one-way** do volume. Ele existe pra:

1. Tornar mudanças no Node-RED visíveis no histórico git.
2. Servir de seed pra reprovisionar Node-RED em ambiente novo.
3. Permitir code review de flows mesmo que a edição em si rode no Node-RED Editor.

### Quem altera o quê

| Quem | Onde edita | Quando |
|------|------------|--------|
| Injetores idempotentes (`infra/scripts/_e0*_*.cjs`) | Volume direto | Em deploy de feature |
| Você no Node-RED Editor (https://hub.xtconect.online/red/) | Volume direto | Hotfix / experimentação |
| Esse repo (`infra/nodered/flows.json`) | **Apenas via sync script** | Após estabilizar mudanças no volume |

**Nunca edite `infra/nodered/flows.json` à mão pra subir mudança em produção.** Vai dar conflito ao próximo sync.

### Sincronizar

```bash
# preview (mostra diff stat)
bash infra/scripts/sync-flows-from-volume.sh

# já cria commit
bash infra/scripts/sync-flows-from-volume.sh --commit
```

O script:
- Faz backup do flows.json do repo (`.bak-pre-sync-<timestamp>`)
- Copia volume → repo
- Mostra `git diff --stat` da mudança

### Backups

Backups históricos do volume vivem em `/opt/xtconect/nodered/data/flows.json.bak-*`. Backups do repo (criados pelo script) ficam ao lado do `flows.json`, ignorados via `.gitignore`.
