#!/usr/bin/env node
// E4.2A closure — cria/atualiza role dynsec `irr-v1-device` (refs #71)
//
// ACLs mínimas pra devices IRR-V1 autenticarem no broker com direitos
// restritos. Usamos wildcard MQTT `+` (NÃO `%c`) em AMBOS os tipos de
// ACL — publishClientSend e subscribePattern — veja GOTCHA.
//
// GOTCHA Mosquitto dynsec (confirmado em 2.x, revalidado 2026-04-22):
//   Placeholders (`%c`, `%u`) em ACLs NÃO SUBSTITUEM corretamente nesta
//   versão do broker:
//     - `publishClientSend` com `%c`: broker devolve PUBACK=0 mas NÃO
//       propaga aos subscribers (silent drop).
//     - `subscribePattern` com `%c`: broker devolve SUBACK=128 (denied).
//       Análogo ao bug já documentado com `%u` (ver debts.md #6/#48).
//       Piora no nosso caso porque o clientId do firmware IRR-V1 diverge
//       do serial (o device gera clientId distinto pra evitar colisão em
//       reconnects), então mesmo se `%c` funcionasse o match falharia.
//   Workaround atual: wildcard `+` em ambos os tipos e isolamento por
//   convention (username = serial; firmware só publica/consome no próprio
//   serial). Qualquer device autenticado CONSEGUE subscribe em commands
//   alheios — ver débito D-acl-1 / debts.md #55 ampliado.
//   Hardening real: role-per-device literal `devices/<serial>/...` no
//   provisionamento, ou TLS client-cert binding.
//
// Uso: node _e042c_dynsec_role_irr_v1.js
//      (precisa rodar de dentro do container nodered pra ter acesso
//       ao MQTT_BRIDGE_USER/PASSWORD env vars, ou ajustar pra passar
//       credenciais via args)

const mqtt = require('mqtt');

const BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://mosquitto:1883';
const USER = process.env.MQTT_BRIDGE_USER || 'nodered';
const PASS = process.env.MQTT_BRIDGE_PASSWORD;

if (!PASS) { console.error('MQTT_BRIDGE_PASSWORD env var required'); process.exit(1); }

const TOPICS_PUB = ['data','state','events','commands/ack','config/current','status'];
const TOPICS_SUB = ['commands','config/push'];

const commands = [
  { command: 'createRole', rolename: 'irr-v1-device' },
];
// Migração 2026-04-22: remove ACLs `%c` obsoletos (subscribePattern) caso
// a role já tivesse sido provisionada com placeholder — ver GOTCHA.
// `not found` é filtrado no handler de resposta igual "already exists".
for (const t of TOPICS_SUB) {
  commands.push({
    command: 'removeRoleACL',
    rolename: 'irr-v1-device',
    acltype: 'subscribePattern',
    topic: 'devices/%c/' + t,
  });
}
// Publish wildcards (isolamento por convention; %c NÃO funciona aqui)
for (const t of TOPICS_PUB) {
  commands.push({
    command: 'addRoleACL',
    rolename: 'irr-v1-device',
    acltype: 'publishClientSend',
    topic: 'devices/+/' + t,
    allow: true,
    priority: 10,
  });
}
// Subscribe wildcards (%c NÃO funciona — ver GOTCHA; idem publish)
for (const t of TOPICS_SUB) {
  commands.push({
    command: 'addRoleACL',
    rolename: 'irr-v1-device',
    acltype: 'subscribePattern',
    topic: 'devices/+/' + t,
    allow: true,
    priority: 10,
  });
}

const c = mqtt.connect(BROKER_URL, { username: USER, password: PASS, protocolVersion: 5 });
c.on('connect', () => {
  c.subscribe('$CONTROL/dynamic-security/v1/response', () => {
    c.publish('$CONTROL/dynamic-security/v1', JSON.stringify({ commands }), { qos: 1 });
  });
});
c.on('message', (topic, payload) => {
  const body = JSON.parse(payload.toString());
  const errors = body.responses.filter((r) => r.error && !/already exists|not found/i.test(r.error));
  if (errors.length > 0) {
    console.error('Dynsec errors:', JSON.stringify(errors, null, 2));
    process.exit(2);
  }
  console.log(`Role irr-v1-device provisionado (${body.responses.length} ops).`);
  c.end();
  process.exit(0);
});
setTimeout(() => { console.error('timeout'); process.exit(1); }, 8000);
