# XT Connect Hub — Infra

Configuração de deployment para o servidor (reside em `/opt/xtconect/` no VPS, versionado aqui).

## Layout

| Pasta            | Conteúdo                                                                 |
|------------------|--------------------------------------------------------------------------|
| `compose/`       | `docker-compose.yml` da stack (postgres, influx, grafana, node-red, mosquitto, webapp, nginx) |
| `mosquitto/`     | `mosquitto.conf` + `certs/` (certs TLS não versionados)                  |
| `nodered/`       | `flows.json` exportado do Node-RED                                       |
| `nginx/`         | `nginx.conf` + `conf.d/default.conf` (proxy reverso p/ webapp e MQTT/WSS) |
| `migrations/`    | SQL do Postgres (001..007), aplicar em ordem                             |
| `scripts/`       | Scripts de deploy, injeção de flows, certbot, backup/restore             |
| `env/`           | `secrets.env.example` (template — arquivo real `secrets.env` não versionado) |
| `docs/`          | `deploy.md`, `restore.md`, `debts.md`, `plano-E2.md`                     |

## Setup inicial (máquina nova)

1. Clonar o repo no VPS em `/opt/xtconect/src/webapp/`
2. Copiar `infra/env/secrets.env.example` → `infra/env/secrets.env` e preencher valores reais
3. Gerar certs TLS do Let's Encrypt e colocar em `infra/mosquitto/certs/`
4. `docker compose -f infra/compose/docker-compose.yml up -d`
5. Aplicar migrations:
   ```bash
   for f in infra/migrations/*.sql; do
     docker exec -i xtconect-postgres-1 psql -U xtconect -d xtconect < "$f"
   done
   ```
6. Rodar scripts de config inicial (node-red flows via `scripts/_e*_inject_flows.js`, dynsec do Mosquitto, etc.)

Ver [`docs/deploy.md`](docs/deploy.md) para passo-a-passo completo.

## Restore de backup

Ver [`docs/restore.md`](docs/restore.md).

## Dev workflow

- **Alterações em flows do Node-RED:** editar no Node-RED UI, depois exportar o `flows.json` atualizado e commitar.
- **Alterações em compose/migrations/scripts:** editar direto, commit, push. No VPS: `git pull` e reaplicar (compose restart / psql).
- **Alterações em secrets:** editar `secrets.env` localmente no VPS (nunca no repo). Adicionar a nova chave no `secrets.env.example` com `<<REDACTED>>`.

## Débitos pendentes

Ver [`docs/debts.md`](docs/debts.md).
