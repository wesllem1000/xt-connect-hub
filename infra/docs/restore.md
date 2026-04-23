# Restore de backup Postgres

## Backups disponíveis

Local: `/var/backups/xtconect/`

| Pasta       | Retenção          | O que é                                    |
|-------------|-------------------|--------------------------------------------|
| `daily/`    | últimos 7 dias    | pg_dump diário às 03:00 (via cron)         |
| `weekly/`   | últimas ~4 semanas | cópia do dump de domingo                   |
| `monthly/`  | últimos ~12 meses | cópia do dump do dia 1 de cada mês         |

Log das execuções: `/var/backups/xtconect/backup.log`.

Cada backup é um `pg_dump --clean --if-exists` comprimido com gzip, gerando
arquivos no formato `xtconect-YYYY-MM-DD_HHMMSS.sql.gz`.

## Restore completo (sobrescreve o DB atual)

```bash
sudo /opt/xtconect/scripts/backup-postgres.sh   # opcional: tirar um backup manual antes
sudo /opt/xtconect/scripts/restore-postgres.sh \
     /var/backups/xtconect/daily/xtconect-YYYY-MM-DD_HHMMSS.sql.gz
```

Digite `sim` quando solicitado. O script imprime COUNT de `devices` e `app_users`
ao final — confirme que está compatível com o esperado.

## Restore em DB alternativo (smoke test / recuperação parcial)

Útil pra validar um backup ou extrair dados específicos sem tocar na produção.

```bash
# 1. Criar DB temporário
docker exec xtconect-postgres-1 psql -U xtconect -d postgres \
  -c "CREATE DATABASE xtconect_restore_test;"

# 2. Restaurar nele
LATEST=$(ls -t /var/backups/xtconect/daily/*.sql.gz | head -1)
gunzip -c "$LATEST" | docker exec -i xtconect-postgres-1 psql -U xtconect -d xtconect_restore_test

# 3. Validar
docker exec xtconect-postgres-1 psql -U xtconect -d xtconect_restore_test -c "\dt"
docker exec xtconect-postgres-1 psql -U xtconect -d xtconect_restore_test -c \
  "SELECT COUNT(*) FROM devices; SELECT COUNT(*) FROM app_users; SELECT COUNT(*) FROM device_readings;"

# 4. Quando terminar, limpar
docker exec xtconect-postgres-1 psql -U xtconect -d postgres \
  -c "DROP DATABASE xtconect_restore_test;"
```

## Restore de uma tabela específica

```bash
gunzip -c /var/backups/xtconect/daily/xtconect-YYYY-MM-DD_HHMMSS.sql.gz \
  | awk '/^COPY public\.devices/,/^\\\.$/' \
  | docker exec -i xtconect-postgres-1 psql -U xtconect -d xtconect
```

Substitua `devices` pelo nome da tabela desejada. Atenção a constraints de
integridade referencial — pode ser necessário desabilitar triggers antes.

## Verificação pós-restore

- [ ] Login funciona na webapp
- [ ] `/dispositivos` lista os devices esperados
- [ ] Page de detalhe de um device carrega histórico
- [ ] Node-RED ainda consegue escrever (postar um reading via ESP-test)

## Cenário: VPS totalmente nova

1. Reconstruir a stack do zero seguindo [`deploy.md`](deploy.md)
2. Copiar o backup mais recente da VPS antiga para a nova:
   ```bash
   scp old-vps:/var/backups/xtconect/daily/xtconect-YYYY-MM-DD_HHMMSS.sql.gz \
       new-vps:/tmp/
   ```
3. Rodar `restore-postgres.sh /tmp/xtconect-YYYY-MM-DD_HHMMSS.sql.gz`
4. Reiniciar Node-RED e webapp: `docker compose -f infra/compose/docker-compose.yml restart nodered webapp`

## Troubleshooting

**`backup-postgres.sh` falhou:**
`cat /var/backups/xtconect/backup.log | tail -20` — erro mais comum é o container
postgres não estar rodando ou não atender como `xtconect-postgres-1`.

**Backup está muito grande ou lento:**
Considerar mudar de `pg_dump` plain para `pg_dump -Fc` (custom format,
compactação interna, restore seletivo com `pg_restore`). Exige atualizar também
o `restore-postgres.sh`.
