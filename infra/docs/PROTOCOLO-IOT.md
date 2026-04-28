# Protocolo IoT XT Connect Hub — Especificação para Firmware

> **Versão:** 2.0 (2026-04-28)
> **Audiência:** desenvolvedores (humanos ou IAs) construindo firmware ESP32/ESP8266/etc. compatível com a plataforma XT Connect Hub.
> **Caso-referência:** Irrigação V1 (`IRR-V1`) — bomba + setores + timers + sensores DS18B20 de temperatura. É o modelo mais completo implementado; outros tipos (gerador, chocadeira) seguem o mesmo padrão adaptando comandos/eventos/payload.
> **Backend de produção:** `hub.xtconect.online` — Node-RED + Mosquitto + Postgres + Influx em Docker.
> **Mudanças vs v1.0:** ver §16 no fim.

---

## 1. Arquitetura

```
┌─────────────┐         MQTT/TLS:8883            ┌──────────────────┐
│             │ ◄────────────────────────────►  │                  │
│  ESP32/IoT  │                                  │  Mosquitto       │
│  (firmware) │                                  │  Broker          │
└─────────────┘                                  └────────┬─────────┘
                                                          │
                                              ┌───────────┴────────────┐
                                              │                        │
                                          ┌───▼─────┐         ┌────────▼────────┐
                                          │Node-RED │         │ Webapp browser  │
                                          │(backend)│         │ (WSS:8884)      │
                                          └────┬────┘         └─────────────────┘
                                               │
                                       ┌───────┴────────┐
                                       │                │
                                  ┌────▼────┐      ┌────▼────┐
                                  │Postgres │      │ Influx  │
                                  │ estado  │      │telemetria│
                                  └─────────┘      └─────────┘
```

### Princípios não-negociáveis

1. **Firmware é a autoridade absoluta** sobre estado físico (bomba, setor, ações de segurança), horários e segurança. Servidor reflete e roteia, não decide.
2. **Servidor sempre tem cópia do último estado** via tópicos `state` e `config/current` retained — UI nova abre e já tem dados.
3. **Comandos têm `cmd_id` + `expires_at`** — descarta se expirado, sempre responde ACK.
4. **Configuração transita via `config/push` retained** — dispositivo que reinicia recupera config do broker.
5. **Eventos discretos** com `event_uuid` (UUIDv4) → dedup natural.
6. **Cada dispositivo tem credenciais MQTT próprias**, com ACL filtrada por serial.
7. **Safety hard local**: alarme físico (temperatura, etc.) corta bomba e setores na hora, **não depende do servidor**.

---

## 2. Identidade e credenciais

### 2.1 Serial
- Formato: `<PREFIXO>-<MAJOR>-<SEQ>`. Exemplos: `IRR-V1-00006`, `INT-V2-00123`, `GER-V1-00001`.
- **Prefixo** identifica tipo: `IRR` irrigação, `INT` interface genérica, `OFG` off-grid, `BMB` bomba, `INC` incubadora, `GER` gerador, `CTN` container, etc.
- **Major version**: `V1`, `V2`. Versão nova quebra retrocompat.
- Serial é **gerado pelo servidor** no provisionamento. Vai gravado na NVS no flashing.

### 2.2 Credenciais MQTT
- `mqtt_username = serial` (string idêntica).
- `mqtt_password` aleatório, gerado no provisionamento, gravado na NVS, único por dispositivo.
- Broker produção: `mqtts://hub.xtconect.online:8883` (TLS).
- Verificar cert do servidor (Let's Encrypt válido — não usar `--insecure`).

### 2.3 Pairing code
- 6-8 caracteres alfanuméricos (sem caracteres confusos: sem `0/O`, `1/I/L`).
- Impresso na etiqueta + QR Code + dentro do dispositivo (display, ou serial debug).
- Cliente final escaneia QR no app pra associar à conta.

---

## 3. Tópicos MQTT (referência completa)

| Tópico | Direção | QoS | Retain | LWT | Propósito |
|---|---|---|---|---|---|
| `devices/<serial>/status` | device → server | 1 | **sim** | **sim** | `online` / `offline` |
| `devices/<serial>/data` | device → server | 0 ou 1 | não | não | Telemetria periódica genérica |
| `devices/<serial>/state` | device → server | 1 | **sim** | não | Snapshot completo do estado |
| `devices/<serial>/events` | device → server | 1 | não | não | Eventos discretos com `event_uuid` |
| `devices/<serial>/telemetry/sensors` | device → server | 0 | não | não | **NOVO v2** — leituras de temperatura por sensor |
| `devices/<serial>/commands` | server → device | 1 | não | não | Comando individual |
| `devices/<serial>/commands/ack` | device → server | 1 | não | não | ACK do comando, casa por `cmd_id` |
| `devices/<serial>/config/push` | server → device | 1 | **sim** | não | Config completa empurrada pelo servidor |
| `devices/<serial>/config/current` | device → server | 1 | **sim** | não | Config que o device aplica AGORA (ground truth) |

**Convenções**:
- Payloads são **JSON UTF-8**.
- Timestamps em **ISO-8601 UTC com `Z`**: `"2026-04-28T14:30:00.000Z"`.
- Nomes de campos em **snake_case**.
- Unidades **SI** (segundos, °C, litros, V, A, W).
- IDs gerados são **UUIDv4**.
- Tamanho máximo de payload: **4096 bytes** (validado no servidor).

**ACL Mosquitto** (configurado por `_e042c_dynsec_role_irr_v1.js`):
- Device pode publicar em: `data`, `state`, `events`, `commands/ack`, `config/current`, `status`, `telemetry/sensors`.
- Device pode subscrever em: `commands`, `config/push`.
- Tentativas fora desse escopo são silenciosamente dropadas pelo broker (PUBACK ok mas mensagem não propaga — ver `_e042c.js` GOTCHA).

---

## 4. Conexão e ciclo de vida

### 4.1 Boot

1. Lê NVS: `serial`, `mqtt_password`, `wifi_ssid`, `wifi_pass`, `last_known_config_version` (opcional).
2. Conecta Wi-Fi (com retry + AP-mode fallback se quiser).
3. Sincroniza relógio via NTP (`pool.ntp.org` ou `a.st1.ntp.br`). **Sem hora válida, NÃO publica timestamps inventados** — espera ou usa epoch=0 com flag.
4. Conecta MQTT com:
   - `client_id = <serial>-<uptime_ms>` (único por sessão)
   - `username = <serial>`, `password` da NVS
   - `clean_session = true`
   - `keepalive = 60s`
   - **LWT**: tópico `devices/<serial>/status`, payload `offline`, QoS 1, retain=true.
5. Após `CONNACK`:
   - Publica `devices/<serial>/status` com `online` retained (sobrescreve LWT).
   - Subscreve `devices/<serial>/commands` QoS 1.
   - Subscreve `devices/<serial>/config/push` QoS 1.
   - Publica `state` retained com snapshot atual.
   - Publica `config/current` retained.
6. Inicia loops: telemetria (intervalo do model — IRR-V1 default 30s), telemetria de sensores (30s para ESP real, 5s pro simulator), scheduler local de timers, watchdog.

### 4.2 Reconexão
- `reconnect_period = 5s` com backoff exponencial até 60s.
- Após reconectar: **republicar `state` e `config/current` retained**.
- Se chegou `config/push` retained durante o downtime, aplica e atualiza `config/current`.

### 4.3 Disconnect limpo
- Antes de desligar voluntariamente: publica `devices/<serial>/status` `offline` retain=true e desconecta com `DISCONNECT`.

---

## 5. Schemas JSON

### 5.1 Status
Payload **string simples** (não JSON):
```
online
```
ou:
```
offline
```
Tópico: `devices/<serial>/status`. Retain=true. QoS 1. LWT do device é `offline`.

### 5.2 Telemetria genérica (`/data`)
```json
{
  "ts": "2026-04-28T14:30:00.000Z",
  "readings": {
    "temperatura_bomba_c": 38.2,
    "tensao_v": 220.3,
    "corrente_a": 2.1
  }
}
```
- `readings` é flat — chaves descritivas, valores numéricos finitos.
- Servidor aceita também payload "flat" (sem envelope `ts/readings`) por retrocompat.
- Frequência: configurável via `telemetry_interval_s`.

### 5.3 State (snapshot, retained)

Exemplo IRR-V1:
```json
{
  "protocol_version": 1,
  "ts": "2026-04-28T14:30:00.000Z",
  "fw_version": "1.2.3",
  "config_version": 12,
  "pump": {
    "state": "off",
    "source": null,
    "started_at": null,
    "scheduled_off_at": null
  },
  "sectors": [
    {"numero": 1, "estado": "closed", "source": null, "opened_at": null, "scheduled_close_at": null},
    {"numero": 2, "estado": "closed", "source": null, "opened_at": null, "scheduled_close_at": null}
  ],
  "indicators": {
    "wifi": true,
    "mqtt": true,
    "time_valid": true
  }
}
```

- **Sempre retain=true**.
- Republicar a cada **transição** (mudança de modo, bomba on/off, setor open/close, etc.).
- `pump.state`: `off | starting | on | stopping`.
- `pump.source`: `null | manual_remote | manual_local | manual_button | automatic | safety`.
- `sector.estado`: `closed | opening | open | closing | paused`.
- `indicators.time_valid`: false até NTP sync.
- **Não usar para telemetria contínua** — use `data` ou `telemetry/sensors`.

### 5.4 Eventos (`/events`)

```json
{
  "event_uuid": "550e8400-e29b-41d4-a716-446655440000",
  "event_type": "pump_on_manual",
  "ts": "2026-04-28T14:30:00.000Z",
  "origem": "manual_app_remote",
  "alvo_tipo": "pump",
  "alvo_id": null,
  "duracao_s": null,
  "resultado": null,
  "payload": {"cmd_id": "abc-123-def"}
}
```

- **`event_uuid`**: UUIDv4 gerado pelo dispositivo. Servidor faz dedup natural (PK `(device_id, event_uuid)`).
- **`event_type`**: lista por modelo, validada contra `device_event_types` no banco. Ver §11 (IRR-V1).
- **`origem`**: `automatic | manual_app_local | manual_app_remote | physical_button | safety`.
- **`alvo_tipo`**: `pump | sector | null`.
- **`alvo_id`**: UUID do setor (se aplicável) ou número como string.
- **`payload`**: campos extras conforme o `event_type`.

**Event types do IRR-V1** estão catalogados em `device_event_types` no banco (32 tipos atualmente). Adicionar novos: ver `infra/docs/adicionar-novo-modelo.md`.

### 5.5 Comandos (`/commands`) — recebidos pelo device

```json
{
  "cmd_id": "abc-123-def-456",
  "protocol_version": 1,
  "cmd": "pump_on",
  "params": {"force": false},
  "issued_at": "2026-04-28T14:30:00.000Z",
  "expires_at": "2026-04-28T14:30:30.000Z",
  "origin": "manual_app_remote",
  "user_id": "uuid-do-user"
}
```

- **`cmd_id`**: UUIDv4 gerado pelo servidor. Device deve guardar últimos 100 IDs em RAM pra **idempotência**.
- **`protocol_version`**: começa em 1. Device rejeita se versão > suportada (ACK `refused`, code `UNSUPPORTED_VERSION`).
- **`cmd`**: string da whitelist do modelo. Ver §11.
- **`params`**: objeto livre por comando.
- **`expires_at`**: device descarta se `now() > expires_at`. ACK com `ack_status=expired`, `ack_code=EXPIRED`.
- **`origin`**: `manual_app_remote | manual_app_local | physical_button | automatic | provisioning | automation`.

### 5.6 ACK (`/commands/ack`)

```json
{
  "cmd_id": "abc-123-def-456",
  "ack_status": "executed",
  "ack_code": "OK",
  "ack_message": "Bomba ligada.",
  "ts": "2026-04-28T14:30:01.000Z",
  "result_payload": {"pump_state": "on"}
}
```

**Valores de `ack_status`**:
- `accepted` — recebido, validado, vai executar (ACK rápido < 100ms).
- `executed` — terminou OK (segundo ACK opcional).
- `refused` — recusado (motivo em `ack_message`, código em `ack_code`).
- `expired` — descartado por `expires_at`.
- `requires_decision` — operação ambígua, precisa decisão do user (ver §6).
- `requires_confirmation` — operação perigosa, precisa confirmação explícita.

**Códigos comuns (`ack_code`)**:
- `OK`, `INVALID_PARAMS`, `INVALID_STATE`, `HARDWARE_ERROR`, `BUSY`, `SAFETY_BLOCKED`, `UNSUPPORTED_VERSION`, `EXPIRED`, `DECISION_NEEDED`, `CONFIRMATION_NEEDED`.

### 5.7 Config Push (server → device, retained)

Payload completo com todas as seções:

```json
{
  "protocol_version": 1,
  "ts": "2026-04-28T14:35:00.000Z",
  "modo_operacao": "manual",
  "bomba": {
    "tipo_bomba": "monofasica",
    "nivel_ativo_bomba": "high",
    "reforco_rele_ativo": false,
    "atraso_abrir_valvula_antes_bomba_s": 3,
    "tempo_bomba_desligada_antes_fechar_valvula_s": 2,
    "atraso_religar_bomba_apos_fechamento_s": 5,
    "tempo_max_continuo_bomba_min": 120,
    "tempo_max_manual_local_min": 60,
    "tempo_max_manual_remoto_sem_internet_min": 60
  },
  "botao": {
    "tipo": "pulso_alterna",
    "debounce_ms": 50,
    "assume_manual": true
  },
  "gpio_1wire": 15,
  "sectors": [
    {
      "numero": 1, "nome": "Setor 1", "habilitado": true, "pausado": false,
      "gpio_rele": 16, "nivel_ativo_rele": "high",
      "tipo_botao_fisico": null, "gpio_botao": null, "debounce_ms": 50
    }
  ],
  "sensors": [
    {
      "rom_id": "28-1D129978F1C3", "nome": "Bomba motor", "role": "pump",
      "nome_custom": null, "limite_alarme_c": 70, "histerese_c": 5,
      "ack_usuario_requerido": true, "ativo": true
    }
  ],
  "timers": [
    {
      "id": "uuid-do-timer", "alvo_tipo": "sector", "sector_numero": 1,
      "tipo": "fixed", "nome": "Manhã setor 1",
      "ativo": true, "pausado": false,
      "hora_inicio": "06:00", "hora_fim": null,
      "duracao_min": 15, "on_minutes": null, "off_minutes": null,
      "dias_semana": 62, "observacao": null
    }
  ]
}
```

- **Sempre retain=true**.
- Device aplica **toda** a config recebida, não apenas seções modificadas.
- `botao.tipo`: `pulso_alterna | pulso_liga | pulso_desliga | retentivo`.
- `nivel_ativo_*`: `high | low`.
- `dias_semana`: bitmask 7-bit, bit 0 = domingo (ex.: `62 = 0b0111110` = seg-sex).
- `timer.tipo`: `fixed | cyclic_window | cyclic_continuous` (ver §8).

### 5.8 Config Current (device → server, retained)

**Mesmo payload de `config/push`**, com os valores que o device está aplicando AGORA. Servidor faz UPSERT no banco — banco vira cache do que o firmware reportou. Se device aplicou parcial (ex.: setor 5 com GPIO inválido), reporta o que conseguiu aplicar.

UI sempre lê `config/current`, NUNCA `config/push`.

### 5.9 Telemetria de sensores (`/telemetry/sensors`) — **NOVO v2**

```json
{
  "protocol_version": 1,
  "ts": "2026-04-28T14:30:00.000Z",
  "readings": [
    {"rom_id": "28-1D129978F1C3", "temperature_c": 42.5},
    {"rom_id": "28-AB9F3344C100", "temperature_c": 38.1}
  ]
}
```

- QoS 0, retain=false (volátil, alta frequência).
- Frequência recomendada: **30s para ESP real** (5s no simulator pra demos).
- Servidor faz `UPDATE irrigation_temperature_sensors SET ultima_leitura_c=?, ultimo_contato_em=NOW() WHERE rom_id = ?`.
- `temperature_c` em °C (float). Se sensor falhou na leitura, manda `null`.

---

## 6. Decisões interativas

Comandos que disparam situações ambíguas devem responder `requires_decision` ou `requires_confirmation` em vez de decidir errado.

### 6.1 `requires_decision`

Exemplo: usuário pediu fechar último setor com bomba ligada.

```json
{
  "cmd_id": "abc-123",
  "ack_status": "requires_decision",
  "ack_code": "DECISION_NEEDED",
  "ack_message": "Fechar este setor desligará a bomba. Como proceder?",
  "decision_options": [
    {"key": "safe_stop", "label": "Desligar bomba primeiro (recomendado)"},
    {"key": "force_close", "label": "Fechar setor mesmo assim"}
  ]
}
```

UI mostra diálogo. Ao escolher, app reenvia o **mesmo `cmd`** com `params.strategy = "safe_stop"` e novo `cmd_id`.

### 6.2 `requires_confirmation`

Exemplo: ligar bomba sem nenhum setor aberto.

```json
{
  "cmd_id": "abc-123",
  "ack_status": "requires_confirmation",
  "ack_code": "CONFIRMATION_NEEDED",
  "ack_message": "Nenhum setor aberto. Ligar bomba pode danificar.",
  "confirmation_action": "force"
}
```

UI mostra "Confirmar"/"Cancelar". Confirmar reenvia com `params.force = true` e novo `cmd_id`.

---

## 7. Lifecycle de alarme — **NOVO v2**

Comportamento DEFINITIVO acordado entre dono + dev:

### 7.1 Quando temperatura ultrapassa limite

1. Firmware imediatamente:
   - **Corta bomba** (estado `off`, source `null`).
   - **Fecha TODOS setores abertos**.
   - **Cancela timers em execução**.
   - Republica `state` retained.
2. Publica `events`:
   - `temp_alarm_triggered` com `payload: {sensor_id, rom_id, role, nome, temp_c, limite_c, bomba_cortada, setores_fechados}`, origem `safety`.
   - `pump_off_safety` se cortou bomba — origem `safety`.
   - `sector_closed` por setor afetado, com `payload.motivo: "temp_alarm_safety"` — origem `safety`.
3. Mantém estado interno `alarm_active = true` com info do sensor disparador. **NÃO** auto-limpa quando temperatura cai.

### 7.2 Limpando o alarme

Alarme só limpa via **ACK explícito**, vindo de duas fontes:

**(a) ACK pelo botão "Reconhecer" no firmware/simulador**:
- Firmware publica `events`:
  ```json
  {
    "event_type": "temp_alarm_ack_user",
    "payload": {"sensor_id": "...", "rom_id": "..."},
    "origem": "manual_app_remote"
  }
  ```
- Backend faz `UPDATE irrigation_alarms SET acked_at=NOW(), resolved_at=NOW()`.
- Firmware zera estado local de alarme.

**(b) ACK pelo app web**:
- App chama `POST /dispositivos/:id/irrigacao/alarmes/:alarmId/ack`.
- Backend faz UPDATE no banco + publica em `devices/<serial>/commands`:
  ```json
  {
    "cmd_id": "...", "protocol_version": 1,
    "cmd": "temp_alarm_clear",
    "params": {"alarm_id": "...", "rom_id": "...", "source": "app_ack"},
    "issued_at": "...", "expires_at": "...",
    "origin": "manual_app_remote", "user_id": "..."
  }
  ```
- Firmware processa `temp_alarm_clear`: zera estado local, ACK `executed`, republica `state`.

### 7.3 Bomba e setores **NÃO religam** automaticamente após ACK

Operador tem que religar manualmente. Justificativa: garantia que humano confirmou que o problema físico foi resolvido (vazamento, bomba travada, etc.).

### 7.4 Persistência

Estado de alarme deve persistir em **NVS/flash** do firmware. Se device reiniciar com alarme ativo, ao subir, restaura o `alarmActive` e a info, e mantém banner ativo até receber ACK.

(O simulator persiste em `localStorage` — comportamento equivalente.)

---

## 8. Scheduler local de timers (3 tipos)

Firmware é a autoridade do tempo. Servidor cadastra timers e empurra via `config/push` retained. Firmware agenda e dispara localmente.

### 8.1 `tipo: "fixed"`
Disparo único no horário, dura `duracao_min`.
- `hora_inicio`: `"HH:MM"`.
- `duracao_min`: minutos (1..1440).
- Quando `dias_semana & (1 << dia_atual)` e `hora_inicio == HH:MM atual` → dispara.
- Após `duracao_min`, desliga.

### 8.2 `tipo: "cyclic_window"`
Liga `on_minutes`, descansa `off_minutes`, dentro da janela `hora_inicio..hora_fim`.
- Janela pode cruzar meia-noite (`hora_inicio = "20:00"`, `hora_fim = "06:00"`).
- Fora da janela: desliga.
- Dentro da janela: alterna ON/OFF respeitando `on_minutes` / `off_minutes`.

### 8.3 `tipo: "cyclic_continuous"`
Mesmo padrão de `cyclic_window` mas **24h** (ignora `hora_inicio` / `hora_fim`).
- Liga `on_minutes`, descansa `off_minutes`, repete.

### 8.4 Comportamento ao acordar do reset
- Lê `config/current` (que tem timers).
- Inicia ciclos com `_running = false` e `_restingSince = null`.
- Tick a cada segundo decide.

### 8.5 Conflitos
Servidor faz detecção de overlap **na criação/edição** (lib `irrTimerOverlap` no Node-RED, retorna 422 com motivo). Firmware confia na config recebida — não precisa validar overlap.

---

## 9. Loop config bidirecional

```
                       ┌─ user edita no app ─┐
                       ▼                     │
   [Postgres]  ◄──── Node-RED PATCH /config ─┘
       │
       └─► publish config/push retained ────────►  ESP/firmware
                                                       │
                                                       │  (aplica)
                                                       ▼
                                                  publish config/current retained
                                                       │
                                                       ▼
                                                  Node-RED handler
                                                       │
                                                       └─► UPSERT em irrigation_*
```

- Usuário edita setor no app → backend `PATCH /setores/:numero` → grava banco → publica `config/push` completa retained.
- Firmware recebe `config/push` → aplica → publica `config/current` retained com valores reais.
- Backend recebe `config/current` → faz UPSERT (ou INSERT se ESP é fonte de verdade) em `irrigation_configs`, `irrigation_sectors`, `irrigation_temperature_sensors`, `irrigation_timers`.
- App refetch snapshot a cada 15s e mostra valores aplicados.

**ESP é fonte de verdade**: se ESP rejeita um GPIO inválido, ele NÃO aplica e NÃO publica em `config/current`. Banco continua com o valor anterior.

---

## 10. Provisionamento e claim

### 10.1 Fábrica
1. Servidor (admin) registra modelo: `INSERT INTO modelos_dispositivo (prefixo, major_version, ...)`.
2. Servidor registra event_types e alarm_types do modelo (ver `infra/docs/adicionar-novo-modelo.md`).
3. Servidor cria função `provision_<modelo>_defaults(uuid)` que popula tabelas de config padrão.
4. Servidor (admin) na UI clica "Provisionar Produto":
   - Gera `serial = <prefixo>-<major>-<seq>` (ex.: `IRR-V1-00007`).
   - Gera `mqtt_password` aleatório.
   - Gera `claim_token` UUID + `pairing_code` curto (sem `0/O/1/I/L`).
   - Cria credencial dynsec no Mosquitto (`createClient` + `addClientRole`).
   - Cria role `<prefixo>-<major>-device` se ainda não existe (com ACLs).
   - Insere row em `devices` com `status=ocioso`.
   - Chama `provision_<modelo>_defaults(uuid)` que popula config padrão.
5. Operador flasheia ESP com firmware + grava NVS: `serial`, `mqtt_password`.
6. Etiqueta com `pairing_code` (texto + QR) é colada no produto.

### 10.2 Claim (cliente final)
1. Cliente abre app, faz login.
2. Clica "Adicionar Dispositivo" → escaneia QR / digita pairing_code.
3. App chama `POST /dispositivos/claim` com `{pairing_code, apelido?}`.
4. Servidor valida: token não usado, dispositivo `status=ocioso`. Associa `user_id` ao device, muda `status=associado`.
5. Servidor pode publicar `config/push` retained customizada (geralmente os defaults já bastam).
6. Cliente vê o dispositivo no dashboard.

---

## 11. IRR-V1 — comandos e eventos (referência)

### 11.1 Comandos aceitos

| `cmd` | `params` | Descrição |
|---|---|---|
| `pump_on` | `{force?: bool}` | Liga bomba. `force=true` ignora "nenhum setor aberto". |
| `pump_off` | `{}` | Desliga bomba. |
| `sector_open` | `{numero, strategy?: "safe_stop"\|"force_close"}` | Abre setor. |
| `sector_close` | `{numero, strategy?: "safe_stop"\|"force_close"}` | Fecha setor. |
| `sector_pause` | `{numero}` | Pausa setor. |
| `sector_resume` | `{numero}` | Resume setor pausado. |
| `mode_set` | `{modo: "manual"\|"automatico"}` | Troca modo geral. |
| `safe_closure` | `{}` | Fecha tudo em sequência segura. |
| `config_reload` | `{}` | Re-aplica `config/current`. |
| `factory_reset` | `{}` | Apaga tudo exceto serial/credenciais. |
| `set_rate` | `{rate_s: int, mode?: "default"\|"burst"}` | Muda intervalo de telemetria (NÃO de telemetry/sensors). |
| `temp_alarm_clear` | `{alarm_id, rom_id, source}` | **Novo v2** — backend pede pra limpar alarme local após ACK no app. |

### 11.2 Eventos emitidos

Catalogados em `device_event_types`. Atuais:

`pump_on_manual`, `pump_off_manual`, `pump_on_auto`, `pump_off_auto_end`, `pump_off_safety`,
`sector_opened`, `sector_closed`, `safe_closure_started`, `safe_closure_completed`,
`last_sector_closed_pump_on`, `confirmation_requested`, `confirmation_accepted`, `confirmation_cancelled`,
`remote_cmd_received`, `remote_cmd_executed`, `remote_cmd_refused`,
`wifi_connected`, `wifi_disconnected`, `mqtt_connected`, `mqtt_disconnected`,
`time_synced`, `time_invalid`,
`timer_created`, `timer_edited`, `timer_paused`, `timer_reactivated`, `timer_removed`,
`temp_alarm_triggered`, `temp_alarm_ack_user`, `temp_sensor_lost`,
`physical_button_pressed`, `auto_shutoff_max_time`.

### 11.3 Tipos de alarme (`irrigation_alarms.tipo`)

`temperature_high`, `sensor_missing`, `pump_runtime_exceeded`, `communication_lost`.

---

## 12. Como adicionar novo modelo de dispositivo

Ver doc separada: `infra/docs/adicionar-novo-modelo.md`.

Resumo: hoje **não exige ALTER TABLE** — `device_event_types` e `device_alarm_types` são catalogos por modelo (migration 021_device_capabilities). Adicionar gerador é INSERT em 3 tabelas.

---

## 13. Segurança

### 13.1 Em produção
- TLS obrigatório no broker (porta 8883, cert Let's Encrypt válido).
- Cada device com credencial própria (dynsec) e ACL filtrada por serial.
- Senhas MQTT nunca trafegam via app — só servidor sabe.
- Frontend usa token MQTT efêmero por usuário (1h, role `webapp-viewer-of:<userid>`).

### 13.2 No firmware
- **Verificar cert do servidor** — não usar `--insecure`.
- NVS protegida (encrypted partition no ESP32).
- Não logar senha MQTT em serial.
- Watchdog hardware + soft watchdog.
- **Timeouts de segurança absolutos** em RAM (bomba não fica ligada > N min sem comando explícito), **independente da config recebida**.

### 13.3 Idempotência
- Comando com `cmd_id` repetido: device ignora (já executou) e responde ACK com mesmo resultado (cache RAM dos últimos 100 cmd_id).
- Eventos duplicados: servidor dedup por `event_uuid`.

---

## 14. Convenções resumidas

| Item | Convenção |
|---|---|
| Encoding | UTF-8 |
| Formato payload | JSON (exceto `status` que é string) |
| Naming campos | `snake_case` |
| Timestamps | ISO-8601 UTC com `Z` |
| IDs gerados | UUIDv4 |
| Unidades | SI |
| Booleans | `true`/`false` |
| QoS comandos/ACK/eventos/state/config | 1 |
| QoS telemetria genérica | 0 ou 1 |
| QoS telemetria de sensores | 0 |
| Retain | `status`, `state`, `config/push`, `config/current` |
| Tamanho máx payload | 4096 bytes |
| Keepalive MQTT | 60s |
| Sessão | `clean_session = true` |

---

## 15. Checklist do firmware

- [ ] Lê serial e mqtt_password de NVS
- [ ] Conecta Wi-Fi com retry + AP-mode fallback
- [ ] Sincroniza NTP antes de publicar timestamps
- [ ] Conecta MQTT com TLS, LWT configurado (`status=offline` retain)
- [ ] Publica `status=online` retain no CONNACK
- [ ] Publica `state` retain no boot
- [ ] Publica `config/current` retain no boot
- [ ] Subscreve `commands` e `config/push`
- [ ] Cache RAM de últimos 100 `cmd_id` (idempotência)
- [ ] Descarta comandos com `expires_at` passado (ACK `expired`)
- [ ] Implementa whitelist de comandos do modelo
- [ ] Emite ACK em `commands/ack` para todo comando
- [ ] Implementa `requires_decision` / `requires_confirmation`
- [ ] Aplica `config/push` quando recebe (se versão > anterior)
- [ ] Republica `config/current` retain após aplicar
- [ ] Emite eventos em `events` com `event_uuid` UUIDv4 nas transições
- [ ] Buffer offline de eventos em flash (até 100)
- [ ] Scheduler local de timers (3 tipos: fixed, cyclic_window, cyclic_continuous)
- [ ] Telemetria genérica em `data` no intervalo configurado
- [ ] Telemetria de sensores em `telemetry/sensors` a cada 30s
- [ ] **Safety hard local**: alarme de temperatura corta bomba+setores+timers, persiste em NVS, só limpa via ACK
- [ ] Implementa comando `temp_alarm_clear` (limpa alarme local)
- [ ] Watchdog hardware ativo
- [ ] Timeouts de segurança absolutos (max runtime bomba, etc.)
- [ ] Reconexão MQTT com backoff exponencial
- [ ] Republica `state` e `config/current` retain após reconectar
- [ ] Botão físico (se aplicável) com debounce e tipos `pulso_alterna|pulso_liga|pulso_desliga|retentivo`

---

## 16. Mudanças vs versão 1.0 (2026-04-27)

| Mudança | Onde | Por que |
|---|---|---|
| Tópico novo `telemetry/sensors` | §3, §5.9 | Leituras de DS18B20 ao vivo (pre-existia só `data` genérico) |
| Schema `state` real | §5.3 | Substitui exemplo conceitual pelo formato implementado |
| Schema `config/push` completo | §5.7 | Inclui modo_operacao, botao, gpio_1wire, sensors com rom_id, timers com 3 tipos |
| Lifecycle de alarme | §7 (novo) | Persiste até ACK explícito (mudança de regra do dono) |
| Comando `temp_alarm_clear` | §11.1 | Novo — backend dispara ao ACK no app |
| Loop config bidirecional | §9 (novo) | Documenta o caminho config/push ↔ config/current |
| Scheduler 3 tipos | §8 | fixed + cyclic_window + cyclic_continuous (era só fixed) |
| Eventos catalogados em DB | §11.2 | `device_event_types` substitui CHECK constraint hardcoded |
| Provisionamento sem ALTER | §10, §12 | Migration 021 destrava novos modelos sem migration |
| Schema validação | §11.3 | `irrigation_alarms.tipo` é catalogado em `device_alarm_types` |

---

**Fim da v2.0 — 2026-04-28.**

> Para qualquer dúvida específica de implementação, consulte os scripts em `infra/scripts/_e0XX_*.cjs` que mostram o que o backend espera receber e como processa. O simulador `public/simulator-irr-v1.html` é a referência viva do comportamento esperado do firmware.
