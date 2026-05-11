#!/usr/bin/env node
// E5.4 — Endpoint Node-RED para ACK de alarme IRR-V1
//
// ROTA: POST /api/dispositivos/:deviceId/irrigacao/alarmes/ack
// BODY: { step: 1 | 2, alarm_id: string }
//
// FLUXO:
//   step=1 → atualiza irrigation_alarms.acked_at + acked_by_user_id
//            publica retained devices/<serial>/alarm/active com ack_state='acknowledged_once'
//
//   step=2 → valida que step=1 já foi feito (acked_at NOT NULL)
//            atualiza resolved_at
//            publica retained devices/<serial>/alarm/active com ack_state='acknowledged_final'
//            (payload com ack_state='acknowledged_final' faz o frontend sumir o banner)
//
//   step=1 (reset por timeout frontend, alarm_id igual) → reverte ack_state para 'open'
//            SE acked_at < agora-30s E resolved_at IS NULL (não foi definitivamente ackado)
//
// NÓS INJETADOS:
//   httpIrrAlarmAck       — http-in  POST /dispositivos/:deviceId/irrigacao/alarmes/ack
//   fnAuthIrrAlarmAck     — function validação JWT/tenant
//   fnIrrAlarmAck         — function lógica principal (pg + mqtt retained)
//   respIrrAlarmAck       — http response
//
// IDEMPOTÊNCIA: busca nós pelo ID antes de inserir; se já existirem, atualiza apenas o func body.
//
// COMO RODAR (aguardar ordem do Wesllem):
//   sudo node /opt/xtconect/scripts/_e054_inject_irr_alarm_ack.cjs
//   docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered
//
// ROLLBACK:
//   sudo cp /opt/xtconect/nodered/data/flows.json.bak-e054-alarm-ack-<TIMESTAMP> \
//           /opt/xtconect/nodered/data/flows.json
//   docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered

'use strict';
const fs   = require('fs');
const path = require('path');

const FLOWS_PATH = '/opt/xtconect/nodered/data/flows.json';

// ─── IDs canônicos dos nós ────────────────────────────────────────────────────
const ID_HTTP_IN    = 'httpIrrAlarmAck';
const ID_FN_AUTH    = 'fnAuthIrrAlarmAck';
const ID_FN_LOGIC   = 'fnIrrAlarmAck';
const ID_HTTP_RESP  = 'respIrrAlarmAck';

// ─── Corpo da função de auth (reutiliza padrão dos outros endpoints IRR-V1) ──
const FN_AUTH_BODY = `
// Reutiliza padrão de autenticação dos endpoints IRR-V1 (fnAuthIrrComandos)
const token = msg.req.headers['authorization']?.replace('Bearer ', '');
if (!token) { msg.statusCode = 401; msg.payload = { error: 'sem_token' }; node.send([null, msg]); return; }

let claims;
try {
  const jose = global.get('jose') || require('jose');
  const secret = new TextEncoder().encode(env.get('JWT_SECRET'));
  const { payload } = await jose.jwtVerify(token, secret);
  claims = payload;
} catch (e) {
  msg.statusCode = 401; msg.payload = { error: 'token_invalido' }; node.send([null, msg]); return;
}

msg._userId   = claims.sub;
msg._userRole = claims.role;
node.send([msg, null]);
`.trim();

// ─── Corpo da função principal ────────────────────────────────────────────────
const FN_LOGIC_BODY = `
const pg   = global.get('pgPool');
const mq   = global.get('mqttBroker');   // broker MQTT interno (registro via _e22)

const deviceId = msg.req.params.deviceId;
const { step, alarm_id } = msg.req.body || {};
const userId   = msg._userId;

// Validações de entrada
if (!deviceId || !alarm_id || ![1, 2].includes(Number(step))) {
  msg.statusCode = 400;
  msg.payload = { error: 'parametros_invalidos', detalhe: 'step (1|2) e alarm_id obrigatórios' };
  node.send(msg); return;
}

// ── Buscar alarme + serial do device ──────────────────────────────────────────
let alarmRow, deviceSerial;
try {
  const res = await pg.query(
    \`SELECT a.id, a.device_id, a.tipo, a.severity, a.message, a.since,
             a.acked_at, a.acked_by_user_id, a.resolved_at, a.payload_json,
             d.serial
       FROM irrigation_alarms a
       JOIN devices d ON d.id = a.device_id
      WHERE a.id = $1 AND a.device_id = $2\`,
    [alarm_id, deviceId]
  );
  if (res.rowCount === 0) {
    msg.statusCode = 404; msg.payload = { error: 'alarme_nao_encontrado' };
    node.send(msg); return;
  }
  alarmRow    = res.rows[0];
  deviceSerial = res.rows[0].serial;
} catch (e) {
  node.error('[fnIrrAlarmAck] pg query alarm: ' + e.message, msg);
  msg.statusCode = 500; msg.payload = { error: 'erro_banco' };
  node.send(msg); return;
}

if (alarmRow.resolved_at) {
  msg.statusCode = 409; msg.payload = { error: 'alarme_ja_resolvido' };
  node.send(msg); return;
}

const topic = \`devices/\${deviceSerial}/alarm/active\`;
let newAckState;

if (Number(step) === 1) {
  // ── ACK step 1: confirmar visualização ────────────────────────────────────
  // Se já foi acked_once mas o frontend está refazendo step=1 (reset por timeout),
  // reverte para 'open' se acked_at < 31s atrás (dentro da janela de timeout do frontend)
  const jaNulo = !alarmRow.acked_at;
  const dentroJanela = alarmRow.acked_at &&
    (Date.now() - new Date(alarmRow.acked_at).getTime()) > 29_500;

  if (!jaNulo && !dentroJanela) {
    // Já ackado recentemente, idempotente
    newAckState = 'acknowledged_once';
  } else if (dentroJanela) {
    // Reset por timeout do frontend
    newAckState = 'open';
    await pg.query(
      'UPDATE irrigation_alarms SET acked_at = NULL, acked_by_user_id = NULL WHERE id = $1',
      [alarm_id]
    );
  } else {
    newAckState = 'acknowledged_once';
    await pg.query(
      'UPDATE irrigation_alarms SET acked_at = NOW(), acked_by_user_id = $2 WHERE id = $1',
      [alarm_id, userId]
    );
  }

} else {
  // ── ACK step 2: confirmar definitivamente ──────────────────────────────────
  if (!alarmRow.acked_at) {
    msg.statusCode = 422;
    msg.payload = { error: 'ack_step1_pendente', detalhe: 'Execute step=1 primeiro' };
    node.send(msg); return;
  }
  newAckState = 'acknowledged_final';
  await pg.query(
    'UPDATE irrigation_alarms SET resolved_at = NOW() WHERE id = $1',
    [alarm_id]
  );
}

// ── Publicar retained MQTT atualizado ─────────────────────────────────────────
const retainedPayload = JSON.stringify({
  kind:      alarmRow.tipo,
  severity:  alarmRow.severity || 'critico',
  message:   alarmRow.message,
  since:     alarmRow.since,
  ack_state: newAckState,
  alarm_id:  alarm_id,
});

try {
  // Usa o helper global mqttPublish injetado por _e22 ou similar
  // Fallback: tenta global 'mqttPublish'; se não existir, usa o broker direto
  const pub = global.get('mqttPublish');
  if (typeof pub === 'function') {
    await pub(topic, retainedPayload, { retain: true, qos: 1 });
  } else if (mq && typeof mq.publish === 'function') {
    await new Promise((res, rej) => mq.publish(topic, retainedPayload, { retain: true, qos: 1 }, (e) => e ? rej(e) : res()));
  } else {
    node.warn('[fnIrrAlarmAck] mqttPublish/mqttBroker não disponível no contexto global — retained NÃO publicado');
  }
} catch (mqErr) {
  node.error('[fnIrrAlarmAck] mqtt publish error: ' + mqErr.message, msg);
  // Não retorna erro 500 — banco já foi atualizado; frontend vai sincronizar pelo próximo poll
}

msg.statusCode = 200;
msg.payload = { ok: true, alarm_id, ack_state: newAckState };
node.send(msg);
`.trim();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mkHttpIn() {
  return {
    id: ID_HTTP_IN,
    type: 'http in',
    name: 'POST /alarmes/ack',
    url: '/dispositivos/:deviceId/irrigacao/alarmes/ack',
    method: 'post',
    upload: false,
    wires: [[ID_FN_AUTH]],
    x: 100, y: 900, z: 'tab_irr_v1',
  };
}

function mkFnAuth() {
  return {
    id: ID_FN_AUTH,
    type: 'function',
    name: 'fnAuthIrrAlarmAck',
    func: FN_AUTH_BODY,
    outputs: 2,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    wires: [[ID_FN_LOGIC], [ID_HTTP_RESP]],
    x: 340, y: 900, z: 'tab_irr_v1',
  };
}

function mkFnLogic() {
  return {
    id: ID_FN_LOGIC,
    type: 'function',
    name: 'fnIrrAlarmAck',
    func: FN_LOGIC_BODY,
    outputs: 1,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    wires: [[ID_HTTP_RESP]],
    x: 590, y: 900, z: 'tab_irr_v1',
  };
}

function mkResp() {
  return {
    id: ID_HTTP_RESP,
    type: 'http response',
    name: 'respIrrAlarmAck',
    statusCode: '',
    headers: {},
    wires: [],
    x: 820, y: 900, z: 'tab_irr_v1',
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (!fs.existsSync(FLOWS_PATH)) {
  console.error('ERRO: flows.json não encontrado em', FLOWS_PATH);
  process.exit(1);
}

let flows;
try {
  flows = JSON.parse(fs.readFileSync(FLOWS_PATH, 'utf8'));
} catch (e) {
  console.error('ERRO: JSON inválido:', e.message);
  process.exit(1);
}

// Backup
const ts      = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const bakPath = `${FLOWS_PATH}.bak-e054-alarm-ack-${ts}`;
fs.copyFileSync(FLOWS_PATH, bakPath);
console.log('Backup criado:', bakPath);

const ALL_IDS = [ID_HTTP_IN, ID_FN_AUTH, ID_FN_LOGIC, ID_HTTP_RESP];
const NEW_NODES = [mkHttpIn(), mkFnAuth(), mkFnLogic(), mkResp()];

let changed = 0;
for (const newNode of NEW_NODES) {
  const existing = flows.find(n => n && n.id === newNode.id);
  if (existing) {
    if (newNode.func) {
      existing.func = newNode.func;
      console.log(`[UPDATE] ${newNode.id} — func body atualizado`);
      changed++;
    } else {
      console.log(`[SKIP]   ${newNode.id} — já existe, sem func body para atualizar`);
    }
  } else {
    flows.push(newNode);
    console.log(`[INSERT] ${newNode.id}`);
    changed++;
  }
}

if (changed === 0) {
  console.log('\nSTATUS: sem alterações necessárias.');
  fs.unlinkSync(bakPath);
  console.log('Backup removido.');
  process.exit(0);
}

let serialized;
try {
  serialized = JSON.stringify(flows, null, 4);
  JSON.parse(serialized);
} catch (e) {
  console.error('ERRO: JSON resultante inválido:', e.message);
  console.error('flows.json NÃO gravado. Restaure:', bakPath);
  process.exit(1);
}

fs.writeFileSync(FLOWS_PATH, serialized, 'utf8');

console.log('\n=== INJECTED OK ===');
console.log('Nós inseridos/atualizados:', changed);
console.log('Backup:', bakPath);
console.log('\nPróximo passo (quando autorizado):');
console.log('  sudo node /opt/xtconect/scripts/_e053_inject_irr_alarm_ack.cjs');
console.log('  docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
