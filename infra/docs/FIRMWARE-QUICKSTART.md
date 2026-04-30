# Firmware ESP — Quickstart

> Documento curto pra IA gerar firmware do dispositivo IRR-V1.
> Spec completa em `PROTOCOLO-IOT.md`. Aqui vai o essencial.

## Contexto pra IA

Você vai escrever firmware ESP32 (preferencial) usando ESP-IDF ou Arduino
framework, em C ou C++. A plataforma servidor já está em produção em
`hub.xtconect.online`, com Mosquitto MQTT TLS na porta 8883. Sua tarefa
é criar firmware que conversa com essa plataforma seguindo um protocolo
JSON sobre MQTT já documentado.

## Stack recomendada

- **Hardware**: ESP32 ou ESP32-S3 (Wi-Fi + flash 4MB+).
- **SDK**: ESP-IDF v5+ (preferido) ou Arduino-ESP32 v3+.
- **Bibliotecas MQTT**: `esp-mqtt` (ESP-IDF) ou `PubSubClient`+`WiFiClientSecure` (Arduino).
- **JSON**: `cJSON` (ESP-IDF) ou `ArduinoJson` v7 (Arduino).
- **Tempo**: SNTP do ESP-IDF (`esp_sntp`).
- **Persistência**: NVS (`nvs_flash`).

## Configuração mínima da NVS

| Chave | Tipo | Exemplo |
|---|---|---|
| `serial` | string | `IRR-V1-00007` |
| `mqtt_pass` | string | `<random_32hex>` |
| `wifi_ssid` | string | (configurado em fábrica ou via AP-mode) |
| `wifi_pass` | string | idem |
| `cfg_version` | u32 | última `config_version` aplicada (opcional) |
| `alarm_state` | blob | estado do alarme persistido |

## MQTT — parâmetros

```c
#define MQTT_BROKER  "mqtts://hub.xtconect.online:8883"
#define MQTT_QOS_CMD 1
#define MQTT_KEEPALIVE 60
#define MQTT_RECONNECT_BASE 5000  // ms
#define MQTT_RECONNECT_MAX  60000
```

```c
const esp_mqtt_client_config_t cfg = {
  .broker.address.uri = MQTT_BROKER,
  .credentials.username = serial,
  .credentials.authentication.password = mqtt_pass,
  .session.keepalive = 60,
  .session.disable_clean_session = false,
  .session.last_will.topic = "devices/<serial>/status",
  .session.last_will.msg = "offline",
  .session.last_will.qos = 1,
  .session.last_will.retain = 1,
  .broker.verification.use_global_ca_store = true, // ou cert embutido
};
```

## Tópicos

```c
#define TOPIC_STATUS         "devices/%s/status"        // pub retain
#define TOPIC_DATA           "devices/%s/data"          // pub
#define TOPIC_STATE          "devices/%s/state"         // pub retain
#define TOPIC_EVENTS         "devices/%s/events"        // pub
#define TOPIC_TELEM_SENSORS  "devices/%s/telemetry/sensors" // pub
#define TOPIC_COMMANDS       "devices/%s/commands"      // sub
#define TOPIC_COMMANDS_ACK   "devices/%s/commands/ack"  // pub
#define TOPIC_CONFIG_PUSH    "devices/%s/config/push"   // sub retain
#define TOPIC_CONFIG_CURRENT "devices/%s/config/current"// pub retain
```

## Sequência de boot (pseudocódigo)

```c
void app_main() {
  nvs_init();
  read_nvs_config(&serial, &mqtt_pass, &wifi_ssid, &wifi_pass, &alarm_state);

  // 1. Restaura estado de alarme persistido
  if (alarm_state.active) {
    pump_off();           // garante segurança
    sectors_close_all();
    timers_cancel_running();
  }

  // 2. Wi-Fi
  wifi_connect_or_ap_mode();

  // 3. NTP — bloqueia até hora válida
  sntp_init();
  while (!time_valid()) vTaskDelay(pdMS_TO_TICKS(500));

  // 4. MQTT
  mqtt_client_t* mqtt = mqtt_init_with_lwt(serial, mqtt_pass);
  mqtt_subscribe(TOPIC_COMMANDS, 1);
  mqtt_subscribe(TOPIC_CONFIG_PUSH, 1);
  mqtt_publish_status_online_retained();
  mqtt_publish_state_retained();
  mqtt_publish_config_current_retained();

  // 5. Tasks
  xTaskCreate(task_telemetry, ...);          // periódico, 30s
  xTaskCreate(task_telemetry_sensors, ...);  // 30s
  xTaskCreate(task_scheduler, ...);          // 1Hz, dispara timers
  xTaskCreate(task_alarm_check, ...);        // 1Hz, verifica DS18B20
  xTaskCreate(task_button, ...);             // bordas do botão físico
  // o handler do MQTT já é callback da lib
}
```

## Handler de comando (template)

```c
void on_command(const char* json) {
  // Parse
  JsonDocument doc;
  deserializeJson(doc, json);
  const char* cmd_id = doc["cmd_id"];
  const char* cmd = doc["cmd"];
  time_t expires_at = parse_iso8601(doc["expires_at"]);

  // 1. Idempotência
  if (cmd_id_seen_recently(cmd_id)) return; // já processou

  // 2. Expiração
  if (time(NULL) > expires_at) {
    publish_ack(cmd_id, "expired", "EXPIRED", "Comando expirado");
    return;
  }

  // 3. Despacha
  if (strcmp(cmd, "pump_on") == 0) {
    bool force = doc["params"]["force"] | false;
    handle_pump_on(cmd_id, force);
  } else if (strcmp(cmd, "pump_off") == 0) {
    handle_pump_off(cmd_id);
  } else if (strcmp(cmd, "sector_open") == 0) {
    int numero = doc["params"]["numero"];
    handle_sector_open(cmd_id, numero, doc["params"]["strategy"]);
  } else if (strcmp(cmd, "temp_alarm_clear") == 0) {
    handle_temp_alarm_clear(cmd_id, doc["params"]["alarm_id"], doc["params"]["rom_id"]);
  } else if (strcmp(cmd, "factory_reset") == 0) {
    handle_factory_reset(cmd_id);
  } else {
    publish_ack(cmd_id, "refused", "INVALID_PARAMS", "cmd desconhecido");
    return;
  }

  // 4. Cache pra idempotência
  cmd_id_remember(cmd_id);
}

void publish_ack(const char* cmd_id, const char* status, const char* code, const char* msg) {
  JsonDocument out;
  out["cmd_id"] = cmd_id;
  out["ack_status"] = status;
  out["ack_code"] = code;
  out["ack_message"] = msg;
  out["ts"] = iso8601_now();
  char buf[512];
  serializeJson(out, buf);
  mqtt_publish(TOPIC_COMMANDS_ACK, buf, 1, 0);
}
```

## Handler de config/push

```c
void on_config_push(const char* json) {
  JsonDocument cfg;
  deserializeJson(cfg, json);

  // Bomba
  apply_bomba_config(cfg["bomba"]);
  // Botão
  apply_botao_config(cfg["botao"]);
  // GPIO 1-Wire
  set_gpio_1wire(cfg["gpio_1wire"]);
  // Setores
  for (JsonObject s : cfg["sectors"].as<JsonArray>()) {
    apply_sector_config(s);
  }
  // Sensores
  for (JsonObject s : cfg["sensors"].as<JsonArray>()) {
    apply_sensor_config(s);  // associa rom_id, limite, histerese, role
  }
  // Timers
  timers_clear_all();
  for (JsonObject t : cfg["timers"].as<JsonArray>()) {
    timers_add(t);  // fixed, cyclic_window, cyclic_continuous
  }
  // Modo
  set_modo(cfg["modo_operacao"]);

  // Echo back
  publish_config_current_retained();
}
```

## Lifecycle de alarme (CRÍTICO — segurança)

```c
void task_alarm_check() {
  while (1) {
    for (sensor_t* s : sensors) {
      if (!s->ativo) continue;
      float temp = ds18b20_read(s->rom_id);
      if (temp == DS18B20_FAIL) {
        publish_event("temp_sensor_lost", s);
        continue;
      }
      s->last_reading = temp;
      if (temp >= s->limite_alarme_c && !alarm_active) {
        // ALARME!
        pump_off();
        sectors_close_all();
        timers_cancel_running();
        republish_state_retained();

        alarm_active = true;
        alarm_info = (alarm_info_t){
          .sensor_id = s->id, .rom_id = s->rom_id,
          .temp = temp, .limite = s->limite_alarme_c
        };
        nvs_save_alarm_state(&alarm_active, &alarm_info);

        publish_event("temp_alarm_triggered", &alarm_info);
        publish_event("pump_off_safety", &alarm_info);
        for (int n : sectors_just_closed) {
          publish_event_with_motivo("sector_closed", n, "temp_alarm_safety");
        }
      }
      // NÃO auto-clear quando temp cair. ACK explícito limpa.
    }
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

void handle_temp_alarm_clear(const char* cmd_id, const char* alarm_id, const char* rom_id) {
  // Backend manda esse cmd quando user clica "Reconhecer" no app web
  if (alarm_active && (rom_id == NULL || strcmp(alarm_info.rom_id, rom_id) == 0)) {
    alarm_active = false;
    memset(&alarm_info, 0, sizeof(alarm_info));
    nvs_save_alarm_state(&alarm_active, NULL);
    republish_state_retained();
  }
  publish_ack(cmd_id, "executed", "OK", "Alarme limpo");
}

// Botão físico "Reconhecer" no display do device
void on_local_ack_button() {
  if (alarm_active) {
    publish_event("temp_alarm_ack_user", &alarm_info, "manual_app_remote");
    alarm_active = false;
    memset(&alarm_info, 0, sizeof(alarm_info));
    nvs_save_alarm_state(&alarm_active, NULL);
    republish_state_retained();
  }
}
```

## Telemetria de sensores (a cada 30s)

```c
void task_telemetry_sensors() {
  while (1) {
    JsonDocument out;
    out["protocol_version"] = 1;
    out["ts"] = iso8601_now();
    JsonArray readings = out["readings"].to<JsonArray>();
    for (sensor_t* s : sensors) {
      JsonObject r = readings.add<JsonObject>();
      r["rom_id"] = s->rom_id;
      r["temperature_c"] = (s->last_reading == DS18B20_FAIL) ? nullptr : s->last_reading;
    }
    char buf[1024];
    serializeJson(out, buf);
    mqtt_publish(TOPIC_TELEM_SENSORS, buf, 0, 0);  // QoS 0, retain false
    vTaskDelay(pdMS_TO_TICKS(30000));
  }
}
```

## Timers — scheduler local (1Hz)

```c
typedef enum { TIMER_FIXED, TIMER_CYCLIC_WINDOW, TIMER_CYCLIC_CONTINUOUS } timer_tipo_t;

void task_scheduler() {
  while (1) {
    if (modo != MODO_AUTOMATICO) { vTaskDelay(pdMS_TO_TICKS(1000)); continue; }
    time_t now = time(NULL);
    int dia = localtime(&now)->tm_wday; // 0=domingo
    char hm[6];
    strftime(hm, sizeof(hm), "%H:%M", localtime(&now));

    for (timer_t* t : timers) {
      if (!t->ativo || t->pausado) continue;
      if (!(t->dias_semana & (1 << dia))) continue;

      switch (t->tipo) {
        case TIMER_FIXED: {
          if (!t->_running && strcmp(t->hora_inicio, hm) == 0 &&
              localtime(&now)->tm_sec < 5) {
            timer_ligar(t, t->duracao_min);
          }
          if (t->_running &&
              now - t->_run_started_at >= t->duracao_min * 60) {
            timer_desligar(t);
          }
          break;
        }
        case TIMER_CYCLIC_WINDOW: {
          bool in_window = is_in_window(t->hora_inicio, t->hora_fim, hm);
          if (!in_window) {
            if (t->_running) timer_desligar(t);
            t->_resting_since = 0;
            break;
          }
          float elapsed_min = (now - t->_run_started_at) / 60.0;
          float resting_min = (t->_resting_since == 0) ? INFINITY :
                              (now - t->_resting_since) / 60.0;
          if (t->_running && elapsed_min >= t->on_minutes) {
            timer_desligar(t);
            t->_resting_since = now;
          } else if (!t->_running && resting_min >= t->off_minutes) {
            timer_ligar(t, t->on_minutes);
            t->_resting_since = 0;
          }
          break;
        }
        case TIMER_CYCLIC_CONTINUOUS:
          // mesma lógica de cyclic_window mas sem checagem de janela
          ...
          break;
      }
    }
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}
```

## Buffer offline de eventos

```c
// Eventos que falham ao publicar (offline) vão pra ring buffer em flash
// (ex.: NVS namespace "evbuffer", até 100 entradas).
// Ao reconectar:
void on_mqtt_reconnect() {
  publish_state_retained();
  publish_config_current_retained();
  for (int i = 0; i < buffer_size(); i++) {
    event_t* e = buffer_peek(i);
    if (mqtt_publish(TOPIC_EVENTS, e->json, 1, 0) == ESP_OK) {
      buffer_pop();
    } else break;
  }
}
```

## Watchdog + safety hard

```c
// Watchdog hardware: assegura que pump_off acontece se loop travar
esp_task_wdt_init(WDT_TIMEOUT_S, true);
esp_task_wdt_add(NULL);

// Safety absoluto: bomba não fica ligada > tempo_max_continuo_bomba_min
// (lido da config). Reset em RAM, independente de qualquer comando.
void task_safety() {
  while (1) {
    if (pump_state == PUMP_ON) {
      time_t elapsed = time(NULL) - pump_started_at;
      if (elapsed > tempo_max_continuo_bomba_min * 60) {
        pump_off();
        publish_event("pump_off_safety", "auto_shutoff_max_time");
      }
    }
    vTaskDelay(pdMS_TO_TICKS(5000));
  }
}
```

---

## Onde testar antes do hardware existir

O simulador web em `/simulator-irr-v1.html` (https://hub.xtconect.online/simulator-irr-v1.html) é a **referência viva** do comportamento esperado. Ele já implementa:

- Boot + LWT + retained `status`/`state`/`config/current`
- Aceita `commands`, responde `commands/ack`
- Aplica `config/push` e ecoa em `config/current`
- Telemetria de sensores em `telemetry/sensors`
- Lifecycle de alarme com persistência local
- 3 tipos de timer
- Comando `temp_alarm_clear`

Use as credenciais MQTT de um device provisionado de teste pra rodar o
firmware contra o broker de produção (ou faça broker local pra dev).

---

## Erros comuns que NÃO PODEM acontecer

1. **Bomba ligada sem ACK do alarme**: nunca religar bomba ou abrir setor enquanto `alarm_active=true`.
2. **Comando duplicado executado 2x**: cache RAM dos últimos 100 cmd_id.
3. **Config aplicada parcialmente sem reportar**: sempre republica `config/current` reflete o que de fato foi aplicado.
4. **Telemetria com timestamp inválido**: aguardar NTP sync antes de publicar.
5. **State retained desatualizado**: sempre republica em transição.
6. **Buffer offline lota**: evita memory bloat — descarta os mais antigos quando atinge 100.

---

## Bugs encontrados em campo (2026-04-30, IRR-V1-00008)

Primeiro teste real ponta-a-ponta da placa do protótipo 2026-04-28 com o broker de produção. Conexão MQTT subiu de primeira, 8 setores foram descobertos pela UI, comandos `sector_open`/`sector_close`/`pump_on`/`pump_off`/`mode_set`/`set_rate` funcionaram local e remoto, telemetria a cada 2s sem falha. Bugs menores que ficaram pra próximo ciclo:

### B1. Timestamps `[NaN:NaN]` em logs antes do SNTP

**Sintoma:** todas linhas do log da página `/log` aparecem com prefixo `[NaN:NaN]` em vez de `[HH:MM]`. O segundo campo (uptime `mm:ss.ms`) está correto.

**Causa provável:** o ring-buffer do logger formata o timestamp absoluto sem checar se SNTP já sincronizou — quando `time(NULL)` ainda é 0/inválido, o `gmtime`/`localtime` produz NaN.

**Fix esperado:**
- Antes do sync, mostrar `[--:--]` em vez de `[NaN:NaN]`.
- Manter o uptime monotônico como segundo campo (já está certo).
- Bloquear PUB de telemetria/eventos com `ts` ISO até NTP fechar (já é regra; reforçar).

### B2. `source=` vazio em desligamentos secundários

**Sintoma:** quando uma ação dispara cascata (ex.: `sector_close` que ao fechar último setor leva a `pump_off`, ou `pump_off` que ao desligar leva a `sector_closed` por safety), o evento secundário sai com `source=` em branco — só o evento primário tem `source=manual_remote`/`manual_local`.

```
01:35.7 I SETOR    3 OFF source=             ← vazio
02:10.3 I BOMBA    OFF source=               ← vazio (cascata de set fechado)
02:11.0 I SETOR    1 OFF source=             ← vazio
```

**Fix esperado:** propagar a `source` original pelas chamadas em cascata. Na cascata o origem semântico continua sendo do gatilho original (`manual_local`/`manual_remote`/`auto_timer`/`safety_alarm`), não vazio.

Isso afeta auditoria/histórico no Influx e a UI de timeline de eventos.

### B3. Linhas duplicadas / triplicadas no `/log`

**Sintoma:** ao copiar o conteúdo da página `/log`, algumas linhas aparecem 2× e 3× em sequência:

```
02:50.2 I TELEM    PUB ... -> OK
02:52.2 I TELEM    PUB ... -> OK
02:50.2 I TELEM    PUB ... -> OK   ← duplicada
02:52.2 I TELEM    PUB ... -> OK   ← duplicada
```

**Causa provável:** wraparound do ring buffer renderizado sem deduplicar, ou o handler HTTP da `/log` está concatenando o buffer 2× quando o cliente faz refresh durante a escrita.

**Fix esperado:**
- Snapshot atomico do ring buffer (mutex/section) antes de renderizar.
- Cada entry tem um sequence number monotônico — render ordena por seq e dedup por seq.

### B4. Implementar `requires_confirmation` para `pump_on` sem setor (spec §6.2)

**Estado atual:** o front já bloqueia `pump_on` quando nenhum setor está aberto. O firmware não tem chance de avaliar.

**Estado especificado:** firmware deve retornar `ack_status=requires_confirmation` + `ack_code=CONFIRMATION_NEEDED` se receber `pump_on` (sem `force=true`) com todos os setores fechados, e aceitar o reenvio com `params.force = true`.

**Por que importa:** modo manutenção / bancada (sangrar linha, teste de pré-pressostato) precisa do override. UI hoje só dá modal informativo "Ok, vou abrir um setor" — mas a spec já prevê o caminho `force=true` quando a UI implementar o botão "Ligar mesmo assim".

**Fix esperado no firmware:** rejeitar `pump_on` sem `force` quando `count(setores_open) == 0`, retornando `requires_confirmation`. Aceitar `pump_on {force: true}` mesmo sem setor aberto (com proteção de tempo curto + `pump_off_safety` se nada abrir em N segundos).

---

**Pronto. Use `PROTOCOLO-IOT.md` para detalhes; este documento é só para começar a codar rápido.**
