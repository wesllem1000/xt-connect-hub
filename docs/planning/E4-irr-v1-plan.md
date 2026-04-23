# E4 · IRR-V1 — plano de implementação

**Épico:** #71 — modelo IRR-V1 (automação de irrigação completa) integrado ao XT Conect Hub.
**Branch base:** `xtconect-v2`.
**Entrega:** MVP web, mobile-first. Nativo é próxima fase; schemas/API já estruturados pra ele.

---

## 0. Pilares não-negociáveis (§16.1)

1. **Firmware é autoridade absoluta.** Ele executa horários, intertravamentos, alarmes, fechamento seguro, timeouts. Backend/webapp **nunca inventa regra** — só armazena, envia, recebe, mostra.
2. **Resiliência offline.** Sem internet a fazenda continua irrigando corretamente. Server faz catch-up quando voltar.
3. **Reuso total da infra:** mesmo Mosquitto, Node-RED, Postgres, Influx, webapp, auth, claim flow. IRR-V1 é `model_code` novo no catálogo de modelos — não produto paralelo.
4. **Pré-montagem no provisionamento:** criar um IRR-V1 no admin já gera config default + 8 setores default + 0 timers + 0 sensores. User claima → ficha abre funcional.

---

## 1. Migrations Postgres

Já temos até a `010_apelido_dispositivo.sql`. Nova sequência:

### `011_irr_v1_schema.sql`

Cria as 6 tabelas novas (todas FK em `devices(id) ON DELETE CASCADE`).

```
devices (existente)
  ├─── 1:1 ──> irrigation_configs
  ├─── 1:N ──> irrigation_sectors        (CHECK numero 1..8; UNIQUE(device_id, numero))
  ├─── 1:N ──> irrigation_timers         (CHECK posição por alvo ≤ 10; CHECK tipo ∈ enum)
  ├─── 1:N ──> irrigation_temperature_sensors  (UNIQUE(device_id, rom_id); CHECK até 4)
  ├─── 1:N ──> irrigation_events         (PK event_uuid; INDEX (device_id, ts DESC))
  └─── 1:N ──> irrigation_alarms         (INDEX (device_id) WHERE resolved_at IS NULL)

irrigation_timers.alvo_id ────> irrigation_sectors.id    (nullable — null = bomba)
irrigation_alarms.acked_by_user_id ────> app_users.id
```

**Colunas detalhadas:**

- `irrigation_configs`: `device_id PK/FK`, `protocol_version INT DEFAULT 1`, `tipo_bomba TEXT CHECK IN ('mono','inverter')`, `reforco_rele BOOL DEFAULT FALSE`, `atraso_abrir_valvula_ligar_bomba_s INT`, `tempo_bomba_off_antes_fechar_valvula_s INT`, `atraso_religar_bomba_s INT`, `tempo_max_bomba_ligada_manual_min INT`, `tempo_max_sem_comunicacao_min INT`, `tipo_botao_bomba TEXT`, `nivel_ativo_bomba TEXT CHECK IN ('high','low')`, `debounce_ms INT`, `gpio_1wire INT DEFAULT 15`, `setorizacao_ativa BOOL`, `criado_em`, `atualizado_em`.

- `irrigation_sectors`: `id PK`, `device_id FK`, `numero INT CHECK 1..8`, `nome TEXT`, `habilitado BOOL`, `pausado BOOL`, `tipo_botao_fisico TEXT`, `gpio_botao INT NULL`, `gpio_rele INT`, `nivel_ativo_rele TEXT`, `debounce_ms INT`, `ultimo_acionamento_em TIMESTAMPTZ`, `ultima_duracao_s INT`, `proxima_execucao_em TIMESTAMPTZ`.

- `irrigation_timers`: `id PK (uuid)`, `device_id FK`, `tipo TEXT CHECK IN ('fixed','cyclic_window','cyclic_continuous')`, `alvo_tipo TEXT CHECK IN ('pump','sector')`, `alvo_id UUID NULL` (FK `irrigation_sectors(id)` quando sector), `nome TEXT`, `ativo BOOL`, `pausado BOOL`, `hora_inicio TIME`, `duracao_min INT`, `hora_fim TIME NULL`, `on_minutes INT NULL`, `off_minutes INT NULL`, `dias_semana SMALLINT CHECK 0..127` (bitmask dom..sab), `observacao TEXT`, `criado_em`.
  - **Trigger** `enforce_limit_10_per_target`: rejeita INSERT que ultrapasse 10 timers por `(device_id, alvo_tipo, COALESCE(alvo_id, '00000000-...'))`.

- `irrigation_temperature_sensors`: `id PK`, `device_id FK`, `rom_id TEXT NOT NULL` (formato `28:XX:XX:...`), `UNIQUE(device_id, rom_id)`, `nome TEXT`, `role TEXT CHECK IN ('pump','inverter','custom')`, `threshold_c NUMERIC(5,2)`, `hysteresis_c NUMERIC(4,2)`, `ativo BOOL`, `ultima_leitura_c NUMERIC(5,2) NULL`, `ultimo_contato_em TIMESTAMPTZ NULL`.
  - **Trigger** `enforce_limit_4_sensors_per_device`: rejeita se já há 4 no device.

- `irrigation_events`: `event_uuid UUID PK` (gerado pelo **firmware**, garante dedup em reenvio), `device_id FK`, `tipo TEXT NOT NULL` (enum-like; 30+ valores listados em §2.5 do contrato MQTT — validação aplicação-side via CHECK expressivo ou enum custom), `alvo_tipo TEXT NULL`, `alvo_id UUID NULL`, `origem TEXT CHECK IN ('automatic','manual_app_local','manual_app_remote','physical_button','safety')`, `resultado TEXT NULL`, `duracao_s INT NULL`, `payload_json JSONB`, `ts TIMESTAMPTZ NOT NULL` (timestamp do **device**, não do ingest), `ingested_at TIMESTAMPTZ DEFAULT NOW()`.
  - Índices: `(device_id, ts DESC)`, `(device_id, tipo, ts DESC)`.
  - `INSERT ... ON CONFLICT (event_uuid) DO NOTHING` — dedup natural.

- `irrigation_alarms`: `id PK (uuid)`, `device_id FK`, `tipo TEXT CHECK IN ('temperature_high','sensor_missing','pump_runtime_exceeded','communication_lost')`, `sensor_rom_id TEXT NULL`, `message TEXT`, `triggered_at TIMESTAMPTZ`, `acked_by_user_id UUID NULL FK app_users`, `acked_at TIMESTAMPTZ NULL`, `resolved_at TIMESTAMPTZ NULL`.
  - Índice parcial `(device_id) WHERE resolved_at IS NULL`.

### `012_irr_v1_model_seed.sql`

Adiciona (ou estende) o registro `IRR-V1` em `modelos_dispositivo`:

- `prefixo='IRR'`, `major_version='V1'`, `nome='Irrigação V1'`, `descricao`, `imagem_url`, `rate_default_segundos=5`, `ativo=true`, `especificacoes` JSONB com defaults e hooks pro provisionamento.
- **Já existe seed do IRR-V1** em `_e030_seed_modelos.sql` (commit `33d719b`). A migration 012 **estende** o row: adiciona flag custom `requires_provisioning_template=true` em `especificacoes.flags`, e valida idempotência.

### `013_irr_v1_provisioning_hook.sql`

Procedure **`provision_irr_v1_defaults(p_device_id UUID)`** idempotente que:

1. `INSERT INTO irrigation_configs(device_id, ...) ON CONFLICT DO NOTHING` — valores default da §5 do doc (atraso=2s, tempo_max_manual=30min, nivel_ativo=high, etc.).
2. `INSERT` 8 rows em `irrigation_sectors` (numero 1..8, `habilitado=false`, `gpio_rele=default_por_numero`, `nome='Setor N'`). Exceto setor 1 que pode vir `habilitado=true` por conveniência — **ponto aberto pra decisão (R1 abaixo)**.
3. Zero rows em `irrigation_timers` e `irrigation_temperature_sensors`.
4. Retorna `(config_id, sector_ids[])`.

Chamada em dois pontos:
- **No provisionamento do admin** (`fnProvisionar` no Node-RED, script `_e030_inject_fleet.js`): após `INSERT INTO devices` bem-sucedido, se `modelo.prefixo='IRR' AND modelo.major_version='V1'`, chama a procedure.
- **Defensivo no claim**: se por algum motivo o device não teve provisionamento (legacy), o fnClaim chama a mesma procedure on-demand.

---

## 2. Contrato MQTT

Arquivo separado: `docs/mqtt/irr-v1-protocol.md`. Link a partir deste plano.

### 2.1 Tópicos

Todos sob `devices/<serial>/`:

| Tópico | Direção | QoS | Retained | Notas |
|---|---|---|---|---|
| `data` | device→server | 0 | não | telemetria periódica (5s) |
| `status` | device→server | 1 | sim (LWT) | online/offline |
| `events` | device→server | 1 | não | eventos pontuais com event_uuid |
| `commands` | server→device | 1 | **não** pra críticos / **sim** pra config | ver §2.3 |
| `commands/ack` | device→server | 1 | não | resposta ao comando |
| `config/push` | server→device | 1 | sim | config completa |
| `config/current` | device→server | 1 | sim | config que o device está aplicando |

### 2.2 `data` (flat, compatível com ingest atual fnHandleData)

```json
{
  "protocol_version": 1,
  "uptime_s": 123, "firmware": "0.1.0", "modelo": "IRR-V1",
  "modo": "automatico", "hora_valida": true, "ntp_ok": true,
  "bomba_ligada": false, "bomba_origem": null,
  "bomba_ligada_ha_s": 0, "bomba_desliga_em_s": null, "bomba_motivo_bloqueio": null,
  "setores": [{"id":1,"aberta":false,"pausado":false,"ligada_ha_s":0}],
  "temp_sensores": [{"rom":"28:AA:...","c":34.2,"st":"ok"}],
  "alarme_temperatura_ativo": false,
  "alarmes": [{"tipo":"sensor_missing","rom":"28:BB:..."}]
}
```

Extend do `fnHandleData` atual: se `modelo==='IRR-V1'`, chamar subhandler que atualiza `last_reading` com o payload inteiro + popula tabelas de estado volátil (sensors.ultima_leitura_c, sensors.ultimo_contato_em, sectors.ultimo_acionamento_em). Base numérica (uptime_s, etc.) continua indo pro Influx.

### 2.3 `commands`

Todos com `request_id UUID` + `expires_at ISO`. `protocol_version: 1`.

| Comando | Body extra | Crítico? (não retained) |
|---|---|---|
| `set_mode` | `{mode:"automatico"\|"manual"}` | sim |
| `pump_on` / `pump_off` | `{force?:true}` | sim |
| `sector_open/close/pause/resume` | `{sector_id:N}` | sim |
| `ack_alarm` | `{alarm_id}` | sim |
| `apply_config` | payload completo config | **não-crítico, retained** |
| `create_timer/update_timer/delete_timer/pause_timer/resume_timer` | timer spec | **não-crítico, retained** |
| `scan_temperature_sensors` | `{}` | sim |
| `dump_local_history` | `{since_seq?}` | sim |
| `sync_time` | `{ts_utc}` | sim |
| `factory_reset` | `{confirm:true}` | sim |
| `reboot` | `{}` | sim |

### 2.4 `commands/ack` — 4 status possíveis

```json
{"request_id":"...","status":"executed","result":{}}
{"request_id":"...","status":"confirmation_required","reason":"all_sectors_closed","message":"..."}
{"request_id":"...","status":"decision_required","options":[{"id":"stop_all","label":"..."}, ...],"message":"..."}
{"request_id":"...","status":"refused","reason":"temperature_alarm_active","message":"..."}
```

### 2.5 `events` — 30+ tipos, lista em anexo do doc MQTT

Exemplos: `pump_start`, `pump_stop`, `sector_open`, `sector_close`, `timer_fired`, `temperature_threshold_reached`, `sensor_missing`, `manual_override_physical_button`, `communication_lost`, `communication_restored`, `factory_reset`, `boot`, etc.

Firmware grava event_uuid local ao gerar. Publica no MQTT imediatamente se online. Se offline, acumula em ring buffer de ~100 eventos na flash. Ao reconectar, reenvia. Backend dedup via `ON CONFLICT (event_uuid) DO NOTHING`.

---

## 3. API REST (backend webapp)

Convenção: **pt-BR** pra consistência com o resto (`/api/dispositivos/...`), não `/api/devices/...`. Lista canônica abaixo; assinaturas completas em anexo neste mesmo doc.

Base: `/api/dispositivos/:serial/irrigacao`

| Verbo | Path | Body (resumido) | Resposta | Notas |
|---|---|---|---|---|
| GET | `/config` | — | `{config}` | |
| PATCH | `/config` | `{campo: valor, ...}` + `confirmed?:bool` | `{config}` | `confirmed=true` obrigatório se mudar `reforco_rele`, `tipo_bomba`, `nivel_ativo_bomba` |
| GET | `/setores` | — | `[8 rows]` | sempre 8; inclui desabilitados |
| PATCH | `/setores/:numero` | `{campos}` | `{setor}` | `numero` 1..8 |
| GET | `/timers` | `?alvo_tipo=pump\|sector&alvo_id=` | `[timers]` | |
| POST | `/timers` | timer spec + `accept_overlap?:bool` | 201 `{timer}` ou 409 `{conflitos, timer_proposto}` | |
| PATCH | `/timers/:id` | parcial | `{timer}` | re-valida overlap |
| DELETE | `/timers/:id` | — | 204 | |
| POST | `/timers/:id/pause` | — | `{timer}` | |
| POST | `/timers/:id/resume` | — | `{timer}` | |
| POST | `/timers/:id/duplicate` | `{nome_novo?}` | 201 `{timer}` | |
| GET | `/sensores-temperatura` | — | `[sensores]` | |
| POST | `/sensores-temperatura/scan` | — | `{request_id}` + async event `sensors_found` | |
| POST | `/sensores-temperatura` | `{rom_id, nome, role, threshold_c, hysteresis_c}` | 201 `{sensor}` | |
| PATCH | `/sensores-temperatura/:rom_id` | parcial | `{sensor}` | |
| DELETE | `/sensores-temperatura/:rom_id` | — | 204 | |
| GET | `/eventos` | `?from=&to=&tipo=&alvo_tipo=&page=&limit=` | paginado | filtros AND |
| GET | `/alarmes/ativos` | — | `[alarmes]` | |
| POST | `/alarmes/:id/ack` | — | `{alarme}` | |
| POST | `/comando` | `{tipo, args}` | `{status, result\|reason\|options}` | **wrapper síncrono: publica + espera ack 10s** |
| POST | `/dump-local-history` | — | `{request_id}` + async events | |

**Regras de validação obrigatórias (backend, antes de publicar):**
- Overlap de timers: algoritmo na seção 8.
- Limite de 10 timers por alvo: 422 com `{limit:10, atual:N}`.
- Config perigosa sem `confirmed:true`: 428.
- Device offline para comando crítico: 503 `{device_offline:true}` — UI exibe "Dispositivo offline, tente de novo".

---

## 4. Node-RED — novos flows

Script inject: `infra/scripts/_e040_inject_irr_v1.js` (idempotente, mesmo padrão dos outros `_e0XX_`).

### 4.1 Ingest `events` (novo handler `fnHandleEvents`)

Assina `devices/+/events` QoS 1. Parse → `INSERT INTO irrigation_events ... ON CONFLICT (event_uuid) DO NOTHING`.

### 4.2 Extend `fnHandleData` pra IRR-V1

No handler atual, após `UPDATE devices SET is_online=TRUE, last_seen=NOW()...`, detectar `payload.modelo === 'IRR-V1'` e delegar pra `irrigationDataSideEffects(devId, payload)`:
- Para cada `temp_sensores[]` com `st:'ok'`: `UPDATE irrigation_temperature_sensors SET ultima_leitura_c=..., ultimo_contato_em=NOW() WHERE device_id=$1 AND rom_id=$2`.
- Para cada `setores[]`: `UPDATE irrigation_sectors SET pausado=..., proxima_execucao_em=... WHERE device_id=$1 AND numero=$2` (só campos voláteis).
- Tratar transições de alarme (criar/resolver rows em `irrigation_alarms` — seção 4.4).

### 4.3 Command router (wrapper HTTP sync)

Endpoint **`POST /api/dispositivos/:serial/irrigacao/comando`**. Handler `fnIrrComando`:

1. Gera `request_id = crypto.randomUUID()`, `expires_at = now+10s`.
2. Publica em `devices/<serial>/commands` com QoS 1 (retained ou não conforme comando, tabela §2.3).
3. Subscribe temporário em `devices/<serial>/commands/ack`, filtra por `request_id`.
4. Timeout de **5s** → responde HTTP 504 parcial (`{status:'waiting_ack'}`) que a UI usa pra mostrar "ainda aguardando...". **10s total** → responde HTTP 504 final (`{status:'timeout'}`). Se ack chega no meio, responde HTTP 200 com o payload do ack (executed/confirmation_required/decision_required/refused).
5. Device offline (sem retained=true + `devices/<serial>/status` != online recente): responde HTTP 503 **sem** publicar.

### 4.4 Alarm detector

No `fnHandleData`, comparar `alarmes[]` do payload com `irrigation_alarms WHERE resolved_at IS NULL`:
- Tipo presente no payload + sem row ativa → `INSERT INTO irrigation_alarms` (trigger event também).
- Tipo ausente do payload + row ativa → `UPDATE irrigation_alarms SET resolved_at=NOW() WHERE ...`.

Dedup é pelo par `(device_id, tipo, sensor_rom_id)` enquanto não resolvido.

---

## 5. Webapp — módulo `src/features/irrigacao/`

### 5.1 Estrutura de diretórios

```
src/features/irrigacao/
├── types.ts                              # todos tipos (IrrigationConfig, Sector, Timer, Alarm, Event, etc.)
├── api.ts                                # todas as funções HTTP
├── hooks/
│   ├── useConfig.ts                      # GET+PATCH
│   ├── useSetores.ts                     # GET+PATCH
│   ├── useTimers.ts                      # GET+POST+PATCH+DELETE+pause/resume/duplicate
│   ├── useSensores.ts
│   ├── useEventos.ts                     # infinite scroll
│   ├── useAlarmesAtivos.ts               # polling 10s
│   ├── useComando.ts                     # wrapper com timeout progressive
│   ├── useDeviceSnapshot.ts              # MQTT live (stub no começo; vira source ao ter ficha específica)
│   └── useIrrigationLive.ts              # reconstroi estado da UI a partir do data/events em tempo real
├── components/
│   ├── BombaSvgAnimada.tsx
│   ├── SetorCardValvula.tsx              # SVG valve + fluxo
│   ├── TemperaturaCard.tsx
│   ├── AlarmeFullscreenBloqueante.tsx    # modal do temperature_high
│   ├── TimerFormModal.tsx                # 3 tipos em um wizard
│   ├── OverlapDetectadoModal.tsx
│   ├── ComandoButton.tsx                 # encapsula spinner 5s + timeout 10s
│   ├── ModoAutoManualToggle.tsx
│   ├── ConfirmacaoDoubleOp.tsx           # pra ações perigosas
│   └── IndicadoresStatusBar.tsx          # 5 badges do topo
├── pages/
│   ├── IrrigacaoDashboardPage.tsx        # tela principal
│   ├── IrrigacaoAutomacoesPage.tsx       # timers
│   ├── IrrigacaoTecnicoPage.tsx          # instalador (subtabs)
│   ├── IrrigacaoHistoricoPage.tsx
│   └── IrrigacaoAlarmesPage.tsx
└── utils/
    ├── timerOverlap.ts                   # algoritmo de sobreposição (client mirror do backend)
    ├── formatters.ts                     # "XX:XX" countdowns, cores por temp, etc.
    └── iconsSvg.tsx                      # svg paths reusados (válvula aberta/fechada, etc.)
```

### 5.2 Detecção de modelo na ficha

`DispositivoDetailPage` vira **dispatcher**: lê `dispositivo.modelo` (já vem no JSON); se começa com `IRR-V1`, renderiza `<IrrigacaoDashboardPage>`; caso contrário, mantém a ficha genérica atual. Rotas não mudam: mesmo `/dispositivos/:id` serve o conteúdo certo.

### 5.3 Animações-chave

- **SVG da bomba**: ring externo `@keyframes spin 2s linear infinite` via CSS — único elemento rotaciona. `<text>` do contador é irmão, não filho, do ring.
- **Válvula**: dois `<path>` (aberto/fechado) com `d` interpolado via `transform: scaleY()` ou troca direta + `transition`.
- **Fluxo de água**: `<rect>` com `@keyframes flow translate` + `<mask>` com wave path + opacidade animada. Ativo só quando bomba ligada E setor aberto.
- **Badges pulsantes "ao vivo"**: `box-shadow` animado sutil + pulse opacity 1→0.8→1.

### 5.4 Alarme fullscreen bloqueante

Componente `<AlarmeFullscreenBloqueante>` montado em root (acima do Dialog) quando `useAlarmesAtivos` retorna `tipo='temperature_high'` com `acked_at=null`. Z-index maior que AppShell. Captura focus. Não pode ser fechado por ESC nem click-outside enquanto não: (a) user clicar "Confirmar ciência", (b) `ultima_leitura_c < threshold_c - hysteresis_c`. Mostra temp ao vivo da `useDeviceSnapshot`.

### 5.5 Responsivo mobile-first

Todos os cards em grid 1-col em `<sm`, 2-col `sm`, 3-col `md`. Drawer lateral pra demais telas (já padrão do AppShell pós-E3.4). Timer form full-screen `<sm`.

---

## 6. Fases de implementação

Cada fase = 1 PR (ou conjunto coeso de commits) + review + merge. Ordem otimizada pra desbloquear o usuário em validação visual o mais cedo possível.

### Fase 1 — Schema + API read-only + ficha com dados mockados (~2-3 dias)

- Migrations 011, 012, 013
- Procedure `provision_irr_v1_defaults`
- Endpoints GET apenas (`/config`, `/setores`, `/sensores-temperatura`, `/alarmes/ativos`)
- `IrrigacaoDashboardPage` renderiza dados estáticos vindos do GET (sem MQTT live, sem comandos). Bomba/setores mostram estado "desligado". Útil pra o usuário confirmar design visual.
- Provisioning hook acionado: criar um IRR-V1 novo já chega com defaults.

**Deploy + push.** User valida layout sem risco de quebrar nada operacional.

### Fase 2 — Comandos + ack síncrono + animações (~2-3 dias)

- Node-RED: command router (wrapper HTTP sync com timeout progressive 5s/10s)
- Endpoint `POST /comando`
- `<ComandoButton>` com os 4 estados (idle, aguardando ack 5s, timeout aviso, refused/executed/confirmation/decision)
- Animações da bomba + válvula + fluxo
- `set_mode`, `pump_on`, `pump_off`, `sector_open/close/pause/resume`, `ack_alarm`

### Fase 3 — Timers + detecção de sobreposição (~2-3 dias)

- Endpoints POST/PATCH/DELETE `/timers` + pause/resume/duplicate
- Trigger PG `enforce_limit_10_per_target`
- `utils/timerOverlap.ts` (backend + client mirror)
- `TimerFormModal` wizard 3 tipos + `OverlapDetectadoModal`
- `IrrigacaoAutomacoesPage`

### Fase 4 — Sensores de temperatura + alarmes (~2-3 dias)

- Endpoints `/sensores-temperatura/*`
- Trigger PG `enforce_limit_4_sensors_per_device`
- `scan_temperature_sensors` (async via event)
- Alarm detector no `fnHandleData`
- `AlarmeFullscreenBloqueante` + tela de alarmes

### Fase 5 — Histórico + polish mobile + i18n scaffolding (~1-2 dias)

- Endpoint `/eventos` paginado
- `IrrigacaoHistoricoPage`
- `dump_local_history` async
- Scaffolding i18n (`src/i18n/pt-BR.json`, hook `useT()`) — strings hoje, tradução amanhã
- Auditoria responsive 375/768/1440 do módulo inteiro

**Total:** ~10-14 dias de VPS pra MVP completo, com 5 entregas incrementais push-frequentes pra minimizar risco.

---

## 7. Riscos e decisões que precisam de confirmação antes de codar

### R1 — Setor 1 habilitado por default?

Prompt diz "todos desabilitados **exceto talvez** o primeiro". **Preciso decisão binária**. Recomendo: **todos desabilitados**. Justificativa: evita comportamento surpresa em produção; user explicitamente habilita o que vai usar. Alternativa: habilitar setor 1 facilita o smoke test inicial.

### R2 — Algoritmo de detecção de sobreposição

Não-trivial no cruzamento de `fixed` × `cyclic_window` × `cyclic_continuous` quando o alvo é o mesmo. Precisa alinhar semântica:

- Dois timers do mesmo alvo que se sobrepõem temporalmente → conflito? Ou só se ambos tentam **ligar** simultâneamente (pump ou abrir sector)?
- `cyclic_continuous` vs qualquer outro: o contínuo sempre sobrepõe porque é 24/7 — conflito automático ou exceção?

**Recomendo:** documentar algoritmo num doc separado antes da Fase 3 e validar com user.

### R3 — Protocolo versioning — o que fazer em mismatch?

Firmware `protocol_version:2` reportando num backend que só fala v1: **aceitar ignorando campos novos** ou **recusar e sinalizar "firmware adiante do server"**? Recomendo primeiro caminho (graceful).

### R4 — Comandos retidos expiram?

`apply_config` com QoS 1 retained fica no broker. Se o device recebe 3 dias depois, o `expires_at` dentro do payload já passou. Firmware decide descartar ou aplicar? Contrato MQTT precisa fixar: **firmware descarta se `now > expires_at`** e publica `event` de `command_expired`.

### R5 — Dedup de events: janela temporal?

`ON CONFLICT event_uuid DO NOTHING` funciona pra eventos do mesmo UUID. Mas e se o firmware gerar UUIDs idênticos por bug (RNG ruim no boot)? Mitigar com `UNIQUE(device_id, event_uuid)` (compound) e log sentinel quando bate. OK pra MVP.

### R6 — Reforço de relé remapeia Setor 1 pro próximo relé livre — onde guardar esse mapping?

Vai na `irrigation_sectors.gpio_rele` (se muda o GPIO do setor 1 quando reforço ativa). UI precisa recalcular na hora de mudar o toggle + persistir. Firmware NÃO confia no GPIO vindo da config (autoridade é do firmware): ele próprio decide o GPIO conforme flag `reforco_rele`. Backend só exibe/guarda pra debug.

### R7 — Factory reset do device deve apagar as rows de Postgres?

Prompt menciona botão físico 10s → reset local do firmware. Pergunta: o device deve publicar `event: factory_reset`, e o server **mantém** as rows históricas (sectors, timers, sensores, events, alarms) ou **apaga**? Recomendo **manter** — user pode ter motivos pra resetar o firmware sem perder histórico server-side. Row `devices` mantém; provisionamento defaults podem ser re-aplicados via botão admin "Re-provisionar" (fora do MVP).

### R8 — Migration destrutiva ou não-destrutiva?

011 é puramente **ADD TABLE** — não-destrutiva, não precisa TRUNCATE. Nenhum risco pra produção atual (nenhum device IRR-V1 ainda). Confirmar: OK aplicar direto em prod com o mesmo padrão dos outros migrations.

### R9 — Documento de requisitos 1300 linhas

Sinalização do user: se eu precisar de trecho específico (ex: lista completa dos 30+ tipos de eventos, detalhes de UX de um pop-up, layout exato de um modal), o user cola aqui. Pontos já identificados onde vou precisar:

- Lista canônica dos 30+ tipos de `irrigation_events.tipo` pra CHECK constraint/enum (§ref desconhecida do doc).
- Valores default EXATOS de cada campo de `irrigation_configs` (atraso_*, tempo_max_*, etc.) pra a procedure.
- Especificação UX das animações SVG da bomba e válvula (frame-rate, cores exatas).
- Texto literal de tooltips na tela técnica.
- Layout do modal fullscreen de alarme.
- Espec do wizard de timer (campos que aparecem conforme tipo).
- Detalhes do algoritmo de overlap (§R2).

---

## 8. Anexo — assinaturas REST completas

(Preenchido na Fase 1 quando a API for codada. Por ora, a tabela da seção 3 é autoritativa pro contrato.)

---

## 9. Dependências e entregáveis imediatos

**Pra começar Fase 1:**
- Decisão sobre R1 (setor 1 default).
- Decisão sobre R8 (aplicar migration em prod ou staging).
- Acesso ao doc de 1300 linhas pros defaults do `irrigation_configs` (§R9 item 2) e lista de tipos de evento (§R9 item 1).

Sem esses 3 itens, posso começar a 011 com defaults placeholder e ajustar depois, mas prefiro não. Aguardo confirmação antes de codar Fase 1.
