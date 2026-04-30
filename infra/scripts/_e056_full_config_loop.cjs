#!/usr/bin/env node
// E5.6 — Fecha o loop config bidirecional pra TUDO: configs (todos campos),
// sectors (todos campos), sensors (mantem), timers (novo).
//
// Auditoria do estado anterior:
//   - irrigation_configs: handler config/current SO sincronizava 3 campos
//     da bomba (tipo_bomba, nivel_ativo_bomba, reforco_rele_ativo). Os
//     outros (atrasos, tempos max, botao, gpio_1wire) ficavam dessincronizados
//     entre app e firmware.
//   - irrigation_sectors: handler config/current SO sincronizava 4 campos
//     (nome, habilitado, gpio_rele, nivel_ativo_rele). pausado, tipo_botao,
//     gpio_botao, debounce_ms ficavam dessincronizados.
//   - irrigation_timers: completamente fora do loop. App grava no banco,
//     simulator/ESP nunca recebem. Confusao confirmada pelo usuario:
//     3 timers no app x 0 timers no simulator.
//
// Como modifica:
//   1. BUILD_PUSH_FN v3 — payload de config/push agora inclui campos
//      completos de configs, sectors, sensors (ja completo) e timers[].
//      Substitui o func de fnIrrPatchConfig, fnIrrPatchSector,
//      fnIrrCreateSensor, fnIrrPatchSensor, fnIrrDeleteSensor.
//   2. Handler config/current v4 — UPSERT completo: todos campos de
//      irrigation_configs, sectors, sensors, timers. Substitui o func
//      do listener (marker v3 -> v4).
//   3. fnIrrPostTimer/PatchTimer/DeleteTimer — passam de outputs=1 pra
//      outputs=2, retornam [msg, pushMsg], segundo wire pra
//      mqttOutConfigPush.
//
// Idempotencia: marker "FULL CONFIG LOOP v4" no func de cada um. 2a
// execucao sai sem mudancas.
//
// Pre-requisito: _e052b, _e053, _e053b, _e054 ja rodaram (usa mqttOutConfigPush).

'use strict';

const fs = require('fs');
const path = require('path');

const FLOWS = '/opt/xtconect/nodered/data/flows.json';
const BACKUPS = '/opt/xtconect/backups';
const MARKER = 'FULL CONFIG LOOP v5';

// Helper de access — mesmo padrao usado em todos os funcs
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

// BUILD_PUSH_FN v3 — payload completo + timers
const BUILD_PUSH_FN = `
async function buildConfigPushMsg(pool, deviceUuid) {
  try {
    const dev = await pool.query('SELECT device_id AS serial FROM devices WHERE id=$1', [deviceUuid]);
    if (dev.rowCount === 0) return null;
    const serial = dev.rows[0].serial;
    const cfgQ = await pool.query('SELECT * FROM irrigation_configs WHERE device_id=$1', [deviceUuid]);
    const secQ = await pool.query(
      'SELECT id, numero, nome, habilitado, pausado, gpio_rele, nivel_ativo_rele, tipo_botao_fisico, gpio_botao, debounce_ms FROM irrigation_sectors WHERE device_id=$1 ORDER BY numero',
      [deviceUuid]
    );
    const senQ = await pool.query(
      'SELECT rom_id, nome, role, nome_custom, limite_alarme_c, histerese_c, ack_usuario_requerido, ativo FROM irrigation_temperature_sensors WHERE device_id=$1 ORDER BY criado_em',
      [deviceUuid]
    );
    const tmrQ = await pool.query(
      \`SELECT id, alvo_tipo, alvo_id, tipo, nome, ativo, pausado,
              hora_inicio::text AS hora_inicio,
              hora_fim::text AS hora_fim,
              duracao_min, on_minutes, off_minutes,
              duracao_s, on_seconds, off_seconds,
              dias_semana, overlap_confirmed, observacao
         FROM irrigation_timers WHERE device_id=$1 ORDER BY criado_em\`,
      [deviceUuid]
    );
    const cfg = cfgQ.rows[0] || {};
    // Mapa numero->sector_id pra timers de setor (firmware usa numero, banco usa uuid)
    const sectorIdToNumero = new Map();
    for (const s of secQ.rows) sectorIdToNumero.set(s.id, s.numero);
    const payload = {
      protocol_version: 1,
      ts: new Date().toISOString(),
      modo_operacao: cfg.modo_operacao,
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
      timers: tmrQ.rows.map(function(t){
        var sectorNumero = (t.alvo_tipo === 'sector' && t.alvo_id) ? sectorIdToNumero.get(t.alvo_id) || null : null;
        return {
          id: t.id,
          alvo_tipo: t.alvo_tipo,
          sector_numero: sectorNumero,
          tipo: t.tipo,
          nome: t.nome,
          ativo: t.ativo,
          pausado: t.pausado,
          hora_inicio: t.hora_inicio,
          hora_fim: t.hora_fim,
          duracao_min: t.duracao_min,
          on_minutes: t.on_minutes,
          off_minutes: t.off_minutes,
          duracao_s: t.duracao_s,
          on_seconds: t.on_seconds,
          off_seconds: t.off_seconds,
          dias_semana: t.dias_semana,
          observacao: t.observacao,
        };
      }),
    };
    return { topic: 'devices/' + serial + '/config/push', payload: JSON.stringify(payload), qos: 1, retain: true };
  } catch(e) {
    node.warn('buildConfigPushMsg: ' + e.message);
    return null;
  }
}`;

// PatchConfig: substitui o func mantendo logica atual, mas com BUILD_PUSH_FN v3
const FN_PATCH_CONFIG = `// ${MARKER}
const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return [msg, null]; }
${ACCESS_HELPER}
${BUILD_PUSH_FN}
const body = msg.payload || {};
const ALLOWED = ['modo_operacao','tipo_bomba','reforco_rele_ativo','nivel_ativo_bomba',
                  'atraso_abrir_valvula_antes_bomba_s','tempo_bomba_desligada_antes_fechar_valvula_s',
                  'atraso_religar_bomba_apos_fechamento_s','tempo_max_continuo_bomba_min',
                  'tempo_max_manual_local_min','tempo_max_manual_remoto_sem_internet_min',
                  'botao_fisico_tipo','botao_debounce_ms','botao_assume_manual','gpio_1wire'];
const sets = []; const params = [];
let idx = 0;
for (const k of Object.keys(body)) {
  if (!ALLOWED.includes(k)) continue;
  idx++; params.push(body[k]); sets.push(k+'=$' + idx);
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
  const sql = 'UPDATE irrigation_configs SET ' + sets.join(', ') + ', atualizado_em=NOW() WHERE device_id=$' + idx + ' RETURNING *';
  const r = await pool.query(sql, params);
  if (r.rowCount === 0) { msg.statusCode=404; msg.payload={error:'config nao provisionada'}; return [msg, null]; }
  msg.statusCode=200; msg.payload={ config: r.rows[0] };
  const pushMsg = await buildConfigPushMsg(pool, device.id);
  return [msg, pushMsg];
} catch(e) {
  if (/check constraint|violates/i.test(e.message)) {
    msg.statusCode=422; msg.payload={error:'valor invalido', detail:e.message};
  } else { node.error('patch config: '+e.message, msg); msg.statusCode=500; msg.payload={error:'internal'}; }
  return [msg, null];
}`;

const FN_PATCH_SECTOR = `// ${MARKER}
const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return [msg, null]; }
${ACCESS_HELPER}
${BUILD_PUSH_FN}
const numero = parseInt(msg.req.params.numero, 10);
if (!Number.isFinite(numero) || numero < 1 || numero > 8) {
  msg.statusCode=400; msg.payload={error:'numero invalido (1..8)'}; return [msg, null];
}
const body = msg.payload || {};
const ALLOWED = ['nome','habilitado','pausado','nivel_ativo_rele',
                  'tipo_botao_fisico','gpio_botao','debounce_ms'];
const sets = []; const params = [];
let idx = 0;
for (const k of Object.keys(body)) {
  if (!ALLOWED.includes(k)) continue;
  idx++; params.push(body[k]); sets.push(k+'=$'+idx);
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
  idx++; params.push(numero);
  const sql = 'UPDATE irrigation_sectors SET ' + sets.join(', ') + ', atualizado_em=NOW() WHERE device_id=$' + (idx-1) + ' AND numero=$' + idx + ' RETURNING *';
  const r = await pool.query(sql, params);
  if (r.rowCount === 0) { msg.statusCode=404; msg.payload={error:'setor nao encontrado'}; return [msg, null]; }
  msg.statusCode=200; msg.payload={ setor: r.rows[0] };
  const pushMsg = await buildConfigPushMsg(pool, device.id);
  return [msg, pushMsg];
} catch(e) {
  if (/check constraint|violates/i.test(e.message)) {
    msg.statusCode=422; msg.payload={error:'valor invalido', detail:e.message};
  } else { node.error('patch setor: '+e.message, msg); msg.statusCode=500; msg.payload={error:'internal'}; }
  return [msg, null];
}`;

// Sensors: copia o padrao mas com BUILD_PUSH_FN v3
const FN_CREATE_SENSOR = `// ${MARKER}
const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return [msg, null]; }
${ACCESS_HELPER}
${BUILD_PUSH_FN}
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
  if (!romId) romId = 'pending-' + crypto.randomUUID();
  const r = await pool.query(
    \`INSERT INTO irrigation_temperature_sensors
       (device_id, rom_id, nome, role, nome_custom, limite_alarme_c, histerese_c, ack_usuario_requerido, ativo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *\`,
    [device.id, romId, nome, role, nomeCustom, limite, histerese, ack, ativo]
  );
  msg.statusCode = 201; msg.payload = { sensor: r.rows[0] };
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

const FN_PATCH_SENSOR = `// ${MARKER}
const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return [msg, null]; }
${ACCESS_HELPER}
${BUILD_PUSH_FN}
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

const FN_DELETE_SENSOR = `// ${MARKER}
const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return [msg, null]; }
${ACCESS_HELPER}
${BUILD_PUSH_FN}
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

// Timers — versao com outputs=2 + buildConfigPushMsg
const FN_POST_TIMER = `// ${MARKER}
const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return [msg, null]; }
const overlap = global.get('irrTimerOverlap');
if (!overlap) { msg.statusCode=503; msg.payload={error:'overlap lib not ready'}; return [msg, null]; }
${ACCESS_HELPER}
${BUILD_PUSH_FN}
const body = msg.payload || {};
const REQ = ['alvo_tipo','tipo','nome','dias_semana'];
for (const k of REQ) if (body[k] == null) { msg.statusCode=400; msg.payload={error:'faltando: '+k}; return [msg, null]; }
if (!['pump','sector'].includes(body.alvo_tipo)) { msg.statusCode=400; msg.payload={error:'alvo_tipo invalido'}; return [msg, null]; }
if (!['fixed','cyclic_window','cyclic_continuous'].includes(body.tipo)) { msg.statusCode=400; msg.payload={error:'tipo invalido'}; return [msg, null]; }
if (body.alvo_tipo === 'sector' && !body.alvo_id) { msg.statusCode=400; msg.payload={error:'alvo_id obrigatorio quando alvo_tipo=sector'}; return [msg, null]; }
if (body.alvo_tipo === 'pump' && body.alvo_id) { msg.statusCode=400; msg.payload={error:'alvo_id deve ser null quando alvo_tipo=pump'}; return [msg, null]; }
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
  const existing = await pool.query(
    'SELECT id, alvo_tipo, alvo_id, tipo, nome, ativo, hora_inicio::text, hora_fim::text, duracao_min, on_minutes, off_minutes, duracao_s, on_seconds, off_seconds, dias_semana FROM irrigation_timers WHERE device_id=$1 AND ativo=TRUE',
    [device.id]
  );
  const result = overlap.detectOverlap(existing.rows, body);
  if (result.errors.length > 0) {
    msg.statusCode = 422;
    msg.payload = { error: 'conflito_mesmo_alvo', conflitos: result.errors };
    return [msg, null];
  }
  if (result.warnings.length > 0 && !body.overlap_confirmed) {
    msg.statusCode = 409;
    msg.payload = { error: 'conflito_alvo_diferente', conflitos: result.warnings, requires: 'overlap_confirmed' };
    return [msg, null];
  }
  try {
    const r = await pool.query(
      \`INSERT INTO irrigation_timers
         (device_id, alvo_tipo, alvo_id, tipo, nome, ativo, pausado,
          hora_inicio, hora_fim, duracao_min, on_minutes, off_minutes,
          duracao_s, on_seconds, off_seconds,
          dias_semana, overlap_confirmed, observacao)
       VALUES ($1,$2,$3,$4,$5,TRUE,FALSE,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *\`,
      [device.id, body.alvo_tipo, body.alvo_id || null, body.tipo, body.nome,
       body.hora_inicio || null, body.hora_fim || null, body.duracao_min || null,
       body.on_minutes || null, body.off_minutes || null,
       body.duracao_s || null, body.on_seconds || null, body.off_seconds || null,
       body.dias_semana, body.overlap_confirmed === true, body.observacao || null]
    );
    msg.statusCode = 201; msg.payload = { timer: r.rows[0] };
    const pushMsg = await buildConfigPushMsg(pool, device.id);
    return [msg, pushMsg];
  } catch(e) {
    if (/limit_reached:10_timers_per_target/.test(e.message)) {
      msg.statusCode=422; msg.payload={error:'limite 10 timers por alvo atingido'};
    } else if (/check constraint|violates/i.test(e.message)) {
      msg.statusCode=422; msg.payload={error:'valor invalido', detail:e.message};
    } else { throw e; }
    return [msg, null];
  }
} catch(e) {
  node.error('post timer: '+e.message, msg);
  msg.statusCode=500; msg.payload={error:'internal'};
  return [msg, null];
}`;

const FN_PATCH_TIMER = `// ${MARKER}
const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return [msg, null]; }
${ACCESS_HELPER}
${BUILD_PUSH_FN}
const timerId = msg.req.params.timer_id;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(timerId)) { msg.statusCode=400; msg.payload={error:'timer_id invalido'}; return [msg, null]; }
const body = msg.payload || {};
const ALLOWED = ['nome','ativo','pausado','hora_inicio','hora_fim','duracao_min',
                  'on_minutes','off_minutes','duracao_s','on_seconds','off_seconds',
                  'dias_semana','observacao','overlap_confirmed'];
const sets = []; const params = [];
let idx = 0;
for (const k of Object.keys(body)) {
  if (!ALLOWED.includes(k)) continue;
  idx++; params.push(body[k]); sets.push(k+'=$'+idx);
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
  idx++; params.push(timerId);
  const sql = 'UPDATE irrigation_timers SET ' + sets.join(', ') + ', atualizado_em=NOW() WHERE device_id=$' + (idx-1) + ' AND id=$' + idx + ' RETURNING *';
  const r = await pool.query(sql, params);
  if (r.rowCount === 0) { msg.statusCode=404; msg.payload={error:'timer nao encontrado'}; return [msg, null]; }
  msg.statusCode=200; msg.payload={ timer: r.rows[0] };
  const pushMsg = await buildConfigPushMsg(pool, device.id);
  return [msg, pushMsg];
} catch(e) {
  if (/check constraint|violates/i.test(e.message)) {
    msg.statusCode=422; msg.payload={error:'valor invalido', detail:e.message};
  } else { node.error('patch timer: '+e.message, msg); msg.statusCode=500; msg.payload={error:'internal'}; }
  return [msg, null];
}`;

const FN_DELETE_TIMER = `// ${MARKER}
const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return [msg, null]; }
${ACCESS_HELPER}
${BUILD_PUSH_FN}
const timerId = msg.req.params.timer_id;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(timerId)) { msg.statusCode=400; msg.payload={error:'timer_id invalido'}; return [msg, null]; }
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
    'DELETE FROM irrigation_timers WHERE device_id=$1 AND id=$2 RETURNING id',
    [device.id, timerId]
  );
  if (r.rowCount === 0) { msg.statusCode=404; msg.payload={error:'timer nao encontrado'}; return [msg, null]; }
  msg.statusCode=200; msg.payload={ ok: true, id: r.rows[0].id };
  const pushMsg = await buildConfigPushMsg(pool, device.id);
  return [msg, pushMsg];
} catch(e) {
  node.error('delete timer: '+e.message, msg);
  msg.statusCode=500; msg.payload={error:'internal'};
  return [msg, null];
}`;

// Handler config/current v4 — UPSERT completo
const FN_CONFIG_CURRENT = `// ${MARKER} (config/current handler)
// UPSERT completo de configs (todos campos), sectors (todos), sensors,
// timers. ESP eh fonte de verdade — banco vira cache.

const pool = global.get('pgPool');
if (!pool) return null;
const parts = (msg.topic || '').split('/');
if (parts.length !== 4 || parts[0] !== 'devices' || parts[2] !== 'config' || parts[3] !== 'current') return null;
const mqttUser = parts[1];

let cfg = null;
try {
  const raw = Buffer.isBuffer(msg.payload) ? msg.payload.toString('utf8') :
              (typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload));
  if (!raw || raw.trim() === '') return null;
  cfg = JSON.parse(raw);
  if (!cfg || typeof cfg !== 'object') return null;
} catch(e) { node.warn('config/current JSON invalido: '+e.message); return null; }

try {
  const drow = await pool.query('SELECT id FROM devices WHERE mqtt_username = $1', [mqttUser]);
  if (drow.rowCount === 0) {
    node.status({fill:'yellow',shape:'ring',text: mqttUser+' device nao encontrado'});
    return null;
  }
  const deviceId = drow.rows[0].id;

  // 1. Espelho cru (compat)
  await pool.query(
    \`UPDATE irrigation_configs SET current_pinout = $2::jsonb, current_pinout_received_at = NOW() WHERE device_id = $1\`,
    [deviceId, JSON.stringify(cfg)]
  );

  // 2. irrigation_configs — TODOS os campos opcionais
  const cSets = []; const cParams = [deviceId]; let cIdx = 1;
  function pushSet(col, val, validate) {
    if (val === undefined || val === null) return;
    if (validate && !validate(val)) return;
    cIdx++; cParams.push(val); cSets.push(col + '=$' + cIdx);
  }
  if (cfg.modo_operacao && (cfg.modo_operacao === 'manual' || cfg.modo_operacao === 'automatico')) {
    pushSet('modo_operacao', cfg.modo_operacao);
  }
  if (cfg.bomba && typeof cfg.bomba === 'object') {
    const b = cfg.bomba;
    pushSet('tipo_bomba', b.tipo_bomba, v => v === 'monofasica' || v === 'inverter');
    pushSet('nivel_ativo_bomba', b.nivel_ativo_bomba, v => v === 'high' || v === 'low');
    pushSet('reforco_rele_ativo', b.reforco_rele_ativo, v => typeof v === 'boolean');
    pushSet('atraso_abrir_valvula_antes_bomba_s', b.atraso_abrir_valvula_antes_bomba_s, v => Number.isFinite(v));
    pushSet('tempo_bomba_desligada_antes_fechar_valvula_s', b.tempo_bomba_desligada_antes_fechar_valvula_s, v => Number.isFinite(v));
    pushSet('atraso_religar_bomba_apos_fechamento_s', b.atraso_religar_bomba_apos_fechamento_s, v => Number.isFinite(v));
    pushSet('tempo_max_continuo_bomba_min', b.tempo_max_continuo_bomba_min, v => Number.isFinite(v));
    pushSet('tempo_max_manual_local_min', b.tempo_max_manual_local_min, v => Number.isFinite(v));
    pushSet('tempo_max_manual_remoto_sem_internet_min', b.tempo_max_manual_remoto_sem_internet_min, v => Number.isFinite(v));
  }
  if (cfg.botao && typeof cfg.botao === 'object') {
    const bt = cfg.botao;
    pushSet('botao_fisico_tipo', bt.tipo, v => ['pulso_alterna','pulso_liga','pulso_desliga','retentivo'].includes(v));
    pushSet('botao_debounce_ms', bt.debounce_ms, v => Number.isFinite(v));
    pushSet('botao_assume_manual', bt.assume_manual, v => typeof v === 'boolean');
  }
  if (Number.isFinite(cfg.gpio_1wire)) pushSet('gpio_1wire', cfg.gpio_1wire);
  if (cSets.length > 0) {
    cSets.push('atualizado_em=NOW()');
    try {
      await pool.query('UPDATE irrigation_configs SET ' + cSets.join(', ') + ' WHERE device_id=$1', cParams);
    } catch(e) { node.warn('config/current configs: ' + e.message); }
  }

  // 3. Setores — UPSERT por (device_id, numero), TODOS campos
  let setoresSync = 0;
  if (Array.isArray(cfg.sectors)) {
    for (const s of cfg.sectors) {
      if (!s || typeof s.numero !== 'number' || s.numero < 1 || s.numero > 8) continue;
      const cols = ['nome','habilitado','pausado','gpio_rele','nivel_ativo_rele',
                    'tipo_botao_fisico','gpio_botao','debounce_ms'];
      const vals = [
        (typeof s.nome === 'string' && s.nome.trim()) ? s.nome.trim().slice(0, 48) : ('Setor ' + s.numero),
        s.habilitado === true,
        s.pausado === true,
        Number.isFinite(s.gpio_rele) ? s.gpio_rele : 16,
        s.nivel_ativo_rele === 'low' ? 'low' : 'high',
        ['pulso_alterna','pulso_liga','pulso_desliga','retentivo'].includes(s.tipo_botao_fisico) ? s.tipo_botao_fisico : null,
        Number.isFinite(s.gpio_botao) ? s.gpio_botao : null,
        Number.isFinite(s.debounce_ms) ? s.debounce_ms : 50,
      ];
      try {
        const ex = await pool.query('SELECT id FROM irrigation_sectors WHERE device_id=$1 AND numero=$2 LIMIT 1', [deviceId, s.numero]);
        if (ex.rowCount > 0) {
          const sets = cols.map((c, i) => c + '=$' + (i + 3));
          await pool.query(
            'UPDATE irrigation_sectors SET ' + sets.join(', ') + ' WHERE device_id=$1 AND numero=$2',
            [deviceId, s.numero, ...vals]
          );
        } else {
          await pool.query(
            \`INSERT INTO irrigation_sectors (device_id, numero, nome, habilitado, pausado, gpio_rele, nivel_ativo_rele, tipo_botao_fisico, gpio_botao, debounce_ms)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)\`,
            [deviceId, s.numero, ...vals]
          );
        }
        setoresSync++;
      } catch(e) { node.warn('config/current setor ' + s.numero + ': ' + e.message); }
    }
  }

  // 4. Sensores — UPSERT por (device_id, rom_id) + DELETE ausentes (igual v3)
  let sensorsSync = 0, sensorsDel = 0;
  if (Array.isArray(cfg.sensors)) {
    const incomingRoms = [];
    for (const s of cfg.sensors) {
      if (!s || typeof s.rom_id !== 'string' || !s.rom_id) continue;
      if (s.role !== 'pump' && s.role !== 'inverter' && s.role !== 'custom') continue;
      if (!Number.isFinite(Number(s.limite_alarme_c))) continue;
      incomingRoms.push(s.rom_id);
      const nome = (typeof s.nome === 'string' && s.nome.trim()) ? s.nome.trim().slice(0, 96) : 'Sensor';
      const limite = Number(s.limite_alarme_c);
      const histerese = Number.isFinite(Number(s.histerese_c)) ? Number(s.histerese_c) : 5;
      const ack = s.ack_usuario_requerido !== false;
      const ativo = s.ativo !== false;
      try {
        const ex = await pool.query('SELECT id FROM irrigation_temperature_sensors WHERE device_id=$1 AND rom_id=$2 LIMIT 1', [deviceId, s.rom_id]);
        if (ex.rowCount > 0) {
          await pool.query(
            \`UPDATE irrigation_temperature_sensors SET nome=$3, role=$4, limite_alarme_c=$5, histerese_c=$6, ack_usuario_requerido=$7, ativo=$8 WHERE device_id=$1 AND rom_id=$2\`,
            [deviceId, s.rom_id, nome, s.role, limite, histerese, ack, ativo]
          );
        } else {
          await pool.query(
            \`INSERT INTO irrigation_temperature_sensors (device_id, rom_id, nome, role, limite_alarme_c, histerese_c, ack_usuario_requerido, ativo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)\`,
            [deviceId, s.rom_id, nome, s.role, limite, histerese, ack, ativo]
          );
        }
        sensorsSync++;
      } catch(e) { node.warn('config/current sensor ' + s.rom_id + ': ' + e.message); }
    }
    try {
      let delRes;
      if (incomingRoms.length === 0) {
        delRes = await pool.query('DELETE FROM irrigation_temperature_sensors WHERE device_id=$1', [deviceId]);
      } else {
        delRes = await pool.query('DELETE FROM irrigation_temperature_sensors WHERE device_id=$1 AND rom_id <> ALL($2::text[])', [deviceId, incomingRoms]);
      }
      sensorsDel = delRes.rowCount || 0;
    } catch(e) { node.warn('config/current sensors delete: ' + e.message); }
  }

  // 5. Timers — UPSERT por (device_id, id) + DELETE ausentes
  // ESP eh fonte de verdade: se device tem id, usa; se sector_numero presente,
  // mapeia pra alvo_id. ESP que nao quer participar do loop de timers pode
  // omitir cfg.timers; nesse caso NAO tocamos no banco (preserva timers do app).
  let timersSync = 0, timersDel = 0;
  if (Array.isArray(cfg.timers)) {
    // Mapa numero -> sector.id pra resolver alvo_id de timers de setor
    const secMap = await pool.query('SELECT id, numero FROM irrigation_sectors WHERE device_id=$1', [deviceId]);
    const numeroToId = new Map();
    for (const row of secMap.rows) numeroToId.set(row.numero, row.id);

    const incomingIds = [];
    for (const t of cfg.timers) {
      if (!t) continue;
      if (!['pump','sector'].includes(t.alvo_tipo)) continue;
      if (!['fixed','cyclic_window','cyclic_continuous'].includes(t.tipo)) continue;
      if (typeof t.nome !== 'string' || !t.nome.trim()) continue;
      if (!Number.isFinite(t.dias_semana)) continue;
      let alvoId = null;
      if (t.alvo_tipo === 'sector') {
        if (Number.isFinite(t.sector_numero)) alvoId = numeroToId.get(t.sector_numero) || null;
        if (!alvoId) continue; // setor desconhecido — ignora
      }
      const tId = t.id; // pode ser null/undefined → INSERT novo
      const cols = ['alvo_tipo','alvo_id','tipo','nome','ativo','pausado',
                    'hora_inicio','hora_fim','duracao_min','on_minutes','off_minutes',
                    'duracao_s','on_seconds','off_seconds',
                    'dias_semana','observacao'];
      const vals = [
        t.alvo_tipo, alvoId, t.tipo, t.nome.trim().slice(0, 96),
        t.ativo !== false, t.pausado === true,
        t.hora_inicio || null, t.hora_fim || null,
        Number.isFinite(t.duracao_min) ? t.duracao_min : null,
        Number.isFinite(t.on_minutes) ? t.on_minutes : null,
        Number.isFinite(t.off_minutes) ? t.off_minutes : null,
        Number.isFinite(t.duracao_s) ? t.duracao_s : null,
        Number.isFinite(t.on_seconds) ? t.on_seconds : null,
        Number.isFinite(t.off_seconds) ? t.off_seconds : null,
        t.dias_semana,
        (typeof t.observacao === 'string' && t.observacao.trim()) ? t.observacao : null,
      ];
      try {
        if (tId) {
          const ex = await pool.query('SELECT id FROM irrigation_timers WHERE device_id=$1 AND id=$2 LIMIT 1', [deviceId, tId]);
          if (ex.rowCount > 0) {
            const sets = cols.map((c, i) => c + '=$' + (i + 3));
            await pool.query(
              'UPDATE irrigation_timers SET ' + sets.join(', ') + ', atualizado_em=NOW() WHERE device_id=$1 AND id=$2',
              [deviceId, tId, ...vals]
            );
            incomingIds.push(tId);
          } else {
            const r = await pool.query(
              \`INSERT INTO irrigation_timers (id, device_id, alvo_tipo, alvo_id, tipo, nome, ativo, pausado, hora_inicio, hora_fim, duracao_min, on_minutes, off_minutes, duracao_s, on_seconds, off_seconds, dias_semana, observacao)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id\`,
              [tId, deviceId, ...vals]
            );
            incomingIds.push(r.rows[0].id);
          }
        } else {
          const r = await pool.query(
            \`INSERT INTO irrigation_timers (device_id, alvo_tipo, alvo_id, tipo, nome, ativo, pausado, hora_inicio, hora_fim, duracao_min, on_minutes, off_minutes, duracao_s, on_seconds, off_seconds, dias_semana, observacao)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id\`,
            [deviceId, ...vals]
          );
          incomingIds.push(r.rows[0].id);
        }
        timersSync++;
      } catch(e) { node.warn('config/current timer: ' + e.message); }
    }
    try {
      let delRes;
      if (incomingIds.length === 0) {
        delRes = await pool.query('DELETE FROM irrigation_timers WHERE device_id=$1', [deviceId]);
      } else {
        delRes = await pool.query('DELETE FROM irrigation_timers WHERE device_id=$1 AND id <> ALL($2::uuid[])', [deviceId, incomingIds]);
      }
      timersDel = delRes.rowCount || 0;
    } catch(e) { node.warn('config/current timers delete: ' + e.message); }
  }

  const parts2 = [];
  if (setoresSync > 0) parts2.push(setoresSync+'s');
  if (sensorsSync > 0) parts2.push(sensorsSync+'sn');
  if (sensorsDel > 0) parts2.push('-'+sensorsDel+'sn');
  if (timersSync > 0) parts2.push(timersSync+'t');
  if (timersDel > 0) parts2.push('-'+timersDel+'t');
  const txt = parts2.length === 0 ? 'pinout ok' : parts2.join(' ');
  node.status({fill:'green',shape:'dot',text: mqttUser+' '+txt});
} catch(e) {
  node.error('config/current merge: '+e.message);
  node.status({fill:'red',shape:'ring',text:'erro: '+e.message});
}
return null;
`;

// =====================================================================

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

  // Idempotencia
  const already = flows.filter(n =>
    n && n.type === 'function' && typeof n.func === 'string' && n.func.includes(MARKER)
  );
  if (already.length > 0) {
    console.log('Ja aplicado (' + already.length + ' func node(s) com marker "' + MARKER + '"). Saindo.');
    process.exit(0);
  }

  // Pre-requisitos
  if (!flows.some(n => n && n.id === 'mqttOutConfigPush')) {
    console.error('mqttOutConfigPush nao encontrado. Rode _e053 primeiro.');
    process.exit(2);
  }

  const targets = [
    { id: 'fnIrrPatchConfig',   func: FN_PATCH_CONFIG,   wires: [['respIrrPatchConfig'],   ['mqttOutConfigPush']], out: 2 },
    { id: 'fnIrrPatchSector',   func: FN_PATCH_SECTOR,   wires: [['respIrrPatchSector'],   ['mqttOutConfigPush']], out: 2 },
    { id: 'fnIrrCreateSensor',  func: FN_CREATE_SENSOR,  wires: [['respIrrCreateSensor'],  ['mqttOutConfigPush']], out: 2 },
    { id: 'fnIrrPatchSensor',   func: FN_PATCH_SENSOR,   wires: [['respIrrPatchSensor'],   ['mqttOutConfigPush']], out: 2 },
    { id: 'fnIrrDeleteSensor',  func: FN_DELETE_SENSOR,  wires: [['respIrrDeleteSensor'],  ['mqttOutConfigPush']], out: 2 },
    { id: 'fnIrrPostTimer',     func: FN_POST_TIMER,     wires: [['respIrrPostTimer'],     ['mqttOutConfigPush']], out: 2 },
    { id: 'fnIrrPatchTimer',    func: FN_PATCH_TIMER,    wires: [['respIrrPatchTimer'],    ['mqttOutConfigPush']], out: 2 },
    { id: 'fnIrrDeleteTimer',   func: FN_DELETE_TIMER,   wires: [['respIrrDeleteTimer'],   ['mqttOutConfigPush']], out: 2 },
  ];
  for (const t of targets) {
    const n = flows.find(x => x && x.id === t.id);
    if (!n) { console.error('Faltando node: ' + t.id); process.exit(2); }
  }

  // Handler config/current — aceita marker antigo (v2/v3) ou versão anterior do
  // próprio _e056 (config/current handler usa mesmo MARKER do resto do flow).
  const handlerCurrent = flows.find(n =>
    n && n.type === 'function' && typeof n.func === 'string' &&
    (n.func.includes('ESP CONFIG SYNC v3') ||
     n.func.includes('ESP CONFIG SYNC v2') ||
     (typeof n.name === 'string' && n.name.includes('config/current sync')))
  );
  if (!handlerCurrent) {
    console.error('Handler config/current nao encontrado. Rode _e052/_e052b primeiro.');
    process.exit(2);
  }

  // Backup
  if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });
  const bkp = path.join(BACKUPS, 'flows-pre-e056-' + ts() + '.json');
  fs.writeFileSync(bkp, raw, 'utf8');
  console.log('Backup salvo em ' + bkp);

  for (const t of targets) {
    const n = flows.find(x => x && x.id === t.id);
    n.func = t.func;
    n.outputs = t.out;
    n.wires = t.wires;
    console.log('  patch ' + t.id + ' (outputs=' + t.out + ')');
  }
  handlerCurrent.func = FN_CONFIG_CURRENT;
  handlerCurrent.name = 'config/current sync (full v5)';
  console.log('  patch handler config/current id=' + handlerCurrent.id);

  const tmp = FLOWS + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(flows, null, 4) + '\n', 'utf8');
  fs.renameSync(tmp, FLOWS);
  console.log('flows.json atualizado.');
  console.log('Proximo passo: sudo docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
}

main();
