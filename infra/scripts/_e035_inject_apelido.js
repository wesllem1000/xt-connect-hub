#!/usr/bin/env node
// E3.5 — Apelido no claim + renomear + expor em GET /dispositivos (refs #65)
//
// Mudanças:
//   1) fnClaim passa a aceitar body.apelido (0..80 chars; vazio ou só espaço
//      vira NULL). Funciona nos dois modos: {serial, pairing_code} e
//      {claim_token}.
//   2) fnListDisp expõe v.apelido no payload.
//   3) Novo endpoint: PATCH /dispositivos/:id — só o owner renomeia (shares
//      com permissão controle não podem). Body {apelido: string|null}.
//
// Idempotente.
//
// Uso: sudo node /opt/xtconect/scripts/_e035_inject_apelido.js
//      docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered

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

// ============================================================
// 1) fnClaim: aceita apelido
// ============================================================
{
  const n = find('fnClaim');
  if (!n) throw new Error('fnClaim not found');
  n.func = [
    "const pool = global.get('pgPool');",
    "if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }",
    "",
    "const body = msg.payload || {};",
    "const token = body.claim_token ? String(body.claim_token).trim() : '';",
    "const serial = body.serial ? String(body.serial).trim() : '';",
    "const pairing = body.pairing_code ? String(body.pairing_code).trim().toUpperCase() : '';",
    "",
    "// Apelido opcional: trim; vazio/só espaço = NULL; 1..80 chars = aceita.",
    "let apelido = null;",
    "if (body.apelido !== undefined && body.apelido !== null) {",
    "  const trimmed = String(body.apelido).trim();",
    "  if (trimmed.length > 80) {",
    "    msg.statusCode=400; msg.payload={error:'apelido deve ter no maximo 80 caracteres'}; return msg;",
    "  }",
    "  if (trimmed.length > 0) apelido = trimmed;",
    "}",
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
    "    \"UPDATE devices SET status='associado', user_id=$1, claimed_em=NOW(), claim_token=NULL, pairing_code=NULL, apelido=$2 WHERE id=$3 AND status='ocioso' RETURNING id\",",
    "    [msg.user.id, apelido, cur.id]",
    "  );",
    "  if (upd.rowCount === 0) {",
    "    msg.statusCode=409; msg.payload={error:'estado mudou durante o claim, tente novamente'}; return msg;",
    "  }",
    "",
    "  // Retorna shape compatível com lista (inclui apelido)",
    "  const r = await pool.query(",
    "    `SELECT d.id, d.device_id AS serial, d.status, d.apelido,",
    "            COALESCE(NULLIF(d.nome_amigavel, ''), d.name) AS nome,",
    "            d.user_id AS owner_id,",
    "            d.is_online AS online, d.last_seen AS last_seen_at,",
    "            d.telemetry_interval_s, d.burst_rate_s,",
    "            m.nome AS modelo_nome",
    "       FROM devices d LEFT JOIN modelos_dispositivo m ON m.id = d.modelo_id",
    "      WHERE d.id=$1 LIMIT 1`,",
    "    [cur.id]",
    "  );",
    "  msg.statusCode = 200;",
    "  msg.payload = { dispositivo: r.rows[0] };",
    "} catch(e) {",
    "  if (/apelido_length/i.test(e.message)) {",
    "    msg.statusCode=400; msg.payload={error:'apelido invalido (1 a 80 caracteres)'}; return msg;",
    "  }",
    "  node.error('claim: '+e.message, msg);",
    "  msg.statusCode=500; msg.payload={error:'internal'};",
    "}",
    "return msg;"
  ].join('\n');
}

// ============================================================
// 2) fnListDisp: inclui v.apelido
// ============================================================
{
  const n = find('fnListDisp');
  if (!n) throw new Error('fnListDisp not found');
  n.func = [
    "// E3.5 — lista do user logado, com apelido opcional.",
    "const pool = global.get('pgPool');",
    "if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }",
    "const userId = msg.user && msg.user.id;",
    "if (!userId) { msg.statusCode=401; msg.payload={error:'unauthenticated'}; return msg; }",
    "try {",
    "  const r = await pool.query(`",
    "    SELECT",
    "      v.id,",
    "      COALESCE(NULLIF(v.nome_amigavel, ''), v.name) AS nome,",
    "      v.apelido,",
    "      v.device_id AS serial,",
    "      m.nome AS modelo,",
    "      uv.recebido_em AS ultimo_valor,",
    "      v.created_at AS criado_em,",
    "      v.is_online AS online,",
    "      v.last_seen AS last_seen_at,",
    "      v.telemetry_interval_s,",
    "      v.burst_rate_s,",
    "      v.access_type,",
    "      v.permissao::text AS permissao,",
    "      v.share_id",
    "    FROM dispositivos_visiveis v",
    "    LEFT JOIN modelos_dispositivo m ON m.id = v.modelo_id",
    "    LEFT JOIN LATERAL (",
    "      SELECT recebido_em FROM dispositivo_ultimo_valor",
    "      WHERE dispositivo_id = v.id ORDER BY recebido_em DESC LIMIT 1",
    "    ) uv ON TRUE",
    "    WHERE v.viewer_id = $1::uuid",
    "    ORDER BY v.created_at DESC",
    "  `, [userId]);",
    "  msg.statusCode = 200;",
    "  msg.payload = r.rows;",
    "} catch(e) {",
    "  node.error('list dispositivos: '+e.message, msg);",
    "  msg.statusCode = 500; msg.payload = {error:'internal'};",
    "}",
    "return msg;"
  ].join('\n');
}

// ============================================================
// 3) PATCH /dispositivos/:id — renomear (owner-only)
// ============================================================
removeId('httpUpdateDisp');
removeId('fnAuthUpdateDisp');
removeId('fnUpdateDisp');
removeId('respUpdateDisp');

flows.push(httpInNode('httpUpdateDisp', 'PATCH /dispositivos/:id',
  '/dispositivos/:id', 'patch', 200, 3400, 'fnAuthUpdateDisp'));
flows.push(authNode('fnAuthUpdateDisp', 440, 3400, 'fnUpdateDisp', 'respUpdateDisp'));
flows.push({
  id: 'fnUpdateDisp', type: 'function', z: 'tabAuth', name: 'Update dispositivo (apelido)',
  func: [
    "const pool = global.get('pgPool');",
    "if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }",
    "",
    "const id = msg.req.params.id;",
    "const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;",
    "if (!UUID_RE.test(id)) { msg.statusCode=400; msg.payload={error:'id invalido'}; return msg; }",
    "",
    "const body = msg.payload || {};",
    "if (!Object.prototype.hasOwnProperty.call(body, 'apelido')) {",
    "  msg.statusCode=400; msg.payload={error:'body deve conter campo apelido (string ou null)'}; return msg;",
    "}",
    "",
    "let apelido = null;",
    "if (body.apelido !== null && body.apelido !== undefined) {",
    "  const trimmed = String(body.apelido).trim();",
    "  if (trimmed.length > 80) {",
    "    msg.statusCode=400; msg.payload={error:'apelido deve ter no maximo 80 caracteres'}; return msg;",
    "  }",
    "  if (trimmed.length > 0) apelido = trimmed;",
    "}",
    "",
    "try {",
    "  const dev = await pool.query('SELECT user_id, status FROM devices WHERE id=$1 LIMIT 1', [id]);",
    "  if (dev.rowCount === 0) { msg.statusCode=404; msg.payload={error:'dispositivo nao encontrado'}; return msg; }",
    "  const isAdmin = msg.user && msg.user.role === 'admin';",
    "  if (dev.rows[0].user_id !== msg.user.id && !isAdmin) {",
    "    msg.statusCode=403; msg.payload={error:'apenas o dono pode renomear'}; return msg;",
    "  }",
    "",
    "  const r = await pool.query(",
    "    `UPDATE devices SET apelido=$1, updated_at=NOW() WHERE id=$2",
    "     RETURNING id, device_id AS serial, apelido, status,",
    "               COALESCE(NULLIF(nome_amigavel, ''), name) AS nome,",
    "               user_id AS owner_id`,",
    "    [apelido, id]",
    "  );",
    "",
    "  msg.statusCode = 200;",
    "  msg.payload = { dispositivo: r.rows[0] };",
    "} catch(e) {",
    "  if (/apelido_length/i.test(e.message)) {",
    "    msg.statusCode=400; msg.payload={error:'apelido invalido (1 a 80 caracteres)'}; return msg;",
    "  }",
    "  node.error('update dispositivo: '+e.message, msg);",
    "  msg.statusCode=500; msg.payload={error:'internal'};",
    "}",
    "return msg;"
  ].join('\n'),
  outputs: 1, libs: [],
  x: 700, y: 3400, wires: [['respUpdateDisp']],
});
flows.push(respNode('respUpdateDisp', 940, 3400));

fs.writeFileSync(PATH, JSON.stringify(flows, null, 4));
console.log('E3.5: fnClaim + fnListDisp patchados; PATCH /dispositivos/:id criado.');
console.log('Reinicie: docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
