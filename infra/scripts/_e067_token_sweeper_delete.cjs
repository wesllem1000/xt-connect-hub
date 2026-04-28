#!/usr/bin/env node
// E5.16 — Sweeper de tokens MQTT efêmeros (D-token-2/3 do roadmap E).
//
// Sweeper anterior (E5.0) chamava `disableClient` em clientes
// `webapp-*` cujo TTL (1h) expirou. Cliente continuava existindo no
// broker — só era recriado/limpo no proximo POST /mqtt-token do mesmo
// user. Em deploys de longa duracao isso acumula clientes silentes.
//
// Mudanca: substitui disableClient por deleteClient (mais limpo). Como
// removeClientRole nao e necessario antes de deleteClient (broker
// dynsec lida com cleanup automatico), basta o delete. Errors "not
// found" sao tolerados (cliente ja foi removido em outro caminho).
//
// Idempotente: marker "TOKEN SWEEP DELETE v2".

'use strict';

const fs = require('fs');
const path = require('path');
const FLOWS = '/opt/xtconect/nodered/data/flows.json';
const BACKUPS = '/opt/xtconect/backups';
const MARKER = 'TOKEN SWEEP DELETE v2';

const NEW_FUNC = `// ${MARKER} — sweeper deleta clients expirados
// Roda a cada 5min. Map e volatil (perdido em restart) — se restart
// acontece com clients ativos no broker, eles ficam orfaos ate o
// proximo POST /mqtt-token do user (que faria deleteClient anterior).
const dynsecBatch = global.get('dynsecBatch');
if (!dynsecBatch) return null;
const tokenMap = global.get('mqtt_ephemeral_tokens');
if (!tokenMap || tokenMap.size === 0) return null;

const now = Date.now();
const expired = [];
for (const [userId, entry] of tokenMap.entries()) {
  if (entry.expires_at.getTime() <= now) {
    expired.push({ userId, username: entry.username });
  }
}

if (expired.length === 0) {
  node.status({ fill: 'grey', shape: 'dot', text: 'nothing expired ' + new Date().toISOString().slice(11,19) });
  return null;
}

node.log('mqtt-token sweeper: ' + expired.length + ' cliente(s) expirado(s) — deletando');

let deletedOk = 0;
for (const { userId, username } of expired) {
  try {
    await dynsecBatch([{ command: 'deleteClient', username }], 5000);
    deletedOk++;
  } catch(e) {
    if (!/not found/i.test(e.message)) {
      node.warn('mqtt-token sweeper: deleteClient ' + username + ': ' + e.message);
    }
  }
  tokenMap.delete(userId);
}

node.status({ fill: 'orange', shape: 'dot', text: 'deleted ' + deletedOk + '/' + expired.length + ' @ ' + new Date().toISOString().slice(11,19) });
return null;
`;

const raw = fs.readFileSync(FLOWS, 'utf8');
const flows = JSON.parse(raw);
const target = flows.find(n => n && n.type === 'function' && typeof n.func === 'string' &&
  n.func.includes('mqtt-token sweeper'));
if (!target) { console.error('sweeper de tokens nao encontrado'); process.exit(2); }
if (target.func.includes(MARKER)) {
  console.log('Ja aplicado. Saindo.'); process.exit(0);
}

function ts() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });
fs.writeFileSync(path.join(BACKUPS, 'flows-pre-e067-' + ts() + '.json'), raw, 'utf8');
target.func = NEW_FUNC;
fs.writeFileSync(FLOWS + '.tmp', JSON.stringify(flows, null, 4) + '\n', 'utf8');
fs.renameSync(FLOWS + '.tmp', FLOWS);
console.log('sweeper atualizado pra deleteClient. Restart Node-RED.');
