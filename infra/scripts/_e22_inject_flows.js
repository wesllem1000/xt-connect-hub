#!/usr/bin/env node
// E2.2 — Injeta validação estrita em fnHandleData/fnHandleStatus e adiciona
//        endpoint GET /dispositivos/:id/readings no flows.json.
const fs = require('fs');
const PATH = '/opt/xtconect/nodered/data/flows.json';
const flows = JSON.parse(fs.readFileSync(PATH, 'utf8'));

function find(id) {
  return flows.find(n => n.id === id);
}
function removeId(id) {
  const i = flows.findIndex(n => n.id === id);
  if (i >= 0) flows.splice(i, 1);
}

// ----- 1) fnHandleData : validação rigorosa + last_reading + ts -----
{
  const n = find('fnHandleData');
  if (!n) throw new Error('fnHandleData not found');
  n.libs = n.libs || [];
  n.func = `// E2.2 — validação estrita do envelope {ts, readings:{k:Number,...}}
const MAX = parseInt(env.get('MQTT_MAX_PAYLOAD_BYTES') || '4096');
const pool = global.get('pgPool');
const writeApi = global.get('influxWrite');
const Point = global.get('influxPoint');
if (!pool) { node.status({ fill:'red', shape:'ring', text:'sem pool' }); return null; }

const topic = msg.topic || '';
const parts = topic.split('/');
if (parts.length !== 3 || parts[0] !== 'devices' || parts[2] !== 'data') {
  node.warn('topic invalido: ' + topic); return null;
}
const mqttUser = parts[1];
if (!mqttUser || mqttUser.length > 64) { node.warn('serial invalido'); return null; }

let raw = msg.payload;
const str = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
if (str.length > MAX) { node.warn('payload > ' + MAX + 'B'); return null; }

let env_;
try { env_ = JSON.parse(str); } catch (e) { node.warn('JSON invalido: ' + e.message); return null; }
if (!env_ || typeof env_ !== 'object' || Array.isArray(env_)) { node.warn('envelope nao e objeto'); return null; }
if (typeof env_.ts !== 'number' || !Number.isFinite(env_.ts) || env_.ts <= 0) { node.warn('ts invalido'); return null; }
if (!env_.readings || typeof env_.readings !== 'object' || Array.isArray(env_.readings)) {
  node.warn('readings ausente/invalido'); return null;
}
const keys = Object.keys(env_.readings);
if (keys.length === 0) { node.warn('readings vazio'); return null; }
for (const k of keys) {
  if (typeof k !== 'string' || k.length === 0 || k.length > 32) { node.warn('key invalida: ' + k); return null; }
  const v = env_.readings[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) { node.warn('valor nao numerico em ' + k); return null; }
}

// Heurística ts: se < 10^12 trata como segundos epoch, senão como ms epoch
const tsNum = env_.ts;
const tsMs = tsNum < 1e12 ? tsNum * 1000 : tsNum;
const tsIso = new Date(tsMs).toISOString();

try {
  // 1) Lookup device
  const r = await pool.query(
    'SELECT id, user_id, status FROM devices WHERE mqtt_username=$1 LIMIT 1',
    [mqttUser]
  );
  if (r.rowCount === 0) {
    await pool.query('INSERT INTO mqtt_events(topic,client_id,payload) VALUES($1,$2,$3)',
      [topic, mqttUser, JSON.stringify(env_)]);
    node.status({ fill:'yellow', shape:'ring', text: mqttUser + ' nao cadastrado' });
    return null;
  }
  const dev = r.rows[0];
  if (dev.status !== 'active') {
    node.status({ fill:'yellow', shape:'ring', text: mqttUser + ' status=' + dev.status });
    return null;
  }
  const devId = dev.id;
  const readingsJson = JSON.stringify(env_.readings);

  // 2) Postgres: histórico + última leitura embutida
  await pool.query(
    'INSERT INTO device_readings(device_id, ts, topic, payload) VALUES($1,$2,$3,$4::jsonb)',
    [devId, tsIso, topic, readingsJson]
  );
  await pool.query(
    'UPDATE devices SET last_reading=$1::jsonb, last_reading_at=$2, last_seen=NOW(), is_online=TRUE WHERE id=$3',
    [readingsJson, tsIso, devId]
  );

  // 3) InfluxDB
  let fieldCount = 0;
  if (writeApi && Point) {
    const p = new Point('readings').tag('device_id', devId).tag('mqtt_user', mqttUser).timestamp(new Date(tsMs));
    for (const k of keys) { p.floatField(k, env_.readings[k]); fieldCount++; }
    if (fieldCount > 0) writeApi.writePoint(p);
  }

  node.status({ fill:'green', shape:'dot', text: mqttUser + ' pg+ifx(' + fieldCount + 'f) ' + new Date().toISOString().slice(11,19) });
  msg.saved = { device_id: devId, ts: tsIso, readings: env_.readings, influx_fields: fieldCount };
  return msg;
} catch (e) {
  node.error('ingest: ' + e.message, msg);
  return null;
}
`;
}

// ----- 2) fnHandleStatus : online apenas se payload === 'online' -----
{
  const n = find('fnHandleStatus');
  if (!n) throw new Error('fnHandleStatus not found');
  n.func = `// E2.2 — status estrito: 'online' -> true; qualquer outra coisa -> false
const pool = global.get('pgPool');
if (!pool) return null;
const parts = (msg.topic || '').split('/');
if (parts.length !== 3) return null;
const mqttUser = parts[1];
if (!mqttUser || mqttUser.length > 64) return null;
const raw = Buffer.isBuffer(msg.payload) ? msg.payload.toString('utf8') : String(msg.payload || '');
const online = raw.trim().toLowerCase() === 'online';
try {
  await pool.query(
    'UPDATE devices SET is_online=$1, last_seen=NOW() WHERE mqtt_username=$2',
    [online, mqttUser]
  );
  node.status({ fill: online ? 'green' : 'red', shape: 'dot', text: mqttUser + ' ' + (online ? 'on' : 'off') });
} catch (e) { node.warn('status update: ' + e.message); }
return null;
`;
}

// ----- 3) GET /dispositivos/:id/readings -----
// Cadeia: httpReadings -> fnAuthReadings -> fnGetReadings -> respReadings
{
  // remover existentes (idempotente)
  ['httpReadings', 'fnAuthReadings', 'fnGetReadings', 'respReadings'].forEach(removeId);

  const tabId = 'tabAuth';

  // Coordenadas: pegar offset baseado em outro nó
  const refX = 200, baseY = 1500;

  flows.push({
    id: 'httpReadings', type: 'http in', z: tabId,
    name: 'GET /dispositivos/:id/readings',
    url: '/dispositivos/:id/readings', method: 'get', upload: false, swaggerDoc: '',
    x: refX, y: baseY, wires: [['fnAuthReadings']]
  });

  flows.push({
    id: 'fnAuthReadings', type: 'function', z: tabId,
    name: 'Auth JWT',
    func: `const auth = (msg.req.headers['authorization']||'').trim();
const m = auth.match(/^Bearer (.+)$/);
if (!m) { msg.statusCode=401; msg.payload={error:'missing bearer token'}; return [null, msg]; }
try {
  const secret = env.get('JWT_SECRET');
  const decoded = jwt.verify(m[1], secret);
  if (decoded.typ === 'refresh') { msg.statusCode=401; msg.payload={error:'refresh token cannot be used here'}; return [null, msg]; }
  msg.user = { id: decoded.sub, email: decoded.email, role: decoded.role };
  return [msg, null];
} catch (e) { msg.statusCode=401; msg.payload={error:'invalid token'}; return [null, msg]; }
`,
    outputs: 2, noerr: 0, initialize: '', finalize: '',
    libs: [{ var: 'jwt', module: 'jsonwebtoken' }],
    x: refX + 200, y: baseY,
    wires: [['fnGetReadings'], ['respReadings']]
  });

  flows.push({
    id: 'fnGetReadings', type: 'function', z: tabId,
    name: 'Get readings',
    func: `const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }

const id = msg.req.params.id;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!id || !UUID_RE.test(id)) { msg.statusCode=400; msg.payload={error:'id invalido'}; return msg; }

const q = msg.req.query || {};
let limit = parseInt(q.limit || '500', 10);
if (!Number.isFinite(limit) || limit <= 0) limit = 500;
if (limit > 2000) limit = 2000;

const sinceParam = q.since ? new Date(q.since) : null;
const untilParam = q.until ? new Date(q.until) : null;
const since = (sinceParam && !isNaN(sinceParam)) ? sinceParam.toISOString() : null;
const until = (untilParam && !isNaN(untilParam)) ? untilParam.toISOString() : null;

try {
  // 1) Lookup + AuthZ
  const sel = await pool.query(
    'SELECT id, user_id, admin_access_level FROM devices WHERE id=$1 LIMIT 1', [id]
  );
  if (sel.rowCount === 0) { msg.statusCode=404; msg.payload={error:'not found'}; return msg; }
  const dev = sel.rows[0];
  const isOwner = dev.user_id === msg.user.id;
  const isAdminWithAccess = msg.user.role === 'admin' && dev.admin_access_level !== 'none';
  if (!isOwner && !isAdminWithAccess) { msg.statusCode=403; msg.payload={error:'forbidden'}; return msg; }

  // 2) Query
  const r = await pool.query(\`
    SELECT ts, payload
    FROM device_readings
    WHERE device_id = $1
      AND ts >= COALESCE($2::timestamptz, now() - interval '24 hours')
      AND ts <= COALESCE($3::timestamptz, now())
    ORDER BY ts DESC
    LIMIT $4
  \`, [id, since, until, limit]);

  msg.statusCode = 200;
  msg.payload = { readings: r.rows.map(row => ({ ts: row.ts, payload: row.payload })) };
} catch (e) {
  node.error('get readings: ' + e.message, msg);
  msg.statusCode = 500; msg.payload = { error: 'internal' };
}
return msg;
`,
    outputs: 1, noerr: 0, initialize: '', finalize: '', libs: [],
    x: refX + 420, y: baseY,
    wires: [['respReadings']]
  });

  flows.push({
    id: 'respReadings', type: 'http response', z: tabId,
    name: '', statusCode: '', headers: {},
    x: refX + 640, y: baseY, wires: []
  });
}

fs.writeFileSync(PATH, JSON.stringify(flows, null, 4));
console.log('flows.json atualizado: fnHandleData/fnHandleStatus regravados, GET /dispositivos/:id/readings adicionado.');
