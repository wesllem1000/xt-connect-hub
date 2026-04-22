# Débitos técnicos — XT Connect Hub

Arquivo vivo. Cada entrada: contexto, onde dói, e uma ideia de como resolver quando chegar a hora.

---

## 1. `devices.user_id` é o owner semântico, mas tem nome legado

- **Contexto**: O schema v1 (migration 001) criou `devices.user_id UUID NOT NULL REFERENCES app_users(id)`. Esse campo **é** o dono (owner) do dispositivo — quem pode ver, operar, configurar, compartilhar. No E2.0 (multi-tenancy) mantivemos esse campo como o owner em vez de adicionar um novo `owner_id`, porque renomear custaria atualizar todas as queries do backend já em uso.
- **Onde dói**:
  - Qualquer leitor novato do código pode achar que `devices.user_id` é um "qualquer user" em vez do dono.
  - **Cuidado no E2.4**: `device_shares.user_id` (tabela que vai ser criada no E2.4) é "usuário **com quem** o device foi compartilhado" — semântica diferente, mesmo com nome igual. Fácil confundir em joins.
- **Mitigação atual**:
  - Usar alias nas queries SQL do backend sempre que o campo aparecer no contexto de devices: `SELECT devices.user_id AS owner_id ...`, `WHERE devices.user_id = $1 -- owner_id`. Facilita leitura.
  - Nos tipos TypeScript do frontend, expor como `ownerId` (e não `userId`) ao consumir a API.
- **Como resolver (pós-MVP)**: migration `NNN_rename_devices_user_id_to_owner_id.sql` + varredura global em `flows.json` e no webapp trocando `user_id`→`owner_id` no contexto de devices. Pode ser feito numa janela de manutenção. Estimativa: 1-2h de trabalho focado.

---

## 2. Role `'instalador'` mantida no CHECK constraint apesar de não estar no plano E2

- **Contexto**: O schema v1/v2 definiu roles `('user','admin','instalador')`. O plano E2 quer reduzir pra `('admin','cliente')`. No E2.0 decidimos expandir pra `('admin','cliente','instalador')` — renomeamos `user`→`cliente` e deixamos `instalador` quieto pra não quebrar usuários existentes (caso haja).
- **Onde dói**: UI não sabe tratar `instalador` hoje. Se aparecer um user com essa role, o router cai em ramos inesperados.
- **Como resolver**: quando consolidar o modelo de permissões (provavelmente no E3 com OTA), decidir se `instalador` vira um tipo de share role (ex: pode dar manutenção em devices não-seus) ou se é só migrado pra `cliente` e o CHECK volta pra dois valores.

---

## 3. (E2.2) Cliente MQTT `webapp-readonly` usa senha compartilhada entre browsers

- **Contexto**: O frontend (build Vite) embute as credenciais `webapp-readonly` no JS distribuído. Qualquer pessoa com acesso ao bundle obtém a senha e pode subscrever todas as topics `devices/+/data` e `devices/+/status`.
- **Onde dói**: Não dá pra revogar acesso a um único usuário sem rotacionar a senha global e re-deployar. Não há tenant filtering no nível do broker — o WSS recebe leituras de TODOS os devices da plataforma; a UI só renderiza as do device aberto, mas tecnicamente os dados estão expostos.
- **Como resolver (E3)**: emitir token MQTT efêmero por usuário a partir do JWT (endpoint `POST /mqtt-token` que retorna `{username, password, expires_in}`), e usar o `mosquitto-go-auth` plugin (ou JWT auth direto via dynsec custom hook) pra validar e aplicar ACL por user.

---

## 4. (E2.2) `device_readings` cresce indefinidamente

- **Contexto**: A tabela armazena cada payload publicado (post-validação) em Postgres. Sem rotação, vai inflar.
- **Onde dói**: Disco e custo de queries (mesmo com índice por `device_id, ts DESC`). O bucket InfluxDB tem retention 90d; PG não.
- **Como resolver**: job de rotação diária (cron externo ou pg_cron) que remove rows com `ts < now() - interval '30 days'`. Prioridade: média (acionar antes de hit ~10M linhas).

---

## 5. (E2.2) Limite de payload MQTT hardcoded em 4KB

- **Contexto**: `fnHandleData` no Node-RED valida `str.length > 4096`. Em devices com muitos sensores ou batches, pode ser apertado.
- **Onde dói**: Devices que precisam mandar payloads maiores recebem `node.warn('payload > 4096B')` e a leitura é descartada silenciosamente.
- **Como resolver**: o limite já lê `env.get('MQTT_MAX_PAYLOAD_BYTES')` (com fallback 4096). Adicionar no `secrets.env` se for necessário aumentar.

---

## 6. (E2.2) Mosquitto dynsec — substituição `%u` não funciona em `publishClientSend` nem em `subscribePattern`

- **Contexto**: Durante E2.2 descobrimos que `publishClientSend devices/%u/data allow` na role `device-publisher` NÃO funciona — mosquitto 2.0 não substitui `%u` em ACLs de tipo `publishClientSend`. **Atualização 2026-04-21** (pré-E2.3): reproduzimos o mesmo problema em `subscribePattern devices/%u/commands allow` — SUBACK=128 (denied) mesmo com a ACL presente e username batendo. Ou seja, `%u` também não substitui em `subscribePattern` nesta versão do broker (contrário ao que os docs sugerem). Contradiz o que tínhamos anotado antes em #48.
- **Mitigação aplicada**:
  - Publish: `publishClientSend devices/+/data allow` (literal wildcard `+`).
  - Subscribe (commands): `subscribePattern devices/+/commands allow` (literal wildcard `+`, priority 10). Aplicado em 2026-04-21 no `dynamic-security.json`. Ver também débito #55.
- **Onde dói**: Um device comprometido pode publicar telemetria forjada para outro device E (agora) também pode subscribe nos comandos alheios. Mitigação no lado do app: só o backend autenticado emite publishes em `devices/<serial>/commands`, e o device deve ignorar payloads cujo `target_serial` não seja o próprio.
- **Como resolver**: criar uma role e ACL POR DEVICE no momento de provisionamento (via `addRoleACL` específico para `devices/<serial>/data` e `devices/<serial>/commands`). Ou usar `mosquitto-go-auth` com filtro por substring do username. Estimativa: ~3-4h.

---

## 7. (E2.2) Bucket InfluxDB `telemetry` com retention 90d

- **Contexto**: bucket criado com `DOCKER_INFLUXDB_INIT_RETENTION=90d`. OK por enquanto.
- **Como resolver**: revisitar quando produzir gráficos > 90d (ex: relatórios anuais). Pode ser tunado via `influx bucket update --retention 365d`.

---

## 51. (E2.2.1) Threshold de offline por dispositivo

- **Contexto**: E2.2.1 implementou staleness detection com threshold fixo global de **120s** (= 2min). O sweeper flipa `is_online=FALSE` quando `last_seen < NOW() - 120s`. Funciona pra devices com intervalo de telemetria típico (≤30s).
- **Onde dói**: Device com `telemetry_interval_s` configurado pra valor alto (ex: sensor a cada 5min) seria considerado offline incorretamente. Hoje nenhum device tem intervalo configurável, então não bate.
- **Depende de**: E2.3 (`set_rate`) introduz `devices.telemetry_interval_s` via comando `hub/device/set-rate`.
- **Como resolver (pós-E2.3)**: trocar `THRESHOLD_SECONDS = 120` no `fnSweeper` por `3 × COALESCE(telemetry_interval_s, 40)`. Query vira algo como `WHERE last_seen < NOW() - (GREATEST(COALESCE(telemetry_interval_s,40) * 3, 60) || ' seconds')::interval`. Evento `device_status_changed` inclui o threshold usado pra UI mostrar contexto ("Offline há 8 min — esperado a cada 5 min").

---

## 55. (E2.3) Device pode subscribe em `devices/+/commands` de qualquer device

- **Contexto**: Para destravar E2.3 (set_rate recebido pelo device), trocamos `subscribePattern devices/%u/commands` por `subscribePattern devices/+/commands` na role `device-publisher` — porque `%u` não substitui em `subscribePattern` nesta versão do mosquitto (ver #6). O efeito colateral é que qualquer device autenticado pode fazer subscribe em **todos** os tópicos de comandos, não apenas no próprio.
- **Onde dói**: Um device comprometido poderia ler os comandos destinados a outros devices (ex: observar `set_rate` em flota alheia). Ele não consegue *executar* os comandos dos outros (o target é identificado pelo próprio device via filtro client-side), mas consegue inspecionar tráfego de controle.
- **Mitigação atual**: comandos são emitidos apenas pelo backend autenticado; nenhum segredo/credencial trafega no payload de comando.
- **Como resolver**: mesma solução de #6 — role/ACL por device no provisionamento com `subscribePattern devices/<serial>/commands` literal. Fica atrelado ao trabalho maior do #6.

---

## 8. (E2.2) Webapp `.env` não está em git, mas precisa estar no host

- **Contexto**: `/opt/xtconect/src/webapp/.env` contém `VITE_MQTT_*` (incluindo senha). É lido em build time. Está no `.gitignore` (correto, segredo).
- **Onde dói**: Se alguém deletar `/opt/xtconect/src/webapp/`, o próximo `pnpm run build` vai gerar o frontend SEM credenciais MQTT — UI conecta e falha em runtime. Existe `.env.example` que documenta o que precisa ser preenchido.
- **Como resolver**: mover credenciais MQTT pro endpoint `/api/mqtt-config` (já existente em flows!) que entrega config em runtime via JWT autenticado. Aí o build deixa de embedar senhas. Vai junto com o débito #3 da rotação por usuário.

---

# Resolvidos

## #48 — dynsec role de devices não permite subscribe em `devices/<serial>/commands`

- **Resolvido em**: 2026-04-21 (após diagnóstico real; a "resolução" anterior do mesmo dia foi um falso positivo).
- **Diagnóstico real**: ACL `subscribePattern devices/%u/commands allow` estava no role `device-publisher`, mas o broker retornava SUBACK=128 (denied) pro simulador. Reproduzido num client de debug com o mesmo role — mesmo SUBACK=128. Conclusão: `%u` não substitui em `subscribePattern` (contrário ao que o diagnóstico anterior e a doc do mosquitto sugeriam). Isso amplia o escopo do débito #6.
- **Ação**: adicionado `subscribePattern devices/+/commands allow` (priority 10) no role `device-publisher` via `mosquitto_ctrl dynsec addRoleACL`, e removido o `%u` obsoleto. Reconfirmado com client de debug: SUBACK=1 (granted). Mudança persistida em `/mosquitto/data/dynamic-security.json` (sem commit — arquivo não está em git). Segurança relacionada virou débito #55.

## #46 — dialog de credenciais mostra apenas URL mqtts://

- **Resolvido em**: 2026-04-21, commit `f42bce8` (`feat(webapp): mostra URL WSS no dialog de credenciais MQTT (#46)`).
- **Como**: `MqttCredentialsDialog.tsx` agora deriva a URL WSS a partir da mqtts (host único) e renderiza duas linhas separadas com rótulo: "URL para firmware (ESP32)" e "URL para navegador / debug". Backend (flows.json) continua retornando só `broker: 'mqtts://...:8883'` — zero blast radius no serviço MQTT.

## #49 — card de dispositivo só abre detalhes pelo menu ⋮

- **Resolvido em**: 2026-04-21, commit `c6448b0` (`feat(webapp): card de dispositivo clicável para abrir detalhes (#49)`).
- **Como**: `DispositivoCard` em `DispositivosPage.tsx` virou `role="button"` com `onClick` chamando `useNavigate`, `tabIndex=0` e handler `onKeyDown` pra Enter/Space. O menu ⋮ recebeu um wrapper com `stopPropagation` pra evitar navegação dupla. Item "Abrir detalhes" foi removido do menu (redundante). Evitamos `<Link>` externo por causa do risco de âncora aninhada com a do `DropdownMenuItem`.
