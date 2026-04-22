#!/usr/bin/env node
// E2.3 — Taxa de telemetria por dispositivo + burst mode + sweeper per-device (#51)
//
// Injeta no flows.json:
//   - Sweeper usa 3x telemetry_interval_s (clamp [60,900]) em vez de 120s fixo (#51).
//   - fnListDisp e fnGetCliente devolvem telemetry_interval_s e burst_rate_s.
//   - Novo endpoint POST /dispositivos/:id/rate (auth + DB update se default + publish MQTT).
//   - Nó mqtt out compartilhado (mqttOutCommands) pra publicar em devices/<serial>/commands.
//
// Uso: sudo node /opt/xtconect/scripts/_e23_inject_flows.js

const fs = require('fs');
const PATH = '/opt/xtconect/nodered/data/flows.json';
const flows = JSON.parse(fs.readFileSync(PATH, 'utf8'));

function find(id) { return flows.find(n => n.id === id); }
function removeId(id) {
  const i = flows.findIndex(n => n.id === id);
  if (i >= 0) flows.splice(i, 1);
}

// ---------- 1) Sweeper — threshold per-device (#51) ----------
{
  const n = find('fnSweeper');
  if (!n) throw new Error('fnSweeper not found');
  n.func = `// E2.3 — flip stale devices to offline usando threshold per-device (#51)
// Threshold efetivo = clamp(3 * telemetry_interval_s, 60, 900) segundos.
const pool = global.get('pgPool');
if (!pool) { node.status({ fill:'yellow', shape:'ring', text:'sem pool' }); return null; }
try {
  const r = await pool.query(
    \`UPDATE devices
        SET is_online = FALSE
      WHERE is_online = TRUE
        AND last_seen IS NOT NULL
        AND last_seen < NOW() - MAKE_INTERVAL(
          secs => GREATEST(60, LEAST(900, telemetry_interval_s * 3))
        )
      RETURNING id, device_id AS serial, user_id, last_seen, telemetry_interval_s\`
  );
  if (r.rowCount === 0) {
    node.status({ fill:'grey', shape:'dot', text:'nothing stale '+new Date().toISOString().slice(11,19) });
    return null;
  }
  const msgs = [];
  for (const row of r.rows) {
    const payload = {
      type: 'device_status_changed',
      online: false,
      device_id: row.id,
      serial: row.serial,
      user_id: row.user_id,
      last_seen_at: row.last_seen ? new Date(row.last_seen).toISOString() : null,
      source: 'sweeper'
    };
    msgs.push({ topic: 'devices/' + row.serial + '/status', payload: JSON.stringify(payload) });
  }
  node.status({ fill:'orange', shape:'dot', text:'flipped '+r.rowCount+' @ '+new Date().toISOString().slice(11,19) });
  for (const m of msgs) node.send(m);
} catch (e) {
  node.error('sweeper: '+e.message);
  node.status({ fill:'red', shape:'ring', text:e.message.slice(0,40) });
}
return null;`;
}

// ---------- 2) fnListDisp — devolver telemetry_interval_s + burst_rate_s ----------
{
  const n = find('fnListDisp');
  if (!n) throw new Error('fnListDisp not found');
  n.func = `const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }
const isAdmin = msg.user && msg.user.role === 'admin';
const userId = msg.user && msg.user.id;
const sql = \`
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
    d.burst_rate_s
  FROM devices d
  LEFT JOIN modelos_dispositivo m ON m.id = d.modelo_id
  LEFT JOIN LATERAL (
    SELECT recebido_em FROM dispositivo_ultimo_valor
    WHERE dispositivo_id = d.id
    ORDER BY recebido_em DESC
    LIMIT 1
  ) uv ON TRUE
  WHERE ($1::uuid IS NULL OR d.user_id = $1::uuid)
  ORDER BY d.created_at DESC
\`;
try {
  const r = await pool.query(sql, [isAdmin ? null : userId]);
  msg.statusCode = 200;
  msg.payload = r.rows;
} catch(e) {
  node.error('list dispositivos: '+e.message, msg);
  msg.statusCode = 500; msg.payload = {error:'internal'};
}
return msg;`;
}

// ---------- 3) fnGetCliente — devolver telemetry_interval_s + burst_rate_s ----------
{
  const n = find('fnGetCliente');
  if (!n) throw new Error('fnGetCliente not found');
  n.func = `const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }
const id = msg.req.params.id;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(id)) { msg.statusCode=400; msg.payload={error:'invalid id'}; return msg; }
try {
  const r = await pool.query(
    'SELECT id, email, full_name AS nome, role, email_verified, is_active, created_at AS criado_em FROM app_users WHERE id=$1 AND role=$2',
    [id, 'cliente']
  );
  if (r.rowCount === 0) { msg.statusCode=404; msg.payload={error:'cliente nao encontrado'}; return msg; }
  const cliente = r.rows[0];
  const d = await pool.query(\`
    SELECT
      d.id,
      COALESCE(NULLIF(d.nome_amigavel,''), d.name) AS nome,
      d.device_id AS serial,
      m.nome AS modelo,
      d.user_id AS owner_id,
      d.admin_access_level,
      d.created_at AS criado_em,
      d.is_online AS online,
      d.last_seen AS last_seen_at,
      d.telemetry_interval_s,
      d.burst_rate_s
    FROM devices d
    LEFT JOIN modelos_dispositivo m ON m.id = d.modelo_id
    WHERE d.user_id = $1
    ORDER BY d.created_at DESC
  \`, [id]);
  cliente.dispositivos = d.rows;
  msg.statusCode = 200;
  msg.payload = cliente;
} catch(e) {
  node.error('get cliente: '+e.message, msg);
  msg.statusCode=500; msg.payload={error:'internal'};
}
return msg;`;
}

// ---------- 4) mqttOutCommands — publica em devices/<serial>/commands ----------
removeId('mqttOutCommands');
flows.push({
  id: 'mqttOutCommands',
  type: 'mqtt out',
  z: 'tabAuth',
  name: 'publish command',
  topic: '',
  qos: '1',
  retain: '',
  respTopic: '',
  contentType: '',
  userProps: '',
  correl: '',
  expiry: '',
  broker: 'brokerMosq',
  x: 900,
  y: 1400,
  wires: []
});

// ---------- 5) POST /dispositivos/:id/rate ----------
removeId('httpSetRate');
flows.push({
  id: 'httpSetRate',
  type: 'http in',
  z: 'tabAuth',
  name: 'POST /dispositivos/:id/rate',
  url: '/dispositivos/:id/rate',
  method: 'post',
  upload: false,
  swaggerDoc: '',
  x: 180,
  y: 1400,
  wires: [['fnAuthSetRate']]
});

removeId('fnAuthSetRate');
flows.push({
  id: 'fnAuthSetRate',
  type: 'function',
  z: 'tabAuth',
  name: 'Auth JWT',
  func: `const auth = (msg.req.headers['authorization']||'').trim();
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
}`,
  outputs: 2,
  libs: [{ var: 'jwt', module: 'jsonwebtoken' }],
  x: 420,
  y: 1400,
  wires: [['fnSetRate'], ['respSetRate']]
});

removeId('fnSetRate');
flows.push({
  id: 'fnSetRate',
  type: 'function',
  z: 'tabAuth',
  name: 'Set rate + publish',
  func: `// E2.3 — atualiza taxa (mode=default) ou só publica burst (mode=burst).
// Permissão: owner ou admin.
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
  const sel = await pool.query(
    'SELECT id, user_id, device_id FROM devices WHERE id=$1 LIMIT 1',
    [id]
  );
  if (sel.rowCount === 0) { msg.statusCode=404; msg.payload={error:'not found'}; return [msg, null]; }
  const dev = sel.rows[0];
  const isOwner = dev.user_id === msg.user.id;
  const isAdmin = msg.user && msg.user.role === 'admin';
  if (!isOwner && !isAdmin) { msg.statusCode=403; msg.payload={error:'forbidden'}; return [msg, null]; }

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
}`,
  outputs: 2,
  libs: [{ var: 'crypto', module: 'crypto' }],
  x: 660,
  y: 1400,
  wires: [['respSetRate'], ['mqttOutCommands']]
});

removeId('respSetRate');
flows.push({
  id: 'respSetRate',
  type: 'http response',
  z: 'tabAuth',
  name: '',
  statusCode: '',
  headers: { 'Content-Type': 'application/json' },
  x: 900,
  y: 1340,
  wires: []
});

fs.writeFileSync(PATH, JSON.stringify(flows, null, 4));
console.log('E2.3: flows.json atualizado — sweeper per-device (#51) + endpoint /rate + mqttOutCommands.');
