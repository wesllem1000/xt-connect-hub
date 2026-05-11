# Contrato MQTT — XT Connect Hub

> **Versão:** v0.15.6+
> **Atualizado em:** 2026-05-10
> **Owner:** Wesllem (plataforma) + Sebastião (firmware ESP)

Este documento é a fonte canônica do contrato MQTT entre dispositivos ESP
(IRR-V1, INT-V2, OFG-V1) e a plataforma XT Connect Hub. Quando houver conflito
entre este doc e `~xtadmin/teste winscp/DOCUMENTACAO-PROTOCOLO-IOT.md`, este
prevalece — o outro está fora do repo e descreve um rascunho mais antigo.

---

## §3a. Tópico `devices/<serial>/status` — duas shapes de payload

> **Contexto:** este tópico é o único onde dois produtores publicam payloads
> com estruturas distintas no mesmo canal retained. Qualquer subscriber
> **deve** distinguir as duas shapes antes de processar.

### Visão geral

| Shape | Produzido por | Quando | Payload |
|---|---|---|---|
| **A — Presença simples** | Firmware ESP (LWT + birth) | Conexão MQTT estabelecida (birth), queda de conexão (LWT), shutdown controlado | String plain: `online` ou `offline` |
| **B — Evento de presença derivado** | Plataforma (Node-RED: `fnHandleStatus`, sweeper, ingest de `/data`) | Após detecção de transição ou timeout de `last_seen` | JSON: `{ type: "device_status_changed", ... }` |

Ambas são publicadas como **retained, QoS 1**. A Shape B sobrescreve a Shape A
no broker. O frontend consome exclusivamente Shape B. O Node-RED consome
exclusivamente Shape A.

### Shape A — Presença simples (firmware → broker)

Campo único, plain text UTF-8, sem aspas JSON.

```
Payload = "online"   (caso-insensitivo no consumer)
Payload = "offline"  (qualquer outro valor → tratado como offline)
```

Quando o firmware publica:

| Gatilho | Valor | Quem publica |
|---|---|---|
| MQTT `CONNACK` recebido (birth message) | `online` | Firmware, imediatamente após conectar |
| Conexão MQTT cai abruptamente (LWT) | `offline` | Broker, automaticamente via Last Will |
| Shutdown controlado (graceful disconnect) | `offline` | Firmware, antes de `DISCONNECT` |

LWT configurado no `CONNECT` (parâmetros obrigatórios):

```c
mqtt_cfg.session.last_will.topic   = "devices/<SERIAL>/status";
mqtt_cfg.session.last_will.msg     = "offline";
mqtt_cfg.session.last_will.msg_len = 7;
mqtt_cfg.session.last_will.qos     = 1;
mqtt_cfg.session.last_will.retain  = 1;
```

Exemplo:

```
Topic:   devices/IRR-V1-00009/status
Payload: online
QoS:     1
Retain:  true
```

Compatibilidade: IRR-V1 firmware 0.15.5 e 0.16+ publicam Shape A identicamente.

### Shape B — Evento de presença derivado (plataforma → broker → frontend)

JSON UTF-8, objeto.

```json
{
  "type":         "device_status_changed",
  "online":       true,
  "device_id":    "uuid-do-device-no-postgres",
  "serial":       "IRR-V1-00009",
  "user_id":      "uuid-do-owner",
  "last_seen_at": "2026-05-10T14:30:00.000Z",
  "source":       "status-mirror"
}
```

Campos:

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `type` | `"device_status_changed"` | sim | Discriminador fixo. Identifica Shape B. |
| `online` | `boolean` | sim | `true` = online, `false` = offline |
| `device_id` | `string` (UUID) | sim | PK do device no Postgres |
| `serial` | `string` | sim | Serial MQTT (`mqtt_username`) |
| `user_id` | `string` (UUID) | sim | UUID do owner |
| `last_seen_at` | `string` (ISO-8601 UTC) | sim | Último timestamp confirmado de atividade |
| `source` | `string` | sim | Origem: `"status-mirror"`, `"ingest"`, `"sweeper"` |

Quando a plataforma publica Shape B:

| Gatilho | `online` | `source` |
|---|---|---|
| `fnHandleStatus` recebe Shape A `"online"` e `wasOnline == false` | `true` | `"status-mirror"` |
| `fnHandleStatus` recebe Shape A `"offline"` e `wasOnline == true` | `false` | `"status-mirror"` |
| Ingest de `/data` detecta primeiro payload e `wasOnline == false` | `true` | `"ingest"` |
| Sweeper (`last_seen` > threshold) | `false` | `"sweeper"` |

### Heurística canônica de distinção (daqui em diante)

Regra única, estável, independente de tamanho:

```
se typeof payload === 'object' && payload.type === 'device_status_changed'
  → Shape B  (evento derivado da plataforma)
caso contrário
  → Shape A  (presença do firmware, ou payload desconhecido — tratar como presença)
```

**Por que não usar tamanho do payload:** Shape A tem 6–7 bytes, Shape B tem ~200–300 bytes — hoje. Mas Shape B pode ser comprimida ou estendida no futuro. Tamanho é frágil.

**Por que não usar `"online" in payload`:** Shape A não é JSON; tentar `"online" in "online"` lança exceção em JS.

**Por que `type === 'device_status_changed'` é estável:** esse valor é gerado exclusivamente pela plataforma em três pontos auditáveis do código Node-RED. O firmware nunca gera esse campo.

### Guard anti-loop no Node-RED (manter obrigatório)

`fnHandleStatus` deve sempre checar, antes de qualquer processamento:

```javascript
if (msg.payload && typeof msg.payload === 'object') return null;
const raw = Buffer.isBuffer(msg.payload) ? msg.payload.toString('utf8') : String(msg.payload || '');
const trimmed = raw.trim();
if (trimmed.startsWith('{') || trimmed.startsWith('[')) return null;
```

Esse guard está implementado em `flows.json` (id `fnHandleStatus`) e **não deve ser removido**.

### Compatibilidade com firmware em produção

| Versão firmware | Shape A publicada | Shape B esperada | Compatível |
|---|---|---|---|
| 0.15.5 (IRR-V1-00009, campo) | `"online"` / `"offline"` plain text | sim | sim |
| 0.16 (em desenvolvimento) | `"online"` / `"offline"` plain text | sim | sim |

A Shape A não muda entre versões. Shape B é gerada exclusivamente pela plataforma.

### Anti-patterns — O que NÃO fazer

1. **Não parsear Shape A como JSON.** `JSON.parse("online")` lança `SyntaxError`.
2. **Não acessar `payload.online` sem verificar Shape B primeiro.** Se o payload for string `"online"`, `payload.online` é `undefined` e `!undefined` é `true` — lógica invertida silenciosa.
3. **Não publicar JSON em `status` a partir do firmware.** O `fnHandleStatus` descartará e o device nunca será marcado online.
4. **Não usar Shape B para heartbeat.** Shape B é emitida apenas em transição real. Loops com o guard.
5. **Não assumir que o retained em `status` é sempre Shape B** ao inicializar o frontend. O hook `useDeviceStatus.ts` trata isso: estado inicial vem da API REST, MQTT só sobrescreve quando Shape B chega.

### Inconsistência pendente (TODO)

`DOCUMENTACAO-PROTOCOLO-IOT.md §5.1` (linhas 131–140) documenta `/status` como JSON com campos `status`, `fw_version`, `uptime_s`, `rssi`, `ip`. **Está em desacordo com a implementação atual:** o firmware publica string plain. Aquele schema descreve uma versão futura desejada — não está em produção.

Decisão pendente (owner: Wesllem): manter string plain para sempre (mais simples, Shape B cobre riqueza de dados) ou evoluir Shape A para JSON compacto em v0.17+ (exigiria atualizar `fnHandleStatus` e todos os guards).

Até a decisão ser tomada, **Shape A = string plain** é a implementação canônica.
