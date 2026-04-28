#!/usr/bin/env node
// E5.7 — Lifecycle de irrigation_alarms a partir dos events MQTT do firmware.
//
// Bug encontrado: handler atual de devices/+/events so faz INSERT em
// irrigation_events (historico imutavel). irrigation_alarms (a tabela que
// o app le pra exibir alarme ativo) ficava vazia, entao temp_alarm_triggered
// no simulator nunca aparecia no XT Connect.
//
// Como modifica:
//   1. Adiciona um function node "fnIrrAlarmLifecycle" no caminho do
//      mqtt-in de events (depois do INSERT irrigation_events). Faz:
//        - event_type='temp_alarm_triggered' → INSERT irrigation_alarms
//          (tipo='temperature_high', sensor_rom_id, message, payload),
//          dedupe por (device_id, sensor_rom_id, resolved_at IS NULL).
//        - event_type='temp_alarm_resolved' → UPDATE resolved_at NOW()
//          em alarmes ativos do mesmo (device_id, sensor_rom_id).
//        - event_type='temp_sensor_lost' → INSERT alarme tipo='sensor_missing'.
//   2. Adiciona endpoint POST /dispositivos/:id/irrigacao/alarmes/:alarmId/ack
//      que UPDATE acked_at=NOW(), acked_by_user_id=<jwt user>.
//
// Idempotencia: detecta presenca de "fnIrrAlarmLifecycle" e sai.
// Pre-requisito: handler de events ja existir (sempre presente).

'use strict';

const fs = require('fs');
const path = require('path');

const FLOWS = '/opt/xtconect/nodered/data/flows.json';
const BACKUPS = '/opt/xtconect/backups';
const FN_LIFECYCLE_ID = 'fnIrrAlarmLifecycle';
const HTTP_ACK_ID = 'httpIrrAckAlarm';

const LIFECYCLE_FUNC = `// E5.7 — alarm lifecycle a partir de events MQTT
const pool = global.get('pgPool');
if (!pool) return null;
const parts = (msg.topic || '').split('/');
if (parts.length !== 3 || parts[0] !== 'devices' || parts[2] !== 'events') return null;
const mqttUser = parts[1];

let ev = null;
try {
  const raw = Buffer.isBuffer(msg.payload) ? msg.payload.toString('utf8') :
              (typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload));
  ev = JSON.parse(raw);
  if (!ev || typeof ev !== 'object') return null;
} catch(e) { return null; }
const t = ev.event_type;
if (t !== 'temp_alarm_triggered' && t !== 'temp_alarm_resolved' && t !== 'temp_sensor_lost') return null;

const payload = ev.payload || ev.payload_json || {};
const romId = payload.rom_id || null;

try {
  const dev = await pool.query('SELECT id FROM devices WHERE mqtt_username=$1', [mqttUser]);
  if (dev.rowCount === 0) return null;
  const deviceId = dev.rows[0].id;

  if (t === 'temp_alarm_triggered') {
    // Dedupe: se já existe alarme ativo pro mesmo (device, rom_id), não duplica
    const exists = await pool.query(
      \`SELECT id FROM irrigation_alarms
        WHERE device_id=$1 AND tipo='temperature_high'
          AND sensor_rom_id IS NOT DISTINCT FROM $2
          AND resolved_at IS NULL
        LIMIT 1\`,
      [deviceId, romId]
    );
    if (exists.rowCount > 0) {
      node.status({fill:'yellow',shape:'ring',text: mqttUser+' alarm dup ignorado'});
      return null;
    }
    const tempC = (typeof payload.temp_c === 'number') ? payload.temp_c : null;
    const limiteC = (typeof payload.limite_c === 'number') ? payload.limite_c : null;
    const nome = payload.nome || ('Sensor ' + (romId || ''));
    const message = 'Temperatura ' +
      (tempC != null ? tempC.toFixed(1) + '°C' : '?') +
      ' acima de ' + (limiteC != null ? limiteC.toFixed(1) + '°C' : '?') +
      ' (' + nome + ')';
    await pool.query(
      \`INSERT INTO irrigation_alarms (device_id, tipo, sensor_rom_id, message, triggered_at, payload_json)
       VALUES ($1, 'temperature_high', $2, $3, $4, $5::jsonb)\`,
      [deviceId, romId, message, ev.ts || new Date(), JSON.stringify(payload)]
    );
    node.status({fill:'red',shape:'dot',text: mqttUser+' alarm criado'});
  } else if (t === 'temp_alarm_resolved') {
    const r = await pool.query(
      \`UPDATE irrigation_alarms
         SET resolved_at = NOW()
       WHERE device_id=$1 AND tipo='temperature_high'
         AND sensor_rom_id IS NOT DISTINCT FROM $2
         AND resolved_at IS NULL
       RETURNING id\`,
      [deviceId, romId]
    );
    if (r.rowCount > 0) node.status({fill:'green',shape:'dot',text: mqttUser+' '+r.rowCount+' alarm resolvido'});
  } else if (t === 'temp_sensor_lost') {
    const exists = await pool.query(
      \`SELECT id FROM irrigation_alarms
        WHERE device_id=$1 AND tipo='sensor_missing'
          AND sensor_rom_id IS NOT DISTINCT FROM $2
          AND resolved_at IS NULL LIMIT 1\`,
      [deviceId, romId]
    );
    if (exists.rowCount === 0) {
      await pool.query(
        \`INSERT INTO irrigation_alarms (device_id, tipo, sensor_rom_id, message, triggered_at, payload_json)
         VALUES ($1, 'sensor_missing', $2, $3, $4, $5::jsonb)\`,
        [deviceId, romId, 'Sensor de temperatura perdeu comunicação (' + (romId || '?') + ')',
         ev.ts || new Date(), JSON.stringify(payload)]
      );
    }
  }
} catch(e) { node.error('alarm lifecycle: '+e.message); }
return null;
`;

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

const ACK_FUNC = `const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }
async function checkDeviceAccess(pool, deviceId, user) {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(deviceId)) return { err: 400, msg: 'id invalido' };
  const isAdmin = user && user.role === 'admin';
  const r = await pool.query(
    \`SELECT d.id, d.user_id AS owner_id, d.modelo_id, m.prefixo, m.major_version
       FROM devices d LEFT JOIN modelos_dispositivo m ON m.id = d.modelo_id
      WHERE d.id = $1 LIMIT 1\`, [deviceId]);
  if (r.rowCount === 0) return { err: 404, msg: 'dispositivo nao encontrado' };
  const dev = r.rows[0];
  if (isAdmin) return { device: dev, access: 'admin' };
  if (dev.owner_id === user.id) return { device: dev, access: 'owner' };
  const s = await pool.query(
    \`SELECT permissao::text AS permissao FROM dispositivo_compartilhado
       WHERE dispositivo_id = $1 AND com_usuario_id = $2 AND status = 'ativo' LIMIT 1\`,
    [deviceId, user.id]);
  if (s.rowCount > 0) return { device: dev, access: 'share', permissao: s.rows[0].permissao };
  return { err: 403, msg: 'sem acesso a este dispositivo' };
}
const alarmId = msg.req.params.alarmId;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(alarmId)) { msg.statusCode=400; msg.payload={error:'alarmId invalido'}; return msg; }
try {
  const chk = await checkDeviceAccess(pool, msg.req.params.id, msg.user);
  if (chk.err) { msg.statusCode=chk.err; msg.payload={error:chk.msg}; return msg; }
  const device = chk.device;
  if (device.prefixo !== 'IRR' || device.major_version !== 'V1') {
    msg.statusCode=400; msg.payload={error:'device nao e IRR-V1'}; return msg;
  }
  const r = await pool.query(
    \`UPDATE irrigation_alarms
        SET acked_at = NOW(), acked_by_user_id = $3
      WHERE id = $2 AND device_id = $1 AND acked_at IS NULL
      RETURNING *\`,
    [device.id, alarmId, msg.user.id]
  );
  if (r.rowCount === 0) {
    msg.statusCode = 404;
    msg.payload = { error: 'alarme nao encontrado ou ja reconhecido' };
    return msg;
  }
  msg.statusCode = 200;
  msg.payload = { alarme: r.rows[0] };
} catch(e) {
  node.error('ack alarme: '+e.message, msg);
  msg.statusCode=500; msg.payload={error:'internal'};
}
return msg;`;

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function main() {
  if (!fs.existsSync(FLOWS)) { console.error('flows.json nao encontrado'); process.exit(2); }
  const raw = fs.readFileSync(FLOWS, 'utf8');
  const flows = JSON.parse(raw);

  if (flows.some(n => n && n.id === FN_LIFECYCLE_ID)) {
    console.log('Ja aplicado (achei "' + FN_LIFECYCLE_ID + '"). Saindo.');
    process.exit(0);
  }
  // Encontra o mqtt-in de events (devices/+/events)
  const mqttInEvents = flows.find(n =>
    n && n.type === 'mqtt in' && typeof n.topic === 'string' && n.topic === 'devices/+/events'
  );
  if (!mqttInEvents) {
    console.error('mqtt-in devices/+/events nao encontrado.');
    process.exit(2);
  }
  const tabId = mqttInEvents.z;

  if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });
  const bkp = path.join(BACKUPS, 'flows-pre-e057-' + ts() + '.json');
  fs.writeFileSync(bkp, raw, 'utf8');
  console.log('Backup salvo em ' + bkp);

  // Adiciona o lifecycle node ao final dos wires do mqtt-in (em paralelo
  // com o insert de events; cada um faz seu trabalho)
  if (!Array.isArray(mqttInEvents.wires) || mqttInEvents.wires.length === 0) {
    mqttInEvents.wires = [[]];
  }
  if (!mqttInEvents.wires[0].includes(FN_LIFECYCLE_ID)) {
    mqttInEvents.wires[0].push(FN_LIFECYCLE_ID);
  }

  flows.push({
    id: FN_LIFECYCLE_ID,
    type: 'function',
    z: tabId,
    name: 'IrrAlarmLifecycle',
    func: LIFECYCLE_FUNC,
    outputs: 1,
    libs: [],
    x: 800, y: mqttInEvents.y || 200,
    wires: [[]],
  });

  // Endpoint POST /alarmes/:alarmId/ack
  flows.push({
    id: HTTP_ACK_ID,
    type: 'http in',
    z: 'tabAuth',
    name: 'POST /dispositivos/:id/irrigacao/alarmes/:alarmId/ack',
    url: '/dispositivos/:id/irrigacao/alarmes/:alarmId/ack',
    method: 'post',
    upload: false,
    swaggerDoc: '',
    x: 200, y: 5300,
    wires: [['fnAuthIrrAckAlarm']],
  });
  flows.push({
    id: 'fnAuthIrrAckAlarm',
    type: 'function',
    z: 'tabAuth',
    name: 'Auth JWT',
    func: AUTH_FUNC,
    outputs: 2,
    libs: [{ var: 'jwt', module: 'jsonwebtoken' }],
    x: 440, y: 5300,
    wires: [['fnIrrAckAlarm'], ['respIrrAckAlarm']],
  });
  flows.push({
    id: 'fnIrrAckAlarm',
    type: 'function',
    z: 'tabAuth',
    name: 'POST /alarmes/:id/ack',
    func: ACK_FUNC,
    outputs: 1,
    libs: [],
    x: 700, y: 5300,
    wires: [['respIrrAckAlarm']],
  });
  flows.push({
    id: 'respIrrAckAlarm',
    type: 'http response',
    z: 'tabAuth',
    name: '',
    statusCode: '',
    headers: { 'Content-Type': 'application/json' },
    x: 940, y: 5300,
    wires: [],
  });

  const tmp = FLOWS + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(flows, null, 4) + '\n', 'utf8');
  fs.renameSync(tmp, FLOWS);
  console.log('flows.json atualizado.');
  console.log('Adicionado:');
  console.log('  - fnIrrAlarmLifecycle (handler MQTT)');
  console.log('  - POST /dispositivos/:id/irrigacao/alarmes/:alarmId/ack');
  console.log('Proximo passo: sudo docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
}

main();
