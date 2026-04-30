# Prompt — próximo ciclo do firmware IRR-V1 (pós-teste 2026-04-30)

> Cole isto no Claude do projeto do firmware ESP. É auto-contido: contexto + o que foi validado + o que precisa mudar + onde encontrar a spec.

---

## Contexto

Estou desenvolvendo o firmware do dispositivo **IRR-V1** (controlador de irrigação ESP32, 8 setores + bomba + sensores DS18B20) que conversa com a plataforma **XT Connect Hub** via MQTT/TLS.

- Servidor: `mqtts://hub.xtconect.online:8883` (Mosquitto + Node-RED + Postgres + Influx, em Docker, em produção).
- UI web: `https://hub.xtconect.online` (React/Vite, branch `lovable-port`).
- Spec do protocolo: `infra/docs/PROTOCOLO-IOT.md` (referência completa).
- Quickstart pra IA: `infra/docs/FIRMWARE-QUICKSTART.md` (resumo + bugs encontrados em campo).

O firmware é a **autoridade absoluta** sobre estado físico, hora local e safety. Servidor reflete e roteia; não decide nada físico.

## Estado atual (2026-04-30)

**Primeiro teste de campo deu certo.** Dispositivo provisionado: `IRR-V1-00008`. Subiu ao broker de produção de primeira; UI descobriu os 8 setores; comandos remotos e locais funcionaram; telemetria a 2s estável; ACK + state retain consistentes. Detalhes do teste em `docs/specs/IRR-V1-00008-test-2026-04-30.md`.

**Comandos validados em campo:** `sector_open`, `sector_close`, `pump_on`, `pump_off`, `mode_set`, `set_rate`. Todos com `cmd_id` + ACK `executed/ok`. Botão local da placa também funciona com `source=manual_local`.

**Proteção bomba seca:** hoje é a UI que bloqueia (`pump_on_without_sector` → modal sem PUB). O firmware ainda não implementa o caminho `requires_confirmation` da spec §6.2.

## Bugs a corrigir neste ciclo

São quatro, todos do log capturado durante o teste do `IRR-V1-00008`:

### B1. `[NaN:NaN]` no prefixo dos logs antes de SNTP fechar

Toda linha do log (página `/log` da AP) sai com `[NaN:NaN]`. Provavelmente o formatador chama `localtime(time(NULL))` quando `time(NULL)` ainda é 0/inválido.

**Fix:** se `time_valid()` (sntp sincronizado) for falso, render `[--:--]` no prefixo. Manter o segundo campo (`mm:ss.ms` de uptime) — esse já está certo. Nenhum PUB de evento/telemetria com `ts` ISO deve sair antes de NTP fechar (já é regra da spec, reforcar).

### B2. `source=` vazio em desligamentos disparados por cascata

Eventos primários (botão local ou MQTT) saem com `source=manual_local` ou `source=manual_remote`. Mas eventos secundários (cascata) saem vazios:

```
01:35.7 I SETOR 3 OFF source=             ← falta manual_local (cascata de desligar bomba?)
02:10.3 I BOMBA OFF source=               ← falta manual_local
02:11.0 I SETOR 1 OFF source=             ← idem
```

**Fix:** propagar a `source` original pelas chamadas internas. Mesmo quando a função de safety/cascata fecha um setor, a `source` semântica continua sendo `manual_local`/`manual_remote`/`auto_timer`/`safety_alarm` (qual gatilho originou a cadeia).

Sugestão de implementação: passar `source_t source` como parâmetro de `pump_off()`, `sector_close()` etc., default `internal` (ou enum `SAFETY` em casos de safety hard).

### B3. Linhas duplicadas/triplicadas na renderização da página `/log`

Trecho do final do log mostra a mesma entry repetida 2-3×:

```
02:54.2 I TELEM PUB ... -> OK
02:56.2 I TELEM PUB ... -> OK
02:54.2 I TELEM PUB ... -> OK   ← repete
02:56.2 I TELEM PUB ... -> OK   ← repete
02:54.2 I TELEM PUB ... -> OK   ← terceira
```

**Fix:** snapshot atômico do ring buffer (mutex/critical section ou copiar pra buffer linear) antes de renderizar o HTML. Se já existe sequence number monotônico por entry, deduplica por seq na renderização.

### B4. Implementar `requires_confirmation` para `pump_on` sem setor (spec §6.2)

Hoje a UI bloqueia totalmente quando todos setores estão fechados. Mas a spec já prevê o fluxo:

1. UI envia `pump_on` (sem `force`).
2. Firmware vê que `count(setores_open) == 0` → responde:
   ```json
   {
     "cmd_id": "...",
     "ack_status": "requires_confirmation",
     "ack_code": "CONFIRMATION_NEEDED",
     "ack_message": "Nenhum setor aberto. Ligar bomba pode danificar.",
     "confirmation_action": "force"
   }
   ```
3. UI mostra "Ligar mesmo assim" e reenvia `pump_on {force: true}` com novo `cmd_id`.
4. Firmware aceita e liga, com proteção: se nada abrir em N segundos, dispara `pump_off_safety` com motivo `dry_run_protection`.

**Implementar no firmware:**
- Em `handle_pump_on(cmd_id, force)`: se `!force && setores_abertos == 0`, publicar ACK `requires_confirmation` e retornar. Não ligar bomba.
- Se `force == true`: ligar normalmente, mas armar timer curto (ex.: configurável, default 30s) que desliga + `pump_off_safety` se nenhum setor abrir nesse intervalo.

## O que NÃO mudar

- Topologia MQTT, retain, QoS, formato JSON dos payloads — está validado em campo.
- Idempotência por `cmd_id` (cache RAM dos últimos 100) — está funcionando.
- State retain a cada transição — está funcionando.
- Set rate / mode set / sector open/close — todos validados, não mexer.

## Como testar

1. **Não desinstalar** o `IRR-V1-00008` — é o que está provisionado e funcional. Pode reflashar a mesma placa.
2. Para B1 (NTP), basta abrir a página `/log` e olhar o prefixo das linhas após o boot. Antes de SNTP fechar deve mostrar `[--:--]`. Depois, hora local válida.
3. Para B2 (source), abrir setor 1, ligar bomba (`source=manual_remote`), depois mandar `pump_off` — o `sector_closed` resultante (se aplicável pelo safety) deve sair com `source=manual_remote`, não vazio.
4. Para B3 (dedup), gerar tráfego pesado (deixar telem rodando 30 min, fazer wraparound do buffer), abrir `/log` várias vezes — não pode haver linhas duplicadas no output.
5. Para B4 (force), com todos setores fechados:
   - `mosquitto_pub` (ou via UI futura) `devices/IRR-V1-00008/commands` com `cmd: "pump_on"` sem `force` → esperar ACK `requires_confirmation`.
   - Mesmo cmd com `params.force = true` → bomba liga, e se nenhum setor abrir em ~30s, sai `pump_off_safety/dry_run_protection`.

## Entregáveis esperados

- Diff do firmware com os 4 fixes acima.
- Página `/log` arrumada, sem `NaN` antes de NTP, sem duplicatas após.
- Log de teste comparável ao da sessão anterior (same format), confirmando os 4 fixes.

## Referência rápida

- Credenciais MQTT do `IRR-V1-00008` estão na NVS da placa que está aqui — não regerar.
- Tópicos: `devices/IRR-V1-00008/{status,data,state,events,telemetry/sensors,commands,commands/ack,config/push,config/current}`.
- Pra detalhes de cada cmd / formato de evento / lifecycle de alarme → `infra/docs/PROTOCOLO-IOT.md`.

Boa.
