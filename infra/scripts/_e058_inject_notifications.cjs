#!/usr/bin/env node
// E5.8 — Notificações por e-mail (Fase 2.1).
//
// Como modifica:
//   1. Estende fnIrrAlarmLifecycle: ao criar irrigation_alarms, enfileira
//      uma row em notification_outbox por (dono + share-receivers do device)
//      com dedup_key = 'alarm:<alarmId>'. Idempotente.
//   2. Adiciona inject node "tickNotifyOutbox" (5s) + function
//      "fnNotifyWorker" que: SELECT pending FOR UPDATE SKIP LOCKED LIMIT 5,
//      chama global.sendMail (criado pelo nodo SMTP existente), marca sent
//      ou failed (com retry_count++). Suprime após 5 falhas.
//
// Pre-req: migration 017_notifications.sql aplicada; template
// /data/templates/email/irrigation-alarm.html copiado.
//
// Idempotencia: detecta presenca de "fnNotifyWorker" e sai.

'use strict';

const fs = require('fs');
const path = require('path');

const FLOWS = '/opt/xtconect/nodered/data/flows.json';
const BACKUPS = '/opt/xtconect/backups';
const FN_LIFECYCLE_ID = 'fnIrrAlarmLifecycle';
const FN_WORKER_ID = 'fnNotifyWorker';
const INJECT_TICK_ID = 'tickNotifyOutbox';

// Versao v2 do lifecycle: enfileira na outbox.
const LIFECYCLE_FUNC_V2 = `// E5.7 + E5.8 — alarm lifecycle + outbox enqueue
const pool = global.get('pgPool');
if (!pool) return null;
const parts = (msg.topic || '').split('/');
if (parts.length !== 3 || parts[0] !== 'devices' || parts[2] !== 'events') return null;
const mqttUser = parts[1];

let ev = null;
try {
  const raw = Buffer.isBuffer(msg.payload) ? msg.payload.toString('utf8') :
              (typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload));
  ev = JSON.parse(raw);
  if (!ev || typeof ev !== 'object') return null;
} catch(e) { return null; }
const t = ev.event_type;
if (t !== 'temp_alarm_triggered' && t !== 'temp_alarm_resolved' && t !== 'temp_sensor_lost') return null;

const payload = ev.payload || ev.payload_json || {};
const romId = payload.rom_id || null;

async function enqueueAlarmEmails(alarmRow, deviceRow) {
  // Recipients: dono + shares ativos com permissao em ('controle','leitura')
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
      user_name: u.name,
      device_name: deviceRow.nome_amigavel || deviceRow.serial,
      device_serial: deviceRow.serial,
      tipo_label: tipoLabel,
      message: alarmRow.message,
      triggered_at: triggeredFmt,
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

try {
  const dev = await pool.query(
    \`SELECT id, device_id AS serial, COALESCE(NULLIF(nome_amigavel,''), name, device_id) AS nome_amigavel
       FROM devices WHERE mqtt_username=$1\`,
    [mqttUser]
  );
  if (dev.rowCount === 0) return null;
  const deviceRow = dev.rows[0];
  const deviceId = deviceRow.id;

  if (t === 'temp_alarm_triggered') {
    const exists = await pool.query(
      \`SELECT id FROM irrigation_alarms
        WHERE device_id=$1 AND tipo='temperature_high'
          AND sensor_rom_id IS NOT DISTINCT FROM $2
          AND resolved_at IS NULL
        LIMIT 1\`,
      [deviceId, romId]
    );
    if (exists.rowCount > 0) {
      node.status({fill:'yellow',shape:'ring',text: mqttUser+' alarm dup ignorado'});
      return null;
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
  } else if (t === 'temp_alarm_resolved') {
    const r = await pool.query(
      \`UPDATE irrigation_alarms
         SET resolved_at = NOW()
       WHERE device_id=$1 AND tipo='temperature_high'
         AND sensor_rom_id IS NOT DISTINCT FROM $2
         AND resolved_at IS NULL
       RETURNING id\`,
      [deviceId, romId]
    );
    if (r.rowCount > 0) node.status({fill:'green',shape:'dot',text: mqttUser+' '+r.rowCount+' alarm resolvido'});
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
return null;
`;

const WORKER_FUNC = `// E5.8 — worker que processa notification_outbox
// Roda a cada 5s via inject. Pega ate 5 itens pending FOR UPDATE SKIP LOCKED,
// envia via global.sendMail, marca sent ou failed (retry up to 5).
const pool = global.get('pgPool');
const sendMail = global.get('sendMail');
if (!pool) return null;
if (!sendMail) {
  node.status({fill:'yellow',shape:'ring',text:'mailer not ready'});
  return null;
}
const MAX_RETRY = 5;

async function processItem(client, item) {
  try {
    await sendMail({
      to: item.dest_email,
      subject: item.subject,
      template: item.template_name,
      vars: item.template_vars,
      text: item.body_text,
    });
    await client.query(
      \`UPDATE notification_outbox SET status='sent', sent_at=NOW() WHERE id=$1\`,
      [item.id]
    );
    return { ok: true };
  } catch(e) {
    const newRetry = item.retry_count + 1;
    const finalStatus = newRetry >= MAX_RETRY ? 'failed' : 'pending';
    await client.query(
      \`UPDATE notification_outbox SET status=$2, retry_count=$3, last_error=$4 WHERE id=$1\`,
      [item.id, finalStatus, newRetry, String(e.message).slice(0, 500)]
    );
    return { ok: false, err: e.message };
  }
}

const client = await pool.connect();
try {
  await client.query('BEGIN');
  const r = await client.query(
    \`SELECT id, user_id, dest_email, subject, template_name, template_vars, body_text, retry_count
       FROM notification_outbox
      WHERE status = 'pending' AND retry_count < $1
      ORDER BY created_at ASC
      LIMIT 5
      FOR UPDATE SKIP LOCKED\`,
    [MAX_RETRY]
  );
  let sent = 0, failed = 0;
  for (const item of r.rows) {
    const res = await processItem(client, item);
    if (res.ok) sent++; else failed++;
  }
  await client.query('COMMIT');
  if (sent + failed > 0) {
    node.status({
      fill: failed > 0 ? 'yellow' : 'green',
      shape: 'dot',
      text: 'sent=' + sent + ' fail=' + failed + ' ' + new Date().toISOString().slice(11,19),
    });
  }
} catch(e) {
  await client.query('ROLLBACK').catch(() => {});
  node.error('notify worker: ' + e.message);
} finally {
  client.release();
}
return null;
`;

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

  if (flows.some(n => n && n.id === FN_WORKER_ID)) {
    console.log('Ja aplicado (achei "' + FN_WORKER_ID + '"). Saindo.');
    process.exit(0);
  }

  const lifecycle = flows.find(n => n && n.id === FN_LIFECYCLE_ID);
  if (!lifecycle) {
    console.error('Pre-requisito: rode _e057_alarm_lifecycle.cjs primeiro.');
    process.exit(2);
  }

  if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });
  const bkp = path.join(BACKUPS, 'flows-pre-e058-' + ts() + '.json');
  fs.writeFileSync(bkp, raw, 'utf8');
  console.log('Backup salvo em ' + bkp);

  // Atualiza lifecycle pra v2 (com enqueue)
  lifecycle.func = LIFECYCLE_FUNC_V2;
  console.log('  patch fnIrrAlarmLifecycle pra v2 (enqueue)');

  // Determina tab — usa mesma do lifecycle
  const tabId = lifecycle.z;

  // Inject node a cada 5s (e 1x no startup)
  flows.push({
    id: INJECT_TICK_ID,
    type: 'inject',
    z: tabId,
    name: 'tick notify outbox 5s',
    props: [{ p: 'payload' }],
    repeat: '5',
    crontab: '',
    once: true,
    onceDelay: '5',
    topic: '',
    payload: '',
    payloadType: 'date',
    x: 200,
    y: (lifecycle.y || 200) + 80,
    wires: [[FN_WORKER_ID]],
  });
  flows.push({
    id: FN_WORKER_ID,
    type: 'function',
    z: tabId,
    name: 'NotifyOutboxWorker',
    func: WORKER_FUNC,
    outputs: 1,
    libs: [],
    x: 480,
    y: (lifecycle.y || 200) + 80,
    wires: [[]],
  });

  const tmp = FLOWS + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(flows, null, 4) + '\n', 'utf8');
  fs.renameSync(tmp, FLOWS);
  console.log('flows.json atualizado.');
  console.log('Adicionado:');
  console.log('  - tickNotifyOutbox (inject 5s)');
  console.log('  - fnNotifyWorker');
  console.log('Proximo passo: sudo docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
}

main();
