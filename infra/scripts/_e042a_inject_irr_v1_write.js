#!/usr/bin/env node
// E4.2A — IRR-V1 write endpoints + MQTT subscribers (refs #71)
//
// Idempotente. Injeta no flows.json:
//   SUBSCRIBERS (device→server):
//     devices/+/state           → upsert irrigation_device_state
//     devices/+/events          → INSERT irrigation_events (dedup)
//     devices/+/commands/ack    → UPDATE irrigation_command_log
//
//   ENDPOINTS (write):
//     POST   /irrigacao/comandos
//     PATCH  /irrigacao/config
//     PATCH  /irrigacao/setores/:numero
//     POST   /irrigacao/timers        (com overlap detection)
//     PATCH  /irrigacao/timers/:id
//     DELETE /irrigacao/timers/:id
//
//   UPDATE:
//     fnIrrSnapshot — agora mescla state da tabela 014
//
//   LIB:
//     fnInitIrrOverlapLib — carrega timer-overlap no global on deploy
//
// Fora de escopo (Fase 3+):
//   - subscriber config/current
//   - CRUD sensores + alarms ack + factory-reset

const fs = require('fs');
const PATH = '/opt/xtconect/nodered/data/flows.json';
const flows = JSON.parse(fs.readFileSync(PATH, 'utf8'));
function find(id) { return flows.find(n => n.id === id); }
function removeId(id) {
  const i = flows.findIndex(n => n.id === id);
  if (i >= 0) flows.splice(i, 1);
}

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

function httpInNode(id, name, url, method, x, y, nextId) {
  return { id, type: 'http in', z: 'tabAuth', name, url, method,
    upload: false, swaggerDoc: '', x, y, wires: [[nextId]] };
}
function authNode(id, x, y, okWire, errWire) {
  return { id, type: 'function', z: 'tabAuth', name: 'Auth JWT',
    func: AUTH_FUNC, outputs: 2, libs: AUTH_LIBS, x, y, wires: [[okWire], [errWire]] };
}
function respNode(id, x, y) {
  return { id, type: 'http response', z: 'tabAuth', name: '',
    statusCode: '', headers: { 'Content-Type': 'application/json' }, x, y, wires: [] };
}

const ACCESS_HELPER = [
  "async function checkDeviceAccess(pool, deviceId, user) {",
  "  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;",
  "  if (!UUID_RE.test(deviceId)) return { err: 400, msg: 'id invalido' };",
  "  const isAdmin = user && user.role === 'admin';",
  "  const r = await pool.query(",
  "    `SELECT d.id, d.device_id AS serial, d.user_id AS owner_id, d.status, d.modelo_id,",
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
// LIB init — carrega timer-overlap pro global context
// (inline; source of truth em infra/scripts/lib/timer-overlap.cjs)
// ============================================================
const OVERLAP_LIB_SRC = fs.readFileSync(
  __dirname + '/lib/timer-overlap.cjs',
  'utf8'
).replace("module.exports = { detectOverlap, expandTimer, hmToMin, minToHm };", "");

removeId('fnInitIrrOverlapLib');
flows.push({
  id: 'fnInitIrrOverlapLib', type: 'function', z: 'tabAuth',
  name: 'Init timer-overlap lib',
  func: [
    "// E4.2A — timer overlap detection (mirror de timer-overlap.cjs)",
    "if (global.get('irrTimerOverlap')) { node.status({fill:'green',shape:'dot',text:'overlap ready'}); return null; }",
    "",
    OVERLAP_LIB_SRC,
    "",
    "global.set('irrTimerOverlap', { detectOverlap, expandTimer, hmToMin, minToHm });",
    "node.status({fill:'green',shape:'dot',text:'overlap loaded'});",
    "return null;"
  ].join('\n'),
  outputs: 1, libs: [],
  x: 200, y: 4300, wires: [[]],
});
// Trigger init node no startup (inject node)
removeId('injectInitOverlap');
flows.push({
  id: 'injectInitOverlap', type: 'inject', z: 'tabAuth',
  name: 'Init overlap on deploy', props: [{p:'payload'}, {p:'topic',vt:'str'}],
  payload: '', payloadType: 'str', topic: '', once: true, onceDelay: 0.1,
  repeat: '', crontab: '',
  x: 200, y: 4260, wires: [['fnInitIrrOverlapLib']],
});

// ============================================================
// SUBSCRIBERS
// ============================================================

// 1) devices/+/state → upsert irrigation_device_state
removeId('mqttInIrrState');
removeId('fnHandleIrrState');
flows.push({
  id: 'mqttInIrrState', type: 'mqtt in', z: 'tabIngest',
  name: 'devices/+/state', topic: 'devices/+/state', qos: '1',
  datatype: 'auto-detect', broker: 'brokerMosq',
  nl: false, rap: true, rh: 0, inputs: 0,
  x: 200, y: 4400, wires: [['fnHandleIrrState']],
});
flows.push({
  id: 'fnHandleIrrState', type: 'function', z: 'tabAuth',
  name: 'Upsert irrigation_device_state',
  func: [
    "const pool = global.get('pgPool');",
    "if (!pool) return null;",
    "const topic = msg.topic || '';",
    "const parts = topic.split('/');",
    "if (parts.length !== 3 || parts[0] !== 'devices' || parts[2] !== 'state') return null;",
    "const mqttUser = parts[1];",
    "let stateJson = null;",
    "try {",
    "  const raw = Buffer.isBuffer(msg.payload) ? msg.payload.toString('utf8') :",
    "              (typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload));",
    "  if (!raw || raw.trim() === '') return null;",
    "  stateJson = JSON.parse(raw);",
    "  if (!stateJson || typeof stateJson !== 'object') return null;",
    "} catch(e) { node.warn('state JSON invalido: '+e.message); return null; }",
    "try {",
    "  await pool.query(",
    "    `INSERT INTO irrigation_device_state (device_id, state_json, received_at)",
    "       SELECT d.id, $2::jsonb, NOW() FROM devices d WHERE d.mqtt_username = $1",
    "     ON CONFLICT (device_id) DO UPDATE SET state_json=EXCLUDED.state_json, received_at=NOW()`,",
    "    [mqttUser, JSON.stringify(stateJson)]",
    "  );",
    "  node.status({fill:'green',shape:'dot',text: mqttUser+' '+new Date().toISOString().slice(11,19)});",
    "} catch(e) { node.error('state upsert: '+e.message); }",
    "return null;"
  ].join('\n'),
  outputs: 1, libs: [],
  x: 500, y: 4400, wires: [[]],
});

// 2) devices/+/events → INSERT irrigation_events (dedup)
removeId('mqttInIrrEvents');
removeId('fnHandleIrrEvents');
flows.push({
  id: 'mqttInIrrEvents', type: 'mqtt in', z: 'tabIngest',
  name: 'devices/+/events', topic: 'devices/+/events', qos: '1',
  datatype: 'auto-detect', broker: 'brokerMosq',
  nl: false, rap: true, rh: 0, inputs: 0,
  x: 200, y: 4500, wires: [['fnHandleIrrEvents']],
});
flows.push({
  id: 'fnHandleIrrEvents', type: 'function', z: 'tabAuth',
  name: 'INSERT irrigation_events',
  func: [
    "const pool = global.get('pgPool');",
    "if (!pool) return null;",
    "const parts = (msg.topic || '').split('/');",
    "if (parts.length !== 3 || parts[2] !== 'events') return null;",
    "const mqttUser = parts[1];",
    "let ev = null;",
    "try {",
    "  const raw = Buffer.isBuffer(msg.payload) ? msg.payload.toString('utf8') :",
    "              (typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload));",
    "  ev = JSON.parse(raw);",
    "  if (!ev || typeof ev !== 'object') return null;",
    "} catch(e) { node.warn('event JSON invalido: '+e.message); return null; }",
    "const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;",
    "if (!ev.event_uuid || !UUID_RE.test(ev.event_uuid)) { node.warn('event_uuid faltando/invalido'); return null; }",
    "if (!ev.event_type) { node.warn('event_type faltando'); return null; }",
    "try {",
    "  const dev = await pool.query('SELECT id FROM devices WHERE mqtt_username=$1', [mqttUser]);",
    "  if (dev.rowCount === 0) return null;",
    "  await pool.query(",
    "    `INSERT INTO irrigation_events",
    "       (device_id, event_uuid, event_type, alvo_tipo, alvo_id, origem, resultado, duracao_s, payload_json, ts)",
    "     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    "     ON CONFLICT (device_id, event_uuid) DO NOTHING`,",
    "    [dev.rows[0].id, ev.event_uuid, ev.event_type,",
    "     ev.alvo_tipo || null, ev.alvo_id || null,",
    "     ev.origem || null, ev.resultado || null, ev.duracao_s || null,",
    "     JSON.stringify(ev.payload || ev.payload_json || {}),",
    "     ev.ts || new Date().toISOString()]",
    "  );",
    "  node.status({fill:'green',shape:'dot',text: mqttUser+'·'+ev.event_type});",
    "} catch(e) { node.error('event insert: '+e.message); }",
    "return null;"
  ].join('\n'),
  outputs: 1, libs: [],
  x: 500, y: 4500, wires: [[]],
});

// 3) devices/+/commands/ack → UPDATE irrigation_command_log
removeId('mqttInIrrAck');
removeId('fnHandleIrrAck');
flows.push({
  id: 'mqttInIrrAck', type: 'mqtt in', z: 'tabIngest',
  name: 'devices/+/commands/ack', topic: 'devices/+/commands/ack', qos: '1',
  datatype: 'auto-detect', broker: 'brokerMosq',
  nl: false, rap: true, rh: 0, inputs: 0,
  x: 200, y: 4600, wires: [['fnHandleIrrAck']],
});
flows.push({
  id: 'fnHandleIrrAck', type: 'function', z: 'tabAuth',
  name: 'UPDATE irrigation_command_log',
  func: [
    "const pool = global.get('pgPool');",
    "if (!pool) return null;",
    "let ack = null;",
    "try {",
    "  const raw = Buffer.isBuffer(msg.payload) ? msg.payload.toString('utf8') :",
    "              (typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload));",
    "  ack = JSON.parse(raw);",
    "  if (!ack || !ack.cmd_id || !ack.status) return null;",
    "} catch(e) { node.warn('ack JSON invalido: '+e.message); return null; }",
    "const valid = ['accepted','executed','refused','expired'];",
    "if (!valid.includes(ack.status)) { node.warn('ack status invalido: '+ack.status); return null; }",
    "try {",
    "  await pool.query(",
    "    `UPDATE irrigation_command_log",
    "        SET ack_status = $1, ack_reason = $2, ack_received_at = NOW(),",
    "            result_payload = $3",
    "      WHERE cmd_id = $4`,",
    "    [ack.status, ack.reason || null,",
    "     ack.result_payload ? JSON.stringify(ack.result_payload) : null,",
    "     ack.cmd_id]",
    "  );",
    "  node.status({fill:'green',shape:'dot',text: ack.cmd_id.slice(0,8)+' '+ack.status});",
    "} catch(e) { node.error('ack update: '+e.message); }",
    "return null;"
  ].join('\n'),
  outputs: 1, libs: [],
  x: 500, y: 4600, wires: [[]],
});

// ============================================================
// ENDPOINT: POST /irrigacao/comandos (core)
// ============================================================
removeId('httpIrrComandos');
removeId('fnAuthIrrComandos');
removeId('fnIrrComandos');
removeId('respIrrComandos');
removeId('mqttOutIrrCommands');

flows.push(httpInNode('httpIrrComandos', 'POST /dispositivos/:id/irrigacao/comandos',
  '/dispositivos/:id/irrigacao/comandos', 'post', 200, 4700, 'fnAuthIrrComandos'));
flows.push(authNode('fnAuthIrrComandos', 440, 4700, 'fnIrrComandos', 'respIrrComandos'));
flows.push({
  id: 'fnIrrComandos', type: 'function', z: 'tabAuth', name: 'POST /comandos',
  func: [
    "const pool = global.get('pgPool');",
    "if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return [msg, null]; }",
    ACCESS_HELPER,
    "const body = msg.payload || {};",
    "const VALID_CMDS = ['pump_on','pump_off','sector_open','sector_close','sector_pause','sector_resume','mode_set','safe_closure','config_reload','factory_reset'];",
    "if (!body.cmd || !VALID_CMDS.includes(body.cmd)) {",
    "  msg.statusCode=400; msg.payload={error:'cmd invalido'}; return [msg, null];",
    "}",
    "try {",
    "  const chk = await checkDeviceAccess(pool, msg.req.params.id, msg.user);",
    "  if (chk.err) { msg.statusCode=chk.err; msg.payload={error:chk.msg}; return [msg, null]; }",
    "  const device = chk.device;",
    "  if (device.prefixo !== 'IRR' || device.major_version !== 'V1') {",
    "    msg.statusCode=400; msg.payload={error:'device nao e IRR-V1'}; return [msg, null];",
    "  }",
    "  // Viewer share não pode comandar; só owner/operator/admin.",
    "  if (chk.access === 'share' && chk.permissao !== 'controle') {",
    "    msg.statusCode=403; msg.payload={error:'sem permissao pra comandar'}; return [msg, null];",
    "  }",
    "  const cmdId = crypto.randomUUID();",
    "  const issuedAt = new Date();",
    "  const expiresAt = new Date(issuedAt.getTime() + 30000);",
    "  await pool.query(",
    "    `INSERT INTO irrigation_command_log",
    "       (cmd_id, device_id, user_id, cmd, params, issued_at, expires_at)",
    "     VALUES ($1, $2, $3, $4, $5, $6, $7)`,",
    "    [cmdId, device.id, msg.user.id, body.cmd,",
    "     JSON.stringify(body.params || {}), issuedAt, expiresAt]",
    "  );",
    "  // Monta payload MQTT",
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
    "  msg.statusCode = 200;",
    "  msg.payload = { cmd_id: cmdId, issued_at: issuedAt.toISOString(), expires_at: expiresAt.toISOString() };",
    "  return [msg, publishMsg];",
    "} catch(e) {",
    "  node.error('irrigacao comandos: '+e.message, msg);",
    "  msg.statusCode=500; msg.payload={error:'internal'};",
    "  return [msg, null];",
    "}"
  ].join('\n'),
  outputs: 2, libs: [{ var: 'crypto', module: 'crypto' }],
  x: 700, y: 4700, wires: [['respIrrComandos'], ['mqttOutIrrCommands']],
});
flows.push(respNode('respIrrComandos', 940, 4700));
flows.push({
  id: 'mqttOutIrrCommands', type: 'mqtt out', z: 'tabAuth',
  name: 'publish commands', topic: '', qos: '1', retain: 'false',
  broker: 'brokerMosq',
  x: 940, y: 4760, wires: [],
});

// ============================================================
// ENDPOINT: PATCH /irrigacao/config
// ============================================================
removeId('httpIrrPatchConfig');
removeId('fnAuthIrrPatchConfig');
removeId('fnIrrPatchConfig');
removeId('respIrrPatchConfig');

flows.push(httpInNode('httpIrrPatchConfig', 'PATCH /dispositivos/:id/irrigacao/config',
  '/dispositivos/:id/irrigacao/config', 'patch', 200, 4800, 'fnAuthIrrPatchConfig'));
flows.push(authNode('fnAuthIrrPatchConfig', 440, 4800, 'fnIrrPatchConfig', 'respIrrPatchConfig'));
flows.push({
  id: 'fnIrrPatchConfig', type: 'function', z: 'tabAuth', name: 'PATCH /config',
  func: [
    "const pool = global.get('pgPool');",
    "if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }",
    ACCESS_HELPER,
    "const body = msg.payload || {};",
    "const ALLOWED = ['modo_operacao','tipo_bomba','reforco_rele_ativo','nivel_ativo_bomba',",
    "                  'atraso_abrir_valvula_antes_bomba_s','tempo_bomba_desligada_antes_fechar_valvula_s',",
    "                  'atraso_religar_bomba_apos_fechamento_s','tempo_max_continuo_bomba_min',",
    "                  'tempo_max_manual_local_min','tempo_max_manual_remoto_sem_internet_min',",
    "                  'botao_fisico_tipo','botao_debounce_ms','botao_assume_manual','gpio_1wire'];",
    "const sets = []; const params = [];",
    "let idx = 0;",
    "for (const k of Object.keys(body)) {",
    "  if (!ALLOWED.includes(k)) continue;",
    "  idx++; params.push(body[k]); sets.push(k+'=$' + idx);",
    "}",
    "if (sets.length === 0) { msg.statusCode=400; msg.payload={error:'nada pra atualizar'}; return msg; }",
    "try {",
    "  const chk = await checkDeviceAccess(pool, msg.req.params.id, msg.user);",
    "  if (chk.err) { msg.statusCode=chk.err; msg.payload={error:chk.msg}; return msg; }",
    "  const device = chk.device;",
    "  if (device.prefixo !== 'IRR' || device.major_version !== 'V1') {",
    "    msg.statusCode=400; msg.payload={error:'device nao e IRR-V1'}; return msg;",
    "  }",
    "  if (chk.access === 'share' && chk.permissao !== 'controle') {",
    "    msg.statusCode=403; msg.payload={error:'sem permissao'}; return msg;",
    "  }",
    "  idx++; params.push(device.id);",
    "  const sql = 'UPDATE irrigation_configs SET ' + sets.join(', ') + ', atualizado_em=NOW() WHERE device_id=$' + idx + ' RETURNING *';",
    "  const r = await pool.query(sql, params);",
    "  if (r.rowCount === 0) { msg.statusCode=404; msg.payload={error:'config nao provisionada'}; return msg; }",
    "  msg.statusCode=200; msg.payload={ config: r.rows[0] };",
    "} catch(e) {",
    "  if (/check constraint|violates/i.test(e.message)) {",
    "    msg.statusCode=422; msg.payload={error:'valor invalido', detail:e.message};",
    "  } else { node.error('patch config: '+e.message, msg); msg.statusCode=500; msg.payload={error:'internal'}; }",
    "}",
    "return msg;"
  ].join('\n'),
  outputs: 1, libs: [],
  x: 700, y: 4800, wires: [['respIrrPatchConfig']],
});
flows.push(respNode('respIrrPatchConfig', 940, 4800));

// ============================================================
// ENDPOINT: PATCH /irrigacao/setores/:numero
// ============================================================
removeId('httpIrrPatchSector');
removeId('fnAuthIrrPatchSector');
removeId('fnIrrPatchSector');
removeId('respIrrPatchSector');

flows.push(httpInNode('httpIrrPatchSector', 'PATCH /dispositivos/:id/irrigacao/setores/:numero',
  '/dispositivos/:id/irrigacao/setores/:numero', 'patch', 200, 4900, 'fnAuthIrrPatchSector'));
flows.push(authNode('fnAuthIrrPatchSector', 440, 4900, 'fnIrrPatchSector', 'respIrrPatchSector'));
flows.push({
  id: 'fnIrrPatchSector', type: 'function', z: 'tabAuth', name: 'PATCH /setores/:numero',
  func: [
    "const pool = global.get('pgPool');",
    "if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }",
    ACCESS_HELPER,
    "const numero = parseInt(msg.req.params.numero, 10);",
    "if (!Number.isFinite(numero) || numero < 1 || numero > 8) {",
    "  msg.statusCode=400; msg.payload={error:'numero invalido (1..8)'}; return msg;",
    "}",
    "const body = msg.payload || {};",
    "const ALLOWED = ['nome','habilitado','pausado','nivel_ativo_rele',",
    "                  'tipo_botao_fisico','gpio_botao','debounce_ms'];",
    "// gpio_rele e numero NÃO editáveis: firmware é autoridade do pinout (R6)",
    "const sets = []; const params = [];",
    "let idx = 0;",
    "for (const k of Object.keys(body)) {",
    "  if (!ALLOWED.includes(k)) continue;",
    "  idx++; params.push(body[k]); sets.push(k+'=$'+idx);",
    "}",
    "if (sets.length === 0) { msg.statusCode=400; msg.payload={error:'nada pra atualizar'}; return msg; }",
    "try {",
    "  const chk = await checkDeviceAccess(pool, msg.req.params.id, msg.user);",
    "  if (chk.err) { msg.statusCode=chk.err; msg.payload={error:chk.msg}; return msg; }",
    "  const device = chk.device;",
    "  if (device.prefixo !== 'IRR' || device.major_version !== 'V1') {",
    "    msg.statusCode=400; msg.payload={error:'device nao e IRR-V1'}; return msg;",
    "  }",
    "  if (chk.access === 'share' && chk.permissao !== 'controle') {",
    "    msg.statusCode=403; msg.payload={error:'sem permissao'}; return msg;",
    "  }",
    "  idx++; params.push(device.id);",
    "  idx++; params.push(numero);",
    "  const sql = 'UPDATE irrigation_sectors SET ' + sets.join(', ') + ', atualizado_em=NOW() WHERE device_id=$' + (idx-1) + ' AND numero=$' + idx + ' RETURNING *';",
    "  const r = await pool.query(sql, params);",
    "  if (r.rowCount === 0) { msg.statusCode=404; msg.payload={error:'setor nao encontrado'}; return msg; }",
    "  msg.statusCode=200; msg.payload={ setor: r.rows[0] };",
    "} catch(e) {",
    "  if (/check constraint|violates/i.test(e.message)) {",
    "    msg.statusCode=422; msg.payload={error:'valor invalido', detail:e.message};",
    "  } else { node.error('patch setor: '+e.message, msg); msg.statusCode=500; msg.payload={error:'internal'}; }",
    "}",
    "return msg;"
  ].join('\n'),
  outputs: 1, libs: [],
  x: 700, y: 4900, wires: [['respIrrPatchSector']],
});
flows.push(respNode('respIrrPatchSector', 940, 4900));

// ============================================================
// ENDPOINT: POST /irrigacao/timers  (overlap detection)
// ============================================================
removeId('httpIrrPostTimer');
removeId('fnAuthIrrPostTimer');
removeId('fnIrrPostTimer');
removeId('respIrrPostTimer');

flows.push(httpInNode('httpIrrPostTimer', 'POST /dispositivos/:id/irrigacao/timers',
  '/dispositivos/:id/irrigacao/timers', 'post', 200, 5000, 'fnAuthIrrPostTimer'));
flows.push(authNode('fnAuthIrrPostTimer', 440, 5000, 'fnIrrPostTimer', 'respIrrPostTimer'));
flows.push({
  id: 'fnIrrPostTimer', type: 'function', z: 'tabAuth', name: 'POST /timers',
  func: [
    "const pool = global.get('pgPool');",
    "if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }",
    "const overlap = global.get('irrTimerOverlap');",
    "if (!overlap) { msg.statusCode=503; msg.payload={error:'overlap lib not ready'}; return msg; }",
    ACCESS_HELPER,
    "const body = msg.payload || {};",
    "const REQ = ['alvo_tipo','tipo','nome','dias_semana'];",
    "for (const k of REQ) if (body[k] == null) { msg.statusCode=400; msg.payload={error:'faltando: '+k}; return msg; }",
    "if (!['pump','sector'].includes(body.alvo_tipo)) { msg.statusCode=400; msg.payload={error:'alvo_tipo invalido'}; return msg; }",
    "if (!['fixed','cyclic_window','cyclic_continuous'].includes(body.tipo)) { msg.statusCode=400; msg.payload={error:'tipo invalido'}; return msg; }",
    "if (body.alvo_tipo === 'sector' && !body.alvo_id) { msg.statusCode=400; msg.payload={error:'alvo_id obrigatorio quando alvo_tipo=sector'}; return msg; }",
    "if (body.alvo_tipo === 'pump' && body.alvo_id) { msg.statusCode=400; msg.payload={error:'alvo_id deve ser null quando alvo_tipo=pump'}; return msg; }",
    "try {",
    "  const chk = await checkDeviceAccess(pool, msg.req.params.id, msg.user);",
    "  if (chk.err) { msg.statusCode=chk.err; msg.payload={error:chk.msg}; return msg; }",
    "  const device = chk.device;",
    "  if (device.prefixo !== 'IRR' || device.major_version !== 'V1') {",
    "    msg.statusCode=400; msg.payload={error:'device nao e IRR-V1'}; return msg;",
    "  }",
    "  if (chk.access === 'share' && chk.permissao !== 'controle') {",
    "    msg.statusCode=403; msg.payload={error:'sem permissao'}; return msg;",
    "  }",
    "  // Overlap detection",
    "  const existing = await pool.query(",
    "    'SELECT id, alvo_tipo, alvo_id, tipo, nome, ativo, hora_inicio::text, hora_fim::text, duracao_min, on_minutes, off_minutes, dias_semana FROM irrigation_timers WHERE device_id=$1 AND ativo=TRUE',",
    "    [device.id]",
    "  );",
    "  const result = overlap.detectOverlap(existing.rows, body);",
    "  if (result.errors.length > 0) {",
    "    msg.statusCode = 422;",
    "    msg.payload = { error: 'conflito_mesmo_alvo', conflitos: result.errors };",
    "    return msg;",
    "  }",
    "  if (result.warnings.length > 0 && !body.overlap_confirmed) {",
    "    msg.statusCode = 409;",
    "    msg.payload = { error: 'conflito_alvo_diferente', conflitos: result.warnings, requires: 'overlap_confirmed' };",
    "    return msg;",
    "  }",
    "  // INSERT",
    "  try {",
    "    const r = await pool.query(",
    "      `INSERT INTO irrigation_timers",
    "         (device_id, alvo_tipo, alvo_id, tipo, nome, ativo, pausado,",
    "          hora_inicio, hora_fim, duracao_min, on_minutes, off_minutes,",
    "          dias_semana, overlap_confirmed, observacao)",
    "       VALUES ($1,$2,$3,$4,$5,TRUE,FALSE,$6,$7,$8,$9,$10,$11,$12,$13)",
    "       RETURNING *`,",
    "      [device.id, body.alvo_tipo, body.alvo_id || null, body.tipo, body.nome,",
    "       body.hora_inicio || null, body.hora_fim || null, body.duracao_min || null,",
    "       body.on_minutes || null, body.off_minutes || null,",
    "       body.dias_semana, body.overlap_confirmed === true, body.observacao || null]",
    "    );",
    "    msg.statusCode = 201; msg.payload = { timer: r.rows[0] };",
    "  } catch(e) {",
    "    if (/limit_reached:10_timers_per_target/.test(e.message)) {",
    "      msg.statusCode=422; msg.payload={error:'limite 10 timers por alvo atingido'};",
    "    } else if (/check constraint|violates/i.test(e.message)) {",
    "      msg.statusCode=422; msg.payload={error:'valor invalido', detail:e.message};",
    "    } else { throw e; }",
    "  }",
    "} catch(e) {",
    "  node.error('post timer: '+e.message, msg);",
    "  msg.statusCode=500; msg.payload={error:'internal'};",
    "}",
    "return msg;"
  ].join('\n'),
  outputs: 1, libs: [],
  x: 700, y: 5000, wires: [['respIrrPostTimer']],
});
flows.push(respNode('respIrrPostTimer', 940, 5000));

// ============================================================
// ENDPOINT: PATCH /irrigacao/timers/:id
// ============================================================
removeId('httpIrrPatchTimer');
removeId('fnAuthIrrPatchTimer');
removeId('fnIrrPatchTimer');
removeId('respIrrPatchTimer');

flows.push(httpInNode('httpIrrPatchTimer', 'PATCH /dispositivos/:id/irrigacao/timers/:timer_id',
  '/dispositivos/:id/irrigacao/timers/:timer_id', 'patch', 200, 5100, 'fnAuthIrrPatchTimer'));
flows.push(authNode('fnAuthIrrPatchTimer', 440, 5100, 'fnIrrPatchTimer', 'respIrrPatchTimer'));
flows.push({
  id: 'fnIrrPatchTimer', type: 'function', z: 'tabAuth', name: 'PATCH /timers/:id',
  func: [
    "const pool = global.get('pgPool');",
    "if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }",
    "const overlap = global.get('irrTimerOverlap');",
    "if (!overlap) { msg.statusCode=503; msg.payload={error:'overlap lib not ready'}; return msg; }",
    ACCESS_HELPER,
    "const timerId = msg.req.params.timer_id;",
    "const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;",
    "if (!UUID_RE.test(timerId)) { msg.statusCode=400; msg.payload={error:'timer_id invalido'}; return msg; }",
    "const body = msg.payload || {};",
    "const ALLOWED = ['nome','ativo','pausado','hora_inicio','hora_fim','duracao_min',",
    "                  'on_minutes','off_minutes','dias_semana','observacao','overlap_confirmed'];",
    "const upd = {}; for (const k of Object.keys(body)) if (ALLOWED.includes(k)) upd[k] = body[k];",
    "if (Object.keys(upd).length === 0) { msg.statusCode=400; msg.payload={error:'nada pra atualizar'}; return msg; }",
    "try {",
    "  const chk = await checkDeviceAccess(pool, msg.req.params.id, msg.user);",
    "  if (chk.err) { msg.statusCode=chk.err; msg.payload={error:chk.msg}; return msg; }",
    "  const device = chk.device;",
    "  if (device.prefixo !== 'IRR' || device.major_version !== 'V1') {",
    "    msg.statusCode=400; msg.payload={error:'device nao e IRR-V1'}; return msg;",
    "  }",
    "  if (chk.access === 'share' && chk.permissao !== 'controle') {",
    "    msg.statusCode=403; msg.payload={error:'sem permissao'}; return msg;",
    "  }",
    "  // Fetch current",
    "  const cur = await pool.query('SELECT * FROM irrigation_timers WHERE id=$1 AND device_id=$2', [timerId, device.id]);",
    "  if (cur.rowCount === 0) { msg.statusCode=404; msg.payload={error:'timer nao encontrado'}; return msg; }",
    "  const merged = Object.assign({}, cur.rows[0], upd);",
    "  // Re-validate overlap com outros timers ativos (exceto o próprio)",
    "  const existing = await pool.query(",
    "    'SELECT id, alvo_tipo, alvo_id, tipo, nome, ativo, hora_inicio::text, hora_fim::text, duracao_min, on_minutes, off_minutes, dias_semana FROM irrigation_timers WHERE device_id=$1 AND ativo=TRUE AND id<>$2',",
    "    [device.id, timerId]",
    "  );",
    "  const result = overlap.detectOverlap(existing.rows, merged);",
    "  if (result.errors.length > 0) { msg.statusCode=422; msg.payload={error:'conflito_mesmo_alvo', conflitos:result.errors}; return msg; }",
    "  if (result.warnings.length > 0 && !body.overlap_confirmed && !cur.rows[0].overlap_confirmed) {",
    "    msg.statusCode=409; msg.payload={error:'conflito_alvo_diferente', conflitos:result.warnings, requires:'overlap_confirmed'}; return msg;",
    "  }",
    "  // UPDATE",
    "  const sets = []; const params = [];",
    "  let idx = 0;",
    "  for (const k of Object.keys(upd)) { idx++; params.push(upd[k]); sets.push(k+'=$'+idx); }",
    "  idx++; params.push(timerId);",
    "  idx++; params.push(device.id);",
    "  const sql = 'UPDATE irrigation_timers SET ' + sets.join(', ') + ', atualizado_em=NOW() WHERE id=$' + (idx-1) + ' AND device_id=$' + idx + ' RETURNING *';",
    "  const r = await pool.query(sql, params);",
    "  msg.statusCode=200; msg.payload={ timer: r.rows[0] };",
    "} catch(e) {",
    "  if (/check constraint|violates/i.test(e.message)) {",
    "    msg.statusCode=422; msg.payload={error:'valor invalido', detail:e.message};",
    "  } else { node.error('patch timer: '+e.message, msg); msg.statusCode=500; msg.payload={error:'internal'}; }",
    "}",
    "return msg;"
  ].join('\n'),
  outputs: 1, libs: [],
  x: 700, y: 5100, wires: [['respIrrPatchTimer']],
});
flows.push(respNode('respIrrPatchTimer', 940, 5100));

// ============================================================
// ENDPOINT: DELETE /irrigacao/timers/:id
// ============================================================
removeId('httpIrrDeleteTimer');
removeId('fnAuthIrrDeleteTimer');
removeId('fnIrrDeleteTimer');
removeId('respIrrDeleteTimer');

flows.push(httpInNode('httpIrrDeleteTimer', 'DELETE /dispositivos/:id/irrigacao/timers/:timer_id',
  '/dispositivos/:id/irrigacao/timers/:timer_id', 'delete', 200, 5200, 'fnAuthIrrDeleteTimer'));
flows.push(authNode('fnAuthIrrDeleteTimer', 440, 5200, 'fnIrrDeleteTimer', 'respIrrDeleteTimer'));
flows.push({
  id: 'fnIrrDeleteTimer', type: 'function', z: 'tabAuth', name: 'DELETE /timers/:id',
  func: [
    "const pool = global.get('pgPool');",
    "if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }",
    ACCESS_HELPER,
    "const timerId = msg.req.params.timer_id;",
    "const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;",
    "if (!UUID_RE.test(timerId)) { msg.statusCode=400; msg.payload={error:'timer_id invalido'}; return msg; }",
    "try {",
    "  const chk = await checkDeviceAccess(pool, msg.req.params.id, msg.user);",
    "  if (chk.err) { msg.statusCode=chk.err; msg.payload={error:chk.msg}; return msg; }",
    "  const device = chk.device;",
    "  if (device.prefixo !== 'IRR' || device.major_version !== 'V1') {",
    "    msg.statusCode=400; msg.payload={error:'device nao e IRR-V1'}; return msg;",
    "  }",
    "  if (chk.access === 'share' && chk.permissao !== 'controle') {",
    "    msg.statusCode=403; msg.payload={error:'sem permissao'}; return msg;",
    "  }",
    "  // Soft delete: marca ativo=false (preserva histórico, permite auditoria)",
    "  const r = await pool.query(",
    "    'UPDATE irrigation_timers SET ativo=FALSE, atualizado_em=NOW() WHERE id=$1 AND device_id=$2 RETURNING id',",
    "    [timerId, device.id]",
    "  );",
    "  if (r.rowCount === 0) { msg.statusCode=404; msg.payload={error:'timer nao encontrado'}; return msg; }",
    "  msg.statusCode=200; msg.payload={ ok: true, id: timerId };",
    "} catch(e) {",
    "  node.error('delete timer: '+e.message, msg);",
    "  msg.statusCode=500; msg.payload={error:'internal'};",
    "}",
    "return msg;"
  ].join('\n'),
  outputs: 1, libs: [],
  x: 700, y: 5200, wires: [['respIrrDeleteTimer']],
});
flows.push(respNode('respIrrDeleteTimer', 940, 5200));

// ============================================================
// PATCH fnIrrSnapshot — inclui state_json
// ============================================================
{
  const n = find('fnIrrSnapshot');
  if (!n) throw new Error('fnIrrSnapshot not found');
  if (!n.func.includes('irrigation_device_state')) {
    // Destructuring: 5 → 6 vars
    n.func = n.func.replace(
      "const [config, sectors, timers, sensors, alarms] = await Promise.all([",
      "const [config, sectors, timers, sensors, alarms, state] = await Promise.all([",
    );
    // Array Promise.all: adiciona a 6ª query logo após a de alarms
    const oldArr = "pool.query('SELECT * FROM irrigation_alarms WHERE device_id=$1 AND resolved_at IS NULL ORDER BY triggered_at DESC', [devId]),\n  ]);";
    const newArr = "pool.query('SELECT * FROM irrigation_alarms WHERE device_id=$1 AND resolved_at IS NULL ORDER BY triggered_at DESC', [devId]),\n    pool.query('SELECT state_json, received_at FROM irrigation_device_state WHERE device_id=$1', [devId]),\n  ]);";
    n.func = n.func.replace(oldArr, newArr);
    // Payload: acrescenta state
    n.func = n.func.replace(
      "active_alarms: alarms.rows",
      "active_alarms: alarms.rows,\n    state: state.rows[0] ? { ...state.rows[0].state_json, _received_at: state.rows[0].received_at } : null"
    );
  }
}

fs.writeFileSync(PATH, JSON.stringify(flows, null, 4));
console.log('E4.2A: subscribers + POST /comandos + PATCH /config + PATCH /setores/:numero + CRUD /timers + init overlap lib.');
console.log('Snapshot agora inclui state da 014.');
console.log('Reinicie: docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
