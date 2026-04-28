#!/usr/bin/env node
// E5.10 hotfix — fnIrrAckAlarm usa crypto.randomUUID() mas o func nao
// declara libs:[{var:'crypto',module:'crypto'}], entao o Node-RED da
// "crypto is not defined" e o endpoint POST /alarmes/:id/ack retorna
// 500 ao usuario.
//
// Idempotente: detecta se libs ja inclui crypto e sai.

'use strict';

const fs = require('fs');
const path = require('path');
const FLOWS = '/opt/xtconect/nodered/data/flows.json';
const BACKUPS = '/opt/xtconect/backups';

function ts() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

const raw = fs.readFileSync(FLOWS, 'utf8');
const flows = JSON.parse(raw);
const target = flows.find(n => n && n.id === 'fnIrrAckAlarm');
if (!target) { console.error('fnIrrAckAlarm nao encontrado'); process.exit(2); }
target.libs = target.libs || [];
const hasCrypto = target.libs.some(l => l && l.var === 'crypto');
if (hasCrypto) { console.log('Ja tem libs crypto. Saindo.'); process.exit(0); }
if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });
fs.writeFileSync(path.join(BACKUPS, 'flows-pre-e061-' + ts() + '.json'), raw, 'utf8');
target.libs.push({ var: 'crypto', module: 'crypto' });
fs.writeFileSync(FLOWS + '.tmp', JSON.stringify(flows, null, 4) + '\n', 'utf8');
fs.renameSync(FLOWS + '.tmp', FLOWS);
console.log('libs crypto adicionada ao fnIrrAckAlarm.');
console.log('Restart Node-RED.');
