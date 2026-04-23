# IRR-V1 — Decisões operacionais (R1–R9) + trechos canônicos

Referência rápida das decisões baked pra Fase 1 e trechos da spec oficial que o backend/webapp consomem diretamente. Fonte autoritativa: [`IRR-V1.md`](./IRR-V1.md) (quando colado).

## Pilar §16.1 (não-negociável)

Firmware é autoridade absoluta sobre regras de segurança, intertravamentos, horários, alarmes, fechamento seguro e timeouts. Backend e webapp nunca inventam regra nova. Server: armazena config, publica via MQTT, recebe estado/eventos, renderiza. Internet fora → fazenda continua irrigando corretamente.

---

## R1 — Defaults de provisionamento

- **Bomba: habilitada** (único componente on por default).
- **8 setores: todos `habilitado=false`**.
- User ativa os setores que usa na tela de configurações técnicas.
- Motivação: smoke-test seguro só da bomba antes de mexer em válvula.

## R1-bis — Nível ativo dos relés (ULN2003)

- Hardware: ULN2003 (Darlington array).
- ESP32 sai HIGH → ULN2003 puxa LOW → aciona bobina.
- Logo: `nivel_ativo_bomba='high'` e `nivel_ativo_rele='high'` pros 8 setores são o default correto.
- UI técnica permite trocar pra `'low'` (casos de SSR/transistor direto).

## R2 — Sobreposição de timers

- **Mesmo alvo** (setor_id ou "bomba") com janelas sobrepostas → **ERRO** (bloqueia salvar). Mensagem literal (§16.10):
  > "Conflito interno: Setor X tem dois horários sobrepostos entre HH:MM e HH:MM. Ajuste antes de salvar."
- **Alvos diferentes** com janelas sobrepostas → **WARNING** (pop-up). Mensagem literal (§16.10):
  > "Setor X e Setor Y possuem horários sobrepostos entre HH:MM e HH:MM. Confirme se a instalação suporta operar os dois ao mesmo tempo."
  > Botões: "Salvar mesmo assim / Editar horários / Cancelar".
  > Se confirmar: salva flag `overlap_confirmed=true` no timer.
- **`cyclic_continuous` vs qualquer outro no mesmo alvo** dentro da janela → ERRO (mutuamente exclusivo).
- Algoritmo: expandir cada timer em janelas `[inicio, inicio+duracao]` pra cada dia da semana marcado; cruzar pares; reportar interseções.

## R3 — Protocol version mismatch

- Server loga WARN e aceita payload parcial (graceful degradation). **Não rejeita.**
- Firmware descarta comando com `protocol_version` diferente e publica `commands/ack` com `status='refused'`, `reason='protocol_mismatch'`.

## R4 — `expires_at` dos comandos

- Node-RED inclui `expires_at = now() + 30s` em todo comando publicado.
- Firmware descarta silenciosamente comandos expirados ao receber (valida `expires_at` vs `now()` local). Publica `event: command_expired` opcional.

## R5 — Dedup de eventos

- PK composta `(device_id, event_uuid)` em `irrigation_events`.
- Inserts: `INSERT ... ON CONFLICT (device_id, event_uuid) DO NOTHING`.
- Firmware gera UUID v4 por evento e retenta até receber ack (via event no barramento de eventos MQTT).

## R6 — Reforço de relé

- Firmware é autoridade (§16.1).
- Quando `reforco_rele_ativo=true`: firmware automaticamente remapeia o relé do Setor 1 pra próxima saída livre.
- Firmware publica o mapeamento atual em `config/current` (retained); backend **apenas espelha** — nunca decide pinout.

## R7 — Factory reset

Apaga (no server):
- `irrigation_configs` (row do device)
- `irrigation_sectors` (8 rows)
- `irrigation_timers` (todas)
- `irrigation_temperature_sensors` (todas)
- `irrigation_alarms` ativos (`WHERE resolved_at IS NULL`)

**Mantém:**
- `irrigation_events` (histórico auditável, imutável)
- row em `devices` (preserva claim; permite reprovisionar sem perder ownership)

## R8 — Aplicar migrations

- Direto em produção após smoke local, mesmo padrão E2/E3.
- Cada arquivo roda em transação única (`BEGIN ... COMMIT`); falha em qualquer statement → rollback automático; E3 continua funcionando.

---

## R9 — Trechos canônicos

### Lista de `event_type` (CHECK constraint de `irrigation_events.event_type`)

31 valores:

```
pump_on_manual          pump_off_manual          pump_on_auto
pump_off_auto_end       pump_off_safety          sector_opened
sector_closed           safe_closure_started     safe_closure_completed
last_sector_closed_pump_on
confirmation_requested  confirmation_accepted    confirmation_cancelled
remote_cmd_received     remote_cmd_executed      remote_cmd_refused
wifi_connected          wifi_disconnected        mqtt_connected
mqtt_disconnected       time_synced              time_invalid
timer_created           timer_edited             timer_paused
timer_reactivated       timer_removed
temp_alarm_triggered    temp_alarm_ack_user      temp_sensor_lost
physical_button_pressed auto_shutoff_max_time
```

### Config defaults (§6.2, §7, §15) — `provision_irr_v1_defaults`

| Campo | Default |
|---|---|
| `tipo_bomba` | `'monofasica'` |
| `reforco_rele_ativo` | `false` |
| `atraso_abrir_valvula_antes_bomba_s` | `3` |
| `tempo_bomba_desligada_antes_fechar_valvula_s` | `2` |
| `atraso_religar_bomba_apos_fechamento_s` | `5` |
| `tempo_max_continuo_bomba_min` | `120` |
| `tempo_max_manual_local_min` | `60` |
| `tempo_max_manual_remoto_sem_internet_min` | `60` |
| `botao_fisico_tipo` | `'pulso_alterna'` |
| `botao_debounce_ms` | `50` |
| `botao_assume_manual` | `true` |
| `nivel_ativo_bomba` | `'high'` (ULN2003) |
| `modo_operacao` | `'manual'` (deploy seguro) |
| `gpio_1wire` | `15` |

### Overlap rules — §16.10

Ver R2 acima. Mensagens verbatim e fluxo de 3 botões.

### Animações obrigatórias — §4.2, §14

- **Bomba desligada:** anel externo estático vermelho/cinza, contador parado.
- **Bomba ligada:** anel externo animado em verde rotacionando. Contador central **NÃO** gira (só o anel).
- **Ligada manual:** contador mostra `Ligada há HH:MM:SS`.
- **Ligada por automação:** contador mostra `Desliga em HH:MM:SS`.
- **Válvula:** indicador verde ativo (aberta), cinza parado (fechada), transição animada (abrindo/fechando), amarelo/laranja (pausada).

### Tooltips técnicos — §7 (linhas 349–376), §8 (linhas 382–416)

Use prosa dos §7/§8 literal como `aria-label`/`title` dos campos do form técnico. Quando `IRR-V1.md` for preenchido, extrair texto por campo aqui pra reuso direto.

### Timer wizard — §9 (linhas 443–507)

5 passos:

1. **Alvo** — bomba ou setor (dropdown).
2. **Nome** — texto.
3. **Dias da semana** — bitmask 7-bit com atalhos: `todos`, `úteis (seg-sex)`, `fim de semana`, `manual`.
4. **Tipo** — `fixed` / `cyclic_window` / `cyclic_continuous`.
5. **Horário + duração** — campos mudam conforme tipo:
   - `fixed`: `hora_inicio`, `duracao_min`.
   - `cyclic_window`: `hora_inicio`, `hora_fim`, `on_minutes`, `off_minutes`.
   - `cyclic_continuous`: `on_minutes`, `off_minutes` (liga X min, desliga Y min, repete dentro da janela 24/7).

Mostrar "próxima execução" calculada client-side (mirror do algoritmo server).

### Alarme temperatura DS18B20 — locked

- Até 4 sensores/device (CHECK via trigger na `irrigation_temperature_sensors`).
- `role ∈ {'pump','inverter','custom'}` (com `nome_custom` quando `custom`).
- `limite_alarme_c` + `histerese_c` (default 5.0) + `ack_usuario_requerido=true`.
- Evento `temp_alarm_triggered` → modal fullscreen bloqueante no webapp.
- Liberação do modal: ack explícito do user **E** `ultima_leitura_c < limite_alarme_c - histerese_c`.
- `temp_sensor_lost`: modal fullscreen bloqueante (mesmo visual), **mas** dispositivo continua operando. Sensores são diagnóstico, não interlock.
