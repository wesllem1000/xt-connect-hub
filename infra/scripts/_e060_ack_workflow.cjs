#!/usr/bin/env node
// E5.10 — Reverte auto-resolve por telemetria; ACK manual passa a ser
// o ÚNICO caminho de resolucao.
//
// Pedido do dono:
//   "Se a temperatura abaixar mas o user nao reconhecer, alarme deve
//    continuar. Se o user estiver ausente, ao voltar deve ver alarme.
//    Sistema so volta se user reconhecer (no simulador ou no app)."
//
// Mudancas:
//
// 1. fnIrrTelemetrySensors v3 — volta a so atualizar ultima_leitura_c
//    (sem mais auto-resolve por telemetria; foi feito em _e059, agora
//    revertido).
//
// 2. fnIrrAlarmLifecycle v3 — adiciona handling de temp_alarm_ack_user
//    (que ja era publicado pelo simulator no botao "Reconhecer"):
//    UPDATE acked_at + resolved_at em alarmes ativos do (device, rom_id).
//    Antes esse event nao tinha efeito no banco. ACK pelo simulador
//    agora resolve.
//
// 3. fnIrrAckAlarm v2 — outputs=2 (response + mqtt out). Apos UPDATE
//    acked_at + resolved_at, publica em devices/<serial>/commands um
//    cmd=temp_alarm_clear com {alarm_id, rom_id, source='app_ack'}
//    pra que o simulador (e ESP real, futuramente) limpe o estado
//    local do alarme. Fecha o loop "ACK no XT Connect → simulador
//    tambem para de mostrar alarme".
//
// Idempotencia: marker "ACK WORKFLOW v3" no func.
// Pre-req: _e057 (lifecycle), _e055/e059 (telemetry), _e056 (loop) ja
// rodaram.

'use strict';

const fs = require('fs');
const path = require('path');

const FLOWS = '/opt/xtconect/nodered/data/flows.json';
const BACKUPS = '/opt/xtconect/backups';
const MARKER = 'ACK WORKFLOW v3';

// fnIrrTelemetrySensors — volta ao v1 (sem auto-resolve)
const TELEMETRY_FUNC = `// ${MARKER} (telemetry: sem auto-resolve)
const pool = global.get('pgPool');
if (!pool) return null;
const parts = (msg.topic || '').split('/');
if (parts.length !== 4 || parts[0] !== 'devices' || parts[2] !== 'telemetry' || parts[3] !== 'sensors') return null;
const mqttUser = parts[1];

let body = null;
try {
  const raw = Buffer.isBuffer(msg.payload) ? msg.payload.toString('utf8') :
              (typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload));
  if (!raw || raw.trim() === '') return null;
  body = JSON.parse(raw);
} catch(e) { node.warn('telemetry/sensors JSON invalido: '+e.message); return null; }
if (!body || !Array.isArray(body.readings)) return null;

try {
  const drow = await pool.query('SELECT id FROM devices WHERE mqtt_username = $1', [mqttUser]);
  if (drow.rowCount === 0) return null;
  const deviceId = drow.rows[0].id;
  const ts = new Date(body.ts || Date.now());

  let updated = 0;
  for (const r of body.readings) {
    if (!r || typeof r.rom_id !== 'string' || !r.rom_id) continue;
    const temp = (typeof r.temperature_c === 'number' && Number.isFinite(r.temperature_c))
      ? r.temperature_c : null;
    try {
      const u = await pool.query(
        \`UPDATE irrigation_temperature_sensors
            SET ultima_leitura_c = $3, ultimo_contato_em = $4
          WHERE device_id = $1 AND rom_id = $2\`,
        [deviceId, r.rom_id, temp, ts]
      );
      if (u.rowCount > 0) updated++;
    } catch(e) {
      node.warn('telemetry/sensors update ' + r.rom_id + ': ' + e.message);
    }
  }
  if (updated > 0) {
    node.status({fill:'green', shape:'dot', text: mqttUser + ' ' + updated + ' leitura(s) ' + new Date().toISOString().slice(11,19)});
  }
} catch(e) { node.error('telemetry/sensors: '+e.message); }
return null;
`;

// fnIrrAlarmLifecycle v3 — temp_alarm_ack_user resolve
const LIFECYCLE_FUNC = `// ${MARKER} — alarm lifecycle + outbox enqueue + ack via event
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
if (t !== 'temp_alarm_triggered' &&
    t !== 'temp_alarm_resolved' &&
    t !== 'temp_alarm_ack_user' &&
    t !== 'temp_sensor_lost') return null;

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
          AND resolved_at IS NULL LIMIT 1\`,
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
    // Alarme so e resolvido por ACK — temp_alarm_resolved nao faz mais
    // nada por design (pedido do dono). Mantemos o handling pra inserir
    // no historico sem tocar em irrigation_alarms.
    node.status({fill:'blue',shape:'ring',text: mqttUser+' resolved ignorado (ack only)'});
  } else if (t === 'temp_alarm_ack_user') {
    // ACK pelo simulator → resolve alarme(s) ativo(s) do (device, rom_id)
    const r = await pool.query(
      \`UPDATE irrigation_alarms
          SET acked_at = COALESCE(acked_at, NOW()),
              resolved_at = NOW()
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
return null;
`;

// fnIrrAckAlarm v2 — outputs=2, publica command pro simulator
const ACK_FUNC = `// ${MARKER} — ack via REST: UPDATE banco + publish MQTT command
const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return [msg, null]; }
async function checkDeviceAccess(pool, deviceId, user) {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(deviceId)) return { err: 400, msg: 'id invalido' };
  const isAdmin = user && user.role === 'admin';
  const r = await pool.query(
    \`SELECT d.id, d.device_id AS serial, d.user_id AS owner_id, d.modelo_id,
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
const alarmId = msg.req.params.alarmId;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(alarmId)) { msg.statusCode=400; msg.payload={error:'alarmId invalido'}; return [msg, null]; }
try {
  const chk = await checkDeviceAccess(pool, msg.req.params.id, msg.user);
  if (chk.err) { msg.statusCode=chk.err; msg.payload={error:chk.msg}; return [msg, null]; }
  const device = chk.device;
  if (device.prefixo !== 'IRR' || device.major_version !== 'V1') {
    msg.statusCode=400; msg.payload={error:'device nao e IRR-V1'}; return [msg, null];
  }
  const r = await pool.query(
    \`UPDATE irrigation_alarms
        SET acked_at = COALESCE(acked_at, NOW()),
            acked_by_user_id = COALESCE(acked_by_user_id, $3),
            resolved_at = NOW()
      WHERE id = $2 AND device_id = $1 AND resolved_at IS NULL
      RETURNING *\`,
    [device.id, alarmId, msg.user.id]
  );
  if (r.rowCount === 0) {
    msg.statusCode = 404;
    msg.payload = { error: 'alarme nao encontrado ou ja resolvido' };
    return [msg, null];
  }
  const alarm = r.rows[0];
  msg.statusCode = 200;
  msg.payload = { alarme: alarm };
  // Publica comando pro simulator/firmware limpar estado local
  const cmdMsg = {
    topic: 'devices/' + device.serial + '/commands',
    payload: JSON.stringify({
      cmd_id: crypto.randomUUID(),
      protocol_version: 1,
      cmd: 'temp_alarm_clear',
      params: { alarm_id: alarm.id, rom_id: alarm.sensor_rom_id, source: 'app_ack' },
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30000).toISOString(),
      origin: 'manual_app_remote',
      user_id: msg.user.id,
    }),
    qos: 1, retain: false,
  };
  return [msg, cmdMsg];
} catch(e) {
  node.error('ack alarme: '+e.message, msg);
  msg.statusCode=500; msg.payload={error:'internal'};
  return [msg, null];
}`;

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

  const fnTel = flows.find(n => n && n.id === 'fnIrrTelemetrySensors');
  const fnLife = flows.find(n => n && n.id === 'fnIrrAlarmLifecycle');
  const fnAck = flows.find(n => n && n.id === 'fnIrrAckAlarm');
  if (!fnTel || !fnLife || !fnAck) {
    console.error('Pre-requisitos: rode _e055, _e057, _e058 antes.');
    console.error('  fnIrrTelemetrySensors=' + Boolean(fnTel));
    console.error('  fnIrrAlarmLifecycle=' + Boolean(fnLife));
    console.error('  fnIrrAckAlarm=' + Boolean(fnAck));
    process.exit(2);
  }
  const already =
    (typeof fnTel.func === 'string' && fnTel.func.includes(MARKER)) ||
    (typeof fnLife.func === 'string' && fnLife.func.includes(MARKER)) ||
    (typeof fnAck.func === 'string' && fnAck.func.includes(MARKER));
  if (already) {
    console.log('Ja aplicado (marker "' + MARKER + '" em pelo menos 1 func). Saindo.');
    process.exit(0);
  }
  if (!flows.some(n => n && n.id === 'mqttOutCommands')) {
    console.error('mqttOutCommands nao encontrado.');
    process.exit(2);
  }

  if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });
  const bkp = path.join(BACKUPS, 'flows-pre-e060-' + ts() + '.json');
  fs.writeFileSync(bkp, raw, 'utf8');
  console.log('Backup salvo em ' + bkp);

  fnTel.func = TELEMETRY_FUNC;
  fnLife.func = LIFECYCLE_FUNC;
  fnAck.func = ACK_FUNC;
  fnAck.outputs = 2;
  fnAck.wires = [['respIrrAckAlarm'], ['mqttOutCommands']];
  console.log('  patch fnIrrTelemetrySensors (no auto-resolve)');
  console.log('  patch fnIrrAlarmLifecycle (handle temp_alarm_ack_user)');
  console.log('  patch fnIrrAckAlarm (outputs=2, publish command)');

  const tmp = FLOWS + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(flows, null, 4) + '\n', 'utf8');
  fs.renameSync(tmp, FLOWS);
  console.log('flows.json atualizado.');
  console.log('Proximo passo: sudo docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
}

main();
