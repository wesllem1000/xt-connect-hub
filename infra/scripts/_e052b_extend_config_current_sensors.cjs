#!/usr/bin/env node
// E5.2b — Estende o handler de devices/+/config/current pra também sincronizar
// irrigation_temperature_sensors (UPSERT por rom_id + DELETE dos ausentes).
//
// Filosofia: igual aos sectors (ESP é fonte de verdade da config, R6). O ESP
// faz scan 1-Wire na boot, descobre os ROMs, e publica o conjunto. Banco vira
// cache. Se um ROM somem (sensor desconectado fisicamente), ele é removido
// do cache pra não aparecer fantasma no app.
//
// Como modifica:
//   1. Backup de flows.json em backups/flows-pre-e052b-<timestamp>.json
//   2. Localiza o func node com o marker "ESP CONFIG SYNC v2" (instalado por
//      _e052) e substitui pela versão v3 (que adiciona o bloco de sensors).
//   3. Escreve flows.json de volta.
//
// Pré-requisito: _e052 deve ter rodado antes (precisa do marker v2). Se não
// tiver rodado, o script aborta.
//
// Idempotência: se já encontrar marker "ESP CONFIG SYNC v3", sai sem mudanças.
//
// Após rodar:
//   sudo docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered

'use strict';

const fs = require('fs');
const path = require('path');

const FLOWS = '/opt/xtconect/nodered/data/flows.json';
const BACKUPS = '/opt/xtconect/backups';
const MARKER_OLD = 'ESP CONFIG SYNC v2';
const MARKER_NEW = 'ESP CONFIG SYNC v3';

const NEW_FUNC = `// ${MARKER_NEW} — handler estendido (sectors + bomba + sensors)
// Adicionado em v3: UPSERT em irrigation_temperature_sensors por (device_id,
// rom_id) + DELETE dos rom_ids ausentes da payload (ESP é autoridade do scan
// 1-Wire — se sumiu do conjunto reportado, sumiu fisicamente).

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

  // 1. Espelho cru do pinout
  await pool.query(
    \`UPDATE irrigation_configs
        SET current_pinout = $2::jsonb,
            current_pinout_received_at = NOW()
      WHERE device_id = $1\`,
    [deviceId, JSON.stringify(cfg)]
  );

  // 2. Bomba
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

  // 3. Setores — UPSERT por (device_id, numero)
  let setoresSync = 0;
  if (Array.isArray(cfg.sectors)) {
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
        setoresSync++;
      } catch(e) {
        node.warn('config/current setor ' + s.numero + ': ' + e.message);
      }
    }
  }

  // 4. Sensors temperatura — UPSERT por (device_id, rom_id) + DELETE ausentes
  let sensorsSync = 0;
  let sensorsDel = 0;
  if (Array.isArray(cfg.sensors)) {
    const incomingRoms = [];
    for (const s of cfg.sensors) {
      if (!s || typeof s.rom_id !== 'string' || !s.rom_id) continue;
      if (s.role !== 'pump' && s.role !== 'inverter' && s.role !== 'custom') continue;
      if (!Number.isFinite(Number(s.limite_alarme_c))) continue;
      incomingRoms.push(s.rom_id);
      const nome = (typeof s.nome === 'string' && s.nome.trim()) ? s.nome.trim().slice(0, 96) : 'Sensor';
      const limite = Number(s.limite_alarme_c);
      const histerese = Number.isFinite(Number(s.histerese_c)) ? Number(s.histerese_c) : 5;
      const ack = s.ack_usuario_requerido !== false;
      const ativo = s.ativo !== false;
      try {
        const ex = await pool.query(
          'SELECT id FROM irrigation_temperature_sensors WHERE device_id=$1 AND rom_id=$2 LIMIT 1',
          [deviceId, s.rom_id]
        );
        if (ex.rowCount > 0) {
          await pool.query(
            \`UPDATE irrigation_temperature_sensors
                SET nome=$3, role=$4, limite_alarme_c=$5, histerese_c=$6,
                    ack_usuario_requerido=$7, ativo=$8
              WHERE device_id=$1 AND rom_id=$2\`,
            [deviceId, s.rom_id, nome, s.role, limite, histerese, ack, ativo]
          );
        } else {
          await pool.query(
            \`INSERT INTO irrigation_temperature_sensors
               (device_id, rom_id, nome, role, limite_alarme_c, histerese_c, ack_usuario_requerido, ativo)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)\`,
            [deviceId, s.rom_id, nome, s.role, limite, histerese, ack, ativo]
          );
        }
        sensorsSync++;
      } catch(e) {
        node.warn('config/current sensor ' + s.rom_id + ': ' + e.message);
      }
    }
    // DELETE: rom_ids que existem no banco e não vieram no payload
    try {
      let delRes;
      if (incomingRoms.length === 0) {
        delRes = await pool.query('DELETE FROM irrigation_temperature_sensors WHERE device_id=$1', [deviceId]);
      } else {
        delRes = await pool.query(
          'DELETE FROM irrigation_temperature_sensors WHERE device_id=$1 AND rom_id <> ALL($2::text[])',
          [deviceId, incomingRoms]
        );
      }
      sensorsDel = delRes.rowCount || 0;
    } catch(e) {
      node.warn('config/current sensors delete: ' + e.message);
    }
  }

  const parts2 = [];
  if (setoresSync > 0) parts2.push(setoresSync+' setor(es)');
  if (sensorsSync > 0) parts2.push(sensorsSync+' sensor(es)');
  if (sensorsDel > 0) parts2.push(sensorsDel+' sensor(es) removido(s)');
  const txt = parts2.length === 0 ? 'pinout ok' : parts2.join(', ');
  node.status({fill:'green',shape:'dot',text: mqttUser+' '+txt});
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
    console.error('flows.json nao encontrado em', FLOWS);
    process.exit(2);
  }
  const raw = fs.readFileSync(FLOWS, 'utf8');
  const flows = JSON.parse(raw);
  if (!Array.isArray(flows)) {
    console.error('flows.json nao e array');
    process.exit(2);
  }

  // Idempotencia
  const alreadyV3 = flows.filter(n =>
    n && n.type === 'function' && typeof n.func === 'string' &&
    n.func.includes(MARKER_NEW)
  );
  if (alreadyV3.length > 0) {
    console.log('Ja aplicado (encontrado "' + MARKER_NEW + '" em ' + alreadyV3.length + ' node(s)). Saindo sem mudancas.');
    process.exit(0);
  }

  // Encontra o handler v2 instalado por _e052
  const candidates = flows.filter(n =>
    n && n.type === 'function' && typeof n.func === 'string' &&
    n.func.includes(MARKER_OLD)
  );
  if (candidates.length !== 1) {
    console.error('Esperava 1 candidato com marker "' + MARKER_OLD + '", achei ' + candidates.length);
    console.error('Rode _e052_extend_config_current_sync.cjs primeiro.');
    candidates.forEach(c => console.error('  id=' + c.id + ' name=' + (c.name || '?')));
    process.exit(2);
  }
  const target = candidates[0];
  console.log('Encontrei handler v2: id=' + target.id + ' name=' + (target.name || '(sem nome)'));

  // Backup
  if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });
  const bkp = path.join(BACKUPS, 'flows-pre-e052b-' + ts() + '.json');
  fs.writeFileSync(bkp, raw, 'utf8');
  console.log('Backup salvo em ' + bkp);

  // Patch
  target.func = NEW_FUNC;
  target.name = 'config/current sync (sectors + bomba + sensors)';

  // Escreve atomicamente
  const tmp = FLOWS + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(flows, null, 4) + '\n', 'utf8');
  fs.renameSync(tmp, FLOWS);
  console.log('flows.json atualizado.');
  console.log('');
  console.log('Proximo passo: reiniciar Node-RED:');
  console.log('  sudo docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
}

main();
