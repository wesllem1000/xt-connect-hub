#!/usr/bin/env node
// E4.2A closure — subscriber config/current + POST /factory-reset (refs #71)
//
// Completa os pendentes do commit 714f25a identificados na review:
//   - devices/+/config/current → merge em irrigation_configs.current_pinout
//     (R6: firmware é autoridade do pinout; server só espelha)
//   - POST /dispositivos/:id/irrigacao/factory-reset (R7)
//
// Idempotente.
//
// Uso: sudo node /opt/xtconect/scripts/_e042b_inject_irr_v1_closure.js
//      docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered

const fs = require('fs');
const PATH = '/opt/xtconect/nodered/data/flows.json';
const flows = JSON.parse(fs.readFileSync(PATH, 'utf8'));
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
// 1) Subscriber devices/+/config/current
// ============================================================
removeId('mqttInIrrCfgCurrent');
removeId('fnHandleIrrCfgCurrent');
flows.push({
  id: 'mqttInIrrCfgCurrent', type: 'mqtt in', z: 'tabIngest',
  name: 'devices/+/config/current', topic: 'devices/+/config/current', qos: '1',
  datatype: 'auto-detect', broker: 'brokerMosq',
  nl: false, rap: true, rh: 0, inputs: 0,
  x: 200, y: 4650, wires: [['fnHandleIrrCfgCurrent']],
});
flows.push({
  id: 'fnHandleIrrCfgCurrent', type: 'function', z: 'tabAuth',
  name: 'Merge current_pinout',
  func: [
    "const pool = global.get('pgPool');",
    "if (!pool) return null;",
    "const parts = (msg.topic || '').split('/');",
    "if (parts.length !== 4 || parts[0] !== 'devices' || parts[2] !== 'config' || parts[3] !== 'current') return null;",
    "const mqttUser = parts[1];",
    "let cfg = null;",
    "try {",
    "  const raw = Buffer.isBuffer(msg.payload) ? msg.payload.toString('utf8') :",
    "              (typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload));",
    "  if (!raw || raw.trim() === '') return null;",
    "  cfg = JSON.parse(raw);",
    "  if (!cfg || typeof cfg !== 'object') return null;",
    "} catch(e) { node.warn('config/current JSON invalido: '+e.message); return null; }",
    "try {",
    "  // Server apenas espelha (R6). Firmware é autoridade do pinout.",
    "  const r = await pool.query(",
    "    `UPDATE irrigation_configs",
    "        SET current_pinout = $2::jsonb,",
    "            current_pinout_received_at = NOW()",
    "      WHERE device_id = (SELECT id FROM devices WHERE mqtt_username = $1)`,",
    "    [mqttUser, JSON.stringify(cfg)]",
    "  );",
    "  if (r.rowCount > 0) {",
    "    node.status({fill:'green',shape:'dot',text: mqttUser+' pinout ok'});",
    "  } else {",
    "    node.status({fill:'yellow',shape:'ring',text: mqttUser+' sem config row'});",
    "  }",
    "} catch(e) { node.error('config/current merge: '+e.message); }",
    "return null;"
  ].join('\n'),
  outputs: 1, libs: [],
  x: 500, y: 4650, wires: [[]],
});

// ============================================================
// 2) POST /dispositivos/:id/irrigacao/factory-reset (R7)
// ============================================================
removeId('httpIrrFactoryReset');
removeId('fnAuthIrrFactoryReset');
removeId('fnIrrFactoryReset');
removeId('respIrrFactoryReset');
removeId('mqttOutIrrFactoryReset');

flows.push(httpInNode('httpIrrFactoryReset', 'POST /dispositivos/:id/irrigacao/factory-reset',
  '/dispositivos/:id/irrigacao/factory-reset', 'post', 200, 5300, 'fnAuthIrrFactoryReset'));
flows.push(authNode('fnAuthIrrFactoryReset', 440, 5300, 'fnIrrFactoryReset', 'respIrrFactoryReset'));
flows.push({
  id: 'fnIrrFactoryReset', type: 'function', z: 'tabAuth', name: 'POST /factory-reset',
  func: [
    "const pool = global.get('pgPool');",
    "if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return [msg, null]; }",
    ACCESS_HELPER,
    "try {",
    "  const chk = await checkDeviceAccess(pool, msg.req.params.id, msg.user);",
    "  if (chk.err) { msg.statusCode=chk.err; msg.payload={error:chk.msg}; return [msg, null]; }",
    "  const device = chk.device;",
    "  if (device.prefixo !== 'IRR' || device.major_version !== 'V1') {",
    "    msg.statusCode=400; msg.payload={error:'device nao e IRR-V1'}; return [msg, null];",
    "  }",
    "  // Só owner ou admin — share operator NÃO pode resetar (ação destrutiva)",
    "  if (chk.access !== 'owner' && chk.access !== 'admin') {",
    "    msg.statusCode=403; msg.payload={error:'factory-reset restrito ao dono'}; return [msg, null];",
    "  }",
    "  // R7: apaga config, sectors, timers, sensors; resolve alarms ativos;",
    "  //     preserva events (histórico) + devices row.",
    "  const client = await pool.connect();",
    "  try {",
    "    await client.query('BEGIN');",
    "    await client.query('DELETE FROM irrigation_timers WHERE device_id=$1', [device.id]);",
    "    await client.query('DELETE FROM irrigation_temperature_sensors WHERE device_id=$1', [device.id]);",
    "    await client.query('UPDATE irrigation_alarms SET resolved_at=NOW() WHERE device_id=$1 AND resolved_at IS NULL', [device.id]);",
    "    await client.query('DELETE FROM irrigation_sectors WHERE device_id=$1', [device.id]);",
    "    await client.query('DELETE FROM irrigation_configs WHERE device_id=$1', [device.id]);",
    "    // Re-provisiona defaults (R1 + R9). Idempotente.",
    "    await client.query('SELECT * FROM provision_irr_v1_defaults($1)', [device.id]);",
    "    await client.query('COMMIT');",
    "  } catch(e) {",
    "    await client.query('ROLLBACK');",
    "    throw e;",
    "  } finally { client.release(); }",
    "  // Comando pro firmware limpar NVS também (async — se device offline,",
    "  // apenas loga; próxima conexão com retained do commands será ignorada",
    "  // porque publicamos non-retained QoS 1 com expires_at curto).",
    "  const cmdId = crypto.randomUUID();",
    "  const issuedAt = new Date();",
    "  const expiresAt = new Date(issuedAt.getTime() + 30000);",
    "  await pool.query(",
    "    `INSERT INTO irrigation_command_log",
    "       (cmd_id, device_id, user_id, cmd, params, issued_at, expires_at)",
    "     VALUES ($1, $2, $3, 'factory_reset', '{}'::jsonb, $4, $5)`,",
    "    [cmdId, device.id, msg.user.id, issuedAt, expiresAt]",
    "  );",
    "  const publishMsg = {",
    "    topic: 'devices/' + device.serial + '/commands',",
    "    payload: JSON.stringify({",
    "      cmd_id: cmdId, protocol_version: 1,",
    "      cmd: 'factory_reset', params: {},",
    "      issued_at: issuedAt.toISOString(), expires_at: expiresAt.toISOString(),",
    "      origin: 'manual_app_remote', user_id: msg.user.id",
    "    }),",
    "    qos: 1, retain: false",
    "  };",
    "  msg.statusCode = 200;",
    "  msg.payload = { ok: true, cmd_id: cmdId, reprovisioned: true };",
    "  return [msg, publishMsg];",
    "} catch(e) {",
    "  node.error('factory-reset: '+e.message, msg);",
    "  msg.statusCode=500; msg.payload={error:'internal: '+e.message};",
    "  return [msg, null];",
    "}"
  ].join('\n'),
  outputs: 2, libs: [{ var: 'crypto', module: 'crypto' }],
  x: 700, y: 5300, wires: [['respIrrFactoryReset'], ['mqttOutIrrFactoryReset']],
});
flows.push(respNode('respIrrFactoryReset', 940, 5300));
flows.push({
  id: 'mqttOutIrrFactoryReset', type: 'mqtt out', z: 'tabAuth',
  name: 'publish factory_reset', topic: '', qos: '1', retain: 'false',
  broker: 'brokerMosq',
  x: 940, y: 5360, wires: [],
});

// ============================================================
fs.writeFileSync(PATH, JSON.stringify(flows, null, 4));
console.log('E4.2A closure: subscriber config/current + POST /factory-reset.');
console.log('Reinicie: docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
