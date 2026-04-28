#!/usr/bin/env node
// E5.3b — Estende buildConfigPushMsg pra incluir sensors[] no payload de
// devices/<serial>/config/push retained. Sem essa extensao, sensores criados
// via app por PATCH /sensores nao chegariam ao ESP — o config/push so teria
// bomba+sectors, e o ESP ficaria sem saber dos sensores configurados.
//
// Como modifica:
//   1. Backup de flows.json em backups/flows-pre-e053b-<timestamp>.json
//   2. Substitui o func de fnIrrPatchConfig e fnIrrPatchSector pra a versao
//      "CONFIG PUSH v2" (igual a v1 + sensors[] no buildConfigPushMsg).
//   3. Salva flows.json atomico.
//
// Pre-requisito: _e053 (CONFIG PUSH v1) deve ter rodado antes.
//
// Idempotencia: marker "CONFIG PUSH v2" — segunda execucao sai sem mudancas.

'use strict';

const fs = require('fs');
const path = require('path');

const FLOWS = '/opt/xtconect/nodered/data/flows.json';
const BACKUPS = '/opt/xtconect/backups';
const MARKER_OLD = 'CONFIG PUSH v1';
const MARKER_NEW = 'CONFIG PUSH v2';

// Helper compartilhado pelos funcs — busca config + sectors + sensors do
// banco e monta o payload de config/push.
const BUILD_PUSH_FN = `
async function buildConfigPushMsg(pool, deviceUuid) {
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
}
`;

const NEW_FUNC_PATCH_CONFIG = `// ${MARKER_NEW}
const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return [msg, null]; }
async function checkDeviceAccess(pool, deviceId, user) {
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
}
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
}
`;

const NEW_FUNC_PATCH_SECTOR = `// ${MARKER_NEW}
const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return [msg, null]; }
async function checkDeviceAccess(pool, deviceId, user) {
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
}
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
}
`;

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
  const alreadyV2 = flows.filter(n =>
    n && n.type === 'function' && typeof n.func === 'string' && n.func.includes(MARKER_NEW)
  );
  if (alreadyV2.length > 0) {
    console.log('Ja aplicado (' + alreadyV2.length + ' func node(s) com marker "' + MARKER_NEW + '"). Saindo.');
    process.exit(0);
  }

  // Detecta v1 (instalado por _e053)
  const hasV1 = flows.some(n =>
    n && n.type === 'function' && typeof n.func === 'string' && n.func.includes(MARKER_OLD)
  );
  if (!hasV1) {
    console.error('Nao encontrei marker "' + MARKER_OLD + '". Rode _e053_publish_config_push.cjs primeiro.');
    process.exit(2);
  }

  const fnConfig = flows.find(n => n && n.id === 'fnIrrPatchConfig');
  const fnSector = flows.find(n => n && n.id === 'fnIrrPatchSector');
  if (!fnConfig || !fnSector) {
    console.error('Nao achei fnIrrPatchConfig ou fnIrrPatchSector.');
    process.exit(2);
  }

  // Backup
  if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });
  const bkp = path.join(BACKUPS, 'flows-pre-e053b-' + ts() + '.json');
  fs.writeFileSync(bkp, raw, 'utf8');
  console.log('Backup salvo em ' + bkp);

  fnConfig.func = NEW_FUNC_PATCH_CONFIG;
  fnSector.func = NEW_FUNC_PATCH_SECTOR;

  // Salva atomicamente
  const tmp = FLOWS + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(flows, null, 4) + '\n', 'utf8');
  fs.renameSync(tmp, FLOWS);
  console.log('flows.json atualizado.');
  console.log('Proximo passo: sudo docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
}

main();
