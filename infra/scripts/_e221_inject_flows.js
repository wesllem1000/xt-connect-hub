#!/usr/bin/env node
// E2.2.1 — Staleness detection + presence event publishing.
//
// Injeta no flows.json:
//   - Sweeper (30s interval) que marca devices como offline quando last_seen
//     ultrapassa o threshold (padrão 120s) e publica evento em devices/+/status.
//   - Atualiza fnHandleData para detectar transição offline→online e publicar evento.
//   - Atualiza fnHandleStatus para detectar transição e publicar evento (ignorando
//     payloads JSON para evitar feedback loop com o que a própria plataforma emite).
//   - Atualiza fnListDisp e fnGetCliente para retornar online + last_seen_at.
//   - Adiciona mqtt out node compartilhado (mqttOutPresence) pra publicar no broker.
//
// Uso: sudo node /opt/xtconect/scripts/_e221_inject_flows.js

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

// ---------- 1) mqttOutPresence ----------
// Nó compartilhado que os outros fluxos enviam msg.topic+payload para publicar
// em devices/<serial>/status. Usa o broker interno (brokerMosq).
removeId('mqttOutPresence');
flows.push({
  id: 'mqttOutPresence',
  type: 'mqtt out',
  z: 'tabIngest',
  name: 'publish presence',
  topic: '',
  qos: '1',
  retain: '',
  respTopic: '',
  contentType: '',
  userProps: '',
  correl: '',
  expiry: '',
  broker: 'brokerMosq',
  x: 820,
  y: 380,
  wires: []
});

// ---------- 2) Sweeper (inject + function → mqttOutPresence) ----------
removeId('injSweeper');
flows.push({
  id: 'injSweeper',
  type: 'inject',
  z: 'tabIngest',
  name: 'staleness 30s',
  props: [{ p: 'payload' }],
  repeat: '30',
  crontab: '',
  once: true,
  onceDelay: '15',
  topic: '',
  payload: '',
  payloadType: 'date',
  x: 180,
  y: 380,
  wires: [['fnSweeper']]
});

removeId('fnSweeper');
flows.push({
  id: 'fnSweeper',
  type: 'function',
  z: 'tabIngest',
  name: 'Flip stale → offline',
  func: `// E2.2.1 — flip stale devices to offline
// Threshold global fixo = 120s (por-device fica pra E2.3, débito #51)
const pool = global.get('pgPool');
if (!pool) { node.status({ fill:'yellow', shape:'ring', text:'sem pool' }); return null; }
const THRESHOLD_SECONDS = 120;
try {
  const r = await pool.query(
    \`UPDATE devices
        SET is_online = FALSE
      WHERE is_online = TRUE
        AND last_seen IS NOT NULL
        AND last_seen < NOW() - ($1 || ' seconds')::interval
      RETURNING id, device_id AS serial, user_id, last_seen\`,
    [String(THRESHOLD_SECONDS)]
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
return null;`,
  outputs: 1,
  timeout: '',
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 400,
  y: 380,
  wires: [['mqttOutPresence']]
});

// ---------- 3) fnHandleData : detecta transição offline→online ----------
{
  const n = find('fnHandleData');
  if (!n) throw new Error('fnHandleData not found');
  n.outputs = 2;
  n.wires = [
    ['dbgData'],              // main output (existente)
    ['mqttOutPresence']       // presence event quando vira online
  ];
  n.func = `// E2.2 + E2.2.1 — validação do envelope + emite presence event no flip offline→online
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
let str;
if (Buffer.isBuffer(raw)) str = raw.toString('utf8');
else if (typeof raw === 'string') str = raw;
else if (raw && typeof raw === 'object') str = JSON.stringify(raw);
else { node.warn('payload type inesperado: ' + typeof raw); return null; }
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

const tsNum = env_.ts;
const tsMs = tsNum < 1e12 ? tsNum * 1000 : tsNum;
const tsIso = new Date(tsMs).toISOString();

try {
  const r = await pool.query(
    'SELECT id, user_id, status, is_online FROM devices WHERE mqtt_username=$1 LIMIT 1',
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
  const wasOnline = dev.is_online === true;
  const readingsJson = JSON.stringify(env_.readings);

  await pool.query(
    'INSERT INTO device_readings(device_id, ts, topic, payload) VALUES($1,$2,$3,$4::jsonb)',
    [devId, tsIso, topic, readingsJson]
  );
  await pool.query(
    'UPDATE devices SET last_reading=$1::jsonb, last_reading_at=$2, last_seen=NOW(), is_online=TRUE WHERE id=$3',
    [readingsJson, tsIso, devId]
  );

  let fieldCount = 0;
  if (writeApi && Point) {
    const p = new Point('readings').tag('device_id', devId).tag('mqtt_user', mqttUser).timestamp(new Date(tsMs));
    for (const k of keys) { p.floatField(k, env_.readings[k]); fieldCount++; }
    if (fieldCount > 0) writeApi.writePoint(p);
  }

  node.status({ fill:'green', shape:'dot', text: mqttUser + ' pg+ifx('+fieldCount+'f) '+new Date().toISOString().slice(11,19) });
  msg.saved = { device_id: devId, ts: tsIso, readings: env_.readings, influx_fields: fieldCount };

  // Emite presence event somente se estava offline (transição)
  let presenceMsg = null;
  if (!wasOnline) {
    presenceMsg = {
      topic: 'devices/' + mqttUser + '/status',
      payload: JSON.stringify({
        type: 'device_status_changed',
        online: true,
        device_id: devId,
        serial: mqttUser,
        user_id: dev.user_id,
        last_seen_at: new Date().toISOString(),
        source: 'ingest'
      })
    };
  }
  return [msg, presenceMsg];
} catch (e) {
  node.error('ingest: ' + e.message, msg);
  return null;
}
`;
}

// ---------- 4) fnHandleStatus : detecta transição + ignora payload JSON ----------
{
  const n = find('fnHandleStatus');
  if (!n) throw new Error('fnHandleStatus not found');
  n.outputs = 2;
  n.wires = [
    [],                    // main output (não utilizado)
    ['mqttOutPresence']    // presence event em transição
  ];
  n.func = `// E2.2.1 — status estrito: 'online' -> true, qq outra coisa -> false.
// Ignora payloads que sejam objetos/JSON (são eventos publicados pela
// própria plataforma → evita loop que flipa is_online=false logo após o
// ingest flipar pra true).
// Publica device_status_changed apenas se houve transição real.
const pool = global.get('pgPool');
if (!pool) return null;
const parts = (msg.topic || '').split('/');
if (parts.length !== 3) return null;
const mqttUser = parts[1];
if (!mqttUser || mqttUser.length > 64) return null;
// Skip self-published presence events. O mqtt in com datatype=auto-detect
// parseia JSON → msg.payload vira objeto; String(obj) dá '[object Object]',
// então não basta checar startsWith('{').
if (msg.payload && typeof msg.payload === 'object') return null;
const raw = Buffer.isBuffer(msg.payload) ? msg.payload.toString('utf8') : String(msg.payload || '');
const trimmed = raw.trim();
if (trimmed.startsWith('{') || trimmed.startsWith('[')) return null;
const online = trimmed.toLowerCase() === 'online';
try {
  const sel = await pool.query(
    'SELECT id, user_id, is_online, last_seen FROM devices WHERE mqtt_username=$1 LIMIT 1',
    [mqttUser]
  );
  if (sel.rowCount === 0) return null;
  const dev = sel.rows[0];
  const wasOnline = dev.is_online === true;
  // Atualiza last_seen só quando online=true; offline preserva o timestamp
  // da última vez que realmente vimos dado (importante pro sweeper).
  if (online) {
    await pool.query(
      'UPDATE devices SET is_online=TRUE, last_seen=NOW() WHERE mqtt_username=$1',
      [mqttUser]
    );
  } else {
    await pool.query(
      'UPDATE devices SET is_online=FALSE WHERE mqtt_username=$1',
      [mqttUser]
    );
  }
  node.status({ fill: online ? 'green' : 'red', shape: 'dot', text: mqttUser + ' ' + (online ? 'on' : 'off') });
  if (wasOnline === online) return null; // sem transição
  const presence = {
    topic: 'devices/' + mqttUser + '/status',
    payload: JSON.stringify({
      type: 'device_status_changed',
      online: online,
      device_id: dev.id,
      serial: mqttUser,
      user_id: dev.user_id,
      last_seen_at: online ? new Date().toISOString() : (dev.last_seen ? new Date(dev.last_seen).toISOString() : null),
      source: 'status-mirror'
    })
  };
  return [null, presence];
} catch (e) { node.warn('status update: ' + e.message); }
return null;
`;
}

// ---------- 5) fnListDisp : adiciona online + last_seen_at ----------
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
    d.last_seen AS last_seen_at
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

// ---------- 6) fnGetCliente : adiciona online + last_seen_at nos devices ----------
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
      d.last_seen AS last_seen_at
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

fs.writeFileSync(PATH, JSON.stringify(flows, null, 4));
console.log('E2.2.1: flows.json atualizado — sweeper + presence events + online/last_seen_at nos endpoints.');
