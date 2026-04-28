#!/usr/bin/env node
// E5.11 — Cron diario de retencao (Fase 2.3).
//
// Como modifica:
//   1. Adiciona inject node "tickRetention" com crontab "0 3 * * *"
//      (3h da manha todos os dias, hora local do container).
//   2. Adiciona function "fnRunRetention" que chama
//      SELECT run_retention_purges() (criada em migration 018) e loga
//      metricas em irrigation_events com event_type especial? Nao — o
//      CHECK constraint nao tem evento de manutencao. Loga so via
//      node.log + node.status.
//
// Idempotencia: detecta presenca de "tickRetention" e sai.
// Pre-req: migration 018_retention.sql aplicada (run_retention_purges existir).

'use strict';

const fs = require('fs');
const path = require('path');

const FLOWS = '/opt/xtconect/nodered/data/flows.json';
const BACKUPS = '/opt/xtconect/backups';
const INJECT_ID = 'tickRetention';
const FN_ID = 'fnRunRetention';

const FUNC_RETENTION = `// E5.11 — daily retention runner
const pool = global.get('pgPool');
if (!pool) {
  node.warn('retention: pgPool nao disponivel');
  node.status({fill:'red',shape:'ring',text:'no pool'});
  return null;
}
try {
  const r = await pool.query('SELECT run_retention_purges() AS metrics');
  const m = r.rows[0].metrics;
  const summary = 'reads=' + m.device_readings_deleted +
                  ' irr=' + m.irrigation_events_deleted +
                  ' mqtt=' + m.mqtt_events_deleted +
                  ' nbox=' + m.notification_outbox_deleted;
  node.log('retention: ' + JSON.stringify(m));
  node.status({fill:'green',shape:'dot',text: summary + ' ' + new Date().toISOString().slice(11,16)});
} catch(e) {
  node.error('retention: ' + e.message);
  node.status({fill:'red',shape:'ring',text:'err: ' + e.message.slice(0,30)});
}
return null;
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

  if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });
  const bkp = path.join(BACKUPS, 'flows-pre-e062-' + ts() + '.json');
  fs.writeFileSync(bkp, raw, 'utf8');

  // Tab id — usa tabIngest se existir (onde estao outros workers), senao tabAuth
  const tabId = flows.some(n => n && n.id === 'tabIngest') ? 'tabIngest' : 'tabAuth';

  flows.push({
    id: INJECT_ID,
    type: 'inject',
    z: tabId,
    name: 'cron retention 03:00 daily',
    props: [{ p: 'payload' }],
    repeat: '',
    crontab: '0 3 * * *',
    once: false,
    onceDelay: '',
    topic: '',
    payload: '',
    payloadType: 'date',
    x: 200, y: 800,
    wires: [[FN_ID]],
  });
  flows.push({
    id: FN_ID,
    type: 'function',
    z: tabId,
    name: 'RunRetention',
    func: FUNC_RETENTION,
    outputs: 1,
    libs: [],
    x: 460, y: 800,
    wires: [[]],
  });

  console.log('Backup: ' + bkp);
  fs.writeFileSync(FLOWS + '.tmp', JSON.stringify(flows, null, 4) + '\n', 'utf8');
  fs.renameSync(FLOWS + '.tmp', FLOWS);
  console.log('flows.json atualizado.');
  console.log('Adicionado: tickRetention (cron diario 03:00) + fnRunRetention');
  console.log('Restart Node-RED.');
}

main();
