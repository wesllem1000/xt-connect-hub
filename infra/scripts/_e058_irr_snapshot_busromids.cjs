#!/usr/bin/env node
// E5.19 — Patch IrrSnapshot: expoe bus_rom_ids no payload pra alimentar a UX
// "sensores detectados" no painel.
//
// Auditoria: o snapshot atual junta config/sectors/timers/sensors/alarms/state.
// Depois da migration 024, irrigation_configs.bus_rom_ids tem TEXT[] dos ROM
// detectados pelo firmware. Frontend precisa desse array no snapshot pra
// computar disponíveis = bus_rom_ids \ sensors[].rom_id.
//
// Idempotente: marker DS18 SNAPSHOT v1 no func node.

'use strict';

const fs = require('fs');
const path = require('path');
const FLOWS = '/opt/xtconect/nodered/data/flows.json';
const BACKUPS = '/opt/xtconect/backups';
const MARKER = 'DS18 SNAPSHOT v1';

function ts() {
  const d = new Date();
  return d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0') +
         '-' + String(d.getHours()).padStart(2,'0') + String(d.getMinutes()).padStart(2,'0') + String(d.getSeconds()).padStart(2,'0');
}

function main() {
  if (!fs.existsSync(FLOWS)) { console.error('flows.json nao encontrado'); process.exit(2); }
  const raw = fs.readFileSync(FLOWS, 'utf8');
  const flows = JSON.parse(raw);

  const fnSnapshot = flows.find(function(n){
    return n && n.type === 'function' && typeof n.func === 'string' &&
           /irrigation_configs WHERE device_id=\$1/.test(n.func) &&
           /irrigation_alarms WHERE device_id=\$1/.test(n.func) &&
           /active_alarms: alarms.rows/.test(n.func);
  });
  if (!fnSnapshot) {
    console.error('IrrSnapshot func node nao encontrado.');
    process.exit(2);
  }

  if (fnSnapshot.func.indexOf(MARKER) !== -1) {
    console.log('Ja aplicado (' + MARKER + '). Saindo.');
    process.exit(0);
  }

  // Backup
  if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });
  const bkp = path.join(BACKUPS, 'flows-pre-e058-' + ts() + '.json');
  fs.writeFileSync(bkp, raw, 'utf8');
  console.log('Backup salvo em ' + bkp);

  // Patch 1: adiciona bus_rom_ids extraido do config no payload final.
  // O config row ja vem completo da query existente (SELECT * FROM
  // irrigation_configs), entao bus_rom_ids esta disponivel em config.rows[0].
  fnSnapshot.func = fnSnapshot.func.replace(
    'active_alarms: alarms.rows,\n    state: state.rows[0]',
    "active_alarms: alarms.rows,\n    bus_rom_ids: (config.rows[0] && Array.isArray(config.rows[0].bus_rom_ids)) ? config.rows[0].bus_rom_ids : [], // " + MARKER + "\n    state: state.rows[0]"
  );

  // Verifica se a substituicao deu certo
  if (fnSnapshot.func.indexOf(MARKER) === -1) {
    console.error('Padrao de substituicao nao encontrado — IrrSnapshot pode ter sido alterado fora desse script.');
    console.error('Reinjete _e041 + _e042a primeiro, ou ajuste o patch.');
    process.exit(2);
  }

  const tmp = FLOWS + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(flows, null, 4) + '\n', 'utf8');
  fs.renameSync(tmp, FLOWS);
  console.log('IrrSnapshot patcheado: bus_rom_ids exposto.');
  console.log('Proximo passo: sudo docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
}

main();
