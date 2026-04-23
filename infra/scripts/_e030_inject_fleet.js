#!/usr/bin/env node
// E3.1 — Gestão de Frota (produtos) + Claim Flow (refs #65)
//
// Injeta no flows.json:
//   1) POST /admin/produtos/provisionar   (admin-only)
//   2) GET  /admin/produtos                (admin-only, paginado)
//   3) GET  /admin/produtos/:id            (admin-only)
//   4) POST /dispositivos/claim            (auth, qualquer user)
//   5) POST /admin/produtos/:id/reset      (admin-only)
//   6) PATCH fnCreateDisp → retorna 410 Gone
//
// Idempotente. Uso:
//   sudo node /opt/xtconect/scripts/_e030_inject_fleet.js
//   docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered

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
  return {
    id, type: 'http in', z: 'tabAuth', name, url, method,
    upload: false, swaggerDoc: '',
    x, y, wires: [[nextId]],
  };
}
function authNode(id, x, y, okWire, errWire) {
  return {
    id, type: 'function', z: 'tabAuth', name: 'Auth JWT',
    func: AUTH_FUNC, outputs: 2, libs: AUTH_LIBS,
    x, y, wires: [[okWire], [errWire]],
  };
}
function respNode(id, x, y) {
  return {
    id, type: 'http response', z: 'tabAuth', name: '',
    statusCode: '', headers: { 'Content-Type': 'application/json' },
    x, y, wires: [],
  };
}

// SQL fragment (sem template interpolation) — lista campos exposed dos produtos
const PRODUTO_SELECT = [
  'd.id',
  'd.device_id AS serial',
  'd.status',
  'd.sequencial',
  'd.provisionado_em',
  'd.claimed_em',
  'd.user_id AS owner_id',
  'd.nome_amigavel AS nome',
  'd.is_online',
  'd.last_seen',
  'd.telemetry_interval_s',
  'd.burst_rate_s',
  'd.modelo_id',
  'm.nome AS modelo_nome',
  'm.prefixo',
  'm.major_version',
  'u.email AS owner_email',
  'u.full_name AS owner_nome'
].join(', ');

// ============================================================
// 1) POST /admin/produtos/provisionar
// ============================================================
removeId('httpProvisionar');
removeId('fnAuthProvisionar');
removeId('fnProvisionar');
removeId('respProvisionar');

flows.push(httpInNode('httpProvisionar', 'POST /admin/produtos/provisionar',
  '/admin/produtos/provisionar', 'post', 200, 2800, 'fnAuthProvisionar'));
flows.push(authNode('fnAuthProvisionar', 440, 2800, 'fnProvisionar', 'respProvisionar'));
flows.push({
  id: 'fnProvisionar', type: 'function', z: 'tabAuth', name: 'Provisionar produto',
  func: [
    "const pool = global.get('pgPool');",
    "if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }",
    "if (!msg.user || msg.user.role !== 'admin') {",
    "  msg.statusCode=403; msg.payload={error:'apenas admin pode provisionar'}; return msg;",
    "}",
    "const dynsecCall = global.get('dynsecCall');",
    "if (!dynsecCall) { msg.statusCode=503; msg.payload={error:'dynsec not ready'}; return msg; }",
    "",
    "const body = msg.payload || {};",
    "const modeloId = String(body.modelo_id || '').trim();",
    "const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;",
    "if (!UUID_RE.test(modeloId)) { msg.statusCode=400; msg.payload={error:'modelo_id invalido'}; return msg; }",
    "",
    "const PAIRING_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';",
    "function pairing(len) {",
    "  const buf = crypto.randomBytes(len);",
    "  let s = '';",
    "  for (let i = 0; i < len; i++) s += PAIRING_ALPHABET[buf[i] % PAIRING_ALPHABET.length];",
    "  return s;",
    "}",
    "",
    "try {",
    "  const mod = await pool.query(",
    "    'SELECT id, prefixo, major_version, nome FROM modelos_dispositivo WHERE id=$1 LIMIT 1',",
    "    [modeloId]",
    "  );",
    "  if (mod.rowCount === 0) { msg.statusCode=404; msg.payload={error:'modelo nao encontrado'}; return msg; }",
    "  const prefixo = mod.rows[0].prefixo;",
    "  const majorVersion = mod.rows[0].major_version;",
    "  if (!prefixo || !majorVersion) {",
    "    msg.statusCode=400; msg.payload={error:'modelo sem prefixo/major_version configurados'}; return msg;",
    "  }",
    "",
    "  const baseUrl = global.get('mailBaseUrl') || env.get('MAIL_BASE_URL') || 'https://hub.xtconect.online';",
    "  const mqttHost = env.get('MQTT_EXTERNAL_HOST') || 'hub.xtconect.online';",
    "  const mqttPort = env.get('MQTT_EXTERNAL_TLS_PORT') || '8883';",
    "  const mqttWsPort = env.get('MQTT_EXTERNAL_WS_PORT') || '8884';",
    "",
    "  let createdId = null;",
    "  let serial = null;",
    "  let mqttPlaintext = null;",
    "  let claimToken = null;",
    "  let pairingCode = null;",
    "  let sequencial = null;",
    "",
    "  for (let attempt = 0; attempt < 5 && !createdId; attempt++) {",
    "    const seqRow = await pool.query(",
    "      'SELECT COALESCE(MAX(sequencial), 0) + 1 AS seq FROM devices WHERE modelo_id=$1',",
    "      [modeloId]",
    "    );",
    "    sequencial = seqRow.rows[0].seq;",
    "    serial = prefixo + '-' + majorVersion + '-' + String(sequencial).padStart(5, '0');",
    "    claimToken = crypto.randomBytes(24).toString('base64url');",
    "    pairingCode = pairing(6);",
    "    mqttPlaintext = crypto.randomBytes(16).toString('hex');",
    "    try {",
    "      const ins = await pool.query(",
    "        \"INSERT INTO devices (user_id, device_id, name, nome_amigavel, mqtt_username, mqtt_password_hash, modelo_id, sequencial, status, claim_token, pairing_code, provisionado_em) VALUES (NULL, $1, $1, $1, $1, NULL, $2, $3, 'ocioso', $4, $5, NOW()) RETURNING id\",",
    "        [serial, modeloId, sequencial, claimToken, pairingCode]",
    "      );",
    "      createdId = ins.rows[0].id;",
    "    } catch(e) {",
    "      if (/unique|duplicate/i.test(e.message) || e.code === '23505') { continue; }",
    "      throw e;",
    "    }",
    "  }",
    "  if (!createdId) {",
    "    msg.statusCode=500; msg.payload={error:'nao foi possivel alocar serial/token unicos em 5 tentativas'}; return msg;",
    "  }",
    "",
    "  try {",
    "    await dynsecCall({ command: 'createClient', username: serial, password: mqttPlaintext });",
    "    await dynsecCall({ command: 'addClientRole', username: serial, rolename: 'device-publisher' });",
    "  } catch (dynErr) {",
    "    try { await dynsecCall({ command: 'deleteClient', username: serial }); } catch(_) {}",
    "    try { await pool.query('DELETE FROM devices WHERE id=$1', [createdId]); } catch(_) {}",
    "    node.error('provisionar dynsec: ' + dynErr.message, msg);",
    "    msg.statusCode=500; msg.payload={error:'mqtt provisioning failed: '+dynErr.message};",
    "    return msg;",
    "  }",
    "",
    "  msg.statusCode = 200;",
    "  msg.payload = {",
    "    id: createdId,",
    "    serial: serial,",
    "    modelo_id: modeloId,",
    "    modelo_nome: mod.rows[0].nome,",
    "    sequencial: sequencial,",
    "    status: 'ocioso',",
    "    pairing_code: pairingCode,",
    "    claim_token: claimToken,",
    "    claim_url: baseUrl + '/claim?serial=' + encodeURIComponent(serial) + '&token=' + encodeURIComponent(claimToken),",
    "    mqtt: {",
    "      host: 'mqtts://' + mqttHost + ':' + mqttPort,",
    "      ws: 'wss://' + mqttHost + ':' + mqttWsPort + '/',",
    "      username: serial,",
    "      password: mqttPlaintext",
    "    }",
    "  };",
    "} catch(e) {",
    "  node.error('provisionar: '+e.message, msg);",
    "  msg.statusCode=500; msg.payload={error:'internal'};",
    "}",
    "return msg;",
  ].join('\n'),
  outputs: 1,
  libs: [{ var: 'crypto', module: 'crypto' }],
  x: 700, y: 2800, wires: [['respProvisionar']],
});
flows.push(respNode('respProvisionar', 940, 2800));

// ============================================================
// 2) GET /admin/produtos
// ============================================================
removeId('httpListProdutos');
removeId('fnAuthListProdutos');
removeId('fnListProdutos');
removeId('respListProdutos');

flows.push(httpInNode('httpListProdutos', 'GET /admin/produtos',
  '/admin/produtos', 'get', 200, 2900, 'fnAuthListProdutos'));
flows.push(authNode('fnAuthListProdutos', 440, 2900, 'fnListProdutos', 'respListProdutos'));
flows.push({
  id: 'fnListProdutos', type: 'function', z: 'tabAuth', name: 'List produtos',
  func: [
    "const pool = global.get('pgPool');",
    "if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }",
    "if (!msg.user || msg.user.role !== 'admin') {",
    "  msg.statusCode=403; msg.payload={error:'apenas admin'}; return msg;",
    "}",
    "const q = msg.req.query || {};",
    "const status = q.status && ['ocioso','associado','defeito','retornado'].includes(q.status) ? q.status : null;",
    "const modeloId = q.modelo_id || null;",
    "const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;",
    "if (modeloId && !UUID_RE.test(modeloId)) { msg.statusCode=400; msg.payload={error:'modelo_id invalido'}; return msg; }",
    "let page = parseInt(q.page || '1', 10); if (!Number.isFinite(page) || page < 1) page = 1;",
    "let limit = parseInt(q.limit || '50', 10); if (!Number.isFinite(limit) || limit < 1 || limit > 200) limit = 50;",
    "const offset = (page - 1) * limit;",
    "",
    "const where = [];",
    "const params = [];",
    "if (status) { params.push(status); where.push('d.status = $' + params.length); }",
    "if (modeloId) { params.push(modeloId); where.push('d.modelo_id = $' + params.length); }",
    "const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';",
    "",
    "try {",
    "  const countR = await pool.query('SELECT COUNT(*)::int AS n FROM devices d ' + whereSql, params);",
    "  const total = countR.rows[0].n;",
    "",
    "  const limitIdx = params.length + 1;",
    "  const offsetIdx = params.length + 2;",
    "  params.push(limit);",
    "  params.push(offset);",
    "  const selectSql = 'SELECT " + PRODUTO_SELECT + " FROM devices d LEFT JOIN modelos_dispositivo m ON m.id = d.modelo_id LEFT JOIN app_users u ON u.id = d.user_id ' + whereSql + ' ORDER BY d.provisionado_em DESC NULLS LAST, d.created_at DESC LIMIT $' + limitIdx + ' OFFSET $' + offsetIdx;",
    "  const r = await pool.query(selectSql, params);",
    "",
    "  msg.statusCode = 200;",
    "  msg.payload = {",
    "    produtos: r.rows,",
    "    paginacao: { page: page, limit: limit, total: total, pages: Math.ceil(total / limit) }",
    "  };",
    "} catch(e) {",
    "  node.error('list produtos: '+e.message, msg);",
    "  msg.statusCode=500; msg.payload={error:'internal'};",
    "}",
    "return msg;",
  ].join('\n'),
  outputs: 1, libs: [],
  x: 700, y: 2900, wires: [['respListProdutos']],
});
flows.push(respNode('respListProdutos', 940, 2900));

// ============================================================
// 3) GET /admin/produtos/:id
// ============================================================
removeId('httpGetProduto');
removeId('fnAuthGetProduto');
removeId('fnGetProduto');
removeId('respGetProduto');

flows.push(httpInNode('httpGetProduto', 'GET /admin/produtos/:id',
  '/admin/produtos/:id', 'get', 200, 3000, 'fnAuthGetProduto'));
flows.push(authNode('fnAuthGetProduto', 440, 3000, 'fnGetProduto', 'respGetProduto'));
flows.push({
  id: 'fnGetProduto', type: 'function', z: 'tabAuth', name: 'Get produto',
  func: [
    "const pool = global.get('pgPool');",
    "if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }",
    "if (!msg.user || msg.user.role !== 'admin') {",
    "  msg.statusCode=403; msg.payload={error:'apenas admin'}; return msg;",
    "}",
    "const id = msg.req.params.id;",
    "const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;",
    "if (!UUID_RE.test(id)) { msg.statusCode=400; msg.payload={error:'id invalido'}; return msg; }",
    "",
    "try {",
    "  const selectSql = 'SELECT " + PRODUTO_SELECT + ", d.claim_token, d.pairing_code FROM devices d LEFT JOIN modelos_dispositivo m ON m.id = d.modelo_id LEFT JOIN app_users u ON u.id = d.user_id WHERE d.id=$1 LIMIT 1';",
    "  const r = await pool.query(selectSql, [id]);",
    "  if (r.rowCount === 0) { msg.statusCode=404; msg.payload={error:'produto nao encontrado'}; return msg; }",
    "  const row = r.rows[0];",
    "  const baseUrl = global.get('mailBaseUrl') || env.get('MAIL_BASE_URL') || 'https://hub.xtconect.online';",
    "  if (row.claim_token) {",
    "    row.claim_url = baseUrl + '/claim?serial=' + encodeURIComponent(row.serial) + '&token=' + encodeURIComponent(row.claim_token);",
    "  }",
    "  msg.statusCode = 200;",
    "  msg.payload = { produto: row };",
    "} catch(e) {",
    "  node.error('get produto: '+e.message, msg);",
    "  msg.statusCode=500; msg.payload={error:'internal'};",
    "}",
    "return msg;",
  ].join('\n'),
  outputs: 1, libs: [],
  x: 700, y: 3000, wires: [['respGetProduto']],
});
flows.push(respNode('respGetProduto', 940, 3000));

// ============================================================
// 4) POST /dispositivos/claim
// ============================================================
removeId('httpClaim');
removeId('fnAuthClaim');
removeId('fnClaim');
removeId('respClaim');

flows.push(httpInNode('httpClaim', 'POST /dispositivos/claim',
  '/dispositivos/claim', 'post', 200, 3100, 'fnAuthClaim'));
flows.push(authNode('fnAuthClaim', 440, 3100, 'fnClaim', 'respClaim'));
flows.push({
  id: 'fnClaim', type: 'function', z: 'tabAuth', name: 'Claim produto',
  func: [
    "const pool = global.get('pgPool');",
    "if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }",
    "",
    "const body = msg.payload || {};",
    "const token = body.claim_token ? String(body.claim_token).trim() : '';",
    "const serial = body.serial ? String(body.serial).trim() : '';",
    "const pairing = body.pairing_code ? String(body.pairing_code).trim().toUpperCase() : '';",
    "",
    "if (!token && !(serial && pairing)) {",
    "  msg.statusCode=400; msg.payload={error:'informe claim_token ou (serial + pairing_code)'}; return msg;",
    "}",
    "",
    "try {",
    "  let sel;",
    "  if (token) {",
    "    sel = await pool.query(",
    "      'SELECT id, device_id, status FROM devices WHERE claim_token = $1 LIMIT 1',",
    "      [token]",
    "    );",
    "  } else {",
    "    sel = await pool.query(",
    "      'SELECT id, device_id, status FROM devices WHERE device_id = $1 AND pairing_code = $2 LIMIT 1',",
    "      [serial, pairing]",
    "    );",
    "  }",
    "  if (sel.rowCount === 0) {",
    "    msg.statusCode=404; msg.payload={error:'dispositivo nao encontrado ou codigo invalido'}; return msg;",
    "  }",
    "  const cur = sel.rows[0];",
    "  if (cur.status !== 'ocioso') {",
    "    msg.statusCode=409; msg.payload={error:'dispositivo ja foi reivindicado'}; return msg;",
    "  }",
    "",
    "  const upd = await pool.query(",
    "    \"UPDATE devices SET status='associado', user_id=$1, claimed_em=NOW(), claim_token=NULL, pairing_code=NULL WHERE id=$2 AND status='ocioso' RETURNING id\",",
    "    [msg.user.id, cur.id]",
    "  );",
    "  if (upd.rowCount === 0) {",
    "    msg.statusCode=409; msg.payload={error:'estado mudou durante o claim, tente novamente'}; return msg;",
    "  }",
    "",
    "  const selectSql = 'SELECT " + PRODUTO_SELECT + " FROM devices d LEFT JOIN modelos_dispositivo m ON m.id = d.modelo_id LEFT JOIN app_users u ON u.id = d.user_id WHERE d.id=$1 LIMIT 1';",
    "  const r = await pool.query(selectSql, [cur.id]);",
    "  msg.statusCode = 200;",
    "  msg.payload = { dispositivo: r.rows[0] };",
    "} catch(e) {",
    "  node.error('claim: '+e.message, msg);",
    "  msg.statusCode=500; msg.payload={error:'internal'};",
    "}",
    "return msg;",
  ].join('\n'),
  outputs: 1, libs: [],
  x: 700, y: 3100, wires: [['respClaim']],
});
flows.push(respNode('respClaim', 940, 3100));

// ============================================================
// 5) POST /admin/produtos/:id/reset
// ============================================================
removeId('httpResetProduto');
removeId('fnAuthResetProduto');
removeId('fnResetProduto');
removeId('respResetProduto');

flows.push(httpInNode('httpResetProduto', 'POST /admin/produtos/:id/reset',
  '/admin/produtos/:id/reset', 'post', 200, 3200, 'fnAuthResetProduto'));
flows.push(authNode('fnAuthResetProduto', 440, 3200, 'fnResetProduto', 'respResetProduto'));
flows.push({
  id: 'fnResetProduto', type: 'function', z: 'tabAuth', name: 'Reset produto',
  func: [
    "const pool = global.get('pgPool');",
    "if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }",
    "if (!msg.user || msg.user.role !== 'admin') {",
    "  msg.statusCode=403; msg.payload={error:'apenas admin'}; return msg;",
    "}",
    "const id = msg.req.params.id;",
    "const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;",
    "if (!UUID_RE.test(id)) { msg.statusCode=400; msg.payload={error:'id invalido'}; return msg; }",
    "",
    "const PAIRING_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';",
    "function pairing(len) {",
    "  const buf = crypto.randomBytes(len);",
    "  let s = '';",
    "  for (let i = 0; i < len; i++) s += PAIRING_ALPHABET[buf[i] % PAIRING_ALPHABET.length];",
    "  return s;",
    "}",
    "",
    "try {",
    "  const cur = await pool.query('SELECT id, device_id, status FROM devices WHERE id=$1 LIMIT 1', [id]);",
    "  if (cur.rowCount === 0) { msg.statusCode=404; msg.payload={error:'produto nao encontrado'}; return msg; }",
    "",
    "  try {",
    "    await pool.query(",
    "      \"UPDATE dispositivo_compartilhado SET status='revogado', revogado_em=NOW(), token_convite=NULL WHERE dispositivo_id=$1 AND status<>'revogado'\",",
    "      [id]",
    "    );",
    "  } catch(e) { node.warn('reset: revoke shares failed: '+e.message); }",
    "",
    "  let claimToken, pairingCode, ok = false;",
    "  for (let attempt = 0; attempt < 5 && !ok; attempt++) {",
    "    claimToken = crypto.randomBytes(24).toString('base64url');",
    "    pairingCode = pairing(6);",
    "    try {",
    "      await pool.query(",
    "        \"UPDATE devices SET status='ocioso', user_id=NULL, claimed_em=NULL, claim_token=$1, pairing_code=$2 WHERE id=$3\",",
    "        [claimToken, pairingCode, id]",
    "      );",
    "      ok = true;",
    "    } catch(e) {",
    "      if (!(/unique|duplicate/i.test(e.message) || e.code === '23505')) { throw e; }",
    "    }",
    "  }",
    "  if (!ok) { msg.statusCode=500; msg.payload={error:'nao foi possivel alocar token/pairing unicos'}; return msg; }",
    "",
    "  const selectSql = 'SELECT " + PRODUTO_SELECT + ", d.claim_token, d.pairing_code FROM devices d LEFT JOIN modelos_dispositivo m ON m.id = d.modelo_id LEFT JOIN app_users u ON u.id = d.user_id WHERE d.id=$1 LIMIT 1';",
    "  const r = await pool.query(selectSql, [id]);",
    "  const row = r.rows[0];",
    "  const baseUrl = global.get('mailBaseUrl') || env.get('MAIL_BASE_URL') || 'https://hub.xtconect.online';",
    "  row.claim_url = baseUrl + '/claim?serial=' + encodeURIComponent(row.serial) + '&token=' + encodeURIComponent(row.claim_token);",
    "",
    "  msg.statusCode = 200;",
    "  msg.payload = { produto: row };",
    "} catch(e) {",
    "  node.error('reset produto: '+e.message, msg);",
    "  msg.statusCode=500; msg.payload={error:'internal: '+e.message};",
    "}",
    "return msg;",
  ].join('\n'),
  outputs: 1,
  libs: [{ var: 'crypto', module: 'crypto' }],
  x: 700, y: 3200, wires: [['respResetProduto']],
});
flows.push(respNode('respResetProduto', 940, 3200));

// ============================================================
// 6) fnCreateDisp → 410 Gone
// ============================================================
{
  const n = find('fnCreateDisp');
  if (!n) throw new Error('fnCreateDisp not found');
  n.func = [
    "// E3.1 — Fluxo direto de criação de dispositivo descontinuado.",
    "// Admin provisiona via /admin/produtos/provisionar, cliente usa /dispositivos/claim.",
    "msg.statusCode = 410;",
    "msg.payload = {",
    "  error: 'Fluxo de criacao direta descontinuado. Use POST /api/dispositivos/claim com serial + pairing_code, ou peca ao admin pra provisionar um produto novo.'",
    "};",
    "return msg;",
  ].join('\n');
  n.libs = [];
}

// ============================================================
fs.writeFileSync(PATH, JSON.stringify(flows, null, 4));
console.log('E3.1: flows.json atualizado.');
console.log('  • endpoints novos: 5');
console.log('  • fnCreateDisp → 410 Gone');
console.log('Reinicie o Node-RED:');
console.log('  docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
