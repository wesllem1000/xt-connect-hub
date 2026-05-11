#!/usr/bin/env node
// E5.5 — Publisher retained de alarme IRR-V1
//
// O QUE FAZ:
//   1. Adiciona nó mqtt-out "mqttOutIrrAlarm" (retain=true, QoS 1) no tabIngest
//   2. Modifica fnIrrAlarmLifecycle para:
//      a) Após INSERT de alarm (temp_alarm_triggered / temp_sensor_lost):
//         — seleciona alarme de maior severidade ativo do device
//         — publica retained em devices/<serial>/alarm/active com payload completo
//         — severidade: critico = temperature_high / pump_runtime_exceeded / communication_lost
//                       aviso   = sensor_missing
//      b) Após UPDATE de resolved_at (temp_alarm_ack_user):
//         — verifica se ainda há alarmes ativos; se não houver, publica payload vazio
//         — se houver outro alarme ativo, promove o de maior severidade
//      c) Adiciona nó inject "injAlarmRecovery" + função "fnAlarmRecovery" que roda
//         na inicialização do Node-RED: SELECT de todos alarmes ativos e republica retained
//         (state recovery após restart do Node-RED)
//   3. Wire: fnIrrAlarmLifecycle output[3] → mqttOutIrrAlarm
//
// COLUNA severity: NÃO existe ainda em irrigation_alarms (migration 019 pendente).
//   O campo "severity" do payload MQTT é calculado em runtime aqui, não lido do DB.
//
// IDEMPOTÊNCIA:
//   — Detecta se já foi aplicado pelo marker "// E055_ALARM_PUB_v1" no func body
//   — Se já aplicado: aplica sobre o ORIGINAL salvo no backup anterior, evitando
//     acumulação de patches sobre patches (estratégia: guarda hash do func original)
//   — Nós externos (mqttOutIrrAlarm, injAlarmRecovery, fnAlarmRecovery): verifica por ID
//
// COMO RODAR (aguardar ordem do Wesllem):
//   sudo node "/home/xtadmin/teste winscp/xt-connect-hub-main/infra/scripts/_e055_inject_irr_alarm_publisher.cjs"
//   docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered
//
// ROLLBACK:
//   sudo cp /opt/xtconect/nodered/data/flows.json.bak-e055-alarm-publisher-<TIMESTAMP> \
//           /opt/xtconect/nodered/data/flows.json
//   docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered

'use strict';
const fs   = require('fs');
const path = require('path');

const FLOWS_PATH = '/opt/xtconect/nodered/data/flows.json';
const MARKER     = '// E055_ALARM_PUB_v1';

// ─── IDs canônicos ───────────────────────────────────────────────────────────
const ID_MQTT_OUT_ALARM  = 'mqttOutIrrAlarm';
const ID_INJ_RECOVERY    = 'injAlarmRecovery';
const ID_FN_RECOVERY     = 'fnAlarmRecovery';
const ID_ALARM_LIFECYCLE = 'fnIrrAlarmLifecycle';
const TAB_INGEST         = 'tabIngest';
const BROKER_ID          = 'brokerMosq';

// ─── Bloco de helpers E055 (injetado no topo do func lifecycle) ──────────────
const HELPERS_BLOCK = `// E055_ALARM_PUB_v1 — helpers de severidade e publicação
// NÃO REMOVER — marcador de idempotência
function e055SeverityOf(tipo) {
  const critico = ['temperature_high', 'pump_runtime_exceeded', 'communication_lost'];
  return critico.includes(tipo) ? 'critico' : 'aviso';
}
async function e055SelectTopAlarm(pool, deviceId) {
  const r = await pool.query(
    \`SELECT id, tipo, message, triggered_at
       FROM irrigation_alarms
      WHERE device_id = $1 AND acked_at IS NULL AND resolved_at IS NULL
      ORDER BY CASE tipo
        WHEN 'temperature_high'      THEN 1
        WHEN 'pump_runtime_exceeded' THEN 2
        WHEN 'communication_lost'    THEN 3
        WHEN 'sensor_missing'        THEN 4
        ELSE 5 END, triggered_at ASC LIMIT 1\`,
    [deviceId]
  );
  return r.rowCount > 0 ? r.rows[0] : null;
}
function e055AlarmMsg(serial, alarm) {
  return {
    topic:   'devices/' + serial + '/alarm/active',
    payload: alarm ? JSON.stringify({
      kind:      alarm.tipo,
      severity:  e055SeverityOf(alarm.tipo),
      message:   alarm.message,
      since:     new Date(alarm.triggered_at).toISOString(),
      ack_state: 'open',
      alarm_id:  alarm.id,
    }) : '',
    qos: 1, retain: true,
  };
}
`;

// ─── Bloco após INSERT temperature_high ─────────────────────────────────────
// Inserido ANTES de "// Engine: trigger irrigation_alarm_created"
const BLOCK_TEMP_HIGH = `    // E055 — publicar alarme retained após INSERT temperature_high
    try {
      const __e055top = await e055SelectTopAlarm(pool, deviceId);
      node.send([null, null, null, e055AlarmMsg(deviceRow.serial, __e055top)]);
    } catch(__e055err) { node.warn('E055 pub triggered: ' + __e055err.message); }
`;

// Âncora única: aparece UMA vez no func, logo após o INSERT de temperature_high
const ANCHOR_TEMP_HIGH = `    // Engine: trigger irrigation_alarm_created`;

// ─── Bloco após INSERT sensor_missing ───────────────────────────────────────
// Inserido ANTES do fechamento "    }\n  }\n} catch(e)" que encerra sensor_lost
// Âncora: a linha específica que fecha o if (exists.rowCount === 0) do sensor_lost
// Usamos o sufixo único: "'sensor_missing', $2, $3, $4, $5::jsonb)"
const BLOCK_SENSOR_MISSING = `      // E055 — publicar alarme retained após INSERT sensor_missing
      try {
        const __e055top2 = await e055SelectTopAlarm(pool, deviceId);
        node.send([null, null, null, e055AlarmMsg(deviceRow.serial, __e055top2)]);
      } catch(__e055err2) { node.warn('E055 pub sensor_missing: ' + __e055err2.message); }
`;

// ─── Bloco após UPDATE acked_at (temp_alarm_ack_user) ───────────────────────
// Substitui a linha de status única → expande em bloco com E055
const ANCHOR_ACK_STATUS = `    if (r.rowCount > 0) node.status({fill:'green',shape:'dot',text: mqttUser+' ack '+r.rowCount+' resolvido'});`;
const BLOCK_ACK_REPLACE = `    if (r.rowCount > 0) {
      node.status({fill:'green',shape:'dot',text: mqttUser+' ack '+r.rowCount+' resolvido'});
      // E055 — publicar clear ou promover alarme seguinte após ack_user
      try {
        const __e055next = await e055SelectTopAlarm(pool, deviceId);
        node.send([null, null, null, e055AlarmMsg(deviceRow.serial, __e055next)]);
      } catch(__e055err3) { node.warn('E055 pub ack_user: ' + __e055err3.message); }
    }`;

// ─── Return final atualizado ─────────────────────────────────────────────────
const RETURN_ORIG = `return [null, mqttMessages.length > 0 ? mqttMessages : null, null];`;
const RETURN_NEW  = `return [null, mqttMessages.length > 0 ? mqttMessages : null, null, null]; // E055: output[3]=mqttOutIrrAlarm`;

// ─── Âncora para inserção do sensor_missing ──────────────────────────────────
// Unique string that appears only once: the INSERT statement for sensor_missing
// closing parenthesis. We look for the specific enqueueAlarmEmails after sensor insert.
// In the original func, the sensor_missing block ends with:
//   "      await enqueueAlarmEmails(ins.rows[0], deviceRow);\n    }\n  }\n} catch"
// We will split on "} catch(e) { node.error('alarm lifecycle" to find the boundary
// and insert our block just before the closing braces.
function buildNewLifecycleFunc(originalFunc) {
  // Validate anchors exist in the original
  if (!originalFunc.includes(ANCHOR_TEMP_HIGH)) {
    throw new Error('Âncora ANCHOR_TEMP_HIGH não encontrada no func. Verificar versão do flow.');
  }
  if (!originalFunc.includes(ANCHOR_ACK_STATUS)) {
    throw new Error('Âncora ANCHOR_ACK_STATUS não encontrada. Verificar versão do flow.');
  }
  if (!originalFunc.includes(RETURN_ORIG)) {
    throw new Error('Return original não encontrado. Verificar versão do flow.');
  }

  let func = originalFunc;

  // 1. Adicionar helpers no topo
  func = HELPERS_BLOCK + '\n' + func;

  // 2. Inserir bloco após INSERT temperature_high (antes do comentário "Engine:")
  func = func.replace(ANCHOR_TEMP_HIGH, BLOCK_TEMP_HIGH + ANCHOR_TEMP_HIGH);

  // 3. Inserir bloco após INSERT sensor_missing.
  //    A âncora mais segura é o closing do bloco sensor_lost antes do catch:
  //    "await enqueueAlarmEmails(ins.rows[0], deviceRow);\n    }\n  }\n} catch(e)"
  //    Mas como enqueueAlarmEmails(ins.rows[0]) aparece duas vezes, precisamos
  //    usar o contexto do bloco sensor_missing especificamente.
  //    O bloco sensor_missing tem a string única "sensor_missing', $2, $3, $4, $5"
  //    Depois de localizar essa posição, encontramos o próximo enqueueAlarmEmails
  //    e inserimos DEPOIS dele, ANTES dos fechamentos.
  const sensorMissingInsertMark = `'sensor_missing', $2, $3, $4, $5::jsonb)`;
  const smIdx = func.indexOf(sensorMissingInsertMark);
  if (smIdx === -1) throw new Error('Âncora sensor_missing INSERT não encontrada.');
  // A partir de smIdx, encontrar o próximo "await enqueueAlarmEmails(ins.rows[0]"
  const enqueueAfterSM = func.indexOf('await enqueueAlarmEmails(ins.rows[0]', smIdx);
  if (enqueueAfterSM === -1) throw new Error('enqueueAlarmEmails após sensor_missing não encontrado.');
  // Encontrar fim dessa linha (até \n)
  const endOfEnqueueLine = func.indexOf('\n', enqueueAfterSM);
  if (endOfEnqueueLine === -1) throw new Error('Fim de linha após enqueue sensor_missing não encontrado.');
  // Inserir o bloco E055 depois dessa linha
  func = func.slice(0, endOfEnqueueLine + 1)
       + BLOCK_SENSOR_MISSING
       + func.slice(endOfEnqueueLine + 1);

  // 4. Substituir linha de status do ack_user por bloco expandido
  func = func.replace(ANCHOR_ACK_STATUS, BLOCK_ACK_REPLACE);

  // 5. Atualizar return final
  func = func.replace(RETURN_ORIG, RETURN_NEW);

  return func;
}

// ─── Corpo da função de recovery (roda no boot) ──────────────────────────────
const FN_RECOVERY_BODY = `// E055_ALARM_PUB_v1 — recovery de alarmes retidos no boot
// Roda 2s após deploy via injAlarmRecovery (once:true).
// Republica retained devices/<serial>/alarm/active para todos alarmes sem ack/resolve.
// Garante que clientes conectados antes do restart recebem o estado atual.
const pool = global.get('pgPool');
if (!pool) {
  node.warn('E055 recovery: pgPool não pronto, retry em 3s');
  setTimeout(async () => {
    const p2 = global.get('pgPool');
    if (!p2) { node.warn('E055 recovery: pgPool ainda ausente, desistindo'); return; }
    await runRecovery(p2);
  }, 3000);
  return;
}
await runRecovery(pool);

async function runRecovery(pool) {
  function sevOf(tipo) {
    return ['temperature_high','pump_runtime_exceeded','communication_lost'].includes(tipo)
      ? 'critico' : 'aviso';
  }
  try {
    // DISTINCT ON: um alarme por device (o de maior prioridade)
    const r = await pool.query(
      \`SELECT DISTINCT ON (d.id)
              d.device_id AS serial,
              ia.id, ia.tipo, ia.message, ia.triggered_at
         FROM irrigation_alarms ia
         JOIN devices d ON d.id = ia.device_id
        WHERE ia.acked_at IS NULL AND ia.resolved_at IS NULL
        ORDER BY d.id,
                 CASE ia.tipo
                   WHEN 'temperature_high'      THEN 1
                   WHEN 'pump_runtime_exceeded' THEN 2
                   WHEN 'communication_lost'    THEN 3
                   WHEN 'sensor_missing'        THEN 4
                   ELSE 5 END,
                 ia.triggered_at ASC\`
    );
    node.log('E055 recovery: ' + r.rowCount + ' alarme(s) ativo(s) a republicar');
    for (const row of r.rows) {
      node.send({
        topic:   'devices/' + row.serial + '/alarm/active',
        payload: JSON.stringify({
          kind:      row.tipo,
          severity:  sevOf(row.tipo),
          message:   row.message,
          since:     new Date(row.triggered_at).toISOString(),
          ack_state: 'open',
          alarm_id:  row.id,
        }),
        qos: 1, retain: true,
      });
    }
  } catch(e) {
    node.error('E055 recovery query: ' + e.message);
  }
}
`;

// ─── Main ────────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(FLOWS_PATH)) {
    console.error('ERRO: flows.json não encontrado em ' + FLOWS_PATH);
    process.exit(1);
  }
  const raw   = fs.readFileSync(FLOWS_PATH, 'utf8');
  let   flows = JSON.parse(raw);

  // Backup com timestamp
  const ts      = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const bakPath = FLOWS_PATH + '.bak-e055-alarm-publisher-' + ts;
  fs.writeFileSync(bakPath, raw, 'utf8');
  console.log('Backup criado: ' + bakPath);

  // ── 1. Localizar fnIrrAlarmLifecycle ────────────────────────────────────────
  const lifecycleNode = flows.find(n => n.id === ID_ALARM_LIFECYCLE);
  if (!lifecycleNode) {
    console.error('ERRO: nó fnIrrAlarmLifecycle não encontrado. Abortando.');
    process.exit(1);
  }

  // ── 2. Obter func original (sem patches anteriores) ─────────────────────────
  // Estratégia de idempotência: se o marker já está presente, recuperamos o func
  // original do PRIMEIRO backup criado por este script (pattern .bak-e055-alarm-publisher-*)
  // Se não houver backup anterior, assume que o func atual é o original.
  let originalFunc = lifecycleNode.func;
  if (originalFunc.includes(MARKER)) {
    console.log('  [INFO] Marker E055 detectado — buscando func original no backup mais antigo...');
    // Listar backups e pegar o mais antigo
    const dir      = path.dirname(FLOWS_PATH);
    const base     = path.basename(FLOWS_PATH);
    const bakFiles = fs.readdirSync(dir)
      .filter(f => f.startsWith(base + '.bak-e055-alarm-publisher-'))
      .sort(); // lexicográfico = cronológico (ISO timestamp)
    if (bakFiles.length === 0) {
      console.error('ERRO: Marker presente mas nenhum backup e055 encontrado. ' +
                    'Forneça o func original manualmente ou restaure o backup.');
      process.exit(1);
    }
    // O mais antigo é o backup da primeira aplicação (func sem patch)
    const oldestBak = path.join(dir, bakFiles[0]);
    console.log('  Usando backup original: ' + oldestBak);
    const oldFlows  = JSON.parse(fs.readFileSync(oldestBak, 'utf8'));
    const oldNode   = oldFlows.find(n => n.id === ID_ALARM_LIFECYCLE);
    if (!oldNode) {
      console.error('ERRO: fnIrrAlarmLifecycle não encontrado no backup ' + oldestBak);
      process.exit(1);
    }
    originalFunc = oldNode.func;
    if (originalFunc.includes(MARKER)) {
      console.error('ERRO: Mesmo o backup mais antigo já contém o marker. ' +
                    'Impossível obter func original limpo.');
      process.exit(1);
    }
    console.log('  Func original recuperado do backup.');
  }

  // ── 3. Construir novo func com patches E055 ──────────────────────────────────
  let newFunc;
  try {
    newFunc = buildNewLifecycleFunc(originalFunc);
  } catch(e) {
    console.error('ERRO ao construir func patched: ' + e.message);
    process.exit(1);
  }

  lifecycleNode.func    = newFunc;
  lifecycleNode.outputs = 4;
  if (!lifecycleNode.wires) lifecycleNode.wires = [[], [], [], []];
  while (lifecycleNode.wires.length < 4) lifecycleNode.wires.push([]);
  if (!lifecycleNode.wires[3].includes(ID_MQTT_OUT_ALARM)) {
    lifecycleNode.wires[3] = [ID_MQTT_OUT_ALARM];
  }
  console.log('Nó fnIrrAlarmLifecycle atualizado (outputs=4, E055 injetado).');

  // ── 4. Criar/verificar mqttOutIrrAlarm ──────────────────────────────────────
  let mqttOutAlarm = flows.find(n => n.id === ID_MQTT_OUT_ALARM);
  if (!mqttOutAlarm) {
    flows.push({
      id: ID_MQTT_OUT_ALARM, type: 'mqtt out', z: TAB_INGEST,
      name: 'publish alarm/active (retained)',
      topic: '', qos: '1', retain: 'true',
      respTopic: '', contentType: '', userProps: '', correl: '', expiry: '',
      broker: BROKER_ID, x: 820, y: 4560, wires: [],
    });
    console.log('Nó mqttOutIrrAlarm CRIADO.');
  } else {
    mqttOutAlarm.retain = 'true';
    mqttOutAlarm.qos    = '1';
    mqttOutAlarm.broker = BROKER_ID;
    console.log('Nó mqttOutIrrAlarm já existe — configuração verificada.');
  }

  // ── 5. Criar/verificar injAlarmRecovery ─────────────────────────────────────
  let injRec = flows.find(n => n.id === ID_INJ_RECOVERY);
  if (!injRec) {
    flows.push({
      id: ID_INJ_RECOVERY, type: 'inject', z: TAB_INGEST,
      name: 'alarm recovery (on start)',
      props: [{ p: 'payload' }, { p: 'topic', vt: 'str' }],
      repeat: '', crontab: '', once: true, onceDelay: 2,
      topic: '', payload: '', payloadType: 'date',
      x: 180, y: 5000, wires: [[ID_FN_RECOVERY]],
    });
    console.log('Nó injAlarmRecovery CRIADO.');
  } else {
    injRec.once = true; injRec.onceDelay = 2; injRec.wires = [[ID_FN_RECOVERY]];
    console.log('Nó injAlarmRecovery já existe — verificado.');
  }

  // ── 6. Criar/verificar fnAlarmRecovery ──────────────────────────────────────
  let fnRec = flows.find(n => n.id === ID_FN_RECOVERY);
  if (!fnRec) {
    flows.push({
      id: ID_FN_RECOVERY, type: 'function', z: TAB_INGEST,
      name: 'AlarmRecovery',
      func: FN_RECOVERY_BODY, outputs: 1,
      x: 420, y: 5000, wires: [[ID_MQTT_OUT_ALARM]],
    });
    console.log('Nó fnAlarmRecovery CRIADO.');
  } else {
    fnRec.func  = FN_RECOVERY_BODY;
    fnRec.wires = [[ID_MQTT_OUT_ALARM]];
    console.log('Nó fnAlarmRecovery já existe — func body atualizado.');
  }

  // ── 7. Gravar ────────────────────────────────────────────────────────────────
  fs.writeFileSync(FLOWS_PATH, JSON.stringify(flows, null, 2), 'utf8');
  console.log('\nflows.json gravado com sucesso em ' + FLOWS_PATH);
  console.log('\nPROXIMO PASSO (aguardar ordem do Wesllem):');
  console.log('  docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
  console.log('\nROLLBACK:');
  console.log('  sudo cp "' + bakPath + '" ' + FLOWS_PATH);
  console.log('  docker compose -f /opt/xtconect/compose/docker-compose.yml restart nodered');
}

main();
