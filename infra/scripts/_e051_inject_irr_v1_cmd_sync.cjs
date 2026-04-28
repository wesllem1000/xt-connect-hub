#!/usr/bin/env node
// E5.1 — Wrapper síncrono de comando IRR-V1 (refs Fase 1.6 do PLANO-DE-ACAO.md)
//
// DECISÃO DE ARQUITETURA:
//   Criamos um NOVO endpoint paralelo `fnIrrComandoSync` em vez de patchar
//   o `fnIrrComandos` existente. Motivo: `fnIrrComandos` (outputs:2, fire-and-forget)
//   tem wiring fixo no flows.json apontando para `respIrrComandos` e
//   `mqttOutIrrCommands`. Patchar o func inline sem mudar o grafo de wires
//   não nos daria a espera bloqueante — precisaríamos de um segundo nó de resposta
//   separado de qualquer forma. Manter o endpoint original intacto garante
//   retro-compatibilidade para qualquer client que já use o fire-and-forget.
//   O novo endpoint `/dispositivos/:id/irrigacao/comandos/sync` contém toda a
//   lógica autônoma: publica via função interna (não via mqtt-out node — ver abaixo)
//   e aguarda o ack via global Map de Promises.
//
//   PUBLICAÇÃO MQTT NO NODE SÍNCRONO:
//   O padrão dos outros scripts usa nodes `mqtt out` separados e retorna
//   [httpMsg, mqttMsg] com outputs:2. Isso não funciona para espera bloqueante:
//   o mqtt-out node dispara assincronamente e o Node-RED já respondeu ao HTTP
//   antes do ack chegar. Para este endpoint, publicamos diretamente via o
//   client MQTT global (`brokerConn` que o Node-RED mantém internamente).
//   A alternativa segura é usar `node.send()` para um mqtt-out node e ao mesmo
//   tempo manter a Promise viva — mas `node.send()` em async function não bloqueia
//   corretamente em todos os cenários de Node-RED 3.x. Portanto usamos o objeto
//   global `mqttClient` que o _e22_inject_flows.js/fnPublishCmd já estabelece,
//   OU, se não existir, invocamos o próprio node mqtt-out reutilizando o existente
//   `mqttOutIrrCommands` via contexto de flow. Implementação mais robusta:
//   recuperar o broker MQTT via global context (padrão documentado no Node-RED).
//   PORÉM — nenhum dos scripts existentes expõe o broker MQTT como global.
//   Solução adotada: injetar um nó auxiliar `fnIrrCmdSyncPublish` (mqtt-out wrapper)
//   conectado ao novo endpoint, e usar uma abordagem de Promise + Map com
//   `node.send([null, publishMsg])` no nó de função síncrona, que tem outputs:2
//   (saída 0 = caminho de espera/resposta; saída 1 = publish imediato para mqtt-out).
//   O truque: a função RETORNA null na saída 0 (não responde ainda) e envia o msg
//   MQTT pela saída 1; a Promise fica pendente no Map; quando `fnHandleIrrAck`
//   resolve a Promise, o handler chama `pendingEntry.res(res, send)` onde `send`
//   é o `node.send` capturado no closure — mas Node-RED não permite capturar
//   node.send de outro nó.
//   SOLUÇÃO FINAL (a mais idiomática para Node-RED async):
//   Usar `node.send()` com timeout interno dentro de uma única função async que
//   retorna null (bloqueando o grafo). A resposta HTTP é enviada via o objeto
//   `msg.res` diretamente (Express-style), que o Node-RED expõe no msg de http-in.
//   Isso é suportado: msg.res.status(200).json({...}) e msg.res.status(504).json({...}).
//   O http response node NÃO é usado — a resposta é feita manualmente.
//   Esta é a abordagem mais direta e não requer wiring extra.
//
// COMO RODAR:
//   sudo node /opt/xtconect/src/webapp/infra/scripts/_e051_inject_irr_v1_cmd_sync.js
//   docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered
//
// COMO VERIFICAR QUE INJETOU:
//   python3 -c "
//   import json
//   f=json.load(open('/opt/xtconect/nodered/data/flows.json'))
//   ids=['httpIrrCmdSync','fnAuthIrrCmdSync','fnIrrCmdSync','fnHandleIrrAckSync','fnInitCmdSyncMap']
//   found=[n['id'] for n in f if n.get('id') in ids]
//   print('Encontrados:', found)
//   print('Faltando:', [i for i in ids if i not in found])
//   "
//
// COMO TESTAR:
//   # Substitua TOKEN, DEVICE_ID, CMD por valores reais.
//   TOKEN=$(curl -s -X POST https://hub.xtconect.online/api/auth/login \
//     -H 'Content-Type: application/json' \
//     -d '{"email":"SEU_EMAIL","password":"SUA_SENHA"}' \
//     | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
//   DEVICE_ID="<uuid-do-dispositivo>"
//
//   # Teste 1 — device online, ESP responde com ack (deve retornar 200 em <10s)
//   curl -v --max-time 15 \
//     -X POST "https://hub.xtconect.online/api/dispositivos/$DEVICE_ID/irrigacao/comandos/sync" \
//     -H "Authorization: Bearer $TOKEN" \
//     -H "Content-Type: application/json" \
//     -d '{"cmd":"pump_on","params":{}}' 2>&1
//
//   # Teste 2 — device offline (deve retornar 503 imediatamente)
//   # (desligue o ESP ou altere is_online manualmente no banco para FALSE)
//   curl -v -X POST "https://hub.xtconect.online/api/dispositivos/$DEVICE_ID/irrigacao/comandos/sync" \
//     -H "Authorization: Bearer $TOKEN" \
//     -H "Content-Type: application/json" \
//     -d '{"cmd":"pump_on","params":{}}'
//
//   # Teste 3 — timeout (device online mas não responde; deve retornar 504 após ~10s)
//   # Use um device real online mas com ESP sem handler de commands/ack.
//   curl -v --max-time 15 \
//     -X POST "https://hub.xtconect.online/api/dispositivos/$DEVICE_ID/irrigacao/comandos/sync" \
//     -H "Authorization: Bearer $TOKEN" \
//     -H "Content-Type: application/json" \
//     -d '{"cmd":"pump_on","params":{}}'
//
//   # Resposta esperada 200:
//   # {"cmd_id":"<uuid>","ack_status":"executed","ack_code":null,"ack_message":null,"result_payload":null}
//   # Resposta esperada 503:
//   # {"error":"device offline"}
//   # Resposta esperada 504:
//   # {"cmd_id":"<uuid>","status":"timeout"}
//
// DÉBITOS DOCUMENTADOS:
//   D-cmdsync-1: O objeto msg.res (Express Response) é usado diretamente para
//     enviar a resposta HTTP. Isso bypassa o http-response node do Node-RED.
//     Se o Node-RED mudar o contrato interno do objeto res (improvável mas
//     possível em versão major), este código quebra. Mitigação documentada:
//     monitorar notas de release do Node-RED antes de upgrade major.
//
//   D-cmdsync-2: O Map `pending_cmd_promises` é global no contexto do Node-RED
//     (global.get/set). Se o Node-RED reiniciar durante uma espera ativa, a
//     Promise é perdida e o cliente HTTP recebe um erro de conexão resetada
//     (não um 504 limpo). O cliente deve tratar reconnect/retry. Não há
//     mitigação simples sem persistência externa (Redis ou Postgres).
//
//   D-cmdsync-3: O ack handler `fnHandleIrrAckSync` é um PATCH ao
//     `fnHandleIrrAck` existente — adiciona resolução de Promise ao final
//     do UPDATE do banco. Se o _e042a for re-injetado depois deste script,
//     o patch será desfeito (fnHandleIrrAck será recriado limpo). Solução:
//     sempre rodar _e051 APÓS _e042a. Ordem de injeção documentada aqui.
//
//   D-cmdsync-4: O TTL de limpeza do Map é 15s (Promise já resolvida ou
//     rejeitada com timeout). Cenário de edge: se o ESP enviar o ack APÓS
//     os 15s (por exemplo, dispositivo com latência alta ou reenvio MQTT),
//     o ack será descartado silenciosamente pelo handler (cmd_id não no Map).
//     O banco ainda registra o ack (via fnHandleIrrAck original). O cliente
//     HTTP já recebeu 504. Aceitável.
//
//   D-cmdsync-5: O endpoint sync não verifica `expires_at` do comando em
//     relação ao clock do servidor vs clock do ESP. Se o ESP demorar exatamente
//     entre 10s (timeout do servidor) e 30s (expires_at do comando), o ESP
//     executará o comando mas o servidor já devolveu 504. O frontend deve
//     tratar 504 como "incerto, não como falha confirmada" e verificar o
//     endpoint GET /snapshot para estado atual. Documentar no contrato de API.
//
// Idempotente: todos os nodes são removeId+push. O patch em fnHandleIrrAck
//   verifica marcador antes de inserir (não duplica).
//
// Ordem de dependência:
//   _e042a deve ter rodado antes (fnHandleIrrAck deve existir).
//   _e051 pode rodar N vezes sem efeitos colaterais.

const fs = require('fs');
const PATH = '/opt/xtconect/nodered/data/flows.json';
const flows = JSON.parse(fs.readFileSync(PATH, 'utf8'));

function find(id) { return flows.find(n => n.id === id); }
function removeId(id) {
  const i = flows.findIndex(n => n.id === id);
  if (i >= 0) flows.splice(i, 1);
}

// ============================================================
// Padrão auth — cópia exata dos outros scripts
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

const ACCESS_HELPER = [
  "async function checkDeviceAccess(pool, deviceId, user) {",
  "  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;",
  "  if (!UUID_RE.test(deviceId)) return { err: 400, msg: 'id invalido' };",
  "  const isAdmin = user && user.role === 'admin';",
  "  const r = await pool.query(",
  "    `SELECT d.id, d.device_id AS serial, d.user_id AS owner_id, d.status, d.is_online, d.modelo_id,",
  "            m.prefixo, m.major_version",
  "       FROM devices d LEFT JOIN modelos_dispositivo m ON m.id = d.modelo_id",
  "      WHERE d.id = $1 LIMIT 1`, [deviceId]);",
  "  if (r.rowCount === 0) return { err: 404, msg: 'dispositivo nao encontrado' };",
  "  const dev = r.rows[0];",
  "  if (isAdmin) return { device: dev, access: 'admin' };",
  "  if (dev.owner_id === user.id) return { device: dev, access: 'owner' };",
  "  const s = await pool.query(",
  "    `SELECT permissao::text AS permissao FROM dispositivo_compartilhado",
  "       WHERE dispositivo_id = $1 AND com_usuario_id = $2 AND status = 'ativo' LIMIT 1`,",
  "    [deviceId, user.id]);",
  "  if (s.rowCount > 0) return { device: dev, access: 'share', permissao: s.rows[0].permissao };",
  "  return { err: 403, msg: 'sem acesso a este dispositivo' };",
  "}",
].join('\n');

// ============================================================
// 1) Node de inicialização do Map de promises pendentes
//    Roda uma vez no deploy (inject once=true).
//    Idempotente: não sobrescreve se já existe.
// ============================================================
removeId('fnInitCmdSyncMap');
removeId('injInitCmdSyncMap');

flows.push({
  id: 'injInitCmdSyncMap',
  type: 'inject',
  z: 'tabAuth',
  name: 'Init pending_cmd_promises',
  props: [{ p: 'payload' }],
  payload: '', payloadType: 'str',
  repeat: '', crontab: '',
  once: true, onceDelay: 0.1,
  x: 200, y: 5620,
  wires: [['fnInitCmdSyncMap']],
});

flows.push({
  id: 'fnInitCmdSyncMap',
  type: 'function',
  z: 'tabAuth',
  name: 'Init pending_cmd_promises Map',
  func: [
    "// E5.1 — inicializa Map de Promises para comandos síncronos.",
    "// Estrutura: Map<cmd_id, { resolve, reject, timer, ts }>",
    "// O Map é global para ser acessível tanto por fnIrrCmdSync quanto",
    "// por fnHandleIrrAck (que fica na tabIngest).",
    "if (!global.get('pending_cmd_promises')) {",
    "  global.set('pending_cmd_promises', new Map());",
    "  node.log('E5.1: pending_cmd_promises Map inicializado');",
    "} else {",
    "  node.log('E5.1: pending_cmd_promises Map já existia (skip)');",
    "}",
    "node.status({ fill: 'green', shape: 'dot', text: 'map pronto' });",
    "return null;",
  ].join('\n'),
  outputs: 1, libs: [],
  x: 480, y: 5620,
  wires: [[]],
});

// ============================================================
// 2) Endpoint POST /dispositivos/:id/irrigacao/comandos/sync
//    HTTP in → Auth JWT → fnIrrCmdSync (outputs:1, responde via msg.res)
//    Não tem http-response node — resposta é via msg.res diretamente.
//    Não tem mqtt-out node separado — publish via broker MQTT global.
// ============================================================
removeId('httpIrrCmdSync');
removeId('fnAuthIrrCmdSync');
removeId('fnIrrCmdSync');
// Não há respNode para este endpoint — resposta via msg.res inline.

flows.push({
  id: 'httpIrrCmdSync',
  type: 'http in',
  z: 'tabAuth',
  name: 'POST /dispositivos/:id/irrigacao/comandos/sync',
  url: '/dispositivos/:id/irrigacao/comandos/sync',
  method: 'post',
  upload: false, swaggerDoc: '',
  x: 200, y: 5660,
  wires: [['fnAuthIrrCmdSync']],
});

flows.push({
  id: 'fnAuthIrrCmdSync',
  type: 'function',
  z: 'tabAuth',
  name: 'Auth JWT (sync cmd)',
  func: AUTH_FUNC,
  outputs: 2,
  libs: AUTH_LIBS,
  x: 500, y: 5660,
  // saída 0 = autenticado → fnIrrCmdSync
  // saída 1 = erro de auth → responde inline via msg.res (sem http-response node)
  wires: [['fnIrrCmdSync'], ['fnIrrCmdSyncAuthErr']],
});

// Nó auxiliar para tratar erro de auth (sem http-response node no fluxo principal)
removeId('fnIrrCmdSyncAuthErr');
flows.push({
  id: 'fnIrrCmdSyncAuthErr',
  type: 'function',
  z: 'tabAuth',
  name: 'Resp auth error (sync cmd)',
  func: [
    "// Envia resposta de erro de autenticação diretamente via msg.res.",
    "// O msg já tem statusCode e payload setados pelo Auth JWT node.",
    "if (msg.res && !msg.res.headersSent) {",
    "  msg.res.status(msg.statusCode || 401).json(msg.payload || { error: 'unauthorized' });",
    "}",
    "return null;",
  ].join('\n'),
  outputs: 1, libs: [],
  x: 500, y: 5720,
  wires: [[]],
});

flows.push({
  id: 'fnIrrCmdSync',
  type: 'function',
  z: 'tabAuth',
  name: 'POST /comandos/sync',
  func: [
    "// E5.1 — endpoint síncrono de comando IRR-V1.",
    "//",
    "// Fluxo:",
    "//   1. Valida pool + Map de promises.",
    "//   2. Verifica acesso ao device (mesmo checkDeviceAccess dos outros endpoints).",
    "//   3. Verifica is_online=true → 503 se offline.",
    "//   4. Gera cmd_id, insere em irrigation_command_log, publica MQTT.",
    "//   5. Registra Promise no Map com TTL de 10s (resposta) + 15s (limpeza).",
    "//   6. Aguarda Promise (resolve = ack chegou; reject = timeout).",
    "//   7. Envia resposta HTTP 200/504 via msg.res diretamente.",
    "//",
    "// NOTA SOBRE PUBLICAÇÃO MQTT:",
    "//   Reutilizamos o node mqttOutIrrCommands existente via node.send().",
    "//   Como esta é uma função async com await, o Node-RED não vai para o",
    "//   próximo nó antes do return — mas node.send() é imediato e não bloqueia.",
    "//   Portanto: send(publishMsg) → mqtt-out dispara; depois await Promise.",
    "//   O fluxo é: HTTP in → Auth → fnIrrCmdSync (envia MQTT via send saída 1,",
    "//   aguarda ack via Promise, responde via msg.res, retorna null).",
    "//   Saída 1 deste nó aponta para mqttOutIrrCmdSync (novo, abaixo).",

    "const pool = global.get('pgPool');",
    "if (!pool) {",
    "  msg.res.status(503).json({ error: 'db not ready' });",
    "  return null;",
    "}",

    "const pendingMap = global.get('pending_cmd_promises');",
    "if (!pendingMap) {",
    "  msg.res.status(503).json({ error: 'cmd sync map not initialized' });",
    "  return null;",
    "}",

    ACCESS_HELPER,

    "const body = msg.payload || {};",
    "const VALID_CMDS = ['pump_on','pump_off','sector_open','sector_close',",
    "  'sector_pause','sector_resume','mode_set','safe_closure','config_reload','factory_reset'];",
    "if (!body.cmd || !VALID_CMDS.includes(body.cmd)) {",
    "  msg.res.status(400).json({ error: 'cmd invalido' });",
    "  return null;",
    "}",

    "try {",
    "  // 1. Verifica acesso",
    "  const chk = await checkDeviceAccess(pool, msg.req.params.id, msg.user);",
    "  if (chk.err) {",
    "    msg.res.status(chk.err).json({ error: chk.msg });",
    "    return null;",
    "  }",
    "  const device = chk.device;",

    "  // 2. Valida modelo IRR-V1",
    "  if (device.prefixo !== 'IRR' || device.major_version !== 'V1') {",
    "    msg.res.status(400).json({ error: 'device nao e IRR-V1' });",
    "    return null;",
    "  }",

    "  // 3. Viewer share não pode comandar",
    "  if (chk.access === 'share' && chk.permissao !== 'controle') {",
    "    msg.res.status(403).json({ error: 'sem permissao pra comandar' });",
    "    return null;",
    "  }",

    "  // 4. Verifica is_online — ANTES de publicar (spec §1.6: 503 sem publicar)",
    "  if (!device.is_online) {",
    "    msg.res.status(503).json({ error: 'device offline' });",
    "    return null;",
    "  }",

    "  // 5. Gera cmd_id e insere no log",
    "  const cmdId = crypto.randomUUID();",
    "  const issuedAt = new Date();",
    "  // TTL do comando no ESP: 30s (mesmo do fire-and-forget original)",
    "  const expiresAt = new Date(issuedAt.getTime() + 30000);",

    "  await pool.query(",
    "    `INSERT INTO irrigation_command_log",
    "       (cmd_id, device_id, user_id, cmd, params, issued_at, expires_at)",
    "     VALUES ($1, $2, $3, $4, $5, $6, $7)`,",
    "    [cmdId, device.id, msg.user.id, body.cmd,",
    "     JSON.stringify(body.params || {}), issuedAt, expiresAt]",
    "  );",

    "  // 6. Registra Promise ANTES de publicar (evita race condition onde o ack",
    "  //    chegaria antes da Promise estar no Map — improvável mas possível em rede local)",
    "  const ackPromise = new Promise((resolve, reject) => {",
    "    // Timer de 10s para timeout",
    "    const timeoutTimer = setTimeout(() => {",
    "      if (pendingMap.has(cmdId)) {",
    "        pendingMap.delete(cmdId);",
    "        reject(new Error('timeout'));",
    "      }",
    "    }, 10000);",

    "    // Timer de limpeza de segurança: remove do Map após 15s mesmo se resolvida",
    "    // (garante que não haja leak em caso de resolve sem delete)",
    "    const cleanupTimer = setTimeout(() => {",
    "      pendingMap.delete(cmdId);",
    "    }, 15000);",

    "    pendingMap.set(cmdId, {",
    "      resolve: (ackPayload) => {",
    "        clearTimeout(timeoutTimer);",
    "        // cleanup fica; será limpo em 15s ou na próxima iteração",
    "        resolve(ackPayload);",
    "      },",
    "      reject,",
    "      ts: issuedAt,",
    "    });",
    "  });",

    "  // 7. Publica MQTT via saída 1 deste nó (conectada ao mqttOutIrrCmdSync)",
    "  const mqttPayload = {",
    "    cmd_id: cmdId, protocol_version: 1,",
    "    cmd: body.cmd, params: body.params || {},",
    "    issued_at: issuedAt.toISOString(), expires_at: expiresAt.toISOString(),",
    "    origin: 'manual_app_remote', user_id: msg.user.id",
    "  };",
    "  const publishMsg = {",
    "    topic: 'devices/' + device.serial + '/commands',",
    "    payload: JSON.stringify(mqttPayload),",
    "    qos: 1, retain: false",
    "  };",
    "  // node.send([null, publishMsg]) — saída 0 = null (sem resposta HTTP ainda),",
    "  // saída 1 = publishMsg para o mqtt-out node.",
    "  node.send([null, publishMsg]);",

    "  // 8. Aguarda ack (bloqueia este handler HTTP até resolve ou timeout)",
    "  try {",
    "    const ack = await ackPromise;",
    "    // ack = { cmd_id, ack_status, ack_code, ack_message, result_payload }",
    "    if (!msg.res.headersSent) {",
    "      msg.res.status(200).json({",
    "        cmd_id: cmdId,",
    "        ack_status: ack.ack_status,",
    "        ack_code: ack.ack_code || null,",
    "        ack_message: ack.ack_message || null,",
    "        result_payload: ack.result_payload || null,",
    "      });",
    "    }",
    "  } catch(e) {",
    "    // timeout ou rejeição",
    "    if (!msg.res.headersSent) {",
    "      msg.res.status(504).json({ cmd_id: cmdId, status: 'timeout' });",
    "    }",
    "    // Garante limpeza do Map (o timer de 15s também limparia, mas belt+suspenders)",
    "    pendingMap.delete(cmdId);",
    "  }",

    "} catch(e) {",
    "  node.error('fnIrrCmdSync: ' + e.message, msg);",
    "  if (!msg.res.headersSent) {",
    "    msg.res.status(500).json({ error: 'internal' });",
    "  }",
    "}",
    "// Retorna null — resposta já foi enviada via msg.res acima.",
    "// O http-response node NÃO é utilizado neste fluxo.",
    "return null;",
  ].join('\n'),
  outputs: 2,
  libs: [{ var: 'crypto', module: 'crypto' }],
  x: 820, y: 5660,
  // saída 0 = null (sem http-response node)
  // saída 1 = publish para mqttOutIrrCmdSync
  wires: [[], ['mqttOutIrrCmdSync']],
});

// mqtt-out node dedicado para o endpoint sync
removeId('mqttOutIrrCmdSync');
flows.push({
  id: 'mqttOutIrrCmdSync',
  type: 'mqtt out',
  z: 'tabAuth',
  name: 'publish commands (sync)',
  topic: '', qos: '1', retain: 'false',
  broker: 'brokerMosq',
  x: 1100, y: 5720,
  wires: [],
});

// ============================================================
// 3) PATCH em fnHandleIrrAck — adiciona resolução de Promise
//    após o UPDATE do banco (que já existia no _e042a).
//
//    Marcador de idempotência: string 'E5.1 — resolve pending Promise'
//    Se já existe no func, não patcha de novo.
//
//    NOTA SOBRE MAPEAMENTO DE CAMPOS:
//    O payload de ack do ESP tem: {cmd_id, status, reason, result_payload}
//    A spec do PLANO §1.6 chama de {ack_status, ack_code, ack_message, result_payload}
//    Mapeamento: status→ack_status, reason→ack_message, sem ack_code (ESP não envia).
//    O campo ack_code é reservado para códigos numéricos de erro (ex: GPIO fault).
//    Por ora fica null até o firmware implementar.
// ============================================================
{
  const n = find('fnHandleIrrAck');
  if (!n) {
    throw new Error(
      'fnHandleIrrAck not found in flows.json. ' +
      'Rode _e042a_inject_irr_v1_write.js antes deste script.'
    );
  }

  const IDEMPOTENCY_MARKER = '// E5.1 — resolve pending Promise';
  if (!n.func.includes(IDEMPOTENCY_MARKER)) {
    // Insere antes do último "return null;" do handler.
    // O handler atual termina com:
    //   node.status({fill:'green',...});
    // } catch(e) { node.error(...); }
    // return null;
    //
    // Inserimos após o bloco try/catch principal, antes do return null final.
    const PATCH_MARKER = "return null;";
    // Garantir que pegamos o ÚLTIMO return null (o do nó, não de um inner return)
    const lastIdx = n.func.lastIndexOf(PATCH_MARKER);
    if (lastIdx === -1) {
      throw new Error('fnHandleIrrAck: marcador "return null;" nao encontrado. Patch manual necessario.');
    }

    const insertion = [
      "",
      "// E5.1 — resolve pending Promise se houver cliente HTTP aguardando este cmd_id.",
      "// O Map pending_cmd_promises é o mesmo registrado pelo fnIrrCmdSync.",
      "// Mapeamento de campos: status→ack_status, reason→ack_message.",
      "// Se não há Promise pendente (ex: fire-and-forget original), é no-op.",
      "try {",
      "  const pendingMap = global.get('pending_cmd_promises');",
      "  if (pendingMap && ack && ack.cmd_id && pendingMap.has(ack.cmd_id)) {",
      "    const entry = pendingMap.get(ack.cmd_id);",
      "    pendingMap.delete(ack.cmd_id);",
      "    entry.resolve({",
      "      ack_status: ack.status,",
      "      ack_code: ack.ack_code || null,",   // reservado para futuro
      "      ack_message: ack.reason || null,",
      "      result_payload: ack.result_payload || null,",
      "    });",
      "    node.log('E5.1: ack resolveu Promise para cmd_id ' + ack.cmd_id);",
      "  }",
      "} catch(e) {",
      "  node.warn('E5.1: erro ao resolver Promise de ack: ' + e.message);",
      "}",
      "",
    ].join('\n');

    n.func = n.func.slice(0, lastIdx) + insertion + n.func.slice(lastIdx);
  }
}

// ============================================================
fs.writeFileSync(PATH, JSON.stringify(flows, null, 4));
console.log('E5.1: endpoint /comandos/sync + init Map + patch fnHandleIrrAck injetados.');
console.log('  Nodes novos: httpIrrCmdSync, fnAuthIrrCmdSync, fnIrrCmdSyncAuthErr,');
console.log('               fnIrrCmdSync, mqttOutIrrCmdSync,');
console.log('               injInitCmdSyncMap, fnInitCmdSyncMap');
console.log('  Patch: fnHandleIrrAck — adicionada resolucao de Promise (idempotente)');
console.log('Reinicie: docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
console.log("INJECTED OK");
