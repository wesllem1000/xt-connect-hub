#!/usr/bin/env node
// E4.2A closure — cria/atualiza role dynsec `irr-v1-device` (refs #71)
//
// ACLs mínimas pra devices IRR-V1 autenticarem no broker com direitos
// restritos. Uso do wildcard `+` em `publishClientSend` (não `%c`) é
// intencional — veja GOTCHA abaixo.
//
// GOTCHA Mosquitto dynsec (confirmado em 2.x):
//   `publishClientSend` com topic pattern usando `%c` causa broker a
//   ACEITAR o publish (PUBACK=0) porém NÃO PROPAGA aos subscribers.
//   Match de placeholders só funciona em `subscribePattern` ACLs.
//   Workaround: usar wildcard MQTT `+` no publishClientSend e delegar
//   isolamento por convention (username = serial, firmware publica só
//   no próprio serial). Para hardening, criar role por device.
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
// Subscribe com %c (funciona corretamente, enforcement real por client)
for (const t of TOPICS_SUB) {
  commands.push({
    command: 'addRoleACL',
    rolename: 'irr-v1-device',
    acltype: 'subscribePattern',
    topic: 'devices/%c/' + t,
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
  const errors = body.responses.filter((r) => r.error && !/already exists/i.test(r.error));
  if (errors.length > 0) {
    console.error('Dynsec errors:', JSON.stringify(errors, null, 2));
    process.exit(2);
  }
  console.log(`Role irr-v1-device provisionado (${body.responses.length} ops).`);
  c.end();
  process.exit(0);
});
setTimeout(() => { console.error('timeout'); process.exit(1); }, 8000);
