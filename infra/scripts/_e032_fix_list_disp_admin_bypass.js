#!/usr/bin/env node
// E3.1 follow-up — remove bypass de admin no fnListDisp (refs #65)
//
// Contexto: admin via /dispositivos enxergava TUDO (ociosos sem dono + devices
// de outros users), porque o handler tinha branch `if (isAdmin)` que consultava
// devices direto sem filtro.
//
// Decisão: admin usa /admin/produtos pra visão de fleet; /dispositivos é
// sempre do ponto-de-vista do user logado (owner + shares ativos).
//
// Idempotente (substitui a função inteira).
//
// Uso: sudo node /opt/xtconect/scripts/_e032_fix_list_disp_admin_bypass.js
//      docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered

const fs = require('fs');
const PATH = '/opt/xtconect/nodered/data/flows.json';
const flows = JSON.parse(fs.readFileSync(PATH, 'utf8'));
function find(id) { return flows.find(n => n.id === id); }

{
  const n = find('fnListDisp');
  if (!n) throw new Error('fnListDisp not found');
  n.func = [
    "// E3.1 follow-up — sempre do ponto-de-vista do user logado (owner + shares ativos).",
    "// Admin usa /admin/produtos pra visão de fleet; nada de bypass aqui.",
    "const pool = global.get('pgPool');",
    "if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }",
    "const userId = msg.user && msg.user.id;",
    "if (!userId) { msg.statusCode=401; msg.payload={error:'unauthenticated'}; return msg; }",
    "try {",
    "  const r = await pool.query(`",
    "    SELECT",
    "      v.id,",
    "      COALESCE(NULLIF(v.nome_amigavel, ''), v.name) AS nome,",
    "      v.device_id AS serial,",
    "      m.nome AS modelo,",
    "      uv.recebido_em AS ultimo_valor,",
    "      v.created_at AS criado_em,",
    "      v.is_online AS online,",
    "      v.last_seen AS last_seen_at,",
    "      v.telemetry_interval_s,",
    "      v.burst_rate_s,",
    "      v.access_type,",
    "      v.permissao::text AS permissao,",
    "      v.share_id",
    "    FROM dispositivos_visiveis v",
    "    LEFT JOIN modelos_dispositivo m ON m.id = v.modelo_id",
    "    LEFT JOIN LATERAL (",
    "      SELECT recebido_em FROM dispositivo_ultimo_valor",
    "      WHERE dispositivo_id = v.id ORDER BY recebido_em DESC LIMIT 1",
    "    ) uv ON TRUE",
    "    WHERE v.viewer_id = $1::uuid",
    "    ORDER BY v.created_at DESC",
    "  `, [userId]);",
    "  msg.statusCode = 200;",
    "  msg.payload = r.rows;",
    "} catch(e) {",
    "  node.error('list dispositivos: '+e.message, msg);",
    "  msg.statusCode = 500; msg.payload = {error:'internal'};",
    "}",
    "return msg;"
  ].join('\n');
}

fs.writeFileSync(PATH, JSON.stringify(flows, null, 4));
console.log('E3.1 fix: fnListDisp sem bypass de admin.');
console.log('Reinicie: docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
