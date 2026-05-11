#!/usr/bin/env node
// E5.2 — Fix ACK topic subscriber: devices/+/commands/ack → devices/+/ack
//
// CONTEXTO:
//   Firmware IRR-V1 versão 0.15.5+ publica ACKs em `devices/<id>/ack`.
//   O nó mqtt-in `mqttInIrrAck` ainda assina `devices/+/commands/ack`
//   (nomenclatura de versão antiga). Sebastião confirmou: firmware NÃO muda,
//   Node-RED se ajusta. Decisão alinhada na Fase 0 v0.15.6.
//
// NÓS AFETADOS:
//   - mqttInIrrAck  (mqtt in)   topic: devices/+/commands/ack → devices/+/ack
//
// NÓS NÃO AFETADOS:
//   - fnHandleIrrAck: não usa msg.topic, só msg.payload — sem mudança necessária
//   - Nenhum mqtt-out publica em devices/+/commands/ack — sem publisher morto
//
// ACL DYNSEC:
//   - Client "nodered" usa role "service-admin" com subscribePattern "#" allow=true
//   - Cobre devices/+/ack sem necessidade de alteração na ACL
//
// IDEMPOTÊNCIA:
//   - Se topic já for devices/+/ack, o script não altera nada e reporta "já ok"
//
// COMO RODAR (NÃO fazer ainda — aguardar ordem do Wesllem):
//   sudo node /opt/xtconect/scripts/_e052_fix_ack_topic.cjs
//   Depois: docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered
//
// COMO VERIFICAR APÓS DEPLOY:
//   python3 -c "
//   import json
//   f=json.load(open('/opt/xtconect/nodered/data/flows.json'))
//   n=next((x for x in f if x.get('id')=='mqttInIrrAck'), None)
//   print('topic atual:', n['topic'] if n else 'NÓ NÃO ENCONTRADO')
//   "
//
// ROLLBACK:
//   sudo cp /opt/xtconect/nodered/data/flows.json.bak-e052-ack-topic-<TIMESTAMP> \
//           /opt/xtconect/nodered/data/flows.json
//   docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered

'use strict';
const fs   = require('fs');
const path = require('path');

// ── Caminhos ────────────────────────────────────────────────────────────────
const FLOWS_PATH = '/opt/xtconect/nodered/data/flows.json';

const OLD_TOPIC = 'devices/+/commands/ack';
const NEW_TOPIC = 'devices/+/ack';
const NODE_ID   = 'mqttInIrrAck';

// ── Leitura ──────────────────────────────────────────────────────────────────
if (!fs.existsSync(FLOWS_PATH)) {
    console.error('ERRO: flows.json não encontrado em', FLOWS_PATH);
    process.exit(1);
}

const raw    = fs.readFileSync(FLOWS_PATH, 'utf8');
let   flows;
try {
    flows = JSON.parse(raw);
} catch (e) {
    console.error('ERRO: flows.json inválido:', e.message);
    process.exit(1);
}

// ── Backup ───────────────────────────────────────────────────────────────────
const ts      = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const bakPath = FLOWS_PATH + `.bak-e052-ack-topic-${ts}`;
fs.copyFileSync(FLOWS_PATH, bakPath);
console.log('Backup criado:', bakPath);

// ── Localizar nó ─────────────────────────────────────────────────────────────
const node = flows.find(n => n && n.id === NODE_ID);

if (!node) {
    console.error(`ERRO: nó "${NODE_ID}" não encontrado no flows.json.`);
    console.error('Backup foi criado mas flows.json NÃO foi alterado.');
    process.exit(1);
}

// ── Verificar estado atual ────────────────────────────────────────────────────
console.log(`\nNó encontrado:`);
console.log(`  id:    ${node.id}`);
console.log(`  type:  ${node.type}`);
console.log(`  name:  ${node.name}`);
console.log(`  topic: ${node.topic}`);

if (node.topic === NEW_TOPIC && node.name === NEW_TOPIC) {
    console.log('\nSTATUS: topic já está correto — nenhuma alteração necessária.');
    // Remover backup gerado desnecessariamente
    fs.unlinkSync(bakPath);
    console.log('Backup removido (sem alteração).');
    process.exit(0);
}

if (node.topic !== OLD_TOPIC) {
    console.warn(`\nAVISO: topic encontrado ("${node.topic}") não corresponde ao esperado ("${OLD_TOPIC}").`);
    console.warn('Aplicando mesmo assim para garantir o valor correto.');
}

// ── Aplicar mudança ───────────────────────────────────────────────────────────
const topicAnterior = node.topic;
const nameAnterior  = node.name;

node.topic = NEW_TOPIC;
// name espelha o topic (convenção dos outros mqtt-in nodes do projeto)
node.name  = NEW_TOPIC;

// ── Validar JSON resultante ───────────────────────────────────────────────────
let serialized;
try {
    serialized = JSON.stringify(flows, null, 4);
    JSON.parse(serialized); // valida round-trip
} catch (e) {
    console.error('ERRO: JSON resultante inválido:', e.message);
    console.error('flows.json NÃO foi salvo. Restaure o backup em:', bakPath);
    process.exit(1);
}

// ── Gravar ───────────────────────────────────────────────────────────────────
fs.writeFileSync(FLOWS_PATH, serialized, 'utf8');

// ── Relatório ─────────────────────────────────────────────────────────────────
console.log('\n=== ALTERAÇÕES APLICADAS ===');
console.log(`Nó:           ${NODE_ID}`);
console.log(`topic antes:  ${topicAnterior}`);
console.log(`topic depois: ${node.topic}`);
console.log(`name antes:   ${nameAnterior}`);
console.log(`name depois:  ${node.name}`);
console.log(`\nBackup disponível em: ${bakPath}`);
console.log('\nINJECTED OK');
console.log('\nPróximo passo (quando autorizado):');
console.log('  docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
