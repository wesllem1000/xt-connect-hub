#!/usr/bin/env node
// E2.4 — Compartilhamento user-to-user de dispositivos (refs #43)
//
// Injeta no flows.json:
//   1. Patch fnListDisp     → usa view dispositivos_visiveis (own + shared)
//   2. Patch fnSetRate      → gate de permissão (owner OR controle/operator)
//   3. Patch fnSignup       → ativa shares pendentes pelo email do novo user
//   4. Endpoints novos:
//        POST   /dispositivos/:id/compartilhamentos
//        GET    /dispositivos/:id/compartilhamentos
//        DELETE /dispositivos/:id/compartilhamentos/:shareId
//        GET    /compartilhamentos/inbox
//        POST   /compartilhamentos/aceitar
//
// Convenção: paths em português pra match com /dispositivos, /modelos-dispositivo etc.
// Permissão usa o enum existente permissao_compartilhamento{leitura,controle},
// onde leitura = viewer e controle = operator.
//
// Uso: sudo node /opt/xtconect/scripts/_e024_inject_shares.js
// Depois: docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered

const fs = require('fs');
const PATH = '/opt/xtconect/nodered/data/flows.json';
const flows = JSON.parse(fs.readFileSync(PATH, 'utf8'));

function find(id) { return flows.find(n => n.id === id); }
function removeId(id) {
  const i = flows.findIndex(n => n.id === id);
  if (i >= 0) flows.splice(i, 1);
}

// Template padrão Auth JWT (igual ao usado em todos os outros endpoints)
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

function authNode(id, x, y, okWire, errWire) {
  return {
    id, type: 'function', z: 'tabAuth', name: 'Auth JWT',
    func: AUTH_FUNC, outputs: 2, libs: AUTH_LIBS,
    x, y, wires: [[okWire], [errWire]],
  };
}

function httpInNode(id, name, url, method, x, y, nextId) {
  return {
    id, type: 'http in', z: 'tabAuth', name, url, method,
    upload: false, swaggerDoc: '',
    x, y, wires: [[nextId]],
  };
}

function respNode(id, x, y) {
  return {
    id, type: 'http response', z: 'tabAuth', name: '',
    statusCode: '', headers: { 'Content-Type': 'application/json' },
    x, y, wires: [],
  };
}

// ---------- 1) PATCH fnListDisp — usa dispositivos_visiveis ----------
{
  const n = find('fnListDisp');
  if (!n) throw new Error('fnListDisp not found');
  n.func = `// E2.4 — devolve devices próprios + compartilhamentos ativos (view dispositivos_visiveis)
const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }
const isAdmin = msg.user && msg.user.role === 'admin';
const userId = msg.user && msg.user.id;
try {
  let r;
  if (isAdmin) {
    // Admin: vê todos os dispositivos como owner (sem coluna access_type='shared').
    r = await pool.query(\`
      SELECT
        d.id,
        COALESCE(NULLIF(d.nome_amigavel, ''), d.name) AS nome,
        d.device_id AS serial,
        m.nome AS modelo,
        uv.recebido_em AS ultimo_valor,
        d.created_at AS criado_em,
        d.is_online AS online,
        d.last_seen AS last_seen_at,
        d.telemetry_interval_s,
        d.burst_rate_s,
        'owner'::text AS access_type,
        'controle'::text AS permissao,
        NULL::uuid AS share_id
      FROM devices d
      LEFT JOIN modelos_dispositivo m ON m.id = d.modelo_id
      LEFT JOIN LATERAL (
        SELECT recebido_em FROM dispositivo_ultimo_valor
        WHERE dispositivo_id = d.id ORDER BY recebido_em DESC LIMIT 1
      ) uv ON TRUE
      ORDER BY d.created_at DESC
    \`);
  } else {
    r = await pool.query(\`
      SELECT
        v.id,
        COALESCE(NULLIF(v.nome_amigavel, ''), v.name) AS nome,
        v.device_id AS serial,
        m.nome AS modelo,
        uv.recebido_em AS ultimo_valor,
        v.created_at AS criado_em,
        v.is_online AS online,
        v.last_seen AS last_seen_at,
        v.telemetry_interval_s,
        v.burst_rate_s,
        v.access_type,
        v.permissao::text AS permissao,
        v.share_id
      FROM dispositivos_visiveis v
      LEFT JOIN modelos_dispositivo m ON m.id = v.modelo_id
      LEFT JOIN LATERAL (
        SELECT recebido_em FROM dispositivo_ultimo_valor
        WHERE dispositivo_id = v.id ORDER BY recebido_em DESC LIMIT 1
      ) uv ON TRUE
      WHERE v.viewer_id = $1::uuid
      ORDER BY v.created_at DESC
    \`, [userId]);
  }
  msg.statusCode = 200;
  msg.payload = r.rows;
} catch(e) {
  node.error('list dispositivos: '+e.message, msg);
  msg.statusCode = 500; msg.payload = {error:'internal'};
}
return msg;`;
}

// ---------- 2) PATCH fnSetRate — gate de permissão (owner OR controle) ----------
{
  const n = find('fnSetRate');
  if (!n) throw new Error('fnSetRate not found');
  n.func = `// E2.3 + E2.4 — atualiza taxa (mode=default) ou só publica burst.
// Permissão: owner, admin, ou compartilhamento ativo com permissao=controle.
const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return [msg, null]; }

const id = msg.req.params.id;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!id || !UUID_RE.test(id)) { msg.statusCode=400; msg.payload={error:'id invalido'}; return [msg, null]; }

const body = msg.payload || {};
const mode = (body.mode === 'burst') ? 'burst' : (body.mode === 'default' ? 'default' : null);
if (!mode) { msg.statusCode=400; msg.payload={error:'mode deve ser default ou burst'}; return [msg, null]; }

const rate = Number(body.rate_s);
if (!Number.isFinite(rate) || !Number.isInteger(rate) || rate < 1) {
  msg.statusCode=400; msg.payload={error:'rate_s invalido'}; return [msg, null];
}
if (mode === 'default' && rate > 3600) {
  msg.statusCode=400; msg.payload={error:'rate_s (default) deve ser <= 3600'}; return [msg, null];
}
if (mode === 'burst' && rate > 60) {
  msg.statusCode=400; msg.payload={error:'rate_s (burst) deve ser <= 60'}; return [msg, null];
}

let durationS = 0;
if (mode === 'burst') {
  durationS = Number(body.duration_s);
  if (!Number.isFinite(durationS) || !Number.isInteger(durationS) || durationS < 5 || durationS > 1800) {
    msg.statusCode=400; msg.payload={error:'duration_s invalido (5..1800)'}; return [msg, null];
  }
}

try {
  const isAdmin = msg.user && msg.user.role === 'admin';

  // Acesso via dispositivos_visiveis: pega permissão efetiva e device serial em uma query.
  let dev, permEff;
  if (isAdmin) {
    const sel = await pool.query(
      'SELECT id, user_id, device_id FROM devices WHERE id=$1 LIMIT 1',
      [id]
    );
    if (sel.rowCount === 0) { msg.statusCode=404; msg.payload={error:'not found'}; return [msg, null]; }
    dev = sel.rows[0];
    permEff = 'controle';
  } else {
    const sel = await pool.query(
      \`SELECT id, owner_id AS user_id, device_id, permissao::text AS permissao
         FROM dispositivos_visiveis
         WHERE id = $1 AND viewer_id = $2 LIMIT 1\`,
      [id, msg.user.id]
    );
    if (sel.rowCount === 0) { msg.statusCode=404; msg.payload={error:'not found'}; return [msg, null]; }
    dev = sel.rows[0];
    permEff = dev.permissao;
    if (permEff !== 'controle') {
      msg.statusCode=403;
      msg.payload={error:'sem permissao para comandar (acesso somente leitura)'};
      return [msg, null];
    }
  }

  if (mode === 'default') {
    await pool.query(
      'UPDATE devices SET telemetry_interval_s=$1 WHERE id=$2',
      [rate, id]
    );
  }

  const requestId = crypto.randomUUID();
  const cmd = {
    cmd: 'set_rate',
    rate_s: rate,
    mode,
    request_id: requestId
  };
  if (mode === 'burst') {
    cmd.expires_at = new Date(Date.now() + durationS * 1000).toISOString();
  }

  const pubMsg = {
    topic: 'devices/' + dev.device_id + '/commands',
    payload: JSON.stringify(cmd)
  };

  msg.statusCode = 200;
  msg.payload = { ok: true, request_id: requestId, applied_rate_s: rate, mode };
  return [msg, pubMsg];
} catch (e) {
  node.error('set rate: ' + e.message, msg);
  msg.statusCode = 500;
  msg.payload = { error: 'internal' };
  return [msg, null];
}`;
}

// ---------- 3) PATCH fnSignup — ativa shares pendentes pelo email ----------
{
  const n = find('fnSignup');
  if (!n) throw new Error('fnSignup not found');
  // Inserir o UPDATE de shares logo após o INSERT do user, antes do email_verification_tokens.
  // Estratégia: substituir a string de marcação conhecida.
  const oldFunc = n.func;
  const marker = "const userId = ins.rows[0].id;";
  if (!oldFunc.includes(marker)) throw new Error('fnSignup marker not found — script desatualizado vs flow');
  const insertion = marker + `
  // E2.4 — ativa qualquer compartilhamento pendente pra esse email
  try {
    const linked = await pool.query(
      \`UPDATE dispositivo_compartilhado
          SET status='ativo', com_usuario_id=$1, aceito_em=NOW(), token_convite=NULL
        WHERE email_convidado=$2 AND status='pendente'
        RETURNING id\`,
      [userId, email]
    );
    if (linked.rowCount > 0) node.log('signup: '+linked.rowCount+' compartilhamento(s) ativado(s) pra '+email);
  } catch(e) { node.warn('signup share-link failed: '+e.message); }`;
  n.func = oldFunc.replace(marker, insertion);
}

// ============================================================
// Novos endpoints — coordenadas y a partir de 2200 pra não colidir
// ============================================================

// ---------- 4) POST /dispositivos/:id/compartilhamentos ----------
removeId('httpCreateShare');
removeId('fnAuthCreateShare');
removeId('fnCreateShare');
removeId('respCreateShare');
flows.push(httpInNode('httpCreateShare', 'POST /dispositivos/:id/compartilhamentos',
  '/dispositivos/:id/compartilhamentos', 'post', 200, 2200, 'fnAuthCreateShare'));
flows.push(authNode('fnAuthCreateShare', 440, 2200, 'fnCreateShare', 'respCreateShare'));
flows.push({
  id: 'fnCreateShare', type: 'function', z: 'tabAuth', name: 'Create share',
  func: `const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }
const id = msg.req.params.id;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(id)) { msg.statusCode=400; msg.payload={error:'id invalido'}; return msg; }

const body = msg.payload || {};
const email = (body.email||'').toLowerCase().trim();
const permRaw = body.permissao || body.permission || '';
let permissao;
if (permRaw === 'leitura' || permRaw === 'viewer') permissao = 'leitura';
else if (permRaw === 'controle' || permRaw === 'operator') permissao = 'controle';
else { msg.statusCode=400; msg.payload={error:'permissao deve ser leitura ou controle (ou viewer/operator)'}; return msg; }

const EMAIL_RE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
if (!EMAIL_RE.test(email)) { msg.statusCode=400; msg.payload={error:'email invalido'}; return msg; }
if (msg.user.email && email === String(msg.user.email).toLowerCase()) {
  msg.statusCode=400; msg.payload={error:'nao pode compartilhar consigo mesmo'}; return msg;
}

try {
  const dev = await pool.query('SELECT id, user_id FROM devices WHERE id=$1 LIMIT 1', [id]);
  if (dev.rowCount === 0) { msg.statusCode=404; msg.payload={error:'dispositivo nao encontrado'}; return msg; }
  if (dev.rows[0].user_id !== msg.user.id) {
    msg.statusCode=403; msg.payload={error:'apenas o dono pode compartilhar'}; return msg;
  }

  const u = await pool.query('SELECT id FROM app_users WHERE email=$1 LIMIT 1', [email]);
  const targetUserId = u.rowCount > 0 ? u.rows[0].id : null;
  const status = targetUserId ? 'ativo' : 'pendente';
  const token = targetUserId ? null : crypto.randomBytes(32).toString('base64url');
  const aceitoEm = targetUserId ? new Date() : null;

  let r;
  try {
    r = await pool.query(
      \`INSERT INTO dispositivo_compartilhado
         (dispositivo_id, com_usuario_id, criado_por, permissao, email_convidado, status, token_convite, aceito_em)
       VALUES ($1, $2, $3, $4::permissao_compartilhamento, $5, $6, $7, $8)
       RETURNING id, dispositivo_id, com_usuario_id, permissao::text AS permissao,
                 email_convidado, status, token_convite, criado_em, aceito_em\`,
      [id, targetUserId, msg.user.id, permissao, email, status, token, aceitoEm]
    );
  } catch(e) {
    if (/uq_compart_email_ativo/i.test(e.message) || /duplicate/i.test(e.message) || e.code === '23505') {
      msg.statusCode=409; msg.payload={error:'ja compartilhado com esse email'}; return msg;
    }
    throw e;
  }

  msg.statusCode = 201;
  msg.payload = { compartilhamento: r.rows[0] };
} catch(e) {
  node.error('create share: '+e.message, msg);
  msg.statusCode=500; msg.payload={error:'internal'};
}
return msg;`,
  outputs: 1,
  libs: [{ var: 'crypto', module: 'crypto' }],
  x: 700, y: 2200, wires: [['respCreateShare']],
});
flows.push(respNode('respCreateShare', 940, 2200));

// ---------- 5) GET /dispositivos/:id/compartilhamentos ----------
removeId('httpListShares');
removeId('fnAuthListShares');
removeId('fnListShares');
removeId('respListShares');
flows.push(httpInNode('httpListShares', 'GET /dispositivos/:id/compartilhamentos',
  '/dispositivos/:id/compartilhamentos', 'get', 200, 2300, 'fnAuthListShares'));
flows.push(authNode('fnAuthListShares', 440, 2300, 'fnListShares', 'respListShares'));
flows.push({
  id: 'fnListShares', type: 'function', z: 'tabAuth', name: 'List shares',
  func: `const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }
const id = msg.req.params.id;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(id)) { msg.statusCode=400; msg.payload={error:'id invalido'}; return msg; }
try {
  const dev = await pool.query('SELECT user_id FROM devices WHERE id=$1 LIMIT 1', [id]);
  if (dev.rowCount === 0) { msg.statusCode=404; msg.payload={error:'dispositivo nao encontrado'}; return msg; }
  const isAdmin = msg.user && msg.user.role === 'admin';
  if (dev.rows[0].user_id !== msg.user.id && !isAdmin) {
    msg.statusCode=403; msg.payload={error:'apenas o dono pode listar compartilhamentos'}; return msg;
  }
  const r = await pool.query(\`
    SELECT s.id, s.email_convidado, s.permissao::text AS permissao, s.status,
           s.criado_em, s.aceito_em, s.revogado_em,
           s.com_usuario_id AS user_id, u.full_name AS user_nome
    FROM dispositivo_compartilhado s
    LEFT JOIN app_users u ON u.id = s.com_usuario_id
    WHERE s.dispositivo_id = $1
    ORDER BY s.criado_em DESC
  \`, [id]);
  msg.statusCode=200;
  msg.payload = { compartilhamentos: r.rows };
} catch(e) {
  node.error('list shares: '+e.message, msg);
  msg.statusCode=500; msg.payload={error:'internal'};
}
return msg;`,
  outputs: 1, libs: [],
  x: 700, y: 2300, wires: [['respListShares']],
});
flows.push(respNode('respListShares', 940, 2300));

// ---------- 6) DELETE /dispositivos/:id/compartilhamentos/:shareId ----------
removeId('httpRevokeShare');
removeId('fnAuthRevokeShare');
removeId('fnRevokeShare');
removeId('respRevokeShare');
flows.push(httpInNode('httpRevokeShare', 'DELETE /dispositivos/:id/compartilhamentos/:shareId',
  '/dispositivos/:id/compartilhamentos/:shareId', 'delete', 200, 2400, 'fnAuthRevokeShare'));
flows.push(authNode('fnAuthRevokeShare', 440, 2400, 'fnRevokeShare', 'respRevokeShare'));
flows.push({
  id: 'fnRevokeShare', type: 'function', z: 'tabAuth', name: 'Revoke share',
  func: `const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }
const id = msg.req.params.id;
const shareId = msg.req.params.shareId;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(id) || !UUID_RE.test(shareId)) {
  msg.statusCode=400; msg.payload={error:'id invalido'}; return msg;
}
try {
  const dev = await pool.query('SELECT user_id FROM devices WHERE id=$1 LIMIT 1', [id]);
  if (dev.rowCount === 0) { msg.statusCode=404; msg.payload={error:'dispositivo nao encontrado'}; return msg; }
  const isAdmin = msg.user && msg.user.role === 'admin';
  if (dev.rows[0].user_id !== msg.user.id && !isAdmin) {
    msg.statusCode=403; msg.payload={error:'apenas o dono pode revogar'}; return msg;
  }
  const r = await pool.query(
    \`UPDATE dispositivo_compartilhado
        SET status='revogado', revogado_em=NOW(), token_convite=NULL
      WHERE id=$1 AND dispositivo_id=$2 AND status<>'revogado'
      RETURNING id\`,
    [shareId, id]
  );
  if (r.rowCount === 0) { msg.statusCode=404; msg.payload={error:'compartilhamento nao encontrado ou ja revogado'}; return msg; }
  msg.statusCode=200;
  msg.payload = { ok: true, id: r.rows[0].id };
} catch(e) {
  node.error('revoke share: '+e.message, msg);
  msg.statusCode=500; msg.payload={error:'internal'};
}
return msg;`,
  outputs: 1, libs: [],
  x: 700, y: 2400, wires: [['respRevokeShare']],
});
flows.push(respNode('respRevokeShare', 940, 2400));

// ---------- 7) GET /compartilhamentos/inbox ----------
removeId('httpInbox');
removeId('fnAuthInbox');
removeId('fnInbox');
removeId('respInbox');
flows.push(httpInNode('httpInbox', 'GET /compartilhamentos/inbox',
  '/compartilhamentos/inbox', 'get', 200, 2500, 'fnAuthInbox'));
flows.push(authNode('fnAuthInbox', 440, 2500, 'fnInbox', 'respInbox'));
flows.push({
  id: 'fnInbox', type: 'function', z: 'tabAuth', name: 'Shares inbox',
  func: `const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }
const userEmail = (msg.user.email||'').toLowerCase();
const userId = msg.user.id;
try {
  const pend = await pool.query(\`
    SELECT s.id, s.token_convite AS token, s.permissao::text AS permissao,
           s.email_convidado, s.criado_em,
           d.id AS dispositivo_id,
           COALESCE(NULLIF(d.nome_amigavel,''), d.name) AS dispositivo_nome,
           d.device_id AS serial,
           u.email AS dono_email, u.full_name AS dono_nome
    FROM dispositivo_compartilhado s
    JOIN devices d ON d.id = s.dispositivo_id
    JOIN app_users u ON u.id = s.criado_por
    WHERE s.status = 'pendente' AND s.email_convidado = $1
    ORDER BY s.criado_em DESC
  \`, [userEmail]);

  const ativ = await pool.query(\`
    SELECT s.id, s.permissao::text AS permissao, s.aceito_em, s.criado_em,
           d.id AS dispositivo_id,
           COALESCE(NULLIF(d.nome_amigavel,''), d.name) AS dispositivo_nome,
           d.device_id AS serial,
           u.email AS dono_email, u.full_name AS dono_nome
    FROM dispositivo_compartilhado s
    JOIN devices d ON d.id = s.dispositivo_id
    JOIN app_users u ON u.id = s.criado_por
    WHERE s.status = 'ativo' AND s.com_usuario_id = $1
    ORDER BY s.aceito_em DESC NULLS LAST
  \`, [userId]);

  msg.statusCode=200;
  msg.payload = { pendentes: pend.rows, ativos: ativ.rows };
} catch(e) {
  node.error('inbox: '+e.message, msg);
  msg.statusCode=500; msg.payload={error:'internal'};
}
return msg;`,
  outputs: 1, libs: [],
  x: 700, y: 2500, wires: [['respInbox']],
});
flows.push(respNode('respInbox', 940, 2500));

// ---------- 8) POST /compartilhamentos/aceitar ----------
removeId('httpAcceptShare');
removeId('fnAuthAcceptShare');
removeId('fnAcceptShare');
removeId('respAcceptShare');
flows.push(httpInNode('httpAcceptShare', 'POST /compartilhamentos/aceitar',
  '/compartilhamentos/aceitar', 'post', 200, 2600, 'fnAuthAcceptShare'));
flows.push(authNode('fnAuthAcceptShare', 440, 2600, 'fnAcceptShare', 'respAcceptShare'));
flows.push({
  id: 'fnAcceptShare', type: 'function', z: 'tabAuth', name: 'Accept share',
  func: `const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }
const body = msg.payload || {};
const token = (body.token||'').trim();
if (!token) { msg.statusCode=400; msg.payload={error:'token obrigatorio'}; return msg; }
try {
  const sel = await pool.query(
    \`SELECT id, dispositivo_id, email_convidado, status
       FROM dispositivo_compartilhado WHERE token_convite=$1 LIMIT 1\`,
    [token]
  );
  if (sel.rowCount === 0 || sel.rows[0].status !== 'pendente') {
    msg.statusCode=404; msg.payload={error:'convite nao encontrado ou ja usado'}; return msg;
  }
  const share = sel.rows[0];
  const userEmail = (msg.user.email||'').toLowerCase();
  if (String(share.email_convidado).toLowerCase() !== userEmail) {
    msg.statusCode=403; msg.payload={error:'convite e para outro email'}; return msg;
  }
  const upd = await pool.query(
    \`UPDATE dispositivo_compartilhado
        SET status='ativo', aceito_em=NOW(), com_usuario_id=$1, token_convite=NULL
      WHERE id=$2
      RETURNING id, dispositivo_id, com_usuario_id, permissao::text AS permissao,
                email_convidado, status, criado_em, aceito_em\`,
    [msg.user.id, share.id]
  );
  const dev = await pool.query(
    \`SELECT id, COALESCE(NULLIF(nome_amigavel,''), name) AS nome,
            device_id AS serial
       FROM devices WHERE id=$1\`,
    [share.dispositivo_id]
  );
  msg.statusCode=200;
  msg.payload = { compartilhamento: upd.rows[0], dispositivo: dev.rows[0] };
} catch(e) {
  node.error('accept share: '+e.message, msg);
  msg.statusCode=500; msg.payload={error:'internal'};
}
return msg;`,
  outputs: 1, libs: [],
  x: 700, y: 2600, wires: [['respAcceptShare']],
});
flows.push(respNode('respAcceptShare', 940, 2600));

// ============================================================
fs.writeFileSync(PATH, JSON.stringify(flows, null, 4));
console.log('E2.4: flows.json atualizado.');
console.log('  • patches: fnListDisp, fnSetRate, fnSignup');
console.log('  • novos endpoints: 5');
console.log('Reinicie o Node-RED:');
console.log('  docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
