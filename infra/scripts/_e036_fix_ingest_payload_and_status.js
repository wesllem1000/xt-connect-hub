#!/usr/bin/env node
// E3.x follow-up — ingest aceita payload flat + status E3.1 (refs #65)
//
// fnHandleData tinha dois gates que silenciavam telemetria real:
//   1) Exigia envelope { ts, readings } — firmwares que publicam payload
//      flat ({umidade_solo:62.9, ...}) eram descartados com warn
//      "ts invalido".
//   2) Só aceitava dev.status === 'active', mas após E3.1 a migration 009
//      trocou o vocabulário pra {ocioso, associado, defeito, retornado}.
//      Resultado: mesmo devices associados e publicando corretamente
//      no envelope E2.2 seriam ignorados.
//
// Fix:
//   - Aceita envelope OU payload flat: se falta `ts`/`readings`, usa
//     Date.now() e filtra o próprio payload, mantendo só campos numéricos
//     finitos como readings.
//   - Status: aceita 'associado' (E3.1) OU 'active' (legacy E2.x) pra
//     não quebrar ambientes que ainda não migraram.
//
// Idempotente.
//
// Uso: sudo node /opt/xtconect/scripts/_e036_fix_ingest_payload_and_status.js
//      docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered

const fs = require('fs');
const PATH = '/opt/xtconect/nodered/data/flows.json';
const flows = JSON.parse(fs.readFileSync(PATH, 'utf8'));
function find(id) { return flows.find(n => n.id === id); }

{
  const n = find('fnHandleData');
  if (!n) throw new Error('fnHandleData not found');
  n.func = [
    "// E2.2 + E2.2.1 + E3.x — validação do envelope (com fallback flat) + presence event",
    "const MAX = parseInt(env.get('MQTT_MAX_PAYLOAD_BYTES') || '4096');",
    "const pool = global.get('pgPool');",
    "const writeApi = global.get('influxWrite');",
    "const Point = global.get('influxPoint');",
    "if (!pool) { node.status({ fill:'red', shape:'ring', text:'sem pool' }); return null; }",
    "",
    "const topic = msg.topic || '';",
    "const parts = topic.split('/');",
    "if (parts.length !== 3 || parts[0] !== 'devices' || parts[2] !== 'data') {",
    "  node.warn('topic invalido: ' + topic); return null;",
    "}",
    "const mqttUser = parts[1];",
    "if (!mqttUser || mqttUser.length > 64) { node.warn('serial invalido'); return null; }",
    "",
    "let raw = msg.payload;",
    "let str;",
    "if (Buffer.isBuffer(raw)) str = raw.toString('utf8');",
    "else if (typeof raw === 'string') str = raw;",
    "else if (raw && typeof raw === 'object') str = JSON.stringify(raw);",
    "else { node.warn('payload type inesperado: ' + typeof raw); return null; }",
    "if (str.length > MAX) { node.warn('payload > ' + MAX + 'B'); return null; }",
    "",
    "let env_;",
    "try { env_ = JSON.parse(str); } catch (e) { node.warn('JSON invalido: ' + e.message); return null; }",
    "if (!env_ || typeof env_ !== 'object' || Array.isArray(env_)) { node.warn('envelope nao e objeto'); return null; }",
    "",
    "// E3.x — aceita envelope { ts, readings } OU payload flat. Firmware novo do",
    "// INT-V2 publica flat ({umidade_solo:62.9, uptime_s:371, ...}); ingest",
    "// deve aceitar ambos pra não quebrar devices legitimamente associados.",
    "let tsNum;",
    "let readings;",
    "if (typeof env_.ts === 'number' && Number.isFinite(env_.ts) && env_.ts > 0 &&",
    "    env_.readings && typeof env_.readings === 'object' && !Array.isArray(env_.readings)) {",
    "  // Formato E2.2: envelope formal.",
    "  tsNum = env_.ts;",
    "  readings = env_.readings;",
    "} else {",
    "  // Payload flat: usa NOW e filtra só campos numéricos finitos.",
    "  tsNum = Date.now();",
    "  readings = {};",
    "  for (const k of Object.keys(env_)) {",
    "    const v = env_[k];",
    "    if (typeof v === 'number' && Number.isFinite(v)) readings[k] = v;",
    "  }",
    "}",
    "",
    "const keys = Object.keys(readings);",
    "if (keys.length === 0) { node.warn('nenhum campo numerico no payload'); return null; }",
    "for (const k of keys) {",
    "  if (typeof k !== 'string' || k.length === 0 || k.length > 32) { node.warn('key invalida: ' + k); return null; }",
    "  const v = readings[k];",
    "  if (typeof v !== 'number' || !Number.isFinite(v)) { node.warn('valor nao numerico em ' + k); return null; }",
    "}",
    "",
    "const tsMs = tsNum < 1e12 ? tsNum * 1000 : tsNum;",
    "const tsIso = new Date(tsMs).toISOString();",
    "",
    "try {",
    "  const r = await pool.query(",
    "    'SELECT id, user_id, status, is_online FROM devices WHERE mqtt_username=$1 LIMIT 1',",
    "    [mqttUser]",
    "  );",
    "  if (r.rowCount === 0) {",
    "    await pool.query('INSERT INTO mqtt_events(topic,client_id,payload) VALUES($1,$2,$3)',",
    "      [topic, mqttUser, JSON.stringify(env_)]);",
    "    node.status({ fill:'yellow', shape:'ring', text: mqttUser + ' nao cadastrado' });",
    "    return null;",
    "  }",
    "  const dev = r.rows[0];",
    "  // E3.1: status 'associado' é o novo 'active'. Aceitamos ambos pra não",
    "  // quebrar ambientes legacy que ainda não migraram.",
    "  if (dev.status !== 'associado' && dev.status !== 'active') {",
    "    node.status({ fill:'yellow', shape:'ring', text: mqttUser + ' status=' + dev.status });",
    "    return null;",
    "  }",
    "  const devId = dev.id;",
    "  const wasOnline = dev.is_online === true;",
    "  const readingsJson = JSON.stringify(readings);",
    "",
    "  await pool.query(",
    "    'INSERT INTO device_readings(device_id, ts, topic, payload) VALUES($1,$2,$3,$4::jsonb)',",
    "    [devId, tsIso, topic, readingsJson]",
    "  );",
    "  await pool.query(",
    "    'UPDATE devices SET last_reading=$1::jsonb, last_reading_at=$2, last_seen=NOW(), is_online=TRUE WHERE id=$3',",
    "    [readingsJson, tsIso, devId]",
    "  );",
    "",
    "  let fieldCount = 0;",
    "  if (writeApi && Point) {",
    "    const p = new Point('readings').tag('device_id', devId).tag('mqtt_user', mqttUser).timestamp(new Date(tsMs));",
    "    for (const k of keys) { p.floatField(k, readings[k]); fieldCount++; }",
    "    if (fieldCount > 0) writeApi.writePoint(p);",
    "  }",
    "",
    "  node.status({ fill:'green', shape:'dot', text: mqttUser + ' pg+ifx('+fieldCount+'f) '+new Date().toISOString().slice(11,19) });",
    "  msg.saved = { device_id: devId, ts: tsIso, readings: readings, influx_fields: fieldCount };",
    "",
    "  let presenceMsg = null;",
    "  if (!wasOnline) {",
    "    presenceMsg = {",
    "      topic: 'devices/' + mqttUser + '/status',",
    "      payload: JSON.stringify({",
    "        type: 'device_status_changed',",
    "        online: true,",
    "        device_id: devId,",
    "        serial: mqttUser,",
    "        user_id: dev.user_id,",
    "        last_seen_at: new Date().toISOString(),",
    "        source: 'ingest'",
    "      })",
    "    };",
    "  }",
    "  return [msg, presenceMsg];",
    "} catch (e) {",
    "  node.error('ingest: ' + e.message, msg);",
    "  return null;",
    "}",
  ].join('\n');
}

// Também o fnHandleStatus tem o mesmo problema de vocabulário? vou revisar
// sem alterar (só inspeção) — ele usa SELECT id, user_id, is_online, last_seen
// e não filtra por status, então deve estar OK.

fs.writeFileSync(PATH, JSON.stringify(flows, null, 4));
console.log('E3.x fix: fnHandleData aceita payload flat + status associado|active.');
console.log('Reinicie: docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
