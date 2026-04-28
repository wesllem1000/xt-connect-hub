#!/usr/bin/env node
// E5.13b — Formato amigavel da duracao offline no email.
//
// Pedido do dono: se passou de 60min, mostrar como "1:32H" (HH:MM h).
// Se passou de 24h, mostrar como "5 dias 22:56H".
// Aplicado tanto no subject quanto no template (variavel renomeada
// minutos_offline -> tempo_offline).
//
// Substitui o func de fnOfflineWatcher. Idempotente: marker
// "OFFLINE FORMAT v2".

'use strict';

const fs = require('fs');
const path = require('path');
const FLOWS = '/opt/xtconect/nodered/data/flows.json';
const BACKUPS = '/opt/xtconect/backups';
const FN_ID = 'fnOfflineWatcher';
const MARKER = 'OFFLINE FORMAT v2';

const NEW_FUNC = `// ${MARKER} — offline watcher com duracao formatada
const OFFLINE_ALERT_MINUTES = parseInt(env.get('OFFLINE_ALERT_MINUTES') || '30', 10);
const pool = global.get('pgPool');
if (!pool) { node.warn('offline watcher: pgPool nao disponivel'); return null; }

function formatOfflineDuration(minutos) {
  // < 60 min: "45 minutos"
  // 60min .. 24h: "1:32H"
  // >= 24h: "5 dias 22:56H"
  if (minutos < 60) return minutos + ' minutos';
  const horas = Math.floor(minutos / 60);
  const mins = minutos % 60;
  const mmStr = String(mins).padStart(2, '0');
  if (horas < 24) return horas + ':' + mmStr + 'H';
  const dias = Math.floor(horas / 24);
  const horasRest = horas % 24;
  return dias + ' dia' + (dias === 1 ? '' : 's') + ' ' + horasRest + ':' + mmStr + 'H';
}

async function runAutomationRules(triggerType, deviceId, deviceRow, payload) {
  const out = { mqttMessages: [] };
  let rules;
  try {
    rules = await pool.query(
      \`SELECT * FROM automation_rules
        WHERE ativo = TRUE AND trigger_type = $1
          AND (device_id IS NULL OR device_id = $2)
        ORDER BY criado_em ASC\`,
      [triggerType, deviceId]
    );
  } catch(e) { node.warn('automation rules query: ' + e.message); return out; }

  for (const rule of rules.rows) {
    if (rule.trigger_params) {
      let allMatch = true;
      for (const k of Object.keys(rule.trigger_params)) {
        if (rule.trigger_params[k] !== undefined && payload && payload[k] !== rule.trigger_params[k]) { allMatch = false; break; }
      }
      if (!allMatch) continue;
    }
    if (rule.cooldown_minutes > 0 && rule.last_fired_at) {
      const since = Date.now() - new Date(rule.last_fired_at).getTime();
      if (since < rule.cooldown_minutes * 60 * 1000) {
        await pool.query(
          \`INSERT INTO automation_executions (rule_id, trigger_payload, status, acoes_executadas)
           VALUES ($1, $2::jsonb, 'skipped_cooldown', '[]'::jsonb)\`,
          [rule.id, JSON.stringify(payload || {})]
        );
        continue;
      }
    }
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
            } catch(e) { node.warn('automation send_email: ' + e.message); }
          }
          acoesExecutadas.push({ type: 'send_email', ok: true, count: recipients.length });
        } else if (action.type === 'publish_command') {
          if (!deviceRow || !deviceRow.serial) {
            acoesExecutadas.push({ type: 'publish_command', ok: false, error: 'device serial nao disponivel' });
            allOk = false; continue;
          }
          const cmd = (action.params && action.params.cmd) || null;
          const allowed = ['pump_off','safe_closure','sector_open','sector_close','sector_pause','sector_resume','mode_set'];
          if (!allowed.includes(cmd)) {
            acoesExecutadas.push({ type: 'publish_command', ok: false, error: 'cmd nao permitido: ' + cmd });
            allOk = false; continue;
          }
          out.mqttMessages.push({
            topic: 'devices/' + deviceRow.serial + '/commands',
            payload: JSON.stringify({
              cmd_id: crypto.randomUUID(), protocol_version: 1,
              cmd: cmd, params: (action.params && action.params.params) || {},
              issued_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 30000).toISOString(),
              origin: 'automation', rule_id: rule.id,
            }),
            qos: 1, retain: false,
          });
          acoesExecutadas.push({ type: 'publish_command', ok: true, cmd: cmd });
        }
      } catch(e) {
        acoesExecutadas.push({ type: action && action.type, ok: false, error: e.message });
        allOk = false;
      }
    }
    const status = allOk ? 'success' : (acoesExecutadas.some(a => a.ok) ? 'partial' : 'failed');
    try {
      await pool.query('UPDATE automation_rules SET last_fired_at = NOW(), last_status = $2 WHERE id = $1', [rule.id, status]);
      await pool.query(
        \`INSERT INTO automation_executions (rule_id, trigger_payload, status, acoes_executadas)
         VALUES ($1, $2::jsonb, $3, $4::jsonb)\`,
        [rule.id, JSON.stringify(payload || {}), status, JSON.stringify(acoesExecutadas)]
      );
    } catch(e) { node.warn('automation log: ' + e.message); }
  }
  return out;
}

let mqttMessagesAll = [];
try {
  const r = await pool.query(
    \`SELECT d.id, d.device_id AS serial, d.user_id, d.last_seen,
            COALESCE(NULLIF(d.nome_amigavel, ''), d.name, d.device_id) AS nome_amigavel
       FROM devices d
      WHERE d.is_online = FALSE
        AND d.last_seen IS NOT NULL
        AND d.last_seen < NOW() - (\$1 || ' minutes')::INTERVAL
        AND d.status IN ('associado','active')
        AND (d.last_offline_alert_at IS NULL OR d.last_offline_alert_at < d.last_seen)
      ORDER BY d.last_seen ASC LIMIT 50\`,
    [OFFLINE_ALERT_MINUTES]
  );
  if (r.rowCount === 0) {
    node.status({fill:'grey', shape:'dot', text:'no offline alerts ' + new Date().toISOString().slice(11,16)});
    return null;
  }
  const baseUrl = global.get('mailBaseUrl') || env.get('MAIL_BASE_URL') || 'https://hub.xtconect.online';
  let alertCount = 0;

  for (const dev of r.rows) {
    const rs = await pool.query(
      \`SELECT au.id, au.email, COALESCE(NULLIF(au.full_name,''), au.email) AS name
         FROM app_users au JOIN devices d ON d.user_id = au.id WHERE d.id = $1
       UNION
       SELECT au.id, au.email, COALESCE(NULLIF(au.full_name,''), au.email) AS name
         FROM dispositivo_compartilhado s JOIN app_users au ON au.id = s.com_usuario_id
        WHERE s.dispositivo_id = $1 AND s.status = 'ativo'\`,
      [dev.id]
    );
    if (rs.rowCount === 0) continue;

    const minutosOffline = Math.floor((Date.now() - new Date(dev.last_seen).getTime()) / 60000);
    const tempoOffline = formatOfflineDuration(minutosOffline);
    const ultimaConexao = new Date(dev.last_seen).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'});
    const subject = '[XT Connect] Equipamento ' + dev.nome_amigavel + ' sem conexao ha ' + tempoOffline;
    const dedupKey = 'offline:' + dev.id + ':' + new Date(dev.last_seen).toISOString();

    for (const u of rs.rows) {
      const vars = {
        user_name: u.name,
        device_name: dev.nome_amigavel,
        device_serial: dev.serial,
        tempo_offline: tempoOffline,
        ultima_conexao: ultimaConexao,
        link: baseUrl + '/dispositivos/' + dev.id,
      };
      const bodyText = subject + '\\n\\nUltima conexao: ' + ultimaConexao + '\\n\\nAcesse: ' + vars.link;
      try {
        await pool.query(
          \`INSERT INTO notification_outbox
             (user_id, dest_email, category, severity, subject, template_name, template_vars, body_text, dedup_key, status)
           VALUES ($1, $2, 'device_offline', 'warning', $3, 'device-offline', $4::jsonb, $5, $6, 'pending')
           ON CONFLICT (user_id, dedup_key, status) DO NOTHING\`,
          [u.id, u.email, subject, JSON.stringify(vars), bodyText, dedupKey]
        );
      } catch(e) { node.warn('outbox enqueue offline: ' + e.message); }
    }

    await pool.query('UPDATE devices SET last_offline_alert_at = NOW() WHERE id = $1', [dev.id]);
    alertCount++;

    try {
      const eng = await runAutomationRules('device_offline', dev.id, { id: dev.id, serial: dev.serial, nome_amigavel: dev.nome_amigavel }, {
        device_id: dev.id, device_serial: dev.serial,
        last_seen: dev.last_seen,
        minutos_offline: minutosOffline,
        tempo_offline: tempoOffline,
      });
      if (eng.mqttMessages && eng.mqttMessages.length > 0) {
        mqttMessagesAll = mqttMessagesAll.concat(eng.mqttMessages);
      }
    } catch(e) { node.warn('offline automation engine: ' + e.message); }
  }

  node.status({fill:'orange', shape:'dot', text: alertCount + ' alertas offline ' + new Date().toISOString().slice(11,16)});
  node.log('offline watcher: ' + alertCount + ' alertas enviados');
} catch(e) {
  node.error('offline watcher: ' + e.message);
  node.status({fill:'red', shape:'ring', text: 'err: ' + e.message.slice(0,30)});
}

return mqttMessagesAll.length > 0 ? [null, mqttMessagesAll] : null;
`;

function ts() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

const raw = fs.readFileSync(FLOWS, 'utf8');
const flows = JSON.parse(raw);
const target = flows.find(n => n && n.id === FN_ID);
if (!target) { console.error('fnOfflineWatcher nao encontrado'); process.exit(2); }
if (typeof target.func === 'string' && target.func.includes(MARKER)) {
  console.log('Ja aplicado. Saindo.'); process.exit(0);
}
if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });
fs.writeFileSync(path.join(BACKUPS, 'flows-pre-e065-' + ts() + '.json'), raw, 'utf8');
target.func = NEW_FUNC;
fs.writeFileSync(FLOWS + '.tmp', JSON.stringify(flows, null, 4) + '\n', 'utf8');
fs.renameSync(FLOWS + '.tmp', FLOWS);
console.log('fnOfflineWatcher atualizado (formato HH:MM e dias).');
console.log('Restart Node-RED.');
