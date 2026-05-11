/**
 * _e053_parser_data_fwversion.cjs
 *
 * Injeção idempotente: substitui o body de fnHandleData (id='fnHandleData')
 * no flows.json para:
 *   1. Extrair fw_version de payloads com aninhamento variável.
 *   2. Gravar em devices.firmware_version apenas quando mudou (anti-UPDATE loop).
 *   3. Manter todo comportamento atual (Influx, presence event, device_readings).
 *
 * Uso: node _e053_parser_data_fwversion.cjs [--dry-run]
 * Idempotência: detecta marcador "// E053" no início do body; se presente, aborta.
 * Backup: flows.json.bak.<timestamp> criado antes de qualquer escrita.
 */

'use strict';
const fs   = require('fs');
const path = require('path');

// IMPORTANTE: editamos o volume montado no container, NÃO o flows.json do repo.
// O repo está desatualizado em relação a produção (divergência conhecida)
// e o container é a fonte de verdade após Task #4 (e05.2). Mesma estratégia do _e052.
const FLOWS_PATH = '/opt/xtconect/nodered/data/flows.json';
const TARGET_ID  = 'fnHandleData';
const MARKER     = '// E053';
const DRY_RUN    = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Novo body da função fnHandleData
// ---------------------------------------------------------------------------
const NEW_FUNC = `// E053 + E2.2 + E2.2.1 + E3.x — parser /data recursivo + extração fw_version
// Substituído por _e053_parser_data_fwversion.cjs

// ---------- helpers ---------------------------------------------------------

/**
 * extractFwVersion — tenta extrair versão de firmware de um payload com
 * aninhamento variável. Ordem de prioridade (mais específico → mais genérico):
 *   1. payload.firmware_version      (string flat, ex: "0.15.5")
 *   2. payload.firmware.version      (objeto aninhado, Sebastião shape A)
 *   3. payload.fw.version            (objeto aninhado, Sebastião shape B)
 *   4. payload.version               (genérico)
 *   5. payload.readings.firmware_version (dentro do envelope envelope)
 * Retorna string semver-ish ou null.
 */
function extractFwVersion(env_) {
  if (!env_ || typeof env_ !== 'object') return null;
  const semverish = /^\\d+\\.\\d+/;   // pelo menos X.Y
  const candidates = [
    env_.firmware_version,
    env_.firmware && env_.firmware.version,
    env_.fw && env_.fw.version,
    env_.version,
    env_.readings && env_.readings.firmware_version
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && semverish.test(c.trim())) return c.trim();
  }
  return null;
}

// ---------- início do handler -----------------------------------------------

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

// Aceita envelope { ts, readings } OU payload flat (fallback E3.x)
let tsNum;
let readings;
if (typeof env_.ts !== 'undefined') {
  // ts pode ser número Unix (seconds ou ms) ou string ISO
  const tsRaw = env_.ts;
  if (typeof tsRaw === 'number' && Number.isFinite(tsRaw) && tsRaw > 0) {
    tsNum = tsRaw;
  } else if (typeof tsRaw === 'string') {
    const parsed = Date.parse(tsRaw);
    tsNum = Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
  } else {
    tsNum = Date.now();
  }

  if (env_.readings && typeof env_.readings === 'object' && !Array.isArray(env_.readings)) {
    readings = env_.readings;
  } else {
    // ts presente mas sem readings — tenta colher campos numéricos do envelope
    readings = {};
    for (const k of Object.keys(env_)) {
      if (k === 'ts' || k === 'firmware_version' || k === 'firmware' || k === 'fw' || k === 'version') continue;
      const v = env_[k];
      if (typeof v === 'number' && Number.isFinite(v)) readings[k] = v;
    }
  }
} else {
  // payload flat sem ts
  tsNum = Date.now();
  readings = {};
  for (const k of Object.keys(env_)) {
    if (k === 'firmware_version' || k === 'firmware' || k === 'fw' || k === 'version') continue;
    const v = env_[k];
    if (typeof v === 'number' && Number.isFinite(v)) readings[k] = v;
  }
}

const keys = Object.keys(readings);
if (keys.length === 0) { node.warn('nenhum campo numerico no payload'); return null; }
for (const k of keys) {
  if (typeof k !== 'string' || k.length === 0 || k.length > 32) { node.warn('key invalida: ' + k); return null; }
  const v = readings[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) { node.warn('valor nao numerico em ' + k); return null; }
}

const tsMs  = tsNum < 1e12 ? tsNum * 1000 : tsNum;
const tsIso = new Date(tsMs).toISOString();

// ---------- extração de fw_version ------------------------------------------
const fwVersion = extractFwVersion(env_);   // null se ausente no payload

try {
  const r = await pool.query(
    'SELECT id, user_id, status, is_online, firmware_version FROM devices WHERE mqtt_username=$1 LIMIT 1',
    [mqttUser]
  );
  if (r.rowCount === 0) {
    await pool.query('INSERT INTO mqtt_events(topic,client_id,payload) VALUES($1,$2,$3)',
      [topic, mqttUser, JSON.stringify(env_)]);
    node.status({ fill:'yellow', shape:'ring', text: mqttUser + ' nao cadastrado' });
    return null;
  }
  const dev = r.rows[0];
  if (dev.status !== 'associado' && dev.status !== 'active') {
    node.status({ fill:'yellow', shape:'ring', text: mqttUser + ' status=' + dev.status });
    return null;
  }
  const devId    = dev.id;
  const wasOnline = dev.is_online === true;
  const readingsJson = JSON.stringify(readings);

  await pool.query(
    'INSERT INTO device_readings(device_id, ts, topic, payload) VALUES($1,$2,$3,$4::jsonb)',
    [devId, tsIso, topic, readingsJson]
  );
  await pool.query(
    'UPDATE devices SET last_reading=$1::jsonb, last_reading_at=$2, last_seen=NOW(), is_online=TRUE WHERE id=$3',
    [readingsJson, tsIso, devId]
  );

  // ---------- gravar firmware_version apenas se mudou ----------------------
  if (fwVersion !== null) {
    const cacheKey = 'lastFwVersion[' + devId + ']';
    const cachedFw  = flow.get(cacheKey);
    // Considera mudança se cache ausente (reinício NR) OU valor diferente do DB
    const dbFw = dev.firmware_version || null;
    const referencia = (cachedFw !== undefined) ? cachedFw : dbFw;
    if (fwVersion !== referencia) {
      await pool.query(
        'UPDATE devices SET firmware_version=$1 WHERE id=$2',
        [fwVersion, devId]
      );
      flow.set(cacheKey, fwVersion);
      node.log('fw_version atualizado: ' + mqttUser + ' ' + referencia + ' -> ' + fwVersion);
    } else if (cachedFw === undefined) {
      // Já estava no DB, só aquece cache
      flow.set(cacheKey, dbFw);
    }
  }
  // ---------- fim fw_version -----------------------------------------------

  let fieldCount = 0;
  if (writeApi && Point) {
    const p = new Point('readings').tag('device_id', devId).tag('mqtt_user', mqttUser).timestamp(new Date(tsMs));
    for (const k of keys) { p.floatField(k, readings[k]); fieldCount++; }
    if (fieldCount > 0) writeApi.writePoint(p);
  }

  const fwTag = fwVersion ? ' fw=' + fwVersion : '';
  node.status({ fill:'green', shape:'dot', text: mqttUser + ' pg+ifx(' + fieldCount + 'f)' + fwTag + ' ' + new Date().toISOString().slice(11,19) });
  msg.saved = { device_id: devId, ts: tsIso, readings: readings, influx_fields: fieldCount, fw_version: fwVersion };

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
      }),
      qos: 1,
      retain: true
    };
  }
  return [msg, presenceMsg];
} catch (e) {
  node.error('ingest: ' + e.message, msg);
  return null;
}`;

// ---------------------------------------------------------------------------
// Leitura e validação do flows.json
// ---------------------------------------------------------------------------
if (!fs.existsSync(FLOWS_PATH)) {
  console.error('ERRO: flows.json nao encontrado em', FLOWS_PATH);
  process.exit(1);
}

let raw;
try { raw = fs.readFileSync(FLOWS_PATH, 'utf8'); }
catch (e) { console.error('ERRO ao ler flows.json:', e.message); process.exit(1); }

let flows;
try { flows = JSON.parse(raw); }
catch (e) { console.error('ERRO: flows.json invalido (JSON):', e.message); process.exit(1); }

if (!Array.isArray(flows)) { console.error('ERRO: flows.json nao e array'); process.exit(1); }

// ---------------------------------------------------------------------------
// Localizar nó-alvo
// ---------------------------------------------------------------------------
const idx = flows.findIndex(n => n.id === TARGET_ID);
if (idx === -1) {
  console.error('ERRO: nó com id=' + TARGET_ID + ' nao encontrado em flows.json');
  process.exit(1);
}

const targetNode = flows[idx];

// ---------------------------------------------------------------------------
// Idempotência: checar marcador
// ---------------------------------------------------------------------------
if (typeof targetNode.func === 'string' && targetNode.func.trimStart().startsWith(MARKER)) {
  console.log('INFO: marcador E053 ja presente — script ja foi aplicado. Nada a fazer.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Dry-run: só mostra o que seria feito
// ---------------------------------------------------------------------------
if (DRY_RUN) {
  console.log('DRY-RUN: nó alvo encontrado (idx=' + idx + ').');
  console.log('DRY-RUN: body atual (' + (targetNode.func || '').length + ' chars) seria substituido por ' + NEW_FUNC.length + ' chars.');
  console.log('DRY-RUN: nenhum arquivo modificado.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------
const backupPath = FLOWS_PATH + '.bak.' + Date.now();
try { fs.copyFileSync(FLOWS_PATH, backupPath); }
catch (e) { console.error('ERRO ao criar backup:', e.message); process.exit(1); }
console.log('Backup criado:', backupPath);

// ---------------------------------------------------------------------------
// Substituir body
// ---------------------------------------------------------------------------
flows[idx] = Object.assign({}, targetNode, { func: NEW_FUNC });

// ---------------------------------------------------------------------------
// Serializar e validar o JSON resultante
// ---------------------------------------------------------------------------
let output;
try { output = JSON.stringify(flows, null, 4); }
catch (e) { console.error('ERRO ao serializar JSON atualizado:', e.message); process.exit(1); }

// Sanity: re-parse para garantir integridade
try { JSON.parse(output); }
catch (e) {
  console.error('ERRO: JSON resultante invalido — abortando (backup preservado):', e.message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Gravar
// ---------------------------------------------------------------------------
try { fs.writeFileSync(FLOWS_PATH, output, 'utf8'); }
catch (e) { console.error('ERRO ao gravar flows.json:', e.message); process.exit(1); }

console.log('OK: flows.json atualizado com parser E053 (fw_version + envelope robusto).');
console.log('    Nó modificado: id=' + TARGET_ID + ' ("' + targetNode.name + '")');
console.log('    Backup em:', backupPath);
console.log('    Proximos passos:');
console.log('      1. docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
console.log('      2. Verificar status do nó "Gravar leitura" no editor NR.');
