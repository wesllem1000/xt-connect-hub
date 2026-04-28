#!/usr/bin/env node
// E5.9 — Auto-resolucao de alarmes baseada em telemetria.
//
// Bug encontrado pelo dono: se o simulator perde estado (Ctrl+F5,
// fechar aba) com um alarme ativo no banco, ele nunca publica
// temp_alarm_resolved e o banco fica com alarme orfao pra sempre.
//
// Solucao: handler de telemetry/sensors (que ja roda a cada 5s e
// atualiza ultima_leitura_c) tambem checa se ha alarme ativo pro
// (device, rom_id) E temp_atual < limite - histerese. Se sim, resolve.
// Backend = fonte de verdade do alarme; simulator/firmware so publicam
// triggered. Resolution e derivada da telemetria continua.
//
// Como modifica:
//   1. Substitui o func de fnIrrTelemetrySensors pela versao v2 que
//      faz, alem do UPDATE de leitura, JOIN com irrigation_alarms +
//      sensor pra resolver alarmes "presos".
//
// Idempotencia: marker "TELEMETRY v2".
// Pre-req: _e055 ja rodou (criou fnIrrTelemetrySensors).

'use strict';

const fs = require('fs');
const path = require('path');

const FLOWS = '/opt/xtconect/nodered/data/flows.json';
const BACKUPS = '/opt/xtconect/backups';
const FN_ID = 'fnIrrTelemetrySensors';
const MARKER = 'TELEMETRY v2';

const NEW_FUNC = `// ${MARKER} — telemetry handler com auto-resolucao de alarmes
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

  let updated = 0, resolved = 0;
  for (const r of body.readings) {
    if (!r || typeof r.rom_id !== 'string' || !r.rom_id) continue;
    const temp = (typeof r.temperature_c === 'number' && Number.isFinite(r.temperature_c))
      ? r.temperature_c : null;

    // 1. UPDATE da leitura
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
      continue;
    }

    // 2. Auto-resolucao: se temp lida < limite - histerese, resolve
    //    qualquer alarme temperature_high ativo pra esse (device, rom_id).
    //    Usa os campos do proprio sensor (limite_alarme_c, histerese_c)
    //    pra calcular o threshold — fonte de verdade do banco.
    if (temp != null) {
      try {
        const res = await pool.query(
          \`UPDATE irrigation_alarms a
              SET resolved_at = NOW()
             FROM irrigation_temperature_sensors s
            WHERE a.device_id = $1
              AND a.sensor_rom_id = $2
              AND a.tipo = 'temperature_high'
              AND a.resolved_at IS NULL
              AND s.device_id = a.device_id
              AND s.rom_id = a.sensor_rom_id
              AND $3 < (s.limite_alarme_c - s.histerese_c)
            RETURNING a.id\`,
          [deviceId, r.rom_id, temp]
        );
        if (res.rowCount > 0) resolved += res.rowCount;
      } catch(e) {
        node.warn('telemetry/sensors auto-resolve ' + r.rom_id + ': ' + e.message);
      }
    }
  }

  const status = (updated > 0 || resolved > 0)
    ? mqttUser + ' ' + updated + ' leitura(s)' + (resolved > 0 ? ' · ' + resolved + ' alarm resolvido(s)' : '') + ' ' + new Date().toISOString().slice(11,19)
    : mqttUser + ' nenhum sensor casou';
  node.status({fill: resolved > 0 ? 'green' : (updated > 0 ? 'green' : 'yellow'), shape: resolved > 0 ? 'dot' : 'ring', text: status});
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
  if (!fs.existsSync(FLOWS)) { console.error('flows.json nao encontrado'); process.exit(2); }
  const raw = fs.readFileSync(FLOWS, 'utf8');
  const flows = JSON.parse(raw);

  const target = flows.find(n => n && n.id === FN_ID);
  if (!target) {
    console.error('fnIrrTelemetrySensors nao encontrado. Rode _e055 primeiro.');
    process.exit(2);
  }
  if (typeof target.func === 'string' && target.func.includes(MARKER)) {
    console.log('Ja aplicado (marker "' + MARKER + '" presente). Saindo.');
    process.exit(0);
  }

  if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });
  const bkp = path.join(BACKUPS, 'flows-pre-e059-' + ts() + '.json');
  fs.writeFileSync(bkp, raw, 'utf8');
  console.log('Backup salvo em ' + bkp);

  target.func = NEW_FUNC;
  console.log('  patch fnIrrTelemetrySensors -> v2');

  const tmp = FLOWS + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(flows, null, 4) + '\n', 'utf8');
  fs.renameSync(tmp, FLOWS);
  console.log('flows.json atualizado.');
  console.log('Proximo passo: sudo docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
}

main();
