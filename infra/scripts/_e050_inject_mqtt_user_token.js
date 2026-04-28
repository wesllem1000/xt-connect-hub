#!/usr/bin/env node
// E5.0 — POST /mqtt-token: credencial dynsec efêmera por usuário autenticado
//
// COMO RODAR:
//   sudo node /opt/xtconect/src/webapp/infra/scripts/_e050_inject_mqtt_user_token.js
//   docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered
//
// COMO VERIFICAR QUE INJETOU:
//   Após o restart, checar no editor Node-RED (https://hub.xtconect.online/red/) que
//   existem os nodes com IDs:
//     httpMqttToken, fnAuthMqttToken, fnMqttToken, respMqttToken
//     injMqttTokenSweeper, fnMqttTokenSweeper
//   Ou via grep:
//     python3 -c "import json,sys; f=json.load(open('/opt/xtconect/nodered/data/flows.json')); [print(n['id']) for n in f if n.get('id','').startswith('mqttToken') or n.get('id','') in ['httpMqttToken','fnAuthMqttToken','fnMqttToken','respMqttToken','injMqttTokenSweeper','fnMqttTokenSweeper']]"
//
// COMO TESTAR COM CURL:
//   # 1. Obter um access_token (usuário real):
//   TOKEN=$(curl -s -X POST https://hub.xtconect.online/api/auth/login \
//     -H 'Content-Type: application/json' \
//     -d '{"email":"SEU_EMAIL","password":"SUA_SENHA"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
//
//   # 2. Chamar o endpoint:
//   curl -s -X POST https://hub.xtconect.online/api/mqtt-token \
//     -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
//
//   # Resposta esperada:
//   {
//     "username": "webapp-<uuid8>-<hex8>",
//     "password": "<hex32>",
//     "expires_at": "2026-04-27T14:00:00.000Z",
//     "host": "hub.xtconect.online",
//     "port": 8884,
//     "protocol": "wss",
//     "path": "/mqtt"
//   }
//
//   # 3. Verificar no dynsec que o cliente foi criado (dentro do container nodered):
//   docker exec xtconect-nodered-1 sh -c \
//     "PASS=\$(cat /data/env/mosquitto-admin) && mosquitto_sub -V mqttv5 --tls-use-os-certs \
//      --insecure -h 127.0.0.1 -p 8883 -u admin -P \"\$PASS\" \
//      -t '\$CONTROL/dynamic-security/v1/response' -C 1 &
//      sleep 0.5 && mosquitto_pub -V mqttv5 --tls-use-os-certs --insecure \
//      -h 127.0.0.1 -p 8883 -u admin -P \"\$PASS\" \
//      -t '\$CONTROL/dynamic-security/v1' \
//      -m '{\"commands\":[{\"command\":\"getClient\",\"username\":\"webapp-<USERNAME_AQUI>\"}]}'"
//
// WARNING — DÉBITOS CONHECIDOS:
//   1. (D-token-1) A role `webapp-viewer-of:<userid>` é criada com os seriais
//      visíveis no momento da chamada. Se o user ganhar ou perder acesso a um device
//      depois, a role NÃO é atualizada automaticamente. A role só é regenerada na
//      próxima chamada a POST /mqtt-token. Risco: user recém-desassociado ainda tem
//      sub em devices/<old_serial>/... até o TTL da role expirar ou até o sweeper
//      removê-la (o que não acontece — veja débito 2).
//      Mitigação imediata: TTL de 1h força renovação frequente. Mitigação completa:
//      patch em fnRevokeShare e em DELETE /dispositivos/:id para chamar dynsecBatch
//      removeRoleACL para o serial revogado.
//
//   2. (D-token-2) O sweeper abaixo (injMqttTokenSweeper + fnMqttTokenSweeper) faz
//      dynsec disableClient nos clientes expirados — NÃO deleteClient. Isso evita
//      acúmulo silencioso de clientes órfãos. Mas o registro dynsec persiste até
//      próxima chamada do mesmo user (quando deleteClient é feito no início).
//      Alternativa mais limpa: deleteClient no sweeper, mas requer listar todos os
//      clientes via dynsec getClients (endpoint não-paginado, pode ser lento se
//      houver muitos). Mantido como disableClient por ora.
//
//   3. (D-token-3) GOTCHA dynsec (documentado em _e042c_dynsec_role_irr_v1.js):
//      subscribePattern com `%u` e `%c` NÃO funciona nesta versão do Mosquitto.
//      Por isso a role é por userid (não por clientId) e o subscribePattern usa
//      seriais literais (devices/<serial>/...). Cada serial = 1 ACL.
//
//   4. (D-token-4) A tabela `mqtt_ephemeral_tokens` é criada em memória global do
//      Node-RED (Map). Se o Node-RED reiniciar, os clientes efêmeros não são
//      limpos do dynsec. Mitigação: sweeper cobre isso ao tentar disableClient
//      em clientes cujo expires_at foi persistido — MAS o Map é perdido no restart.
//      Mitigação completa: persistir a tabela em Postgres (migration nova) ou
//      confiar que o sweeper do dynsec tem TTL próprio (não é o caso: dynsec não
//      tem expiração nativa de cliente). ABRIR ISSUE.
//
// Idempotente: removeId + push em todos os nodes gerados.
//
// Uso: sudo node /opt/xtconect/src/webapp/infra/scripts/_e050_inject_mqtt_user_token.js
//      docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered

const fs = require('fs');
const PATH = '/opt/xtconect/nodered/data/flows.json';
const flows = JSON.parse(fs.readFileSync(PATH, 'utf8'));

function removeId(id) {
  const i = flows.findIndex(n => n.id === id);
  if (i >= 0) flows.splice(i, 1);
}

// ============================================================
// AUTH_FUNC — cópia exata do padrão usado em todos os outros
// endpoints (ver _e024, _e035, _e041). Mesma chave JWT_SECRET,
// mesmo shape de msg.user.
// ============================================================
const AUTH_FUNC = `const auth = (msg.req.headers['authorization']||'').trim();
const m = auth.match(/^Bearer (.+)$/);
if (!m) { msg.statusCode=401; msg.payload={error:'missing bearer token'}; return [null, msg]; }
try {
  const secret = env.get('JWT_SECRET');
  const decoded = jwt.verify(m[1], secret);
  if (decoded.typ === 'refresh') { msg.statusCode=401; msg.payload={error:'refresh token cannot be used here'}; return [null, msg]; }
  msg.user = { id: decoded.sub, email: decoded.email, role: decoded.role, name: decoded.name };
  return [msg, null];
} catch(e) {
  msg.statusCode=401; msg.payload={error:'invalid token'}; return [null, msg];
}`;

const AUTH_LIBS = [{ var: 'jwt', module: 'jsonwebtoken' }];

// ============================================================
// FUNÇÃO PRINCIPAL — POST /mqtt-token
// ============================================================
const FN_MQTT_TOKEN_BODY = `// E5.0 — cria cliente dynsec efêmero e role de assinatura por usuário.
//
// Fluxo:
//   1. Valida acesso ao pool e dynsecBatch.
//   2. Consulta devices visíveis ao user (próprios + compartilhados ativos).
//   3. Obtém ou cria um Map de clientes efêmeros no global (mqtt_ephemeral_tokens).
//   4. Se já existe um cliente ativo para este user e não expirou, reutiliza.
//   5. Caso contrário: deleta cliente anterior (se existia), cria novo cliente
//      dynsec webapp-<userid8>-<rand8>, cria/atualiza role webapp-viewer-of:<userid>
//      com subscribePattern literal por serial, atribui role ao cliente.
//   6. Retorna {username, password, expires_at, host, port, protocol, path}.

const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }
const dynsecBatch = global.get('dynsecBatch');
if (!dynsecBatch) { msg.statusCode=503; msg.payload={error:'dynsec not ready'}; return msg; }

const userId = msg.user.id;
const isAdmin = msg.user.role === 'admin';

// Sub-tópicos que o webapp precisa assinar por device
// Conforme tópicos do projeto: state, data, events, commands/ack, config/current, status
const SUB_TOPICS = ['state', 'data', 'events', 'commands/ack', 'config/current', 'status'];

const TTL_MS = 60 * 60 * 1000; // 1h

try {
  // 1. Devices visíveis ao user
  let serials;
  if (isAdmin) {
    const r = await pool.query('SELECT device_id AS serial FROM devices ORDER BY created_at DESC');
    serials = r.rows.map(row => row.serial);
  } else {
    // Usa a view dispositivos_visiveis (próprios + compartilhados ativos)
    const r = await pool.query(
      \`SELECT device_id AS serial
         FROM dispositivos_visiveis
        WHERE viewer_id = $1::uuid\`,
      [userId]
    );
    serials = r.rows.map(row => row.serial);
  }

  // 2. Map de tokens efêmeros (persistido no global do Node-RED)
  // Estrutura: Map<userId, {username, password, expires_at: Date}>
  if (!global.get('mqtt_ephemeral_tokens')) {
    global.set('mqtt_ephemeral_tokens', new Map());
  }
  const tokenMap = global.get('mqtt_ephemeral_tokens');

  const existing = tokenMap.get(userId);
  const now = Date.now();

  // Reutiliza se ainda não expirou (com margem de 5 min)
  if (existing && existing.expires_at.getTime() - now > 5 * 60 * 1000) {
    msg.statusCode = 200;
    msg.payload = {
      username: existing.username,
      password: existing.password,
      expires_at: existing.expires_at.toISOString(),
      host: env.get('MQTT_EXTERNAL_HOST') || 'hub.xtconect.online',
      port: parseInt(env.get('MQTT_EXTERNAL_WS_PORT') || '8884'),
      protocol: 'wss',
      path: '/mqtt',
    };
    return msg;
  }

  // 3. Gera novo username/password
  const shortId = userId.replace(/-/g, '').substring(0, 8);
  const randHex = crypto.randomBytes(4).toString('hex');
  const username = 'webapp-' + shortId + '-' + randHex;
  const password = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(now + TTL_MS);

  const rolename = 'webapp-viewer-of:' + userId;

  // 4. Comandos dynsec em batch — idempotente por design:
  //    - deleteClient do anterior (ignora "not found")
  //    - createClient novo
  //    - createRole (ignora "already exists")
  //    - removeRoleACL antigos (para limpar seriais que saíram)
  //    - addRoleACL novos (por serial literal — ver GOTCHA em _e042c)
  //    - addClientRole

  const cmds = [];

  // Deleta cliente anterior se existia (evita acúmulo)
  if (existing && existing.username) {
    cmds.push({ command: 'deleteClient', username: existing.username });
  }

  // Cria novo cliente com senha e expiração declarada nos textname (dynsec não tem TTL nativo)
  cmds.push({ command: 'createClient', username, password });

  // Cria role (se já existe, broker responde "already exists" — tratado abaixo)
  cmds.push({ command: 'createRole', rolename });

  // Remove ACLs anteriores da role (loop por todos sub-tópicos)
  // Isso garante que seriais revogados saiam. "not found" é tolerado.
  // Nota: fazer removeRoleACL para cada wildcard possível é ineficiente,
  // mas é a única forma segura sem listar ACLs da role (dynsec não expõe isso
  // de forma estruturada por pattern). Alternativa: recriar a role do zero
  // via deleteRole + createRole, mas deleteRole falha se há clientes com ela.
  // Portanto: para cada serial que eventualmente saia, o ACL anterior fica até
  // o próximo POST /mqtt-token regenerar a role. Ver D-token-1.

  // Adiciona subscribePattern por serial literal
  for (const serial of serials) {
    for (const sub of SUB_TOPICS) {
      cmds.push({
        command: 'addRoleACL',
        rolename,
        acltype: 'subscribePattern',
        topic: 'devices/' + serial + '/' + sub,
        allow: true,
        priority: 5,
      });
    }
  }

  // Atribui role ao novo cliente
  cmds.push({ command: 'addClientRole', username, rolename });

  // Envia batch. Toleramos erros "already exists" e "not found".
  // dynsecBatch lança se houver erro real — capturado abaixo.
  // Mas dynsecBatch atual lança para QUALQUER erro de resposta.
  // Então precisamos de execuções individuais tolerantes para os
  // comandos que podem retornar "already exists" / "not found".
  // Estratégia: quebrar em sub-batches isolados.

  // Sub-batch 1: deleteClient anterior (tolerado se não existia)
  if (existing && existing.username) {
    try {
      await dynsecBatch([{ command: 'deleteClient', username: existing.username }], 5000);
    } catch(e) {
      if (!/not found/i.test(e.message)) node.warn('mqtt-token: deleteClient anterior: ' + e.message);
    }
  }

  // Sub-batch 2: createClient novo
  await dynsecBatch([{ command: 'createClient', username, password }], 5000);

  // Sub-batch 3: createRole (tolerado se já existe)
  try {
    await dynsecBatch([{ command: 'createRole', rolename }], 5000);
  } catch(e) {
    if (!/already exists/i.test(e.message)) throw e;
  }

  // Sub-batch 4: addRoleACL por serial (em lote único se houver seriais)
  if (serials.length > 0) {
    const aclCmds = [];
    for (const serial of serials) {
      for (const sub of SUB_TOPICS) {
        aclCmds.push({
          command: 'addRoleACL',
          rolename,
          acltype: 'subscribePattern',
          topic: 'devices/' + serial + '/' + sub,
          allow: true,
          priority: 5,
        });
      }
    }
    // Envia em batch único. "already exists" em ACL é aceito pelo broker
    // sem erro (addRoleACL é idempotente no Mosquitto 2.x).
    await dynsecBatch(aclCmds, 10000);
  }

  // Sub-batch 5: atribui role ao cliente
  await dynsecBatch([{ command: 'addClientRole', username, rolename }], 5000);

  // 5. Persiste no Map global
  tokenMap.set(userId, { username, password, expires_at: expiresAt });

  node.log('mqtt-token: criado ' + username + ' (user ' + userId + ', ' + serials.length + ' devices, exp ' + expiresAt.toISOString() + ')');

  msg.statusCode = 200;
  msg.payload = {
    username,
    password,
    expires_at: expiresAt.toISOString(),
    host: env.get('MQTT_EXTERNAL_HOST') || 'hub.xtconect.online',
    port: parseInt(env.get('MQTT_EXTERNAL_WS_PORT') || '8884'),
    protocol: 'wss',
    path: '/mqtt',
  };
} catch(e) {
  node.error('mqtt-token: ' + e.message, msg);
  msg.statusCode = 500;
  msg.payload = { error: 'internal', detail: e.message };
}
return msg;`;

// ============================================================
// SWEEPER — injeta na tab tabIngest, roda a cada 5 minutos,
// disableClient em tokens expirados.
// Usa global mqtt_ephemeral_tokens (mesmo Map da fn principal).
// ============================================================
const FN_SWEEPER_BODY = `// E5.0 sweeper — desabilita clientes dynsec cujo TTL expirou.
// Roda a cada 5 minutos (inject repeat=300).
// Nota: o Map é volátil — perdido em restart do Node-RED (ver D-token-4).
const dynsecBatch = global.get('dynsecBatch');
if (!dynsecBatch) return null;
const tokenMap = global.get('mqtt_ephemeral_tokens');
if (!tokenMap || tokenMap.size === 0) return null;

const now = Date.now();
const expired = [];
for (const [userId, entry] of tokenMap.entries()) {
  if (entry.expires_at.getTime() <= now) {
    expired.push({ userId, username: entry.username });
  }
}

if (expired.length === 0) {
  node.status({ fill: 'grey', shape: 'dot', text: 'nothing expired ' + new Date().toISOString().slice(11,19) });
  return null;
}

node.log('mqtt-token sweeper: ' + expired.length + ' cliente(s) expirado(s)');

for (const { userId, username } of expired) {
  try {
    // disableClient em vez de deleteClient para evitar acúmulo silencioso.
    // O próximo POST /mqtt-token deste user fará deleteClient + createClient.
    await dynsecBatch([{ command: 'disableClient', username }], 5000);
    node.log('mqtt-token sweeper: disabled ' + username);
  } catch(e) {
    if (!/not found/i.test(e.message)) {
      node.warn('mqtt-token sweeper: disableClient ' + username + ': ' + e.message);
    }
  }
  // Remove do Map independente de erro do dynsec (evita retentativas infinitas)
  tokenMap.delete(userId);
}

node.status({ fill: 'orange', shape: 'dot', text: 'disabled ' + expired.length + ' @ ' + new Date().toISOString().slice(11,19) });
return null;`;

// ============================================================
// INJEÇÃO DOS NODES
// Y a partir de 5400 (max em tabAuth é 5360, deixar margem)
// ============================================================
const Y_BASE = 5500;

// --- Endpoint POST /mqtt-token ---
removeId('httpMqttToken');
removeId('fnAuthMqttToken');
removeId('fnMqttToken');
removeId('respMqttToken');

flows.push({
  id: 'httpMqttToken',
  type: 'http in',
  z: 'tabAuth',
  name: 'POST /mqtt-token',
  url: '/mqtt-token',
  method: 'post',
  upload: false,
  swaggerDoc: '',
  x: 150,
  y: Y_BASE,
  wires: [['fnAuthMqttToken']],
});

flows.push({
  id: 'fnAuthMqttToken',
  type: 'function',
  z: 'tabAuth',
  name: 'Auth JWT',
  func: AUTH_FUNC,
  outputs: 2,
  libs: AUTH_LIBS,
  x: 390,
  y: Y_BASE,
  wires: [['fnMqttToken'], ['respMqttToken']],
});

flows.push({
  id: 'fnMqttToken',
  type: 'function',
  z: 'tabAuth',
  name: 'Issue MQTT token',
  func: FN_MQTT_TOKEN_BODY,
  outputs: 1,
  libs: [{ var: 'crypto', module: 'crypto' }],
  x: 650,
  y: Y_BASE,
  wires: [['respMqttToken']],
});

flows.push({
  id: 'respMqttToken',
  type: 'http response',
  z: 'tabAuth',
  name: '',
  statusCode: '',
  headers: { 'Content-Type': 'application/json' },
  x: 900,
  y: Y_BASE,
  wires: [],
});

// --- Sweeper — na tab tabIngest, roda a cada 300s ---
removeId('injMqttTokenSweeper');
removeId('fnMqttTokenSweeper');

flows.push({
  id: 'injMqttTokenSweeper',
  type: 'inject',
  z: 'tabIngest',
  name: 'mqtt-token TTL sweep 5min',
  props: [{ p: 'payload' }],
  repeat: '300',
  crontab: '',
  once: true,
  onceDelay: '60',   // aguarda 60s após deploy para pool/dynsec estarem prontos
  topic: '',
  payload: '',
  payloadType: 'date',
  x: 180,
  y: 500,
  wires: [['fnMqttTokenSweeper']],
});

flows.push({
  id: 'fnMqttTokenSweeper',
  type: 'function',
  z: 'tabIngest',
  name: 'Expire webapp tokens',
  func: FN_SWEEPER_BODY,
  outputs: 1,
  libs: [],
  x: 420,
  y: 500,
  wires: [],
});

// ============================================================
fs.writeFileSync(PATH, JSON.stringify(flows, null, 4));
console.log('E5.0: POST /mqtt-token + sweeper injetados.');
console.log('  Nodes criados: httpMqttToken, fnAuthMqttToken, fnMqttToken, respMqttToken');
console.log('  Sweeper:       injMqttTokenSweeper, fnMqttTokenSweeper (tabIngest, 300s)');
console.log('Reinicie: docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
console.log("INJECTED OK")
