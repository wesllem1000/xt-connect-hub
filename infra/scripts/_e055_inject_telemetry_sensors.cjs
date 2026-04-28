#!/usr/bin/env node
// E5.5 — Cria handler MQTT pra devices/+/telemetry/sensors que faz UPDATE
// em irrigation_temperature_sensors.ultima_leitura_c (e ultimo_contato_em).
// Sem isso, a UI mostra "—" pra sempre porque ninguem escreve no campo.
//
// Payload esperado:
//   {
//     protocol_version: 1,
//     ts: "2026-04-28T14:00:00Z",
//     readings: [
//       { rom_id: "28-AABB...", temperature_c: 42.5 },
//       ...
//     ]
//   }
//
// Como modifica:
//   1. Backup de flows.json.
//   2. Adiciona 2 nodes: mqtt-in (subscribe devices/+/telemetry/sensors) +
//      function (UPDATE por rom_id). Sem response, sem MQTT out.
//   3. Salva atomico.
//
// Idempotencia: se ja existir node id "mqttInIrrTelemetrySensors", sai.
//
// Pre-requisito: brokerMosq existir (sempre presente, criado no setup base).

'use strict';

const fs = require('fs');
const path = require('path');

const FLOWS = '/opt/xtconect/nodered/data/flows.json';
const BACKUPS = '/opt/xtconect/backups';
const MQTT_IN_ID = 'mqttInIrrTelemetrySensors';
const FN_ID = 'fnIrrTelemetrySensors';

const HANDLER_FUNC = `// IRR-V1 telemetry/sensors handler
const pool = global.get('pgPool');
if (!pool) return null;
const parts = (msg.topic || '').split('/');
if (parts.length !== 4 || parts[0] !== 'devices' || parts[2] !== 'telemetry' || parts[3] !== 'sensors') return null;
const mqttUser = parts[1];

let body = null;
try {
  const raw = Buffer.isBuffer(msg.payload) ? msg.payload.toString('utf8') :
              (typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload));
  if (!raw || raw.trim() === '') return null;
  body = JSON.parse(raw);
} catch(e) { node.warn('telemetry/sensors JSON invalido: '+e.message); return null; }
if (!body || !Array.isArray(body.readings)) return null;

try {
  const drow = await pool.query('SELECT id FROM devices WHERE mqtt_username = $1', [mqttUser]);
  if (drow.rowCount === 0) return null;
  const deviceId = drow.rows[0].id;
  const ts = new Date(body.ts || Date.now());

  let updated = 0;
  for (const r of body.readings) {
    if (!r || typeof r.rom_id !== 'string' || !r.rom_id) continue;
    const temp = (typeof r.temperature_c === 'number' && Number.isFinite(r.temperature_c))
      ? r.temperature_c : null;
    try {
      const u = await pool.query(
        \`UPDATE irrigation_temperature_sensors
            SET ultima_leitura_c = $3, ultimo_contato_em = $4
          WHERE device_id = $1 AND rom_id = $2\`,
        [deviceId, r.rom_id, temp, ts]
      );
      if (u.rowCount > 0) updated++;
    } catch(e) {
      node.warn('telemetry/sensors update ' + r.rom_id + ': ' + e.message);
    }
  }
  if (updated > 0) {
    node.status({fill:'green', shape:'dot', text: mqttUser + ' ' + updated + ' leitura(s) ' + new Date().toISOString().slice(11,19)});
  } else {
    node.status({fill:'yellow', shape:'ring', text: mqttUser + ' nenhum sensor casou rom_id'});
  }
} catch(e) {
  node.error('telemetry/sensors: '+e.message);
}
return null;
`;

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function main() {
  if (!fs.existsSync(FLOWS)) {
    console.error('flows.json nao encontrado em', FLOWS);
    process.exit(2);
  }
  const raw = fs.readFileSync(FLOWS, 'utf8');
  const flows = JSON.parse(raw);

  if (flows.some(n => n && n.id === MQTT_IN_ID)) {
    console.log('Ja aplicado (encontrei "' + MQTT_IN_ID + '"). Saindo.');
    process.exit(0);
  }

  if (!flows.some(n => n && n.id === 'brokerMosq')) {
    console.error('brokerMosq nao encontrado.');
    process.exit(2);
  }
  // Decide qual tab usar — preferir tabIngest (onde estao mqtt-in handlers similares).
  const tabId = flows.some(n => n && n.id === 'tabIngest') ? 'tabIngest' : 'tabAuth';

  if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });
  const bkp = path.join(BACKUPS, 'flows-pre-e055-' + ts() + '.json');
  fs.writeFileSync(bkp, raw, 'utf8');
  console.log('Backup salvo em ' + bkp);

  flows.push({
    id: MQTT_IN_ID,
    type: 'mqtt in',
    z: tabId,
    name: 'devices/+/telemetry/sensors',
    topic: 'devices/+/telemetry/sensors',
    qos: '0',
    datatype: 'auto-detect',
    broker: 'brokerMosq',
    nl: false,
    rap: true,
    rh: 0,
    inputs: 0,
    x: 200,
    y: 700,
    wires: [[FN_ID]],
  });
  flows.push({
    id: FN_ID,
    type: 'function',
    z: tabId,
    name: 'IrrTelemetrySensors',
    func: HANDLER_FUNC,
    outputs: 1,
    libs: [],
    x: 480,
    y: 700,
    wires: [[]],
  });

  const tmp = FLOWS + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(flows, null, 4) + '\n', 'utf8');
  fs.renameSync(tmp, FLOWS);
  console.log('flows.json atualizado (2 nodes adicionados em ' + tabId + ').');
  console.log('Proximo passo: sudo docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
}

main();
