# Deploy — reconstruindo a stack do zero

Guia condensado para subir toda a plataforma XT Connect Hub em uma VPS nova.

## Pré-requisitos

- Ubuntu 22.04+ (ou Debian 12+) com 2 vCPU / 4GB RAM mínimo
- Docker Engine + plugin `docker compose`
- Domínio público apontando pro IP da VPS (ex: `hub.xtconect.online`)
- Portas abertas: 80 (HTTP), 443 (HTTPS), 8883 (MQTT TLS), 8884 (MQTT WSS)

## Passo 1 — Clonar o repo

```bash
sudo mkdir -p /opt/xtconect/src
sudo chown $USER:$USER /opt/xtconect/src
cd /opt/xtconect/src
git clone git@github.com:wesllem1000/xt-connect-hub.git webapp
cd webapp
git checkout xtconect-v2
```

## Passo 2 — Secrets

```bash
cp infra/env/secrets.env.example infra/env/secrets.env
${EDITOR:-nano} infra/env/secrets.env
# preencher todos os <<REDACTED>> usando os geradores sugeridos no topo do arquivo
```

Além do `secrets.env`, criar arquivos separados para passwords montadas como secrets do Docker:

```bash
mkdir -p infra/env
echo -n "<senha_smtp>"               > infra/env/smtp-password
echo -n "<senha_mqtt_ingest>"        > infra/env/mqtt-ingest-password
echo -n "<senha_mqtt_webapp_ro>"     > infra/env/mqtt-webapp-readonly-password
chmod 600 infra/env/*-password
```

## Passo 3 — Certificados TLS (Let's Encrypt)

```bash
sudo apt install certbot -y
sudo certbot certonly --standalone -d hub.xtconect.online -m <email> --agree-tos
# Os certs vão pra /etc/letsencrypt/live/hub.xtconect.online/
sudo cp /etc/letsencrypt/live/hub.xtconect.online/fullchain.pem infra/mosquitto/certs/
sudo cp /etc/letsencrypt/live/hub.xtconect.online/privkey.pem  infra/mosquitto/certs/
sudo chown 1883:1883 infra/mosquitto/certs/*.pem
```

O script `infra/scripts/certbot-deploy-mosquitto.sh` é chamado pelo certbot no renew e copia os novos certs pra pasta do Mosquitto + reload.

## Passo 4 — Subir a stack

```bash
docker compose -f infra/compose/docker-compose.yml up -d
docker compose -f infra/compose/docker-compose.yml ps
```

Aguardar até postgres ficar `healthy`. Então aplicar migrations:

```bash
for f in infra/migrations/*.sql; do
  echo ">> $f"
  docker exec -i xtconect-postgres-1 psql -U xtconect -d xtconect < "$f"
done
```

## Passo 5 — Bootstrap do Mosquitto (dynsec)

Criar usuários e ACLs no dynamic-security do Mosquitto. Usar os scripts existentes em `/opt/xtconect/scripts/dynsec_*` (se aplicável) ou configurar via `mosquitto_ctrl`.

## Passo 6 — Bootstrap do Node-RED (flows)

```bash
# Com Node-RED já rodando, injetar flows via API
curl -u admin:$NODERED_ADMIN_PASSWORD \
  -X POST http://localhost:1880/flows \
  -H "Content-Type: application/json" \
  --data @infra/nodered/flows.json
```

Ou rodar os scripts `_e*_inject_flows.js` na ordem E2.0 → E2.1 → E2.2 → E2.2.1 → E2.3.

## Passo 7 — Verificar

- `curl https://hub.xtconect.online/api/health` → 200
- Login em `https://hub.xtconect.online/` com `WEBAPP_ADMIN_PASSWORD`
- MQTT: conectar um ESP-test ao broker, ver reading chegando no webapp

## Passo 8 — Backups

Ver [`restore.md`](restore.md) para detalhes. Cron do backup fica em `crontab -l` do root:

```
0 3 * * * /opt/xtconect/scripts/backup-postgres.sh
```

## Atualizações subsequentes

```bash
cd /opt/xtconect/src/webapp
git pull origin xtconect-v2
# webapp frontend
pnpm install && pnpm build && ./infra/scripts/deploy-webapp.sh
# migrations novas
for f in infra/migrations/*.sql; do docker exec -i xtconect-postgres-1 psql -U xtconect -d xtconect < "$f"; done
# compose/config
docker compose -f infra/compose/docker-compose.yml up -d
```
