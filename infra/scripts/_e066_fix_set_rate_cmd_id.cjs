#!/usr/bin/env node
// E5.15 — Corrige fnSetRate pra publicar com cmd_id (formato novo).
//
// Bug legado documentado: o func de setRate (E2.3) publicava em
// devices/<serial>/commands com `request_id` em vez de `cmd_id` e sem
// protocol_version/issued_at/expires_at. Simulator ignora silentemente
// e firmware novo (apos E5.1 cmd-sync) tambem nao processa.
//
// Mudanca minima: troca request_id por cmd_id, adiciona campos do
// envelope padrao. Resposta REST mantem `request_id` no payload pra
// compat com clientes web ja deployados (que olham esse campo). O
// MQTT que vai pro device usa cmd_id (correto).
//
// Idempotencia: marker "SET_RATE CMD_ID v2".

'use strict';

const fs = require('fs');
const path = require('path');
const FLOWS = '/opt/xtconect/nodered/data/flows.json';
const BACKUPS = '/opt/xtconect/backups';
const FN_ID = 'fnSetRate';
const MARKER = 'SET_RATE CMD_ID v2';

const NEW_FUNC = `// ${MARKER}
// E2.3 + E2.4 + E5.15 — atualiza taxa (mode=default) ou só publica burst.
// Permissão: owner, admin, ou compartilhamento ativo com permissao=controle.
const pool = global.get('pgPool');
if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return [msg, null]; }

const id = msg.req.params.id;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!id || !UUID_RE.test(id)) { msg.statusCode=400; msg.payload={error:'id invalido'}; return [msg, null]; }

const body = msg.payload || {};
const mode = (body.mode === 'burst') ? 'burst' : (body.mode === 'default' ? 'default' : null);
if (!mode) { msg.statusCode=400; msg.payload={error:'mode deve ser default ou burst'}; return [msg, null]; }

const rate = Number(body.rate_s);
if (!Number.isFinite(rate) || !Number.isInteger(rate) || rate < 1) {
  msg.statusCode=400; msg.payload={error:'rate_s invalido'}; return [msg, null];
}
if (mode === 'default' && rate > 3600) {
  msg.statusCode=400; msg.payload={error:'rate_s (default) deve ser <= 3600'}; return [msg, null];
}
if (mode === 'burst' && rate > 60) {
  msg.statusCode=400; msg.payload={error:'rate_s (burst) deve ser <= 60'}; return [msg, null];
}

let durationS = 0;
if (mode === 'burst') {
  durationS = Number(body.duration_s);
  if (!Number.isFinite(durationS) || !Number.isInteger(durationS) || durationS < 5 || durationS > 1800) {
    msg.statusCode=400; msg.payload={error:'duration_s invalido (5..1800)'}; return [msg, null];
  }
}

try {
  const isAdmin = msg.user && msg.user.role === 'admin';
  let dev, permEff;
  if (isAdmin) {
    const sel = await pool.query(
      'SELECT id, user_id, device_id FROM devices WHERE id=$1 LIMIT 1', [id]
    );
    if (sel.rowCount === 0) { msg.statusCode=404; msg.payload={error:'not found'}; return [msg, null]; }
    dev = sel.rows[0];
    permEff = 'controle';
  } else {
    const sel = await pool.query(
      \`SELECT id, owner_id AS user_id, device_id, permissao::text AS permissao
         FROM dispositivos_visiveis
         WHERE id = $1 AND viewer_id = $2 LIMIT 1\`,
      [id, msg.user.id]
    );
    if (sel.rowCount === 0) { msg.statusCode=404; msg.payload={error:'not found'}; return [msg, null]; }
    dev = sel.rows[0];
    permEff = dev.permissao;
    if (permEff !== 'controle') {
      msg.statusCode=403;
      msg.payload={error:'sem permissao para comandar (acesso somente leitura)'};
      return [msg, null];
    }
  }

  if (mode === 'default') {
    await pool.query('UPDATE devices SET telemetry_interval_s=$1 WHERE id=$2', [rate, id]);
  }

  const cmdId = crypto.randomUUID();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + (mode === 'burst' ? durationS * 1000 : 30000));
  const cmd = {
    cmd_id: cmdId,
    protocol_version: 1,
    cmd: 'set_rate',
    params: { rate_s: rate, mode },
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    origin: 'manual_app_remote',
    user_id: msg.user.id,
    // Backwards-compat: clientes antigos liam estes campos no mesmo payload
    rate_s: rate,
    mode,
    request_id: cmdId,
  };

  const pubMsg = {
    topic: 'devices/' + dev.device_id + '/commands',
    payload: JSON.stringify(cmd),
    qos: 1,
    retain: false,
  };

  msg.statusCode = 200;
  msg.payload = { ok: true, cmd_id: cmdId, request_id: cmdId, applied_rate_s: rate, mode };
  return [msg, pubMsg];
} catch (e) {
  node.error('set rate: ' + e.message, msg);
  msg.statusCode = 500;
  msg.payload = { error: 'internal' };
  return [msg, null];
}`;

const raw = fs.readFileSync(FLOWS, 'utf8');
const flows = JSON.parse(raw);
const target = flows.find(n => n && n.id === FN_ID);
if (!target) { console.error('fnSetRate nao encontrado'); process.exit(2); }
if (typeof target.func === 'string' && target.func.includes(MARKER)) {
  console.log('Ja aplicado. Saindo.'); process.exit(0);
}
function ts() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });
fs.writeFileSync(path.join(BACKUPS, 'flows-pre-e066-' + ts() + '.json'), raw, 'utf8');
target.func = NEW_FUNC;
target.libs = target.libs || [];
if (!target.libs.some(l => l && l.var === 'crypto')) {
  target.libs.push({ var: 'crypto', module: 'crypto' });
}
fs.writeFileSync(FLOWS + '.tmp', JSON.stringify(flows, null, 4) + '\n', 'utf8');
fs.renameSync(FLOWS + '.tmp', FLOWS);
console.log('fnSetRate atualizado. Restart Node-RED.');
