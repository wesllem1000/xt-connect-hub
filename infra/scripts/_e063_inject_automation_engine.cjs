#!/usr/bin/env node
// E5.12 — Motor de regras de automacao + endpoints CRUD.
//
// Como modifica:
//   1. Atualiza fnIrrAlarmLifecycle pra chamar runAutomationRules apos
//      INSERT em irrigation_alarms (trigger='irrigation_alarm_created').
//      Output 2 ja existe — passa a emitir mqttMessages quando regras
//      tem acao publish_command.
//   2. Adiciona endpoints CRUD:
//        GET    /api/automacoes
//        POST   /api/automacoes
//        GET    /api/automacoes/:id
//        PATCH  /api/automacoes/:id
//        DELETE /api/automacoes/:id
//        POST   /api/automacoes/:id/run    (manual)
//        GET    /api/automacoes/:id/execucoes
//
// Idempotencia: detecta presenca de "httpAutomationsList" e sai.
// Pre-req: migration 019 aplicada. _e057, _e058 ja rodaram.

'use strict';

const fs = require('fs');
const path = require('path');
const FLOWS = '/opt/xtconect/nodered/data/flows.json';
const BACKUPS = '/opt/xtconect/backups';
const MARKER_NODE_ID = 'httpAutomationsList';
const MARKER_LIFECYCLE = 'AUTOMATION ENGINE v1';

// =============================================================
// Engine (executado dentro do fnIrrAlarmLifecycle como helper)
// =============================================================
const ENGINE_HELPER = `
async function runAutomationRules(pool, triggerType, deviceId, deviceRow, payload) {
  const out = { results: [], mqttMessages: [] };
  let rules;
  try {
    rules = await pool.query(
      \`SELECT * FROM automation_rules
        WHERE ativo = TRUE
          AND trigger_type = $1
          AND (device_id IS NULL OR device_id = $2)
        ORDER BY criado_em ASC\`,
      [triggerType, deviceId]
    );
  } catch(e) { node.warn('automation rules query: ' + e.message); return out; }

  for (const rule of rules.rows) {
    // Filtra por trigger_params (matching parcial, MVP)
    if (rule.trigger_params) {
      let allMatch = true;
      for (const k of Object.keys(rule.trigger_params)) {
        if (rule.trigger_params[k] !== undefined && payload && payload[k] !== rule.trigger_params[k]) {
          allMatch = false; break;
        }
      }
      if (!allMatch) continue;
    }

    // Cooldown
    if (rule.cooldown_minutes > 0 && rule.last_fired_at) {
      const cooldownMs = rule.cooldown_minutes * 60 * 1000;
      const since = Date.now() - new Date(rule.last_fired_at).getTime();
      if (since < cooldownMs) {
        await pool.query(
          \`INSERT INTO automation_executions (rule_id, trigger_payload, status, acoes_executadas)
           VALUES ($1, $2::jsonb, 'skipped_cooldown', '[]'::jsonb)\`,
          [rule.id, JSON.stringify(payload || {})]
        );
        continue;
      }
    }

    // Executa acoes
    const acoesExecutadas = [];
    let allOk = true;
    for (const action of (Array.isArray(rule.acoes) ? rule.acoes : [])) {
      try {
        if (action.type === 'send_email') {
          const recipients = Array.isArray(action.params && action.params.recipients) ? action.params.recipients : [];
          const subject = (action.params && action.params.subject) || ('[XT Connect] Automacao: ' + (rule.nome || ''));
          const bodyText = (action.params && action.params.body_text)
            || ('Regra "' + rule.nome + '" disparada. Trigger: ' + triggerType + '. Payload: ' + JSON.stringify(payload || {}));
          const dedupBase = 'rule:' + rule.id + ':' + Date.now();
          for (let idx = 0; idx < recipients.length; idx++) {
            const email = String(recipients[idx]).toLowerCase().trim();
            if (!email) continue;
            // Tenta resolver user_id pelo email (se existir); senao usa owner da regra
            const u = await pool.query('SELECT id FROM app_users WHERE email = $1 LIMIT 1', [email]);
            const userId = u.rowCount > 0 ? u.rows[0].id : rule.owner_user_id;
            try {
              await pool.query(
                \`INSERT INTO notification_outbox
                   (user_id, dest_email, category, severity, subject, template_name, template_vars, body_text, dedup_key, status)
                 VALUES ($1, $2, 'automation', 'warning', $3, NULL, '{}'::jsonb, $4, $5, 'pending')
                 ON CONFLICT (user_id, dedup_key, status) DO NOTHING\`,
                [userId, email, subject, bodyText, dedupBase + ':' + idx]
              );
            } catch(e) { node.warn('automation send_email enqueue: ' + e.message); }
          }
          acoesExecutadas.push({ type: 'send_email', ok: true, count: recipients.length });
        } else if (action.type === 'publish_command') {
          if (!deviceRow || !deviceRow.serial) {
            acoesExecutadas.push({ type: 'publish_command', ok: false, error: 'device serial nao disponivel' });
            allOk = false;
            continue;
          }
          const cmd = (action.params && action.params.cmd) || null;
          const allowed = ['pump_off','safe_closure','sector_open','sector_close','sector_pause','sector_resume','mode_set'];
          if (!allowed.includes(cmd)) {
            acoesExecutadas.push({ type: 'publish_command', ok: false, error: 'cmd nao permitido em automacao: ' + cmd });
            allOk = false;
            continue;
          }
          out.mqttMessages.push({
            topic: 'devices/' + deviceRow.serial + '/commands',
            payload: JSON.stringify({
              cmd_id: crypto.randomUUID(),
              protocol_version: 1,
              cmd: cmd,
              params: (action.params && action.params.params) || {},
              issued_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 30000).toISOString(),
              origin: 'automation',
              rule_id: rule.id,
            }),
            qos: 1, retain: false,
          });
          acoesExecutadas.push({ type: 'publish_command', ok: true, cmd: cmd });
        } else {
          acoesExecutadas.push({ type: action.type, ok: false, error: 'tipo de acao desconhecido' });
          allOk = false;
        }
      } catch(e) {
        acoesExecutadas.push({ type: action && action.type, ok: false, error: e.message });
        allOk = false;
      }
    }

    // Update last_fired + log
    const status = allOk ? 'success' : (acoesExecutadas.some(a => a.ok) ? 'partial' : 'failed');
    try {
      await pool.query(
        'UPDATE automation_rules SET last_fired_at = NOW(), last_status = $2 WHERE id = $1',
        [rule.id, status]
      );
      await pool.query(
        \`INSERT INTO automation_executions (rule_id, trigger_payload, status, acoes_executadas)
         VALUES ($1, $2::jsonb, $3, $4::jsonb)\`,
        [rule.id, JSON.stringify(payload || {}), status, JSON.stringify(acoesExecutadas)]
      );
    } catch(e) { node.warn('automation log: ' + e.message); }

    out.results.push({ rule_id: rule.id, status });
  }
  return out;
}
`;

// =============================================================
// fnIrrAlarmLifecycle v4 — agora chama o engine
// =============================================================
const LIFECYCLE_FUNC_V4 = `// ${MARKER_LIFECYCLE} — alarm lifecycle + outbox enqueue + automation engine
const pool = global.get('pgPool');
if (!pool) return [null, null];
const parts = (msg.topic || '').split('/');
if (parts.length !== 3 || parts[0] !== 'devices' || parts[2] !== 'events') return [null, null];
const mqttUser = parts[1];

let ev = null;
try {
  const raw = Buffer.isBuffer(msg.payload) ? msg.payload.toString('utf8') :
              (typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload));
  ev = JSON.parse(raw);
  if (!ev || typeof ev !== 'object') return [null, null];
} catch(e) { return [null, null]; }
const t = ev.event_type;
if (t !== 'temp_alarm_triggered' &&
    t !== 'temp_alarm_resolved' &&
    t !== 'temp_alarm_ack_user' &&
    t !== 'temp_sensor_lost') return [null, null];

const payload = ev.payload || ev.payload_json || {};
const romId = payload.rom_id || null;

async function enqueueAlarmEmails(alarmRow, deviceRow) {
  const rs = await pool.query(
    \`SELECT au.id, au.email, COALESCE(NULLIF(au.full_name,''), au.email) AS name
       FROM app_users au
       JOIN devices d ON d.user_id = au.id
       WHERE d.id = $1
     UNION
     SELECT au.id, au.email, COALESCE(NULLIF(au.full_name,''), au.email) AS name
       FROM dispositivo_compartilhado s
       JOIN app_users au ON au.id = s.com_usuario_id
       WHERE s.dispositivo_id = $1 AND s.status = 'ativo'\`,
    [deviceRow.id]
  );
  if (rs.rowCount === 0) return;
  const baseUrl = global.get('mailBaseUrl') || env.get('MAIL_BASE_URL') || 'https://hub.xtconect.online';
  const tipoLabel = alarmRow.tipo === 'temperature_high' ? 'Temperatura alta'
                  : alarmRow.tipo === 'sensor_missing' ? 'Sensor de temperatura perdido'
                  : alarmRow.tipo;
  const triggeredFmt = new Date(alarmRow.triggered_at).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'});
  const subject = '[XT Connect] Alarme em ' + (deviceRow.nome_amigavel || deviceRow.serial) + ' — ' + tipoLabel;
  const dedupKey = 'alarm:' + alarmRow.id;
  for (const u of rs.rows) {
    const vars = {
      user_name: u.name, device_name: deviceRow.nome_amigavel || deviceRow.serial,
      device_serial: deviceRow.serial, tipo_label: tipoLabel,
      message: alarmRow.message, triggered_at: triggeredFmt,
      link: baseUrl + '/dispositivos/' + deviceRow.id,
    };
    const bodyText = subject + '\\n\\n' + alarmRow.message + '\\n\\nAcesse: ' + vars.link;
    try {
      await pool.query(
        \`INSERT INTO notification_outbox
           (user_id, dest_email, category, severity, subject, template_name, template_vars, body_text, dedup_key, status)
         VALUES ($1, $2, 'irrigation_alarm', 'critical', $3, 'irrigation-alarm', $4::jsonb, $5, $6, 'pending')
         ON CONFLICT (user_id, dedup_key, status) DO NOTHING\`,
        [u.id, u.email, subject, JSON.stringify(vars), bodyText, dedupKey]
      );
    } catch(e) { node.warn('outbox enqueue fail u=' + u.id + ': ' + e.message); }
  }
}

${ENGINE_HELPER}

let mqttMessages = [];

try {
  const dev = await pool.query(
    \`SELECT id, device_id AS serial, COALESCE(NULLIF(nome_amigavel,''), name, device_id) AS nome_amigavel
       FROM devices WHERE mqtt_username=$1\`,
    [mqttUser]
  );
  if (dev.rowCount === 0) return [null, null];
  const deviceRow = dev.rows[0];
  const deviceId = deviceRow.id;

  if (t === 'temp_alarm_triggered') {
    const exists = await pool.query(
      \`SELECT id FROM irrigation_alarms
        WHERE device_id=$1 AND tipo='temperature_high'
          AND sensor_rom_id IS NOT DISTINCT FROM $2
          AND resolved_at IS NULL LIMIT 1\`,
      [deviceId, romId]
    );
    if (exists.rowCount > 0) {
      node.status({fill:'yellow',shape:'ring',text: mqttUser+' alarm dup ignorado'});
      return [null, null];
    }
    const tempC = (typeof payload.temp_c === 'number') ? payload.temp_c : null;
    const limiteC = (typeof payload.limite_c === 'number') ? payload.limite_c : null;
    const nome = payload.nome || ('Sensor ' + (romId || ''));
    const message = 'Temperatura ' +
      (tempC != null ? tempC.toFixed(1) + '°C' : '?') +
      ' acima de ' + (limiteC != null ? limiteC.toFixed(1) + '°C' : '?') +
      ' (' + nome + ')';
    const ins = await pool.query(
      \`INSERT INTO irrigation_alarms (device_id, tipo, sensor_rom_id, message, triggered_at, payload_json)
       VALUES ($1, 'temperature_high', $2, $3, $4, $5::jsonb)
       RETURNING *\`,
      [deviceId, romId, message, ev.ts || new Date(), JSON.stringify(payload)]
    );
    node.status({fill:'red',shape:'dot',text: mqttUser+' alarm criado'});
    await enqueueAlarmEmails(ins.rows[0], deviceRow);

    // Engine: trigger irrigation_alarm_created
    try {
      const automPayload = {
        alarm_id: ins.rows[0].id,
        alarm_tipo: ins.rows[0].tipo,
        device_id: deviceId,
        device_serial: deviceRow.serial,
        sensor_rom_id: romId,
        temp_c: tempC, limite_c: limiteC, message: message,
      };
      const eng = await runAutomationRules(pool, 'irrigation_alarm_created', deviceId, deviceRow, automPayload);
      if (eng.mqttMessages && eng.mqttMessages.length > 0) {
        mqttMessages = mqttMessages.concat(eng.mqttMessages);
      }
      if (eng.results.length > 0) node.log('automation: ' + eng.results.length + ' regra(s) avaliada(s)');
    } catch(e) { node.warn('automation engine: ' + e.message); }
  } else if (t === 'temp_alarm_resolved') {
    node.status({fill:'blue',shape:'ring',text: mqttUser+' resolved ignorado (ack only)'});
  } else if (t === 'temp_alarm_ack_user') {
    const r = await pool.query(
      \`UPDATE irrigation_alarms
          SET acked_at = COALESCE(acked_at, NOW()), resolved_at = NOW()
        WHERE device_id=$1 AND tipo='temperature_high'
          AND sensor_rom_id IS NOT DISTINCT FROM $2
          AND resolved_at IS NULL
        RETURNING id\`,
      [deviceId, romId]
    );
    if (r.rowCount > 0) node.status({fill:'green',shape:'dot',text: mqttUser+' ack '+r.rowCount+' resolvido'});
  } else if (t === 'temp_sensor_lost') {
    const exists = await pool.query(
      \`SELECT id FROM irrigation_alarms
        WHERE device_id=$1 AND tipo='sensor_missing'
          AND sensor_rom_id IS NOT DISTINCT FROM $2
          AND resolved_at IS NULL LIMIT 1\`,
      [deviceId, romId]
    );
    if (exists.rowCount === 0) {
      const ins = await pool.query(
        \`INSERT INTO irrigation_alarms (device_id, tipo, sensor_rom_id, message, triggered_at, payload_json)
         VALUES ($1, 'sensor_missing', $2, $3, $4, $5::jsonb)
         RETURNING *\`,
        [deviceId, romId, 'Sensor de temperatura perdeu comunicação (' + (romId || '?') + ')',
         ev.ts || new Date(), JSON.stringify(payload)]
      );
      await enqueueAlarmEmails(ins.rows[0], deviceRow);
    }
  }
} catch(e) { node.error('alarm lifecycle: '+e.message); }

return [null, mqttMessages.length > 0 ? mqttMessages : null];
`;

// =============================================================
// CRUD endpoints helpers
// =============================================================
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

const FN_LIST = `const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }
try {
  const isAdmin = msg.user.role === 'admin';
  const r = await pool.query(
    isAdmin
      ? \`SELECT r.*, d.device_id AS device_serial, COALESCE(NULLIF(d.nome_amigavel,''), d.name, d.device_id) AS device_nome
           FROM automation_rules r LEFT JOIN devices d ON d.id = r.device_id
          ORDER BY r.criado_em DESC\`
      : \`SELECT r.*, d.device_id AS device_serial, COALESCE(NULLIF(d.nome_amigavel,''), d.name, d.device_id) AS device_nome
           FROM automation_rules r LEFT JOIN devices d ON d.id = r.device_id
          WHERE r.owner_user_id = $1 ORDER BY r.criado_em DESC\`,
    isAdmin ? [] : [msg.user.id]
  );
  msg.statusCode = 200;
  msg.payload = { regras: r.rows };
} catch(e) {
  node.error('automacoes list: ' + e.message, msg);
  msg.statusCode = 500; msg.payload = { error: 'internal' };
}
return msg;`;

const FN_CREATE = `const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }
const body = msg.payload || {};
const nome = (typeof body.nome === 'string' && body.nome.trim()) ? body.nome.trim().slice(0, 96) : null;
const triggerType = body.trigger_type;
const VALID_TRIGGERS = ['irrigation_alarm_created','device_offline','manual'];
const triggerParams = body.trigger_params && typeof body.trigger_params === 'object' ? body.trigger_params : {};
const condicoes = Array.isArray(body.condicoes) ? body.condicoes : [];
const acoes = Array.isArray(body.acoes) ? body.acoes : [];
const cooldown = Number.isFinite(body.cooldown_minutes) ? Math.max(0, Math.min(10080, body.cooldown_minutes)) : 0;
const ativo = body.ativo !== false;
const deviceId = body.device_id || null;
const descricao = (typeof body.descricao === 'string' && body.descricao.trim()) ? body.descricao.trim() : null;

if (!nome) { msg.statusCode=400; msg.payload={error:'nome obrigatorio'}; return msg; }
if (!VALID_TRIGGERS.includes(triggerType)) { msg.statusCode=400; msg.payload={error:'trigger_type invalido'}; return msg; }
if (acoes.length === 0) { msg.statusCode=400; msg.payload={error:'pelo menos uma acao obrigatoria'}; return msg; }
for (const a of acoes) {
  if (!a || (a.type !== 'send_email' && a.type !== 'publish_command')) {
    msg.statusCode=400; msg.payload={error:'acao type invalido — use send_email|publish_command'}; return msg;
  }
}
try {
  // Se device_id fornecido, valida acesso
  if (deviceId) {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(deviceId)) { msg.statusCode=400; msg.payload={error:'device_id invalido'}; return msg; }
    const isAdmin = msg.user.role === 'admin';
    const d = await pool.query('SELECT user_id FROM devices WHERE id = $1', [deviceId]);
    if (d.rowCount === 0) { msg.statusCode=404; msg.payload={error:'device nao encontrado'}; return msg; }
    if (!isAdmin && d.rows[0].user_id !== msg.user.id) {
      msg.statusCode=403; msg.payload={error:'sem acesso ao device'}; return msg;
    }
  }
  const r = await pool.query(
    \`INSERT INTO automation_rules
       (owner_user_id, device_id, nome, descricao, ativo, trigger_type, trigger_params, condicoes, acoes, cooldown_minutes)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10)
     RETURNING *\`,
    [msg.user.id, deviceId, nome, descricao, ativo, triggerType,
     JSON.stringify(triggerParams), JSON.stringify(condicoes), JSON.stringify(acoes), cooldown]
  );
  msg.statusCode = 201;
  msg.payload = { regra: r.rows[0] };
} catch(e) {
  if (/check constraint|violates/i.test(e.message)) {
    msg.statusCode=422; msg.payload={error:'valor invalido', detail: e.message};
  } else { node.error('automacao create: ' + e.message, msg); msg.statusCode=500; msg.payload={error:'internal'}; }
}
return msg;`;

const FN_PATCH = `const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }
const id = msg.req.params.id;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(id)) { msg.statusCode=400; msg.payload={error:'id invalido'}; return msg; }
const body = msg.payload || {};
const ALLOWED = ['nome','descricao','ativo','trigger_type','trigger_params','condicoes','acoes','cooldown_minutes','device_id'];
const sets = []; const params = [];
let idx = 0;
for (const k of Object.keys(body)) {
  if (!ALLOWED.includes(k)) continue;
  let v = body[k];
  if (k === 'trigger_params' || k === 'condicoes' || k === 'acoes') v = JSON.stringify(v || (k === 'trigger_params' ? {} : []));
  idx++; params.push(v);
  if (k === 'trigger_params' || k === 'condicoes' || k === 'acoes') sets.push(k + '=$' + idx + '::jsonb');
  else sets.push(k + '=$' + idx);
}
if (sets.length === 0) { msg.statusCode=400; msg.payload={error:'nada pra atualizar'}; return msg; }
try {
  const isAdmin = msg.user.role === 'admin';
  // Verifica ownership
  const own = await pool.query('SELECT owner_user_id FROM automation_rules WHERE id = $1', [id]);
  if (own.rowCount === 0) { msg.statusCode=404; msg.payload={error:'nao encontrado'}; return msg; }
  if (!isAdmin && own.rows[0].owner_user_id !== msg.user.id) {
    msg.statusCode=403; msg.payload={error:'sem acesso'}; return msg;
  }
  idx++; params.push(id);
  const sql = 'UPDATE automation_rules SET ' + sets.join(', ') + ' WHERE id = $' + idx + ' RETURNING *';
  const r = await pool.query(sql, params);
  msg.statusCode=200; msg.payload = { regra: r.rows[0] };
} catch(e) {
  if (/check constraint|violates/i.test(e.message)) {
    msg.statusCode=422; msg.payload={error:'valor invalido', detail: e.message};
  } else { node.error('automacao patch: ' + e.message, msg); msg.statusCode=500; msg.payload={error:'internal'}; }
}
return msg;`;

const FN_DELETE = `const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }
const id = msg.req.params.id;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(id)) { msg.statusCode=400; msg.payload={error:'id invalido'}; return msg; }
try {
  const isAdmin = msg.user.role === 'admin';
  const filter = isAdmin ? 'id = $1' : 'id = $1 AND owner_user_id = $2';
  const ps = isAdmin ? [id] : [id, msg.user.id];
  const r = await pool.query('DELETE FROM automation_rules WHERE ' + filter + ' RETURNING id', ps);
  if (r.rowCount === 0) { msg.statusCode=404; msg.payload={error:'nao encontrado'}; return msg; }
  msg.statusCode=200; msg.payload = { ok: true, id: r.rows[0].id };
} catch(e) {
  node.error('automacao delete: ' + e.message, msg);
  msg.statusCode=500; msg.payload={error:'internal'};
}
return msg;`;

const FN_EXEC_LIST = `const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }
const id = msg.req.params.id;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(id)) { msg.statusCode=400; msg.payload={error:'id invalido'}; return msg; }
try {
  const isAdmin = msg.user.role === 'admin';
  const ownQ = await pool.query('SELECT owner_user_id FROM automation_rules WHERE id = $1', [id]);
  if (ownQ.rowCount === 0) { msg.statusCode=404; msg.payload={error:'nao encontrado'}; return msg; }
  if (!isAdmin && ownQ.rows[0].owner_user_id !== msg.user.id) {
    msg.statusCode=403; msg.payload={error:'sem acesso'}; return msg;
  }
  const r = await pool.query(
    'SELECT * FROM automation_executions WHERE rule_id = $1 ORDER BY triggered_at DESC LIMIT 50',
    [id]
  );
  msg.statusCode = 200;
  msg.payload = { execucoes: r.rows };
} catch(e) {
  node.error('automacao executions: ' + e.message, msg);
  msg.statusCode=500; msg.payload={error:'internal'};
}
return msg;`;

// Endpoint config — array de objetos pra criar nodes
const ENDPOINTS = [
  { method: 'get',    url: '/api/automacoes',                   baseId: 'AutomationsList',     label: 'GET /api/automacoes',      func: FN_LIST,      y: 5400 },
  { method: 'post',   url: '/api/automacoes',                   baseId: 'AutomationsCreate',   label: 'POST /api/automacoes',     func: FN_CREATE,    y: 5500 },
  { method: 'patch',  url: '/api/automacoes/:id',               baseId: 'AutomationsPatch',    label: 'PATCH /api/automacoes/:id', func: FN_PATCH,    y: 5600 },
  { method: 'delete', url: '/api/automacoes/:id',               baseId: 'AutomationsDelete',   label: 'DELETE /api/automacoes/:id', func: FN_DELETE,  y: 5700 },
  { method: 'get',    url: '/api/automacoes/:id/execucoes',     baseId: 'AutomationsExecs',    label: 'GET /api/automacoes/:id/execucoes', func: FN_EXEC_LIST, y: 5800 },
];

function makeEndpointNodes({ method, url, baseId, label, func, y }) {
  return [
    {
      id: 'http' + baseId, type: 'http in', z: 'tabAuth',
      name: method.toUpperCase() + ' ' + url, url, method,
      upload: false, swaggerDoc: '', x: 200, y,
      wires: [['fnAuth' + baseId]],
    },
    {
      id: 'fnAuth' + baseId, type: 'function', z: 'tabAuth',
      name: 'Auth JWT', func: AUTH_FUNC, outputs: 2,
      libs: [{ var: 'jwt', module: 'jsonwebtoken' }],
      x: 440, y,
      wires: [['fn' + baseId], ['resp' + baseId]],
    },
    {
      id: 'fn' + baseId, type: 'function', z: 'tabAuth',
      name: label, func, outputs: 1, libs: [],
      x: 700, y,
      wires: [['resp' + baseId]],
    },
    {
      id: 'resp' + baseId, type: 'http response', z: 'tabAuth',
      name: '', statusCode: '',
      headers: { 'Content-Type': 'application/json' },
      x: 940, y, wires: [],
    },
  ];
}

function ts() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function main() {
  if (!fs.existsSync(FLOWS)) { console.error('flows.json nao encontrado'); process.exit(2); }
  const raw = fs.readFileSync(FLOWS, 'utf8');
  const flows = JSON.parse(raw);

  if (flows.some(n => n && n.id === MARKER_NODE_ID)) {
    console.log('Ja aplicado (achei "' + MARKER_NODE_ID + '"). Saindo.');
    process.exit(0);
  }

  const lifecycle = flows.find(n => n && n.id === 'fnIrrAlarmLifecycle');
  if (!lifecycle) {
    console.error('Pre-requisito: rode _e057 antes.');
    process.exit(2);
  }
  if (!flows.some(n => n && n.id === 'mqttOutCommands')) {
    console.error('mqttOutCommands nao encontrado.');
    process.exit(2);
  }

  if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });
  const bkp = path.join(BACKUPS, 'flows-pre-e063-' + ts() + '.json');
  fs.writeFileSync(bkp, raw, 'utf8');

  // Atualiza fnIrrAlarmLifecycle: outputs=2 (dummy primeiro, mqtt no segundo)
  lifecycle.func = LIFECYCLE_FUNC_V4;
  lifecycle.outputs = 2;
  lifecycle.libs = lifecycle.libs || [];
  if (!lifecycle.libs.some(l => l && l.var === 'crypto')) {
    lifecycle.libs.push({ var: 'crypto', module: 'crypto' });
  }
  lifecycle.wires = [[], ['mqttOutCommands']];

  // Adiciona endpoints
  for (const e of ENDPOINTS) {
    for (const n of makeEndpointNodes(e)) flows.push(n);
  }

  console.log('Backup: ' + bkp);
  fs.writeFileSync(FLOWS + '.tmp', JSON.stringify(flows, null, 4) + '\n', 'utf8');
  fs.renameSync(FLOWS + '.tmp', FLOWS);
  console.log('flows.json atualizado.');
  console.log('  patch fnIrrAlarmLifecycle (outputs=2, engine inline)');
  console.log('  + 5 endpoints REST de /api/automacoes');
  console.log('Restart Node-RED.');
}

main();
