#!/usr/bin/env node
// E5.4 — Injeta 3 endpoints HTTP no Node-RED pra CRUD remoto de sensores
// de temperatura, fechando o caminho App→Device:
//
//   POST   /dispositivos/:id/irrigacao/sensores-temperatura
//   PATCH  /dispositivos/:id/irrigacao/sensores-temperatura/:sensorId
//   DELETE /dispositivos/:id/irrigacao/sensores-temperatura/:sensorId
//
// Cada endpoint, em sucesso, dispara buildConfigPushMsg → publica retained
// em devices/<serial>/config/push. O simulator (e o ESP real) recebem,
// reconciliam o conjunto local de sensores e publicam de volta em
// config/current — ESP segue como fonte de verdade (R6).
//
// O endpoint de POST aceita rom_id explicito (vindo do app, no caso onde
// o usuario quer pre-cadastrar antes do device descobrir) ou auto-gera
// um placeholder ('pending-<uuid>') se nao vier — o ESP real, ao detectar
// o sensor fisico, vai sobrescrever via config/current com o ROM verdadeiro.
//
// Como modifica:
//   1. Backup de flows.json.
//   2. Adiciona 12 nodes novos (4 por endpoint: http in, fnAuth, fnLogic,
//      response). Reusa o existente mqttOutConfigPush (criado por _e053).
//   3. Salva atomico.
//
// Idempotencia: detecta presenca de "httpIrrCreateSensor" e sai.
//
// Pre-requisito: _e053 (cria mqttOutConfigPush). Recomendavel rodar _e053b
// antes pra que sensors[] entre no payload de config/push — mas nao e
// estritamente necessario (esse script nao depende disso).

'use strict';

const fs = require('fs');
const path = require('path');

const FLOWS = '/opt/xtconect/nodered/data/flows.json';
const BACKUPS = '/opt/xtconect/backups';
const MARKER_NODE_ID = 'httpIrrCreateSensor';

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

const ACCESS_HELPER = `async function checkDeviceAccess(pool, deviceId, user) {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(deviceId)) return { err: 400, msg: 'id invalido' };
  const isAdmin = user && user.role === 'admin';
  const r = await pool.query(
    \`SELECT d.id, d.device_id AS serial, d.user_id AS owner_id, d.status, d.modelo_id,
            m.prefixo, m.major_version
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
}`;

const BUILD_PUSH_HELPER = `async function buildConfigPushMsg(pool, deviceUuid) {
  try {
    const dev = await pool.query('SELECT device_id AS serial FROM devices WHERE id=$1', [deviceUuid]);
    if (dev.rowCount === 0) return null;
    const serial = dev.rows[0].serial;
    const cfgQ = await pool.query('SELECT * FROM irrigation_configs WHERE device_id=$1', [deviceUuid]);
    const secQ = await pool.query(
      'SELECT numero, nome, habilitado, pausado, gpio_rele, nivel_ativo_rele, tipo_botao_fisico, gpio_botao, debounce_ms FROM irrigation_sectors WHERE device_id=$1 ORDER BY numero',
      [deviceUuid]
    );
    const senQ = await pool.query(
      'SELECT rom_id, nome, role, nome_custom, limite_alarme_c, histerese_c, ack_usuario_requerido, ativo FROM irrigation_temperature_sensors WHERE device_id=$1 ORDER BY criado_em',
      [deviceUuid]
    );
    const cfg = cfgQ.rows[0] || {};
    const payload = {
      protocol_version: 1,
      ts: new Date().toISOString(),
      bomba: {
        tipo_bomba: cfg.tipo_bomba,
        nivel_ativo_bomba: cfg.nivel_ativo_bomba,
        reforco_rele_ativo: cfg.reforco_rele_ativo,
        atraso_abrir_valvula_antes_bomba_s: cfg.atraso_abrir_valvula_antes_bomba_s,
        tempo_bomba_desligada_antes_fechar_valvula_s: cfg.tempo_bomba_desligada_antes_fechar_valvula_s,
        atraso_religar_bomba_apos_fechamento_s: cfg.atraso_religar_bomba_apos_fechamento_s,
        tempo_max_continuo_bomba_min: cfg.tempo_max_continuo_bomba_min,
        tempo_max_manual_local_min: cfg.tempo_max_manual_local_min,
        tempo_max_manual_remoto_sem_internet_min: cfg.tempo_max_manual_remoto_sem_internet_min,
      },
      botao: {
        tipo: cfg.botao_fisico_tipo,
        debounce_ms: cfg.botao_debounce_ms,
        assume_manual: cfg.botao_assume_manual,
      },
      gpio_1wire: cfg.gpio_1wire,
      sectors: secQ.rows.map(function(s){ return {
        numero: s.numero, nome: s.nome, habilitado: s.habilitado, pausado: s.pausado,
        gpio_rele: s.gpio_rele, nivel_ativo_rele: s.nivel_ativo_rele,
        tipo_botao_fisico: s.tipo_botao_fisico, gpio_botao: s.gpio_botao, debounce_ms: s.debounce_ms,
      }; }),
      sensors: senQ.rows.map(function(s){ return {
        rom_id: s.rom_id, nome: s.nome, role: s.role, nome_custom: s.nome_custom,
        limite_alarme_c: Number(s.limite_alarme_c),
        histerese_c: Number(s.histerese_c),
        ack_usuario_requerido: s.ack_usuario_requerido,
        ativo: s.ativo,
      }; }),
    };
    return { topic: 'devices/' + serial + '/config/push', payload: JSON.stringify(payload), qos: 1, retain: true };
  } catch(e) {
    node.warn('buildConfigPushMsg: ' + e.message);
    return null;
  }
}`;

// =====================================================================
// LOGIC FUNCS
// =====================================================================

const FN_CREATE_SENSOR = `// IRR-V1 sensors crud — POST
const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return [msg, null]; }
${ACCESS_HELPER}
${BUILD_PUSH_HELPER}
const body = msg.payload || {};
const nome = (typeof body.nome === 'string' && body.nome.trim()) ? body.nome.trim().slice(0,96) : null;
const role = body.role;
const limite = Number(body.limite_alarme_c);
const histerese = body.histerese_c === undefined ? 5 : Number(body.histerese_c);
const ack = body.ack_usuario_requerido !== false;
const ativo = body.ativo !== false;
let romId = (typeof body.rom_id === 'string' && body.rom_id.trim()) ? body.rom_id.trim() : null;
const nomeCustom = (typeof body.nome_custom === 'string' && body.nome_custom.trim()) ? body.nome_custom.trim() : null;
if (!nome) { msg.statusCode=400; msg.payload={error:'nome obrigatorio'}; return [msg, null]; }
if (!['pump','inverter','custom'].includes(role)) { msg.statusCode=400; msg.payload={error:'role invalido (pump|inverter|custom)'}; return [msg, null]; }
if (!Number.isFinite(limite)) { msg.statusCode=400; msg.payload={error:'limite_alarme_c obrigatorio (numerico)'}; return [msg, null]; }
if (!Number.isFinite(histerese) || histerese < 0 || histerese > 50) { msg.statusCode=400; msg.payload={error:'histerese_c deve estar em [0,50]'}; return [msg, null]; }
try {
  const chk = await checkDeviceAccess(pool, msg.req.params.id, msg.user);
  if (chk.err) { msg.statusCode=chk.err; msg.payload={error:chk.msg}; return [msg, null]; }
  const device = chk.device;
  if (device.prefixo !== 'IRR' || device.major_version !== 'V1') {
    msg.statusCode=400; msg.payload={error:'device nao e IRR-V1'}; return [msg, null];
  }
  if (chk.access === 'share' && chk.permissao !== 'controle') {
    msg.statusCode=403; msg.payload={error:'sem permissao'}; return [msg, null];
  }
  // Se app nao mandou rom_id, gera placeholder. ESP real vai descobrir o
  // ROM fisico no scan 1-Wire e sobrescrever via config/current (UPSERT).
  if (!romId) romId = 'pending-' + crypto.randomUUID();
  const r = await pool.query(
    \`INSERT INTO irrigation_temperature_sensors
       (device_id, rom_id, nome, role, nome_custom, limite_alarme_c, histerese_c, ack_usuario_requerido, ativo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *\`,
    [device.id, romId, nome, role, nomeCustom, limite, histerese, ack, ativo]
  );
  msg.statusCode = 201;
  msg.payload = { sensor: r.rows[0] };
  const pushMsg = await buildConfigPushMsg(pool, device.id);
  return [msg, pushMsg];
} catch(e) {
  if (/limit_reached:4_sensors_per_device/.test(e.message)) {
    msg.statusCode=409; msg.payload={error:'limite de 4 sensores por dispositivo atingido'}; return [msg, null];
  }
  if (/duplicate key|unique constraint/i.test(e.message)) {
    msg.statusCode=409; msg.payload={error:'rom_id ja cadastrado pra este dispositivo'}; return [msg, null];
  }
  if (/check constraint|violates/i.test(e.message)) {
    msg.statusCode=422; msg.payload={error:'valor invalido', detail:e.message}; return [msg, null];
  }
  node.error('create sensor: '+e.message, msg);
  msg.statusCode=500; msg.payload={error:'internal'};
  return [msg, null];
}`;

const FN_PATCH_SENSOR = `// IRR-V1 sensors crud — PATCH
const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return [msg, null]; }
${ACCESS_HELPER}
${BUILD_PUSH_HELPER}
const sensorId = msg.req.params.sensorId;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(sensorId)) { msg.statusCode=400; msg.payload={error:'sensorId invalido'}; return [msg, null]; }
const body = msg.payload || {};
const ALLOWED = ['nome','nome_custom','role','limite_alarme_c','histerese_c','ack_usuario_requerido','ativo'];
const sets = []; const params = [];
let idx = 0;
for (const k of Object.keys(body)) {
  if (!ALLOWED.includes(k)) continue;
  let v = body[k];
  if (k === 'role' && !['pump','inverter','custom'].includes(v)) {
    msg.statusCode=400; msg.payload={error:'role invalido'}; return [msg, null];
  }
  if (k === 'limite_alarme_c' || k === 'histerese_c') {
    v = Number(v);
    if (!Number.isFinite(v)) { msg.statusCode=400; msg.payload={error:k+' deve ser numerico'}; return [msg, null]; }
  }
  if (k === 'nome' && typeof v === 'string') v = v.trim().slice(0, 96);
  idx++; params.push(v); sets.push(k+'=$'+idx);
}
if (sets.length === 0) { msg.statusCode=400; msg.payload={error:'nada pra atualizar'}; return [msg, null]; }
try {
  const chk = await checkDeviceAccess(pool, msg.req.params.id, msg.user);
  if (chk.err) { msg.statusCode=chk.err; msg.payload={error:chk.msg}; return [msg, null]; }
  const device = chk.device;
  if (device.prefixo !== 'IRR' || device.major_version !== 'V1') {
    msg.statusCode=400; msg.payload={error:'device nao e IRR-V1'}; return [msg, null];
  }
  if (chk.access === 'share' && chk.permissao !== 'controle') {
    msg.statusCode=403; msg.payload={error:'sem permissao'}; return [msg, null];
  }
  idx++; params.push(device.id);
  idx++; params.push(sensorId);
  const sql = 'UPDATE irrigation_temperature_sensors SET ' + sets.join(', ') + ' WHERE device_id=$' + (idx-1) + ' AND id=$' + idx + ' RETURNING *';
  const r = await pool.query(sql, params);
  if (r.rowCount === 0) { msg.statusCode=404; msg.payload={error:'sensor nao encontrado'}; return [msg, null]; }
  msg.statusCode=200; msg.payload={ sensor: r.rows[0] };
  const pushMsg = await buildConfigPushMsg(pool, device.id);
  return [msg, pushMsg];
} catch(e) {
  if (/check constraint|violates/i.test(e.message)) {
    msg.statusCode=422; msg.payload={error:'valor invalido', detail:e.message};
  } else { node.error('patch sensor: '+e.message, msg); msg.statusCode=500; msg.payload={error:'internal'}; }
  return [msg, null];
}`;

const FN_DELETE_SENSOR = `// IRR-V1 sensors crud — DELETE
const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return [msg, null]; }
${ACCESS_HELPER}
${BUILD_PUSH_HELPER}
const sensorId = msg.req.params.sensorId;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(sensorId)) { msg.statusCode=400; msg.payload={error:'sensorId invalido'}; return [msg, null]; }
try {
  const chk = await checkDeviceAccess(pool, msg.req.params.id, msg.user);
  if (chk.err) { msg.statusCode=chk.err; msg.payload={error:chk.msg}; return [msg, null]; }
  const device = chk.device;
  if (device.prefixo !== 'IRR' || device.major_version !== 'V1') {
    msg.statusCode=400; msg.payload={error:'device nao e IRR-V1'}; return [msg, null];
  }
  if (chk.access === 'share' && chk.permissao !== 'controle') {
    msg.statusCode=403; msg.payload={error:'sem permissao'}; return [msg, null];
  }
  const r = await pool.query(
    'DELETE FROM irrigation_temperature_sensors WHERE device_id=$1 AND id=$2 RETURNING id, rom_id',
    [device.id, sensorId]
  );
  if (r.rowCount === 0) { msg.statusCode=404; msg.payload={error:'sensor nao encontrado'}; return [msg, null]; }
  msg.statusCode=200; msg.payload={ ok: true, removido: r.rows[0] };
  const pushMsg = await buildConfigPushMsg(pool, device.id);
  return [msg, pushMsg];
} catch(e) {
  node.error('delete sensor: '+e.message, msg);
  msg.statusCode=500; msg.payload={error:'internal'};
  return [msg, null];
}`;

// =====================================================================
// FLOW NODES
// =====================================================================

function makeEndpointNodes(opts) {
  // opts: { method, urlSuffix, baseId, label, fnLogicCode, x, y }
  const { method, urlSuffix, baseId, label, fnLogicCode, x, y } = opts;
  return [
    {
      id: 'httpIrr' + baseId,
      type: 'http in',
      z: 'tabAuth',
      name: method.toUpperCase() + ' ' + urlSuffix,
      url: urlSuffix,
      method: method.toLowerCase(),
      upload: false,
      swaggerDoc: '',
      x: x,
      y: y,
      wires: [['fnAuthIrr' + baseId]],
    },
    {
      id: 'fnAuthIrr' + baseId,
      type: 'function',
      z: 'tabAuth',
      name: 'Auth JWT',
      func: AUTH_FUNC,
      outputs: 2,
      libs: [{ var: 'jwt', module: 'jsonwebtoken' }],
      x: x + 240,
      y: y,
      wires: [['fnIrr' + baseId], ['respIrr' + baseId]],
    },
    {
      id: 'fnIrr' + baseId,
      type: 'function',
      z: 'tabAuth',
      name: label,
      func: fnLogicCode,
      outputs: 2,
      libs: [],
      x: x + 500,
      y: y,
      wires: [['respIrr' + baseId], ['mqttOutConfigPush']],
    },
    {
      id: 'respIrr' + baseId,
      type: 'http response',
      z: 'tabAuth',
      name: '',
      statusCode: '',
      headers: { 'Content-Type': 'application/json' },
      x: x + 740,
      y: y,
      wires: [],
    },
  ];
}

// =====================================================================

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

  // Idempotencia
  if (flows.some(n => n && n.id === MARKER_NODE_ID)) {
    console.log('Ja aplicado (encontrei "' + MARKER_NODE_ID + '"). Saindo.');
    process.exit(0);
  }

  // Pre-requisito: mqttOutConfigPush deve existir (criado por _e053)
  if (!flows.some(n => n && n.id === 'mqttOutConfigPush')) {
    console.error('mqttOutConfigPush nao encontrado. Rode _e053_publish_config_push.cjs primeiro.');
    process.exit(2);
  }

  // Backup
  if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });
  const bkp = path.join(BACKUPS, 'flows-pre-e054-' + ts() + '.json');
  fs.writeFileSync(bkp, raw, 'utf8');
  console.log('Backup salvo em ' + bkp);

  // Cria os 3 endpoints (12 nodes total). Y posicionado depois dos PATCH
  // de setores (y=4900) — coloco em y=5000, 5100, 5200.
  const newNodes = [
    ...makeEndpointNodes({
      method: 'POST',
      urlSuffix: '/dispositivos/:id/irrigacao/sensores-temperatura',
      baseId: 'CreateSensor',
      label: 'POST /sensores-temperatura',
      fnLogicCode: FN_CREATE_SENSOR,
      x: 200, y: 5000,
    }),
    ...makeEndpointNodes({
      method: 'PATCH',
      urlSuffix: '/dispositivos/:id/irrigacao/sensores-temperatura/:sensorId',
      baseId: 'PatchSensor',
      label: 'PATCH /sensores-temperatura/:sensorId',
      fnLogicCode: FN_PATCH_SENSOR,
      x: 200, y: 5100,
    }),
    ...makeEndpointNodes({
      method: 'DELETE',
      urlSuffix: '/dispositivos/:id/irrigacao/sensores-temperatura/:sensorId',
      baseId: 'DeleteSensor',
      label: 'DELETE /sensores-temperatura/:sensorId',
      fnLogicCode: FN_DELETE_SENSOR,
      x: 200, y: 5200,
    }),
  ];

  for (const n of newNodes) flows.push(n);
  console.log('Adicionados ' + newNodes.length + ' nodes (3 endpoints).');

  const tmp = FLOWS + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(flows, null, 4) + '\n', 'utf8');
  fs.renameSync(tmp, FLOWS);
  console.log('flows.json atualizado.');
  console.log('Proximo passo: sudo docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
}

main();
