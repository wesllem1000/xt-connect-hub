#!/usr/bin/env node
// E5.3 — Após PATCH /config ou PATCH /setores no Node-RED, publicar a config
// completa em devices/<serial>/config/push retained pra que o ESP receba a
// mudança. Fecha o loop entre app e dispositivo (ESP é fonte de verdade,
// mas aceita updates server→device via push retained).
//
// Como modifica:
//   1. Localiza fnIrrPatchConfig e fnIrrPatchSector pelos IDs (estáveis no
//      flows.json desde _e041) e substitui o func deles por uma versão
//      estendida que, em sucesso, lê banco completo e retorna
//      [respMsg, mqttPushMsg]. outputs muda de 1 para 2.
//   2. Adiciona segundo wire em cada node apontando pra mqttOutConfigPush.
//   3. Cria mqttOutConfigPush se não existir (mqtt-out com tópico dinâmico
//      via msg.topic, retain=true, qos=1, broker=brokerMosq).
//   4. Idempotência: marcador "CONFIG PUSH v1" no func — segunda execução
//      sai sem mudanças.
//
// Após rodar: restart Node-RED.

'use strict';

const fs = require('fs');
const path = require('path');

const FLOWS = '/opt/xtconect/nodered/data/flows.json';
const BACKUPS = '/opt/xtconect/backups';
const MARKER = 'CONFIG PUSH v1';

// Helper compartilhado pelos 2 funcs — busca config + sectors do banco
// e monta o payload de config/push. Retorna {topic, payload} ou null se
// device não tem serial/config (não impede a resposta HTTP).
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
    };
    return { topic: 'devices/' + serial + '/config/push', payload: JSON.stringify(payload), qos: 1, retain: true };
  } catch(e) {
    node.warn('buildConfigPushMsg: ' + e.message);
    return null;
  }
}
`;

const NEW_FUNC_PATCH_CONFIG = `// ${MARKER}
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
  // Sucesso: publica config/push retained pra notificar o ESP
  const pushMsg = await buildConfigPushMsg(pool, device.id);
  return [msg, pushMsg];
} catch(e) {
  if (/check constraint|violates/i.test(e.message)) {
    msg.statusCode=422; msg.payload={error:'valor invalido', detail:e.message};
  } else { node.error('patch config: '+e.message, msg); msg.statusCode=500; msg.payload={error:'internal'}; }
  return [msg, null];
}
`;

const NEW_FUNC_PATCH_SECTOR = `// ${MARKER}
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
// gpio_rele e numero NÃO editáveis: firmware é autoridade do pinout (R6)
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
  // Sucesso: publica config/push retained pra notificar o ESP
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
    console.error('flows.json não encontrado em', FLOWS);
    process.exit(2);
  }
  const raw = fs.readFileSync(FLOWS, 'utf8');
  const flows = JSON.parse(raw);

  // Idempotência
  const already = flows.filter(n =>
    n && n.type === 'function' && typeof n.func === 'string' && n.func.includes(MARKER)
  );
  if (already.length > 0) {
    console.log('Já aplicado (' + already.length + ' func node(s) com marker "' + MARKER + '"). Saindo.');
    process.exit(0);
  }

  const fnConfig = flows.find(n => n && n.id === 'fnIrrPatchConfig');
  const fnSector = flows.find(n => n && n.id === 'fnIrrPatchSector');
  if (!fnConfig || !fnSector) {
    console.error('Não achei fnIrrPatchConfig ou fnIrrPatchSector — flows.json fora do esperado');
    process.exit(2);
  }
  console.log('Encontrados: fnIrrPatchConfig, fnIrrPatchSector');

  // Encontra/cria o mqtt-out
  const MQTT_OUT_ID = 'mqttOutConfigPush';
  let mqttOut = flows.find(n => n && n.id === MQTT_OUT_ID);
  if (!mqttOut) {
    mqttOut = {
      id: MQTT_OUT_ID,
      type: 'mqtt out',
      z: fnConfig.z, // mesma tab dos fns (tabAuth)
      name: 'mqtt out config/push',
      topic: '', // dinâmico via msg.topic
      qos: '1',
      retain: 'true',
      respTopic: '',
      contentType: '',
      userProps: '',
      correl: '',
      expiry: '',
      broker: 'brokerMosq',
      x: 1180,
      y: 4850,
      wires: [],
    };
    flows.push(mqttOut);
    console.log('Adicionado mqtt-out node: ' + MQTT_OUT_ID);
  } else {
    console.log('mqtt-out node já existe: ' + MQTT_OUT_ID);
  }

  // Backup
  if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });
  const bkp = path.join(BACKUPS, 'flows-pre-e053-' + ts() + '.json');
  fs.writeFileSync(bkp, raw, 'utf8');
  console.log('Backup salvo em ' + bkp);

  // Patch fnIrrPatchConfig
  fnConfig.func = NEW_FUNC_PATCH_CONFIG;
  fnConfig.outputs = 2;
  fnConfig.wires = [['respIrrPatchConfig'], [MQTT_OUT_ID]];

  // Patch fnIrrPatchSector
  fnSector.func = NEW_FUNC_PATCH_SECTOR;
  fnSector.outputs = 2;
  fnSector.wires = [['respIrrPatchSector'], [MQTT_OUT_ID]];

  // Salva atomicamente
  const tmp = FLOWS + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(flows, null, 4) + '\n', 'utf8');
  fs.renameSync(tmp, FLOWS);
  console.log('flows.json atualizado.');
  console.log('Próximo passo: sudo docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
}

main();
