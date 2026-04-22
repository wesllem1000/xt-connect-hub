#!/usr/bin/env node
// E3.2 — Expõe prefixo/major_version nos endpoints de modelo (refs #65)
// Pra UI admin filtrar modelos provisionáveis (linha legada sem prefixo
// não deve aparecer no dropdown de provisionamento).
//
// Idempotente (substitui func inteira).
//
// Uso: sudo node /opt/xtconect/scripts/_e031_patch_modelos.js
//      docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered

const fs = require('fs');
const PATH = '/opt/xtconect/nodered/data/flows.json';
const flows = JSON.parse(fs.readFileSync(PATH, 'utf8'));
function find(id) { return flows.find(n => n.id === id); }

// fnListModelos: adiciona prefixo, major_version, ativo na select
{
  const n = find('fnListModelos');
  if (!n) throw new Error('fnListModelos not found');
  n.func = [
    "const pool = global.get('pgPool');",
    "if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }",
    "const sql = `",
    "  SELECT",
    "    m.id, m.nome, m.descricao, m.fabricante, m.criado_em,",
    "    m.prefixo, m.major_version, m.rate_default_segundos, m.ativo,",
    "    (SELECT COUNT(*)::int FROM devices d WHERE d.modelo_id = m.id) AS total_dispositivos",
    "  FROM modelos_dispositivo m",
    "  WHERE m.ativo = TRUE",
    "  ORDER BY m.nome ASC",
    "`;",
    "try {",
    "  const r = await pool.query(sql);",
    "  msg.statusCode = 200;",
    "  msg.payload = r.rows;",
    "} catch(e) {",
    "  node.error('list modelos: '+e.message, msg);",
    "  msg.statusCode = 500; msg.payload = {error:'internal'};",
    "}",
    "return msg;"
  ].join('\n');
}

// fnGetModelo: adiciona prefixo, major_version, rate_default_segundos
{
  const n = find('fnGetModelo');
  if (!n) throw new Error('fnGetModelo not found');
  n.func = [
    "const pool = global.get('pgPool');",
    "if (!pool) { msg.statusCode=503; msg.payload={error:'db not ready'}; return msg; }",
    "const id = msg.req.params.id;",
    "if (!/^[0-9a-f-]{36}$/i.test(id)) { msg.statusCode=400; msg.payload={error:'invalid id'}; return msg; }",
    "try {",
    "  const r = await pool.query('SELECT id,nome,descricao,fabricante,imagem_url,especificacoes,protocolos_suportados,retencao_historico_horas,ativo,criado_em,atualizado_em,prefixo,major_version,rate_default_segundos FROM modelos_dispositivo WHERE id=$1',[id]);",
    "  if (r.rowCount===0) { msg.statusCode=404; msg.payload={error:'not found'}; return msg; }",
    "  const modelo = r.rows[0];",
    "  const w = await pool.query(`",
    "    SELECT mw.id, mw.widget_id AS catalogo_widget_id, mw.titulo, mw.ordem,",
    "           mw.coluna, mw.linha, mw.largura, mw.altura,",
    "           mw.direcao, mw.json_path_leitura, mw.nome_comando,",
    "           mw.configuracao AS config_padrao, mw.ativo,",
    "           cw.nome AS widget_nome, cw.tipo AS widget_tipo, cw.icone AS widget_icone",
    "    FROM modelo_widgets mw",
    "    JOIN catalogo_widgets cw ON cw.id = mw.widget_id",
    "    WHERE mw.modelo_id = $1 AND mw.ativo = TRUE",
    "    ORDER BY mw.ordem ASC",
    "  `, [id]);",
    "  modelo.widgets = w.rows;",
    "  msg.statusCode = 200;",
    "  msg.payload = modelo;",
    "} catch(e) {",
    "  node.error('get modelo: '+e.message, msg);",
    "  msg.statusCode = 500; msg.payload = {error:'internal'};",
    "}",
    "return msg;"
  ].join('\n');
}

fs.writeFileSync(PATH, JSON.stringify(flows, null, 4));
console.log('E3.2: fnListModelos + fnGetModelo agora expõem prefixo/major_version.');
console.log('Reinicie: docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
