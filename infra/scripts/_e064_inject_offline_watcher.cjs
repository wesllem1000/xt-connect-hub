#!/usr/bin/env node
// E5.13 — Watcher de devices offline (Plano A do roadmap).
//
// Cron `*/5 * * * *` (a cada 5 minutos): SELECT devices que estao
// offline ha > OFFLINE_ALERT_MINUTES (default 30) E ainda nao tiveram
// alerta enviado nesse episodio offline. Pra cada match:
//   - Enfileira email pra dono+shares no notification_outbox.
//   - Atualiza last_offline_alert_at = NOW() (dedup).
//   - Dispara automation engine com trigger='device_offline' pra
//     regras custom do user.
//
// Idempotencia: detecta presenca de "tickOfflineWatcher" e sai.
// Pre-req: migration 020 + template device-offline.html.

'use strict';

const fs = require('fs');
const path = require('path');
const FLOWS = '/opt/xtconect/nodered/data/flows.json';
const BACKUPS = '/opt/xtconect/backups';
const INJECT_ID = 'tickOfflineWatcher';
const FN_ID = 'fnOfflineWatcher';

const WATCHER_FUNC = `// E5.13 — offline watcher
const OFFLINE_ALERT_MINUTES = parseInt(env.get('OFFLINE_ALERT_MINUTES') || '30', 10);
const pool = global.get('pgPool');
if (!pool) {
  node.warn('offline watcher: pgPool nao disponivel');
  return null;
}

async function runAutomationRules(triggerType, deviceId, deviceRow, payload) {
  const out = { mqttMessages: [] };
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
    if (rule.trigger_params) {
      let allMatch = true;
      for (const k of Object.keys(rule.trigger_params)) {
        if (rule.trigger_params[k] !== undefined && payload && payload[k] !== rule.trigger_params[k]) {
          allMatch = false; break;
        }
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
        }
      } catch(e) {
        acoesExecutadas.push({ type: action && action.type, ok: false, error: e.message });
        allOk = false;
      }
    }
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
  }
  return out;
}

let mqttMessagesAll = [];
try {
  // Devices que ficaram offline ha > OFFLINE_ALERT_MINUTES E:
  //  - last_seen IS NOT NULL (ja se conectou pelo menos uma vez)
  //  - status associado/active (so devices em uso)
  //  - alerta nao foi enviado nesse episodio
  //    (last_offline_alert_at IS NULL OR last_offline_alert_at < last_seen)
  const r = await pool.query(
    \`SELECT d.id, d.device_id AS serial, d.user_id, d.last_seen,
            COALESCE(NULLIF(d.nome_amigavel, ''), d.name, d.device_id) AS nome_amigavel
       FROM devices d
      WHERE d.is_online = FALSE
        AND d.last_seen IS NOT NULL
        AND d.last_seen < NOW() - (\$1 || ' minutes')::INTERVAL
        AND d.status IN ('associado','active')
        AND (d.last_offline_alert_at IS NULL OR d.last_offline_alert_at < d.last_seen)
      ORDER BY d.last_seen ASC
      LIMIT 50\`,
    [OFFLINE_ALERT_MINUTES]
  );
  if (r.rowCount === 0) {
    node.status({fill:'grey', shape:'dot', text:'no offline alerts ' + new Date().toISOString().slice(11,16)});
    return null;
  }

  const baseUrl = global.get('mailBaseUrl') || env.get('MAIL_BASE_URL') || 'https://hub.xtconect.online';
  let alertCount = 0;

  for (const dev of r.rows) {
    // Recipients: dono + shares ativos
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
    const ultimaConexao = new Date(dev.last_seen).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'});
    const subject = '[XT Connect] Equipamento ' + dev.nome_amigavel + ' sem conexao ha ' + minutosOffline + 'min';
    const dedupKey = 'offline:' + dev.id + ':' + new Date(dev.last_seen).toISOString();

    for (const u of rs.rows) {
      const vars = {
        user_name: u.name,
        device_name: dev.nome_amigavel,
        device_serial: dev.serial,
        minutos_offline: String(minutosOffline),
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

    // Marca alerta enviado
    await pool.query('UPDATE devices SET last_offline_alert_at = NOW() WHERE id = $1', [dev.id]);
    alertCount++;

    // Dispara engine de automacoes pra regras custom (trigger device_offline)
    try {
      const eng = await runAutomationRules('device_offline', dev.id, { id: dev.id, serial: dev.serial, nome_amigavel: dev.nome_amigavel }, {
        device_id: dev.id, device_serial: dev.serial,
        last_seen: dev.last_seen, minutos_offline: minutosOffline,
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

function main() {
  if (!fs.existsSync(FLOWS)) { console.error('flows.json nao encontrado'); process.exit(2); }
  const raw = fs.readFileSync(FLOWS, 'utf8');
  const flows = JSON.parse(raw);
  if (flows.some(n => n && n.id === INJECT_ID)) {
    console.log('Ja aplicado (achei "' + INJECT_ID + '"). Saindo.');
    process.exit(0);
  }
  if (!flows.some(n => n && n.id === 'mqttOutCommands')) {
    console.error('mqttOutCommands nao encontrado.');
    process.exit(2);
  }

  if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });
  const bkp = path.join(BACKUPS, 'flows-pre-e064-' + ts() + '.json');
  fs.writeFileSync(bkp, raw, 'utf8');

  const tabId = flows.some(n => n && n.id === 'tabIngest') ? 'tabIngest' : 'tabAuth';

  flows.push({
    id: INJECT_ID,
    type: 'inject',
    z: tabId,
    name: 'cron offline watcher 5min',
    props: [{ p: 'payload' }],
    repeat: '',
    crontab: '*/5 * * * *',
    once: true,
    onceDelay: '30',
    topic: '',
    payload: '',
    payloadType: 'date',
    x: 200, y: 900,
    wires: [[FN_ID]],
  });
  flows.push({
    id: FN_ID,
    type: 'function',
    z: tabId,
    name: 'OfflineWatcher',
    func: WATCHER_FUNC,
    outputs: 2,
    libs: [{ var: 'crypto', module: 'crypto' }],
    x: 460, y: 900,
    wires: [[], ['mqttOutCommands']],
  });

  console.log('Backup: ' + bkp);
  fs.writeFileSync(FLOWS + '.tmp', JSON.stringify(flows, null, 4) + '\n', 'utf8');
  fs.renameSync(FLOWS + '.tmp', FLOWS);
  console.log('flows.json atualizado.');
  console.log('Adicionado: tickOfflineWatcher (cron 5min) + fnOfflineWatcher');
  console.log('Restart Node-RED.');
}

main();
