#!/usr/bin/env node
// E068_MODE_STATE_MIRROR_v1 — Espelha modo em irrigation_device_state +
// republica retained /state quando mode_set ack=executed.
//
// Bug observado (IRR-V1-00008, fw 0.18.5-net-resilience, 2026-05-11):
//   1. Usuario clicou mode_set manual -> firmware acka "executed/ok".
//   2. irrigation_configs.modo_operacao foi atualizado pra "manual".
//   3. MAS o ESP NAO republica devices/<serial>/state retained, entao
//      state_json.modo continua "automatico" no broker e na tabela
//      irrigation_device_state.
//   4. Frontend le state.modo PRIMEIRO (IrrigacaoDashboardPage:302-305)
//      antes de cair no fallback config.modo_operacao -> UI fica travada
//      mostrando o modo antigo.
//
// Solucao server-side (sem mexer no firmware):
//   No ACK handler (fnHandleIrrAck), quando vier mode_set executed:
//   a) Update irrigation_device_state.state_json.modo via jsonb_set.
//   b) Re-publica devices/<serial>/state retained com state_json atual.
//   Webapp subscribe em /state vai invalidar a query e renderizar correto.
//
// Idempotencia: marker "MODE_STATE_MIRROR_v1" no func.

'use strict';

const fs = require('fs');
const path = require('path');
const FLOWS = '/opt/xtconect/nodered/data/flows.json';
const BACKUPS = '/opt/xtconect/backups';
const FN_ID = 'fnHandleIrrAck';
const MARKER = 'MODE_STATE_MIRROR_v1';

const OLD_BLOCK = `      if (modo === 'manual' || modo === 'automatico') {
        await pool.query(
          \`UPDATE irrigation_configs SET modo_operacao = $1 WHERE device_id = $2\`,
          [modo, row.device_id]
        );
      }`;

const NEW_BLOCK = `      if (modo === 'manual' || modo === 'automatico') {
        await pool.query(
          \`UPDATE irrigation_configs SET modo_operacao = $1 WHERE device_id = $2\`,
          [modo, row.device_id]
        );
        // ${MARKER} — fw 0.18.5 nao republica /state apos mode_set.
        // Espelha modo em irrigation_device_state + republica retained
        // /state pra UI nao ficar travada no valor antigo.
        try {
          const stRow = await pool.query(
            \`UPDATE irrigation_device_state SET state_json = jsonb_set(state_json, '{modo}', to_jsonb($1::text), true), received_at = NOW() WHERE device_id = $2 RETURNING state_json\`,
            [modo, row.device_id]
          );
          const drow = await pool.query('SELECT device_id AS serial FROM devices WHERE id = $1', [row.device_id]);
          if (stRow.rowCount > 0 && drow.rowCount > 0) {
            const stateMsg = {
              topic: 'devices/' + drow.rows[0].serial + '/state',
              payload: JSON.stringify(stRow.rows[0].state_json),
              qos: 1, retain: true
            };
            try { node.send([null, stateMsg]); } catch(eSend) {}
          }
        } catch(eMirror) { node.warn('${MARKER}: ' + eMirror.message); }
      }`;

function ts() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

const raw = fs.readFileSync(FLOWS, 'utf8');
const flows = JSON.parse(raw);
const target = flows.find(n => n && n.id === FN_ID);
if (!target) { console.error('ERRO: ' + FN_ID + ' nao encontrado'); process.exit(2); }
if (typeof target.func !== 'string') { console.error('ERRO: target.func nao e string'); process.exit(2); }
if (target.func.includes(MARKER)) {
  console.log('Ja aplicado (' + MARKER + '). Saindo.');
  process.exit(0);
}
if (!target.func.includes(OLD_BLOCK)) {
  console.error('ERRO: bloco original nao encontrado em ' + FN_ID + '. Aborting.');
  console.error('Provavelmente o func foi reescrito por outra inject. Cheque diff.');
  process.exit(3);
}

if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });
fs.writeFileSync(path.join(BACKUPS, 'flows-pre-e068-' + ts() + '.json'), raw, 'utf8');

target.func = target.func.replace(OLD_BLOCK, NEW_BLOCK);

fs.writeFileSync(FLOWS + '.tmp', JSON.stringify(flows, null, 4) + '\n', 'utf8');
fs.renameSync(FLOWS + '.tmp', FLOWS);
console.log(FN_ID + ' patcheado com ' + MARKER + '. Restart Node-RED.');
