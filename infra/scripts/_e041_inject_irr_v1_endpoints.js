#!/usr/bin/env node
// E4.1 — IRR-V1 endpoints GET + hooks de provisionamento (refs #71)
//
// Idempotente. Injeta no flows.json:
//   1) Patch fnProvisionar pra chamar provision_irr_v1_defaults quando
//      modelo tem requires_provisioning_template=true.
//   2) Patch fnClaim (defensivo) pra chamar a mesma procedure se o
//      device for IRR-V1 e a config ainda não existir (guarda contra
//      race ou devices criados antes da migration).
//   3) 7 endpoints GET read-only, todos sob /dispositivos/:id/irrigacao:
//      - /snapshot          (payload agregado pro dashboard)
//      - /config
//      - /setores
//      - /timers
//      - /sensores-temperatura
//      - /eventos (paginado)
//      - /alarmes/ativos
//   Middleware comum: JWT + owner-or-share check (admin bypass).
//
// Uso: sudo node /opt/xtconect/scripts/_e041_inject_irr_v1_endpoints.js
//      docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered

const fs = require('fs');
const PATH = '/opt/xtconect/nodered/data/flows.json';
const flows = JSON.parse(fs.readFileSync(PATH, 'utf8'));
function find(id) { return flows.find(n => n.id === id); }
function removeId(id) {
  const i = flows.findIndex(n => n.id === id);
  if (i >= 0) flows.splice(i, 1);
}

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
const AUTH_LIBS = [{ var: 'jwt', module: 'jsonwebtoken' }];

function httpInNode(id, name, url, method, x, y, nextId) {
  return { id, type: 'http in', z: 'tabAuth', name, url, method,
    upload: false, swaggerDoc: '', x, y, wires: [[nextId]] };
}
function authNode(id, x, y, okWire, errWire) {
  return { id, type: 'function', z: 'tabAuth', name: 'Auth JWT',
    func: AUTH_FUNC, outputs: 2, libs: AUTH_LIBS, x, y, wires: [[okWire], [errWire]] };
}
function respNode(id, x, y) {
  return { id, type: 'http response', z: 'tabAuth', name: '',
    statusCode: '', headers: { 'Content-Type': 'application/json' }, x, y, wires: [] };
}

// ============================================================
// Helper compartilhado: verifica acesso ao device (owner ou share ativo;
// admin bypass). Retorna {deviceRow, access} ou null + set msg erro.
// Inline function usada por todos os GETs IRR-V1.
// ============================================================
const ACCESS_HELPER_SQL = [
  "async function checkDeviceAccess(pool, deviceId, user) {",
  "  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;",
  "  if (!UUID_RE.test(deviceId)) return { err: 400, msg: 'id invalido' };",
  "  const isAdmin = user && user.role === 'admin';",
  "  const r = await pool.query(",
  "    `SELECT d.id, d.device_id AS serial, d.user_id AS owner_id, d.status, d.modelo_id,",
  "            m.prefixo, m.major_version",
  "       FROM devices d LEFT JOIN modelos_dispositivo m ON m.id = d.modelo_id",
  "      WHERE d.id = $1 LIMIT 1`,",
  "    [deviceId]",
  "  );",
  "  if (r.rowCount === 0) return { err: 404, msg: 'dispositivo nao encontrado' };",
  "  const dev = r.rows[0];",
  "  if (isAdmin) return { device: dev, access: 'admin' };",
  "  if (dev.owner_id === user.id) return { device: dev, access: 'owner' };",
  "  const s = await pool.query(",
  "    `SELECT permissao::text AS permissao FROM dispositivo_compartilhado",
  "       WHERE dispositivo_id = $1 AND com_usuario_id = $2 AND status = 'ativo' LIMIT 1`,",
  "    [deviceId, user.id]",
  "  );",
  "  if (s.rowCount > 0) return { device: dev, access: 'share', permissao: s.rows[0].permissao };",
  "  return { err: 403, msg: 'sem acesso a este dispositivo' };",
  "}",
].join('\n');

function irrEndpoint(idPrefix, url, method, x, y, handlerBody) {
  removeId('http' + idPrefix);
  removeId('fnAuth' + idPrefix);
  removeId('fn' + idPrefix);
  removeId('resp' + idPrefix);
  flows.push(httpInNode('http' + idPrefix, `${method.toUpperCase()} ${url}`,
    url, method, x, y, 'fnAuth' + idPrefix));
  flows.push(authNode('fnAuth' + idPrefix, x + 240, y, 'fn' + idPrefix, 'resp' + idPrefix));
  flows.push({
    id: 'fn' + idPrefix, type: 'function', z: 'tabAuth', name: idPrefix,
    func: [
      "const pool = global.get('pgPool');",
      "if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }",
      ACCESS_HELPER_SQL,
      "try {",
      "  const chk = await checkDeviceAccess(pool, msg.req.params.id, msg.user);",
      "  if (chk.err) { msg.statusCode=chk.err; msg.payload={error:chk.msg}; return msg; }",
      "  const device = chk.device;",
      "  // Verifica modelo IRR-V1",
      "  if (device.prefixo !== 'IRR' || device.major_version !== 'V1') {",
      "    msg.statusCode=400; msg.payload={error:'device nao e IRR-V1'}; return msg;",
      "  }",
      handlerBody,
      "} catch(e) {",
      `  node.error('${idPrefix}: '+e.message, msg);`,
      "  msg.statusCode=500; msg.payload={error:'internal'};",
      "}",
      "return msg;"
    ].join('\n'),
    outputs: 1, libs: [],
    x: x + 480, y, wires: [['resp' + idPrefix]],
  });
  flows.push(respNode('resp' + idPrefix, x + 720, y));
}

// ============================================================
// 1) PATCH fnProvisionar — chama provision_irr_v1_defaults
// ============================================================
{
  const n = find('fnProvisionar');
  if (!n) throw new Error('fnProvisionar not found');
  // Checa se já tem hook — idempotência
  if (!n.func.includes('provision_irr_v1_defaults')) {
    // Insere chamada após o dynsec createClient/addClientRole, antes do return de sucesso.
    const marker = "  msg.statusCode = 200;\n  msg.payload = {";
    if (!n.func.includes(marker)) {
      throw new Error('fnProvisionar marker missing — manual fix needed');
    }
    const insertion = [
      "  // E4.1 — se modelo requer template (IRR-V1), roda procedure de provisionamento.",
      "  try {",
      "    const flags = await pool.query(",
      "      \"SELECT especificacoes->'flags'->>'provisioning_procedure' AS proc FROM modelos_dispositivo WHERE id=$1\",",
      "      [modeloId]",
      "    );",
      "    const procName = flags.rows[0] && flags.rows[0].proc;",
      "    if (procName === 'provision_irr_v1_defaults') {",
      "      await pool.query('SELECT * FROM provision_irr_v1_defaults($1)', [createdId]);",
      "      node.log('IRR-V1 defaults provisionados pra ' + serial);",
      "    }",
      "  } catch(e) { node.warn('provisioning template falhou: ' + e.message); }",
      "",
      marker,
    ].join('\n');
    n.func = n.func.replace(marker, insertion);
  }
}

// ============================================================
// 2) PATCH fnClaim — provisiona defensivamente se IRR-V1
// ============================================================
{
  const n = find('fnClaim');
  if (!n) throw new Error('fnClaim not found');
  if (!n.func.includes('provision_irr_v1_defaults')) {
    const marker = "  msg.statusCode = 200;\n  msg.payload = { dispositivo: r.rows[0] };";
    if (!n.func.includes(marker)) {
      throw new Error('fnClaim marker missing — manual fix needed');
    }
    const insertion = [
      "  // E4.1 — Defensivo: se IRR-V1 e ainda não tem config, provisiona.",
      "  try {",
      "    const mod = await pool.query(",
      "      `SELECT m.prefixo, m.major_version FROM devices d",
      "         LEFT JOIN modelos_dispositivo m ON m.id = d.modelo_id",
      "         WHERE d.id = $1 LIMIT 1`,",
      "      [cur.id]",
      "    );",
      "    if (mod.rowCount > 0 &&",
      "        mod.rows[0].prefixo === 'IRR' && mod.rows[0].major_version === 'V1') {",
      "      const existing = await pool.query('SELECT 1 FROM irrigation_configs WHERE device_id=$1', [cur.id]);",
      "      if (existing.rowCount === 0) {",
      "        await pool.query('SELECT * FROM provision_irr_v1_defaults($1)', [cur.id]);",
      "        node.log('IRR-V1 defaults defensivamente provisionados pra ' + cur.id);",
      "      }",
      "    }",
      "  } catch(e) { node.warn('claim defensive provisioning: ' + e.message); }",
      "",
      marker,
    ].join('\n');
    n.func = n.func.replace(marker, insertion);
  }
}

// ============================================================
// 3) ENDPOINTS GET IRR-V1 — 7 no total
// ============================================================

// 3.1 GET /dispositivos/:id/irrigacao/snapshot
irrEndpoint('IrrSnapshot',
  '/dispositivos/:id/irrigacao/snapshot', 'get', 200, 3500,
  [
    "  const devId = device.id;",
    "  const [config, sectors, timers, sensors, alarms] = await Promise.all([",
    "    pool.query('SELECT * FROM irrigation_configs WHERE device_id=$1', [devId]),",
    "    pool.query('SELECT id, numero, nome, habilitado, pausado, gpio_rele, nivel_ativo_rele, tipo_botao_fisico, gpio_botao, debounce_ms, ultimo_acionamento_em, ultima_duracao_s, proxima_execucao_em FROM irrigation_sectors WHERE device_id=$1 ORDER BY numero', [devId]),",
    "    pool.query('SELECT * FROM irrigation_timers WHERE device_id=$1 ORDER BY criado_em DESC', [devId]),",
    "    pool.query('SELECT * FROM irrigation_temperature_sensors WHERE device_id=$1 ORDER BY criado_em', [devId]),",
    "    pool.query('SELECT * FROM irrigation_alarms WHERE device_id=$1 AND resolved_at IS NULL ORDER BY triggered_at DESC', [devId]),",
    "  ]);",
    "  msg.statusCode = 200;",
    "  msg.payload = {",
    "    device: { id: device.id, serial: device.serial, modelo: device.prefixo + '-' + device.major_version },",
    "    config: config.rows[0] || null,",
    "    sectors: sectors.rows,",
    "    timers: timers.rows,",
    "    sensors: sensors.rows,",
    "    active_alarms: alarms.rows",
    "  };"
  ].join('\n')
);

// 3.2 GET /config
irrEndpoint('IrrGetConfig',
  '/dispositivos/:id/irrigacao/config', 'get', 200, 3600,
  [
    "  const r = await pool.query('SELECT * FROM irrigation_configs WHERE device_id=$1', [device.id]);",
    "  if (r.rowCount === 0) { msg.statusCode=404; msg.payload={error:'config nao provisionada'}; return msg; }",
    "  msg.statusCode=200; msg.payload={ config: r.rows[0] };"
  ].join('\n')
);

// 3.3 GET /setores
irrEndpoint('IrrGetSectors',
  '/dispositivos/:id/irrigacao/setores', 'get', 200, 3700,
  [
    "  const r = await pool.query(",
    "    `SELECT id, numero, nome, habilitado, pausado, gpio_rele, nivel_ativo_rele,",
    "            tipo_botao_fisico, gpio_botao, debounce_ms,",
    "            ultimo_acionamento_em, ultima_duracao_s, proxima_execucao_em",
    "       FROM irrigation_sectors WHERE device_id=$1 ORDER BY numero`,",
    "    [device.id]",
    "  );",
    "  msg.statusCode=200; msg.payload={ setores: r.rows };"
  ].join('\n')
);

// 3.4 GET /timers
irrEndpoint('IrrGetTimers',
  '/dispositivos/:id/irrigacao/timers', 'get', 200, 3800,
  [
    "  const q = msg.req.query || {};",
    "  const wheres = ['device_id=$1'];",
    "  const params = [device.id];",
    "  if (q.alvo_tipo && (q.alvo_tipo === 'pump' || q.alvo_tipo === 'sector')) {",
    "    params.push(q.alvo_tipo); wheres.push('alvo_tipo=$' + params.length);",
    "  }",
    "  if (q.alvo_id) { params.push(q.alvo_id); wheres.push('alvo_id=$' + params.length); }",
    "  const sql = 'SELECT * FROM irrigation_timers WHERE ' + wheres.join(' AND ') + ' ORDER BY criado_em DESC';",
    "  const r = await pool.query(sql, params);",
    "  msg.statusCode=200; msg.payload={ timers: r.rows };"
  ].join('\n')
);

// 3.5 GET /sensores-temperatura
irrEndpoint('IrrGetSensors',
  '/dispositivos/:id/irrigacao/sensores-temperatura', 'get', 200, 3900,
  [
    "  const r = await pool.query(",
    "    'SELECT * FROM irrigation_temperature_sensors WHERE device_id=$1 ORDER BY criado_em',",
    "    [device.id]",
    "  );",
    "  msg.statusCode=200; msg.payload={ sensores: r.rows };"
  ].join('\n')
);

// 3.6 GET /eventos (paginado)
irrEndpoint('IrrGetEvents',
  '/dispositivos/:id/irrigacao/eventos', 'get', 200, 4000,
  [
    "  const q = msg.req.query || {};",
    "  let limit = parseInt(q.limit || '100', 10); if (!Number.isFinite(limit) || limit < 1 || limit > 500) limit = 100;",
    "  let offset = parseInt(q.offset || '0', 10); if (!Number.isFinite(offset) || offset < 0) offset = 0;",
    "  const wheres = ['device_id=$1']; const params = [device.id];",
    "  if (q.tipo) { params.push(q.tipo); wheres.push('event_type=$' + params.length); }",
    "  if (q.from) { params.push(q.from); wheres.push('ts >= $' + params.length); }",
    "  if (q.to)   { params.push(q.to);   wheres.push('ts <= $' + params.length); }",
    "  if (q.alvo_tipo) { params.push(q.alvo_tipo); wheres.push('alvo_tipo=$' + params.length); }",
    "  params.push(limit); params.push(offset);",
    "  const limIdx = params.length - 1; const offIdx = params.length;",
    "  const sql = 'SELECT * FROM irrigation_events WHERE ' + wheres.join(' AND ') +",
    "              ' ORDER BY ts DESC LIMIT $' + limIdx + ' OFFSET $' + offIdx;",
    "  const r = await pool.query(sql, params);",
    "  // count sem paginação",
    "  const countParams = params.slice(0, params.length - 2);",
    "  const countSql = 'SELECT COUNT(*)::int AS n FROM irrigation_events WHERE ' + wheres.join(' AND ');",
    "  const c = await pool.query(countSql, countParams);",
    "  msg.statusCode=200;",
    "  msg.payload = { eventos: r.rows, paginacao: { limit: limit, offset: offset, total: c.rows[0].n } };"
  ].join('\n')
);

// 3.7 GET /alarmes/ativos
irrEndpoint('IrrGetActiveAlarms',
  '/dispositivos/:id/irrigacao/alarmes/ativos', 'get', 200, 4100,
  [
    "  const r = await pool.query(",
    "    'SELECT * FROM irrigation_alarms WHERE device_id=$1 AND resolved_at IS NULL ORDER BY triggered_at DESC',",
    "    [device.id]",
    "  );",
    "  msg.statusCode=200; msg.payload={ alarmes: r.rows };"
  ].join('\n')
);

fs.writeFileSync(PATH, JSON.stringify(flows, null, 4));
console.log('E4.1: IRR-V1 endpoints + provisioning hooks injetados.');
console.log('Reinicie: docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
