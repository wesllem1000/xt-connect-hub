# Plano E2 — Ingestão MQTT + Multi-tenancy + Scaffold OTA

> **Projeto:** XT Connect Hub (xtconect)
> **Contexto:** Continuação do trabalho em `/opt/xtconect` no VPS (branch `xtconect-v2`). E1 (dynsec + credenciais MQTT) fechou com sucesso. Agora vamos transformar a plataforma em multi-tenant, implementar ingestão MQTT→banco, tempo real na UI, burst mode, compartilhamento user-to-user e scaffold de OTA.
> **Quem executa:** VPS Claude Code (rodando na própria VPS).
> **Quem aprova decisões de design:** o usuário (wesllem). Este plano já tem todas as decisões arquiteturais fechadas — se algo ficar ambíguo na execução, **pergunta antes de inventar**.

---

## Decisões arquiteturais já fechadas

### Multi-tenancy
- Existe **duas roles**: `admin` (equipe XT) e `cliente` (usuário final).
- Cada `device` pertence a **um** `owner` (user com role=cliente).
- Admin vê todos os clientes + devices. Cliente vê só os devices que é dono OU que foi compartilhado com ele.
- Signup self-service **e** admin cria cliente, ambos disponíveis.

### Acesso técnico XT (consentimento LGPD)
- Coluna `admin_access_level` em `devices` com 3 valores: `none`, `maintenance`, `full`.
- **Default: `maintenance`** no cadastro (checkbox pré-marcado com texto explícito de consentimento).
- Cliente pode alterar a qualquer momento em "Configurações do dispositivo" → "Acesso técnico".
- **Modo manutenção** permite: ver status online/offline, ver firmware version, alterar taxa de telemetria, mudar broker, reiniciar dispositivo.
- **Modo completo** inclui manutenção + dados em tempo real + histórico + OTA + configs de domínio.

### Compartilhamento user-to-user
- Owner pode compartilhar com outros users com 3 roles: `viewer` (só ver) / `operator` (ver + comandos) / `admin` (ver + comandos + configurar + compartilhar).
- Duas formas: **por e-mail** (se user já existe na plataforma) e **por código temporário** (expira em 24h, útil pra quem ainda não tem conta).
- Owner pode revogar a qualquer momento.

### Comunicação dispositivo ↔ servidor
- **Payload** segue envelope JSON fixo:
```json
  {
    "ts": 1745155200,
    "readings": { "temp": 25.3, "umid": 60 }
  }
```
  `ts` é unix timestamp em segundos (do dispositivo). `readings` é dict flat chave→número.
- **Tópicos MQTT** (convenção existente, manter):
  - `devices/<serial>/data` — device publica telemetria
  - `devices/<serial>/status` — device publica online/offline/lwt
  - `devices/<serial>/commands` — servidor publica comandos pro device
  - `devices/<serial>/ota/offer` — servidor publica ofertas de update (scaffold só)
  - `devices/<serial>/ota/status` — device publica status de update (scaffold só)
- **Taxa padrão** configurável por dispositivo. Cliente pode pedir "tempo real" que libera burst temporário.

### Armazenamento
- **Postgres**: última leitura em `devices.last_reading` (jsonb) + histórico recente em `device_readings` (últimos 30 dias, rotate depois).
- **InfluxDB**: série temporal completa pra Grafana.

### SMTP (e-mails transacionais)
- Servidor: `smtp.hostinger.com` porta `465` SSL.
- Usuário: `conect@xtautomatize.com.br`.
- Senha: lê de `/opt/xtconect/env/smtp-password` (arquivo a ser criado pelo usuário manualmente antes do E2.1).
- Domínio de envio: `xtautomatize.com.br` por ora (plano é migrar pra `noreply@xtconect.online` depois — variável de ambiente `MAIL_FROM` permite swap sem mexer em código).
- Validar SPF/DKIM do domínio xtautomatize.com.br com `dig TXT xtautomatize.com.br` antes do primeiro envio. Se faltar, reportar ao usuário os registros DNS a adicionar.

### Versionamento de firmware
- SemVer clássico `MAJOR.MINOR.PATCH` (ex: `1.7.0`).
- Coluna `firmware_version` em `devices` = versão atualmente rodando (reportada pelo device no primeiro connect).
- Tabela `firmwares` já com coluna `signature` (bytea) pronta pra assinatura digital futura.

---

## Ordem de execução

Cada sub-slice fecha com smoke tests e push pro GitHub antes do próximo começar. Se algum der problema, resolve antes de prosseguir.

1. **E2.0** — Multi-tenancy base *(bloqueia todos os outros)*
2. **E2.1** — Signup self-service + SMTP
3. **E2.2** — Ingestão MQTT + tempo real
4. **E2.3** — Taxa + burst mode
5. **E2.4** — Compartilhamento user-to-user
6. **E2.5** — Scaffold OTA (rápido, mais é schema + tópicos)

Recomendação: dividir em 3 janelas de trabalho — (E2.0+E2.1), (E2.2+E2.3), (E2.4+E2.5).

---

## E2.0 — Multi-tenancy base

### Objetivo
Transformar o sistema atual (single-tenant admin-only) em multi-tenant real. Admin vê tudo; cliente vê só seus próprios devices.

### Schema (migration 004_multitenancy.sql)

```sql
-- Adicionar role + email_verified em users
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'cliente'
  CHECK (role IN ('admin','cliente'));
ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN full_name TEXT;  -- se ainda não existir
-- Usuário wesllem existente: marcar como admin e email_verified
UPDATE users SET role='admin', email_verified=true WHERE email='wesllem1000@gmail.com';

-- Adicionar owner em devices
ALTER TABLE devices ADD COLUMN owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
-- Backfill: dispositivos existentes ficam sem dono (admin gerencia via admin_access_level)
-- ou atribuir todos ao wesllem (decidir na execução, preferência: atribuir ao wesllem).

-- Coluna de consentimento técnico (começa a ser usado já aqui, mesmo sem OTA)
ALTER TABLE devices ADD COLUMN admin_access_level TEXT NOT NULL DEFAULT 'maintenance'
  CHECK (admin_access_level IN ('none','maintenance','full'));
```

### Backend (Node-RED flows.json)

- **fnLogin** (atualizar): incluir `role` e `owner_id` nos claims do access_token.
- **fnRefresh** (atualizar): mesmo.
- **Middleware fnAuth**: já valida token; adicionar função helper `isAdmin(msg)` e `currentUserId(msg)`.
- **GET /dispositivos**:
  - Se `role=admin` → query todos os devices (comportamento atual).
  - Se `role=cliente` → filtrar `WHERE owner_id = $userId OR id IN (SELECT device_id FROM device_shares WHERE user_id=$userId)`. Tabela device_shares ainda não existe, deixar o `OR` preparado mas protegido por `EXISTS(information_schema)` ou simplesmente ignorar shares nesta iteração e corrigir no E2.4.
- **POST /dispositivos**:
  - Se `role=cliente` → força `owner_id = currentUserId`.
  - Se `role=admin` → aceita `owner_id` no body (campo opcional; se omitido, pega de req.user).
- **DELETE /dispositivos/:id** e **PATCH /dispositivos/:id**:
  - Se `role=cliente` → só permite se `owner_id = currentUserId`.
- **Endpoints novos para admin:**
  - `GET /admin/clientes` (lista users com role=cliente, inclui count de dispositivos)
  - `GET /admin/clientes/:id` (detalhe + lista de dispositivos do cliente)
  - `POST /admin/clientes` (cria cliente com email+nome+senha temp → envia email; este endpoint delega pro fluxo de signup no E2.1; pode ficar como stub aqui e ganhar corpo em E2.1).
  - Todos protegidos por `fnAuthAdmin` (middleware que rejeita não-admin com 403).

### Frontend

- **Store de auth (zustand)**: incluir `role` no user decodificado.
- **Roteamento**:
  - `/dispositivos` — acessível a todos autenticados
  - `/admin/*` — só role=admin (guard `RequireAdmin`)
  - Novas rotas: `/admin/clientes` (lista) e `/admin/clientes/:id` (detalhe).
- **Sidebar**: item "Admin" já existe; adicionar sub-itens "Modelos" (existente), "Clientes" (novo), "Widgets em breve".
- **Página /admin/clientes**: tabela com colunas `Nome / E-mail / Dispositivos / Cadastrado em / Ações`. Botão "Novo cliente" abre dialog (form: nome, e-mail, senha temporária ou opção "enviar link de criação"). Submete em `POST /admin/clientes`.
- **Página /admin/clientes/:id**: header com dados do cliente + lista de dispositivos dele (reutiliza componente DispositivoCard) + botão "Voltar".
- **DispositivoFormDialog** (ajustar): se user admin e estiver criando um device dentro de `/admin/clientes/:id`, fixar `owner_id` pra esse cliente. Se criando em `/dispositivos` normalmente, owner é o próprio user.

### Smoke tests
1. Login como admin → vê lista de clientes vazia (ou só o admin).
2. Criar cliente "teste-cliente-1" com e-mail `cliente1@test.com` (senha temporária). SMTP pode falhar aqui, ignorar a falha de e-mail neste sub-slice (sai no E2.1).
3. Logout e login como `cliente1@test.com` → não vê página Admin na sidebar. Cria um dispositivo → aparece só pra ele.
4. Logout e login como admin → vê o dispositivo na lista geral, e também em `/admin/clientes/<id>`.
5. Admin tenta deletar dispositivo do cliente → permite (admin tem acesso global).

### Arquivos tocados (esperados)
- `/opt/xtconect/postgres/migrations/004_multitenancy.sql` (novo)
- `/opt/xtconect/nodered/data/flows.json` (modificado)
- `/opt/xtconect/src/webapp/src/api/auth.ts` (claim `role` no decode)
- `/opt/xtconect/src/webapp/src/store/auth.ts` (incluir role no state)
- `/opt/xtconect/src/webapp/src/app/router.tsx` (RequireAdmin guard)
- `/opt/xtconect/src/webapp/src/features/admin/ClientesPage.tsx` (novo)
- `/opt/xtconect/src/webapp/src/features/admin/ClienteDetailPage.tsx` (novo)
- `/opt/xtconect/src/webapp/src/features/admin/NovoClienteDialog.tsx` (novo)

### Commit + push
Depois dos smoke tests passando, commitar como:
```
feat(multitenancy): adiciona roles admin/cliente e owner_id em devices
```
e push pra origin xtconect-v2.

---

## E2.1 — Signup self-service + SMTP Hostinger

### Objetivo
Cliente consegue se cadastrar sozinho em `/signup`, recebe e-mail de confirmação, clica no link e confirma a conta. Admin também pode criar clientes (endpoint `POST /admin/clientes` ganha corpo).

### Pré-requisito humano
Antes de iniciar, o usuário (wesllem) precisa:
1. Criar arquivo `/opt/xtconect/env/smtp-password` com a senha do e-mail `conect@xtautomatize.com.br` (chmod 600 root:root).
2. Adicionar ao `/opt/xtconect/env/.env` (ou equivalente do compose):
```
   SMTP_HOST=smtp.hostinger.com
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=conect@xtautomatize.com.br
   MAIL_FROM="XT Conect Hub <conect@xtautomatize.com.br>"
   MAIL_BASE_URL=https://xtconect.online
```
   Senha é lida à parte do `smtp-password`.

VPS Claude Code deve validar que esses arquivos existem no início do E2.1. Se não existirem, parar e pedir ao usuário pra criar.

### Schema (migration 005_email_verification.sql)

```sql
CREATE TABLE email_verification_tokens (
  token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('signup','password_reset')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON email_verification_tokens (user_id);
```

### Backend (Node-RED)

Instalar módulo `nodemailer` no Node-RED (`functionExternalModules: true` já está ligado, então add no functionGlobalContext ou require dentro da function):

- **fnSmtpClient** (helper global): cria transporter único via `nodemailer.createTransport({host, port, secure, auth:{user, pass}})`. Lê `pass` via `fs.readFileSync('/data/env/smtp-password','utf8').trim()` (o path `/data/env` é mount do `/opt/xtconect/env` no container Node-RED).
- **fnSendMail** (helper): aceita `{to, subject, html, text}`. Usa `from` do env `MAIL_FROM`.

**Endpoints novos:**

- `POST /auth/signup`:
  - Body: `{email, password, full_name}`.
  - Valida: email único, password ≥ 8 chars.
  - Cria user com `email_verified=false`, `role='cliente'`.
  - Gera token em `email_verification_tokens` (expira em 24h).
  - Envia e-mail HTML (template abaixo) com link `{MAIL_BASE_URL}/verify?token=<uuid>`.
  - Retorna `{message: "Verifique seu e-mail para ativar a conta."}`.
- `GET /auth/verify?token=<uuid>`:
  - Valida token existe, não usado, não expirado.
  - Marca user `email_verified=true`, marca token `used_at`.
  - Retorna redirect 302 pra `/login?verified=true`.
- `POST /auth/resend`:
  - Body: `{email}`.
  - Se user existe e não verificado → gera novo token e reenvia. Se já verificado ou não existe → retorna 200 neutro (não vaza info).
- **fnLogin** (ajustar): rejeitar login com 403 se `email_verified=false`, com mensagem "Confirme seu e-mail antes de entrar. [Reenviar link]".
- **POST /admin/clientes** (implementar de verdade agora):
  - Body: `{email, full_name, senha_temporaria?: string}`.
  - Cria user com `email_verified=true` (admin já confiou) + role=cliente + password (bcrypt da senha temporária; se não enviada, gera senha random 12 chars).
  - Envia e-mail "Sua conta XT Conect foi criada pela equipe" com login + senha temporária + link pra alterar.
  - Retorna `{user: {...}, senha_temporaria: "..."}` (admin vê a senha uma vez; frontend mostra em dialog copiável tipo o de MQTT).

### Template de e-mail (HTML, minimal)

Usar um HTML simples inline (sem frameworks tipo MJML por enquanto):

```html
<div style="font-family:system-ui,Arial;max-width:480px;margin:0 auto;padding:24px;background:#fafafa">
  <h1 style="color:#166a4c">XT Connect Hub</h1>
  <p>Olá {{nome}},</p>
  <p>Confirme seu e-mail pra ativar sua conta:</p>
  <a href="{{link}}" style="display:inline-block;padding:12px 24px;background:#166a4c;color:#fff;text-decoration:none;border-radius:6px">Confirmar e-mail</a>
  <p style="color:#666;font-size:12px;margin-top:24px">Link expira em 24h. Se você não criou essa conta, pode ignorar este e-mail.</p>
</div>
```

Outros templates: signup-welcome, admin-created, password-reset. Salvar em `/opt/xtconect/nodered/templates/email/*.html` e carregar via fs.

### Frontend

- **Página `/signup`**: form (nome, e-mail, senha, confirmar senha, aceite de termos). Submete POST /auth/signup, mostra toast "Verifique seu e-mail" e redireciona pra `/login`.
- **Página `/verify`**: lê `?token=` da URL, chama GET /auth/verify (o backend já retorna redirect). Se chegar direto, mostra tela "Verificando..." com spinner e depois "E-mail confirmado! Faça login".
- **Página `/login`** (ajustar): se `?verified=true` no query, mostra banner verde "E-mail confirmado, pode entrar". Se login retornar erro de não-verificado, mostra botão "Reenviar e-mail de confirmação" que chama `/auth/resend`.
- **Admin → Novo cliente dialog**: após criar, abre dialog estilo MqttCredentialsDialog com a senha temporária copiável + aviso "Anote essa senha — ela não será mostrada de novo".

### Smoke tests
1. Criar conta em `/signup` com e-mail próprio (usuário pode usar um e-mail dele real).
2. Tentar logar antes de verificar → erro com botão "reenviar".
3. Clicar no link do e-mail → redirecionado pra `/login?verified=true` com banner verde.
4. Login com sucesso → cai em `/dispositivos`.
5. Como admin, criar cliente via dialog → dialog mostra senha temporária copiável. Fazer login com esse user → funciona.
6. Verificar que e-mail do admin-created chegou (pode ir pra spam, marcar como não-spam).
7. Tentar criar signup com e-mail já existente → erro 409.

### Arquivos tocados
- `/opt/xtconect/postgres/migrations/005_email_verification.sql` (novo)
- `/opt/xtconect/nodered/data/flows.json` (modificado — vários endpoints novos)
- `/opt/xtconect/nodered/templates/email/*.html` (novo, 3-4 templates)
- `/opt/xtconect/nodered/data/package.json` (adicionar nodemailer)
- `/opt/xtconect/compose/docker-compose.yml` (se precisar mount /opt/xtconect/env → /data/env no serviço nodered — verificar se já existe)
- `/opt/xtconect/src/webapp/src/features/auth/SignupPage.tsx` (novo)
- `/opt/xtconect/src/webapp/src/features/auth/VerifyPage.tsx` (novo)
- `/opt/xtconect/src/webapp/src/features/auth/LoginPage.tsx` (modificado)
- `/opt/xtconect/src/webapp/src/features/admin/NovoClienteDialog.tsx` (corpo real agora)

---

## E2.2 — Ingestão MQTT + tempo real via WSS

### Objetivo
Dispositivos publicam em `devices/<serial>/data` → Node-RED valida, grava em Postgres (última leitura) e InfluxDB (histórico). Frontend conecta via WSS 8884 e vê dados chegando ao vivo.

### Schema (migration 006_ingestion.sql)

```sql
-- Última leitura no próprio device (pra card "ÚLTIMO DADO")
ALTER TABLE devices ADD COLUMN last_reading JSONB;
ALTER TABLE devices ADD COLUMN last_reading_at TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN last_seen_at TIMESTAMPTZ;  -- atualizado em data OU status
ALTER TABLE devices ADD COLUMN online BOOLEAN NOT NULL DEFAULT false;

-- Histórico recente em postgres (últimos 30 dias; rotacionar depois com pg_cron ou job externo)
CREATE TABLE device_readings (
  id BIGSERIAL PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_device_readings_device_ts ON device_readings (device_id, ts DESC);
```

### Node-RED flows

Novo grupo "Ingestão":

- **mqttInData** (mqtt in, subscreve `devices/+/data`, QoS 1):
  - Tópico dinâmico — extrai `serial` do topic via split.
  - Conecta via client "Mosquitto Ingestão" (cliente dynsec com role service-admin — já existe pro controle, ou criar `ingest` client com role mais restrita `ingestion-reader` que só tem `subscribePattern devices/#`).
- **fnValidatePayload**:
  - Parseia msg.payload JSON.
  - Valida envelope `{ts: number, readings: object}`.
  - Rejeita se: payload > 4KB, ts não é número, readings vazio ou não-objeto, readings contém chaves não-string, valores não-numéricos.
  - Em caso de inválido: loga warn e descarta (não erro fatal).
  - Em caso de válido: adiciona `msg.serial`, `msg.ts_device`, `msg.readings`.
- **fnLookupDevice**:
  - Query Postgres: `SELECT id, owner_id, status FROM devices WHERE mqtt_username = $serial`.
  - Se não existe ou status != 'active' → descarta.
  - Adiciona `msg.device_id`.
- **fnInsertPostgres** (paralelo):
  - Atualiza `devices SET last_reading=$readings, last_reading_at=to_timestamp($ts), last_seen_at=now(), online=true WHERE id=$id`.
  - Insert em `device_readings (device_id, ts, payload) VALUES (...)`.
- **fnInsertInflux** (paralelo):
  - POST pra InfluxDB v2 API: `/api/v2/write?org=xtconect&bucket=telemetry`.
  - Converte readings em line protocol: `reading,device=<serial> temp=25.3,umid=60 <ts_ns>`.
  - Token lido de env `INFLUX_TOKEN`.
- **mqttInStatus** (subscribe `devices/+/status`):
  - Payload geralmente é `online` / `offline` (LWT).
  - Atualiza `devices.online` + `last_seen_at`.

**Endpoints novos:**

- `GET /dispositivos/:id/readings?from=<iso>&to=<iso>&limit=500`:
  - Se cliente tem acesso ao device, retorna últimas N leituras de `device_readings`.
  - Usado pra gráfico histórico na página de detalhe do device.

### WSS — frontend consumindo tempo real

- Frontend usa biblioteca `mqtt` via npm (versão ESM browser). Conecta em `wss://hub.xtconect.online:8884` com credenciais de um client dynsec **webapp-readonly** (criar no setup: role `ui-subscriber` → só `subscribePattern devices/#`).
  - **Nota de segurança**: o client webapp-readonly tem senha compartilhada entre todos os browsers. Não é ideal, mas aceitável como MVP. Pra produção, ideal seria emitir token curto por usuário. Documentar como débito técnico.
- **Hook `useDeviceLiveData(serial)`**: conecta MQTT, subscribe `devices/<serial>/data`, expõe `lastReading` reativo.
- **Página `/dispositivos/:id`** (nova, ou ajustar existente):
  - Header: nome, serial, status online/offline, último dado.
  - Gráfico tempo-real: usa recharts, pega histórico inicial via REST e vai adicionando pontos conforme chega via WSS. Buffer de 100 pontos visíveis.
  - Card "Última leitura" com cada campo de readings formatado.

### Smoke tests
1. Publicar manualmente via mosquitto_pub:
```
   mosquitto_pub -h hub.xtconect.online -p 8883 --cafile /etc/letsencrypt/live/hub.xtconect.online/chain.pem \
     -u esp32-test-001 -P <senha_esp32> -t devices/esp32-test-001/data \
     -m '{"ts":1745155200,"readings":{"temp":25.3,"umid":60}}' -q 1
```
2. No banco: `SELECT last_reading, last_reading_at FROM devices WHERE mqtt_username='esp32-test-001'` → deve mostrar os valores.
3. No banco: `SELECT COUNT(*) FROM device_readings WHERE device_id=...` → deve ter 1.
4. No InfluxDB via Grafana: query `from(bucket:"telemetry") |> range(start:-1m)` → deve retornar o ponto.
5. Publicar payload inválido `{"foo":"bar"}` → logs mostram rejeição; banco não incrementa.
6. Abrir `/dispositivos/<id>` no navegador, publicar nova leitura → UI mostra no gráfico em ~1s.
7. Desligar device (simular com disconnect MQTT) → card marca offline em 60s (LWT).

### Arquivos tocados
- `/opt/xtconect/postgres/migrations/006_ingestion.sql`
- `/opt/xtconect/nodered/data/flows.json`
- `/opt/xtconect/mosquitto/data/dynamic-security.json` (adicionar clients `ingest` e `webapp-readonly` com roles específicas)
- `/opt/xtconect/env/mqtt-ingest-password`, `/opt/xtconect/env/mqtt-webapp-password`
- `/opt/xtconect/src/webapp/package.json` (adicionar mqtt, recharts já deve ter)
- `/opt/xtconect/src/webapp/src/hooks/useDeviceLiveData.ts` (novo)
- `/opt/xtconect/src/webapp/src/features/dispositivos/DispositivoDetailPage.tsx` (novo ou revisar)

---

## E2.2.1 — Staleness detection + badge online/offline no card (implementado)

### Entregue
Sweeper em Node-RED (inject 30s) que flipa `devices.is_online=FALSE` quando `last_seen < NOW() - 120s`. Transições publicam `device_status_changed` em `devices/<serial>/status` como JSON (distinguido do texto `online`/`offline` que o próprio device emite). `fnHandleData` emite evento de transição offline→online quando chega dado; `fnHandleStatus` espelha a transição do LWT/graceful disconnect. `fnListDisp` e `fnGetCliente` passam a retornar `online` e `last_seen_at`. Frontend: hook `useDeviceStatus` subscreve `devices/<serial>/status` e atualiza o card em tempo real (tanto em `/dispositivos` quanto em `/admin/clientes/:id`).

### Débito aberto
**#51 — threshold por-dispositivo** fica pra pós-E2.3 (quando `telemetry_interval_s` existir). Hoje é global 120s fixo.

---

## E2.3 — Taxa de telemetria + burst mode

### Objetivo
Cada device tem uma taxa padrão de envio (ex: 60s). Cliente pode clicar "Tempo real" pra receber rajada (ex: 2s) por tempo limitado (ex: 10min). Firmware responde a comandos MQTT.

### Schema (migration 007_telemetry_rate.sql)

```sql
ALTER TABLE devices ADD COLUMN telemetry_interval_s INT NOT NULL DEFAULT 60;
ALTER TABLE devices ADD COLUMN telemetry_burst_interval_s INT NOT NULL DEFAULT 2;
ALTER TABLE devices ADD COLUMN telemetry_burst_max_duration_s INT NOT NULL DEFAULT 600;
ALTER TABLE devices ADD COLUMN burst_active_until TIMESTAMPTZ;  -- quando está em burst, expira

ALTER TABLE modelos ADD COLUMN default_telemetry_interval_s INT DEFAULT 60;
ALTER TABLE modelos ADD COLUMN default_telemetry_burst_interval_s INT DEFAULT 2;
```

### Node-RED

- **POST /dispositivos/:id/tempo-real**:
  - Body: `{duration_s?: number}` (default 600).
  - Permissão: owner, compartilhado com role >=operator, ou admin com access_level=full (compartilhamento ainda não existe aqui — corrigir no E2.4; por agora só owner e admin).
  - Calcula `burst_until = now() + duration_s`.
  - Publica em `devices/<serial>/commands`:
```json
    {"cmd":"set_rate","interval_s":2,"duration_s":600}
```
  - Atualiza `devices.burst_active_until=burst_until`.
  - Retorna `{burst_active_until: "..."}`.
- **POST /dispositivos/:id/config**:
  - Body parcial: `{telemetry_interval_s?, ...}`.
  - Permissão: owner/admin-full/admin-maintenance (porque é manutenção).
  - Atualiza banco + publica em `commands`:
```json
    {"cmd":"set_rate","interval_s":30}
```
    (sem `duration_s` → persiste).
- **Cron burst-expiry** (a cada 60s): `UPDATE devices SET burst_active_until=NULL WHERE burst_active_until < now()`.

### Frontend

- Na página de detalhe do device, botão grande **"Tempo real"** com ícone de pulse:
  - Se inativo: botão cinza "Ativar tempo real".
  - Clique → chama endpoint → botão vira verde com countdown `Tempo real: 9:23 restantes`.
  - Botão secundário "Estender +10min" (reenvia comando).
  - Ao expirar: volta pro estado inicial.
- Em "Configurações do dispositivo", campo "Intervalo de envio (segundos)" editável (com range do modelo como hint).

### Smoke tests
1. Device publicando a cada 60s. Clicar "Tempo real" → backend publica comando, firmware passa a mandar cada 2s.
2. Passar 10min sem estender → firmware volta a 60s (verificar nos logs/UI).
3. Alterar intervalo base pra 30s em configs → firmware aplica, verifica no próximo ciclo.
4. Cliente sem permissão tentando chamar endpoint → 403.

### Nota sobre firmware
O firmware do ESP32 precisa implementar o handler de `commands/set_rate`. Isso é do lado do dispositivo, fora do escopo do VPS Claude Code. O usuário (wesllem) vai cuidar disso. **Mas** o VPS Claude Code deve adicionar no arquivo `firmware/README.md` (criar) a especificação do protocolo de comandos pra servir de referência.

### Arquivos tocados
- `/opt/xtconect/postgres/migrations/007_telemetry_rate.sql`
- `/opt/xtconect/nodered/data/flows.json`
- `/opt/xtconect/src/webapp/src/features/dispositivos/DispositivoDetailPage.tsx`
- `/opt/xtconect/src/webapp/src/features/dispositivos/TempoRealButton.tsx` (novo)
- `/opt/xtconect/src/webapp/src/features/dispositivos/ConfigDispositivoDialog.tsx` (novo)
- `/opt/xtconect/firmware/README.md` (novo, spec de comandos)

---

## E2.4 — Compartilhamento user-to-user

### Objetivo
Owner pode compartilhar dispositivos com outros usuários (por e-mail ou código), definindo nível de acesso. Pode revogar.

### Schema (migration 008_device_sharing.sql)

```sql
CREATE TABLE device_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_role TEXT NOT NULL CHECK (share_role IN ('viewer','operator','admin')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id, user_id)
);
CREATE INDEX idx_device_shares_user ON device_shares (user_id);

CREATE TABLE device_share_invites (
  token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  share_role TEXT NOT NULL CHECK (share_role IN ('viewer','operator','admin')),
  invited_email TEXT,  -- opcional: se owner especificou e-mail mas user não existia
  created_by UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_by UUID REFERENCES users(id),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Node-RED

**Endpoints novos:**

- `POST /dispositivos/:id/share`:
  - Body: `{email?: string, role: 'viewer'|'operator'|'admin'}`.
  - Permissão: owner ou share_role=admin ou user-role=admin.
  - Se email informado:
    - Se user existe: cria row em `device_shares` e envia e-mail "Você recebeu acesso ao dispositivo X".
    - Se user não existe: cria row em `device_share_invites` (com invited_email) e envia e-mail "Você foi convidado; crie conta em /signup usando este e-mail pra liberar o acesso".
  - Se email omitido: só gera token em `device_share_invites` (expira em 24h) e retorna `{share_code: "<token>"}` pro owner enviar manualmente.
- `POST /dispositivos/share/accept`:
  - Body: `{token: uuid}`.
  - Valida token válido, não expirado, não usado.
  - Cria row em `device_shares` com user_id = currentUser.
  - Marca invite como accepted.
  - Se há outros invites pendentes pro mesmo email (no signup o user foi criado com e-mail X e há invite pra X), auto-processa eles também.
- `GET /dispositivos/:id/shares`:
  - Lista quem tem acesso (só owner, share-admin ou admin global veem).
- `DELETE /dispositivos/:id/shares/:share_id`:
  - Revoga acesso.
- **GET /dispositivos** (ajustar): incluir devices via shares no filtro (`WHERE owner_id=$u OR EXISTS(SELECT 1 FROM device_shares WHERE device_id=devices.id AND user_id=$u)`).
- **Hook no /auth/signup**: após criar user, checar se há invites pendentes pro email; se houver, auto-aceitar após email_verified=true.

### Frontend

- Em detalhe do device (se user é owner ou share-admin), tab nova "Compartilhamentos":
  - Lista quem tem acesso (nome, e-mail, role, data, botão Remover).
  - Botão "Convidar por e-mail" → dialog (email + select de role).
  - Botão "Gerar código" → dialog mostra o token UUID + botão copiar + aviso "Expira em 24h".
- Página `/aceitar-convite?token=<uuid>` (pode ser simples): se logado, chama accept. Se não, redireciona pra login/signup e retorna depois.
- Banner no topo de /dispositivos: "Você tem 2 convites pendentes" quando aplicável.

### Smoke tests
1. User A cria device. Convida user B (existente) como viewer → B recebe e-mail e vê device em /dispositivos. B consegue ver dados mas não muda configs (403).
2. User A convida C (não existe) por e-mail → C recebe convite. C faz signup com o mesmo e-mail → após verificar, device aparece automaticamente.
3. User A gera código, envia no WhatsApp pra D. D faz login (já tem conta) e abre link `/aceitar-convite?token=...` → device aparece.
4. User A remove B → B não vê mais o device. Tenta acessar rota direta → 403.
5. User B (só viewer) tenta clicar "Tempo real" → 403.

### Arquivos tocados
- `/opt/xtconect/postgres/migrations/008_device_sharing.sql`
- `/opt/xtconect/nodered/data/flows.json`
- `/opt/xtconect/nodered/templates/email/share-invite.html` (novo)
- `/opt/xtconect/src/webapp/src/features/dispositivos/SharesTab.tsx` (novo)
- `/opt/xtconect/src/webapp/src/features/dispositivos/ShareInviteDialog.tsx` (novo)
- `/opt/xtconect/src/webapp/src/features/aceitar-convite/AceitarConvitePage.tsx` (novo)

---

## E2.5 — Scaffold OTA

### Objetivo
**Não implementa OTA funcional**. Só prepara o banco e a topologia MQTT pra que E3 consiga plugar o restante sem migração dolorosa. Schema + tópicos + assinatura preparada.

### Schema (migration 009_ota_scaffold.sql)

```sql
-- Metadados de hardware/firmware em devices
ALTER TABLE devices ADD COLUMN hardware_board TEXT;           -- ex: 'esp32-wroom-32'
ALTER TABLE devices ADD COLUMN hardware_revision TEXT;        -- ex: 'v1.0'
ALTER TABLE devices ADD COLUMN firmware_version TEXT;         -- ex: '1.7.0' (SemVer)
ALTER TABLE devices ADD COLUMN firmware_target_version TEXT;  -- se está em processo de update
ALTER TABLE devices ADD COLUMN firmware_update_status TEXT    -- idle/pending/downloading/verifying/applied/failed
  CHECK (firmware_update_status IN ('idle','pending','downloading','verifying','applied','failed'));
ALTER TABLE devices ADD COLUMN firmware_update_progress INT CHECK (firmware_update_progress BETWEEN 0 AND 100);
ALTER TABLE devices ADD COLUMN firmware_update_error TEXT;
ALTER TABLE devices ADD COLUMN firmware_updated_at TIMESTAMPTZ;

-- Repositório de firmwares
CREATE TABLE firmwares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id UUID REFERENCES modelos(id),           -- nullable: firmware pode servir vários modelos
  hardware_board TEXT NOT NULL,
  hardware_revision TEXT,                          -- nullable: NULL = qualquer revisão
  version TEXT NOT NULL,                           -- SemVer
  file_path TEXT NOT NULL,                         -- caminho no filesystem (/opt/xtconect/firmwares/...)
  file_size_bytes BIGINT NOT NULL,
  checksum_sha256 TEXT NOT NULL,                   -- hex lowercase
  signature BYTEA,                                 -- assinatura digital (ed25519 ou rsa); null por enquanto
  signature_algorithm TEXT,                        -- 'ed25519' / 'rsa-sha256' / null
  release_notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hardware_board, hardware_revision, version)
);
CREATE INDEX idx_firmwares_board_ver ON firmwares (hardware_board, version DESC);
```

### Mosquitto dynsec

Adicionar ao role `device-publisher` ACLs para:
- `publishClientSend` em `devices/%u/ota/status` (device reporta progresso)
- `subscribePattern` em `devices/%u/ota/offer` (device escuta ofertas)

Adicionar ao role `service-admin` (se não coberto pelo `#`):
- `publishClientSend` em `devices/+/ota/offer`
- `subscribePattern` em `devices/+/ota/status`

### Backend (mínimo)

- **mqttInStatus** (já existe): estender pra aceitar mensagens em `devices/<serial>/ota/status` e atualizar `firmware_update_status/progress`.
- **No connect do device** (primeira mensagem em `status`): se payload incluir `{firmware_version, hardware_board, hardware_revision}`, atualizar em `devices`.
- **Endpoint stub** `POST /admin/firmwares/upload` retornando `501 Not Implemented` com body `{message: "Disponível no E3"}`. Só pra deixar claro que a rota é reservada.

### Spec OTA (só documentar, não implementar)

Criar `/opt/xtconect/docs/ota-protocol.md` descrevendo:
- Fluxo: admin upload → sign → mark as active → trigger rollout → server publishes offer → device acknowledges → device downloads via HTTPS → device validates checksum + signature → device flashes + reboots → device reports applied.
- Schema do `ota/offer`:
```json
  {
    "version": "1.8.0",
    "url": "https://hub.xtconect.online/firmwares/uuid.bin",
    "size_bytes": 1048576,
    "checksum_sha256": "hex...",
    "signature_ed25519": "base64...",
    "expires_at": 1745155200
  }
```
- Schema do `ota/status`:
```json
  {"status": "downloading", "progress": 45}
  {"status": "applied", "from_version": "1.7.0", "to_version": "1.8.0"}
  {"status": "failed", "error": "checksum_mismatch"}
```
- Decisão criptográfica (ed25519 recomendado — chaves pequenas, validação rápida no ESP32).

### Smoke tests
1. Migration aplicada sem erro.
2. Device publica status inicial com firmware_version → banco atualiza `devices.firmware_version`.
3. POST /admin/firmwares/upload retorna 501.
4. Dynsec aceita publish em `ota/status` pelo device-publisher.

### Arquivos tocados
- `/opt/xtconect/postgres/migrations/009_ota_scaffold.sql`
- `/opt/xtconect/mosquitto/data/dynamic-security.json`
- `/opt/xtconect/nodered/data/flows.json`
- `/opt/xtconect/docs/ota-protocol.md` (novo)

---

## Checklist final E2

Depois de todos os sub-slices passarem:

- [ ] Todas as migrations aplicadas (004–009)
- [ ] `flows.json` commitado no git (fechar task #34)
- [ ] Admin consegue criar cliente + cliente consegue fazer signup
- [ ] E-mails de confirmação chegam (não-spam depois de marcar)
- [ ] ESP32 simulado publicando → dados aparecem em real-time na UI
- [ ] Burst mode funciona (botão "Tempo real" envia comando)
- [ ] Compartilhamento por e-mail e por código testado
- [ ] Schema OTA pronto (devices.firmware_version se popula no connect)
- [ ] Build de produção (`npm run build`) sem erros
- [ ] Deploy em `/opt/xtconect/www/` via script existente
- [ ] Push pra origin/xtconect-v2
- [ ] Documentar débitos técnicos descobertos ao longo do caminho num arquivo `/opt/xtconect/docs/debts.md` (ex: client webapp-readonly com senha compartilhada, se aplicável)

---

## Notas finais pro VPS Claude Code

1. **Antes de iniciar qualquer sub-slice**, faça `git pull origin xtconect-v2` e confira que o working tree está limpo.
2. **Depois de cada sub-slice**, smoke tests → commit descritivo → push. Não acumular múltiplos sub-slices num commit só.
3. **Se descobrir um gap que não está no plano** (ex: o flow existente já faz algo diferente do esperado, ou uma tabela tem coluna com nome diferente), **não invente — reporte pro usuário**, descreva o gap com 2-3 opções de resolução, e espere decisão antes de seguir.
4. **Senhas e tokens**: nunca commitar no git. Sempre via `/opt/xtconect/env/*`.
5. **Migrations são imutáveis após aplicadas**: se precisar corrigir algo, crie `010_fix_XXX.sql`, não edite as antigas.
6. **Node-RED flow**: faça backup de `flows.json` antes de cada edição maior (tipo `flows.json.bak-e20-YYYYMMDD-HHMMSS`).
7. **Este plano tem escopo grande** (~2-3 janelas de trabalho completas). Divida em commits menores e faça pausas pra confirmar com o usuário se algo estiver saindo do trilho.

Boa sorte.
