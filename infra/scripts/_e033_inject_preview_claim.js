#!/usr/bin/env node
// E3.3 — GET /dispositivos/preview-claim (refs #65)
//
// Endpoint de preview do claim pra landing page (/claim?serial=X&token=Y).
// NÃO consome o token — só valida que o device existe, está ocioso, e o
// token/pairing bate. Usado pra mostrar "Reivindicar IRR-V1-00042?" antes
// do user confirmar.
//
// Idempotente.
//
// Uso: sudo node /opt/xtconect/scripts/_e033_inject_preview_claim.js
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
  return {
    id, type: 'http in', z: 'tabAuth', name, url, method,
    upload: false, swaggerDoc: '', x, y, wires: [[nextId]],
  };
}
function authNode(id, x, y, okWire, errWire) {
  return {
    id, type: 'function', z: 'tabAuth', name: 'Auth JWT',
    func: AUTH_FUNC, outputs: 2, libs: AUTH_LIBS, x, y, wires: [[okWire], [errWire]],
  };
}
function respNode(id, x, y) {
  return {
    id, type: 'http response', z: 'tabAuth', name: '',
    statusCode: '', headers: { 'Content-Type': 'application/json' }, x, y, wires: [],
  };
}

// ============================================================
// GET /dispositivos/preview-claim
// ============================================================
removeId('httpPreviewClaim');
removeId('fnAuthPreviewClaim');
removeId('fnPreviewClaim');
removeId('respPreviewClaim');

flows.push(httpInNode('httpPreviewClaim', 'GET /dispositivos/preview-claim',
  '/dispositivos/preview-claim', 'get', 200, 3300, 'fnAuthPreviewClaim'));
flows.push(authNode('fnAuthPreviewClaim', 440, 3300, 'fnPreviewClaim', 'respPreviewClaim'));
flows.push({
  id: 'fnPreviewClaim', type: 'function', z: 'tabAuth', name: 'Preview claim',
  func: [
    "const pool = global.get('pgPool');",
    "if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }",
    "",
    "const q = msg.req.query || {};",
    "const token = q.token ? String(q.token).trim() : '';",
    "const serial = q.serial ? String(q.serial).trim() : '';",
    "const pairing = q.pairing_code ? String(q.pairing_code).trim().toUpperCase() : '';",
    "",
    "if (!token && !(serial && pairing)) {",
    "  msg.statusCode=400; msg.payload={error:'informe token ou (serial + pairing_code)'}; return msg;",
    "}",
    "",
    "try {",
    "  let sel;",
    "  if (token) {",
    "    sel = await pool.query(",
    "      `SELECT d.id, d.device_id AS serial, d.status,",
    "              d.modelo_id,",
    "              m.nome AS modelo_nome, m.prefixo, m.major_version, m.imagem_url AS modelo_icone",
    "         FROM devices d",
    "         LEFT JOIN modelos_dispositivo m ON m.id = d.modelo_id",
    "         WHERE d.claim_token = $1 LIMIT 1`,",
    "      [token]",
    "    );",
    "  } else {",
    "    sel = await pool.query(",
    "      `SELECT d.id, d.device_id AS serial, d.status,",
    "              d.modelo_id,",
    "              m.nome AS modelo_nome, m.prefixo, m.major_version, m.imagem_url AS modelo_icone",
    "         FROM devices d",
    "         LEFT JOIN modelos_dispositivo m ON m.id = d.modelo_id",
    "         WHERE d.device_id = $1 AND d.pairing_code = $2 LIMIT 1`,",
    "      [serial, pairing]",
    "    );",
    "  }",
    "",
    "  if (sel.rowCount === 0) {",
    "    msg.statusCode=404; msg.payload={error:'codigo invalido ou dispositivo nao encontrado'}; return msg;",
    "  }",
    "  const d = sel.rows[0];",
    "  if (d.status !== 'ocioso') {",
    "    msg.statusCode=409; msg.payload={error:'dispositivo ja foi reivindicado'}; return msg;",
    "  }",
    "",
    "  msg.statusCode = 200;",
    "  msg.payload = {",
    "    serial: d.serial,",
    "    status: d.status,",
    "    modelo: d.modelo_id ? {",
    "      id: d.modelo_id,",
    "      nome: d.modelo_nome,",
    "      prefixo: d.prefixo,",
    "      major_version: d.major_version,",
    "      icone: d.modelo_icone",
    "    } : null",
    "  };",
    "} catch(e) {",
    "  node.error('preview claim: '+e.message, msg);",
    "  msg.statusCode=500; msg.payload={error:'internal'};",
    "}",
    "return msg;"
  ].join('\n'),
  outputs: 1, libs: [],
  x: 700, y: 3300, wires: [['respPreviewClaim']],
});
flows.push(respNode('respPreviewClaim', 940, 3300));

fs.writeFileSync(PATH, JSON.stringify(flows, null, 4));
console.log('E3.3: GET /dispositivos/preview-claim criado.');
console.log('Reinicie: docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
