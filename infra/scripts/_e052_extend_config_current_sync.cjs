#!/usr/bin/env node
// E5.2 — Estende o handler de devices/+/config/current pra também sincronizar
// irrigation_sectors e irrigation_configs (campos da bomba) com o que o
// dispositivo publica. Antes só gravava em irrigation_configs.current_pinout.
//
// Filosofia: ESP é fonte de verdade da config (R6). Banco vira cache do que
// o firmware reportou em config/current retained. App lê do banco como antes.
//
// Como modifica:
//   1. Faz backup de flows.json em backups/flows-pre-e052-<timestamp>.json
//   2. Localiza o func node do listener config/current (matching pela string
//      "current_pinout = $2::jsonb" — 1 hit esperado)
//   3. Substitui sua property `func` pela versão estendida
//   4. Escreve flows.json de volta
//
// Após rodar: precisa restart Node-RED.
//   sudo docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered
//
// Idempotência: o script detecta se já está aplicado (matching pela string
// "ESP CONFIG SYNC v2" no func) e aborta se sim.

'use strict';

const fs = require('fs');
const path = require('path');

const FLOWS = '/opt/xtconect/nodered/data/flows.json';
const BACKUPS = '/opt/xtconect/backups';

const NEW_FUNC = `// ESP CONFIG SYNC v2 — handler estendido
// 1. Espelha pinout cru em irrigation_configs.current_pinout (legado)
// 2. Atualiza irrigation_configs com campos top-level de bomba (tipo, nivel
//    ativo, reforco_rele) — ESP é autoridade
// 3. UPSERT em irrigation_sectors por (device_id, numero) com nome,
//    habilitado, gpio_rele, nivel_ativo_rele (preserva debounce_ms,
//    pausado, gpio_botao, etc. do banco — campos não vindos do payload)

const pool = global.get('pgPool');
if (!pool) return null;
const parts = (msg.topic || '').split('/');
if (parts.length !== 4 || parts[0] !== 'devices' || parts[2] !== 'config' || parts[3] !== 'current') return null;
const mqttUser = parts[1];

let cfg = null;
try {
  const raw = Buffer.isBuffer(msg.payload) ? msg.payload.toString('utf8') :
              (typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload));
  if (!raw || raw.trim() === '') return null;
  cfg = JSON.parse(raw);
  if (!cfg || typeof cfg !== 'object') return null;
} catch(e) { node.warn('config/current JSON invalido: '+e.message); return null; }

try {
  const drow = await pool.query('SELECT id FROM devices WHERE mqtt_username = $1', [mqttUser]);
  if (drow.rowCount === 0) {
    node.status({fill:'yellow',shape:'ring',text: mqttUser+' device nao encontrado'});
    return null;
  }
  const deviceId = drow.rows[0].id;

  // 1. Espelho cru do pinout (compat — algum consumer pode usar)
  await pool.query(
    \`UPDATE irrigation_configs
        SET current_pinout = $2::jsonb,
            current_pinout_received_at = NOW()
      WHERE device_id = $1\`,
    [deviceId, JSON.stringify(cfg)]
  );

  // 2. Bomba (config row precisa existir; provision_irr_v1_defaults garante)
  if (cfg.bomba && typeof cfg.bomba === 'object') {
    const b = cfg.bomba;
    const sets = [];
    const params = [deviceId];
    let idx = 1;
    if (b.tipo_bomba === 'monofasica' || b.tipo_bomba === 'inverter') {
      idx++; params.push(b.tipo_bomba); sets.push('tipo_bomba=$'+idx);
    }
    if (b.nivel_ativo_bomba === 'high' || b.nivel_ativo_bomba === 'low') {
      idx++; params.push(b.nivel_ativo_bomba); sets.push('nivel_ativo_bomba=$'+idx);
    }
    if (typeof b.reforco_rele_ativo === 'boolean') {
      idx++; params.push(b.reforco_rele_ativo); sets.push('reforco_rele_ativo=$'+idx);
    }
    if (sets.length > 0) {
      sets.push('atualizado_em=NOW()');
      await pool.query('UPDATE irrigation_configs SET ' + sets.join(', ') + ' WHERE device_id=$1', params);
    }
  }

  // 3. Setores — UPSERT por (device_id, numero); só os que vieram no payload
  if (Array.isArray(cfg.sectors)) {
    let touched = 0;
    for (const s of cfg.sectors) {
      if (!s || typeof s.numero !== 'number' || s.numero < 1 || s.numero > 8) continue;
      const nome = (typeof s.nome === 'string' && s.nome.trim()) ? s.nome.trim().slice(0, 48) : ('Setor ' + s.numero);
      const habilitado = s.habilitado === true;
      const gpio = Number.isFinite(s.gpio_rele) ? s.gpio_rele : 16;
      const nivel = s.nivel_ativo_rele === 'low' ? 'low' : 'high';
      try {
        const ex = await pool.query(
          'SELECT id FROM irrigation_sectors WHERE device_id=$1 AND numero=$2 LIMIT 1',
          [deviceId, s.numero]
        );
        if (ex.rowCount > 0) {
          await pool.query(
            \`UPDATE irrigation_sectors
                SET nome=$3, habilitado=$4, gpio_rele=$5, nivel_ativo_rele=$6
              WHERE device_id=$1 AND numero=$2\`,
            [deviceId, s.numero, nome, habilitado, gpio, nivel]
          );
        } else {
          await pool.query(
            \`INSERT INTO irrigation_sectors
               (device_id, numero, nome, habilitado, gpio_rele, nivel_ativo_rele, debounce_ms, pausado)
             VALUES ($1, $2, $3, $4, $5, $6, 50, FALSE)\`,
            [deviceId, s.numero, nome, habilitado, gpio, nivel]
          );
        }
        touched++;
      } catch(e) {
        node.warn('config/current setor ' + s.numero + ': ' + e.message);
      }
    }
    node.status({fill:'green',shape:'dot',text: mqttUser+' '+touched+' setor(es) sync'});
  } else {
    node.status({fill:'green',shape:'dot',text: mqttUser+' pinout ok (sem sectors[])'});
  }
} catch(e) {
  node.error('config/current merge: '+e.message);
  node.status({fill:'red',shape:'ring',text:'erro: '+e.message});
}
return null;
`;

// =====================================================================

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function main() {
  if (!fs.existsSync(FLOWS)) {
    console.error('flows.json não encontrado em', FLOWS);
    process.exit(2);
  }
  const raw = fs.readFileSync(FLOWS, 'utf8');
  const flows = JSON.parse(raw);
  if (!Array.isArray(flows)) {
    console.error('flows.json não é array');
    process.exit(2);
  }

  // Idempotência
  const already = flows.filter(n =>
    n && n.type === 'function' && typeof n.func === 'string' &&
    n.func.includes('ESP CONFIG SYNC v2')
  );
  if (already.length > 0) {
    console.log('Já aplicado (encontrado "ESP CONFIG SYNC v2" em ' + already.length + ' node(s)). Saindo sem mudanças.');
    process.exit(0);
  }

  // Encontra o handler atual: function node com o SQL legado de current_pinout
  const candidates = flows.filter(n =>
    n && n.type === 'function' && typeof n.func === 'string' &&
    n.func.includes('current_pinout = $2::jsonb') &&
    n.func.includes("config/current JSON invalido")
  );
  if (candidates.length !== 1) {
    console.error('Esperava 1 candidato, achei ' + candidates.length);
    candidates.forEach(c => console.error('  id=' + c.id + ' name=' + (c.name || '?')));
    process.exit(2);
  }
  const target = candidates[0];
  console.log('Encontrei handler atual: id=' + target.id + ' name=' + (target.name || '(sem nome)'));

  // Backup
  if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });
  const bkp = path.join(BACKUPS, 'flows-pre-e052-' + ts() + '.json');
  fs.writeFileSync(bkp, raw, 'utf8');
  console.log('Backup salvo em ' + bkp);

  // Patch
  target.func = NEW_FUNC;
  if (!target.name || target.name === 'Function 1') target.name = 'config/current sync (sectors + bomba)';

  // Escreve atomicamente
  const tmp = FLOWS + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(flows, null, 4) + '\n', 'utf8');
  fs.renameSync(tmp, FLOWS);
  console.log('flows.json atualizado.');
  console.log('');
  console.log('Próximo passo: reiniciar Node-RED:');
  console.log('  sudo docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
}

main();
