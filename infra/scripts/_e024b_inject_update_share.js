#!/usr/bin/env node
// E2.4b — PATCH /dispositivos/:id/compartilhamentos/:shareId (edita permissão)
//
// Segue o mesmo padrão do _e024_inject_shares.js. Idempotente (removeId + push).
// Owner-only; só aceita shares com status='ativo' (pendente/revogado → 409).
// Idempotente do lado do backend também: permissão igual à atual → 200 sem UPDATE.
//
// Uso: sudo node /opt/xtconect/src/webapp/infra/scripts/_e024b_inject_update_share.js
// Depois: docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered

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

// ---------- PATCH /dispositivos/:id/compartilhamentos/:shareId ----------
removeId('httpUpdateShare');
removeId('fnAuthUpdateShare');
removeId('fnUpdateShare');
removeId('respUpdateShare');

flows.push(httpInNode(
  'httpUpdateShare',
  'PATCH /dispositivos/:id/compartilhamentos/:shareId',
  '/dispositivos/:id/compartilhamentos/:shareId',
  'patch',
  200, 2700,
  'fnAuthUpdateShare',
));
flows.push(authNode('fnAuthUpdateShare', 440, 2700, 'fnUpdateShare', 'respUpdateShare'));
flows.push({
  id: 'fnUpdateShare', type: 'function', z: 'tabAuth', name: 'Update share permissao',
  func: `const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }

const id = msg.req.params.id;
const shareId = msg.req.params.shareId;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(id) || !UUID_RE.test(shareId)) {
  msg.statusCode=400; msg.payload={error:'id invalido'}; return msg;
}

const body = msg.payload || {};
const permRaw = body.permissao || body.permission || '';
let permissao;
if (permRaw === 'leitura' || permRaw === 'viewer') permissao = 'leitura';
else if (permRaw === 'controle' || permRaw === 'operator') permissao = 'controle';
else { msg.statusCode=400; msg.payload={error:'permissao deve ser leitura ou controle (ou viewer/operator)'}; return msg; }

try {
  const dev = await pool.query('SELECT user_id FROM devices WHERE id=$1 LIMIT 1', [id]);
  if (dev.rowCount === 0) { msg.statusCode=404; msg.payload={error:'dispositivo nao encontrado'}; return msg; }
  const isAdmin = msg.user && msg.user.role === 'admin';
  if (dev.rows[0].user_id !== msg.user.id && !isAdmin) {
    msg.statusCode=403; msg.payload={error:'apenas o dono pode editar'}; return msg;
  }

  const sel = await pool.query(
    \`SELECT id, status, permissao::text AS permissao
       FROM dispositivo_compartilhado
      WHERE id=$1 AND dispositivo_id=$2 LIMIT 1\`,
    [shareId, id]
  );
  if (sel.rowCount === 0) {
    msg.statusCode=404; msg.payload={error:'compartilhamento nao encontrado'}; return msg;
  }
  const cur = sel.rows[0];
  if (cur.status !== 'ativo') {
    msg.statusCode=409;
    msg.payload={error:'nao e possivel editar permissao de convite '+cur.status};
    return msg;
  }

  // Idempotente: se ja tá com a permissão nova, retorna row atual sem UPDATE.
  let row;
  if (cur.permissao === permissao) {
    const r = await pool.query(\`
      SELECT s.id, s.email_convidado, s.permissao::text AS permissao, s.status,
             s.criado_em, s.aceito_em, s.revogado_em,
             s.com_usuario_id AS user_id, u.full_name AS user_nome
      FROM dispositivo_compartilhado s
      LEFT JOIN app_users u ON u.id = s.com_usuario_id
      WHERE s.id=$1
    \`, [shareId]);
    row = r.rows[0];
  } else {
    const r = await pool.query(\`
      UPDATE dispositivo_compartilhado AS s
         SET permissao=$1::permissao_compartilhamento
       WHERE s.id=$2 AND s.dispositivo_id=$3 AND s.status='ativo'
       RETURNING s.id, s.email_convidado, s.permissao::text AS permissao, s.status,
                 s.criado_em, s.aceito_em, s.revogado_em,
                 s.com_usuario_id AS user_id,
                 (SELECT full_name FROM app_users WHERE id = s.com_usuario_id) AS user_nome
    \`, [permissao, shareId, id]);
    if (r.rowCount === 0) {
      msg.statusCode=409; msg.payload={error:'compartilhamento mudou de estado, tente novamente'}; return msg;
    }
    row = r.rows[0];
  }

  msg.statusCode=200;
  msg.payload = { compartilhamento: row };
} catch(e) {
  node.error('update share: '+e.message, msg);
  msg.statusCode=500; msg.payload={error:'internal'};
}
return msg;`,
  outputs: 1, libs: [],
  x: 700, y: 2700, wires: [['respUpdateShare']],
});
flows.push(respNode('respUpdateShare', 940, 2700));

fs.writeFileSync(PATH, JSON.stringify(flows, null, 4));
console.log('E2.4b: flows.json atualizado.');
console.log('  • novo endpoint: PATCH /dispositivos/:id/compartilhamentos/:shareId');
console.log('Reinicie o Node-RED:');
console.log('  docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
