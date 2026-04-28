# XT Connect Hub — Visão Geral do Projeto

> **Data:** 2026-04-28
> **Versão:** consolidação após sessão Fase 1+2 (50+ commits em `lovable-port`)

---

## 1. O que é

Plataforma IoT em nuvem (`hub.xtconect.online`) pra gerenciar equipamentos
agrícolas, residenciais e industriais conectados — começando pela linha
**XT Conect** de irrigação, com expansão prevista pra geradores,
chocadeiras, bombas de poço, off-grid e outros.

**Modelo de negócio**:
- Hardware vendido com QR Code pra associação (claim) na conta do cliente.
- App web (PWA-ready) acessível em qualquer navegador moderno.
- Notificações por e-mail (WhatsApp planejado).
- Conta admin gerencia o catálogo de produtos, gera códigos de
  pareamento, regenera senhas MQTT.

---

## 2. Quem usa

### 2.1 Administrador (você, futuros funcionários)
- Cadastra modelos de equipamento (`IRR-V1`, futuros `GER-V1` etc.).
- Provisiona produtos novos: gera serial, senha MQTT, código de
  pareamento, etiqueta com QR Code.
- Vê todos os clientes e dispositivos.
- Pode resetar produto pra estado de fábrica (admin only).

### 2.2 Cliente final
- Cadastra-se com e-mail (verificação obrigatória).
- Adiciona equipamento escaneando QR Code ou digitando código.
- Acessa dashboard com painel completo do equipamento.
- Compartilha dispositivo com outras contas (modo "leitura" ou "controle").
- Cria automações (regras se-então: "se alarme, manda email pro técnico").
- Recebe alertas por e-mail.

### 2.3 Compartilhado (família, técnico, instalador)
- Recebe convite por e-mail.
- Aceita pelo app.
- Vê e/ou comanda os dispositivos do dono que liberou acesso.

---

## 3. O que o sistema faz hoje

### 3.1 Backend (servidor em produção)
- **Banco PostgreSQL** com schema de IoT genérico + tabelas específicas
  por modelo (irrigation_*, automation_rules, notification_outbox, etc.).
- **InfluxDB** pra séries temporais de telemetria (90 dias).
- **Mosquitto MQTT** com TLS, ACL por dispositivo via plugin dynsec.
- **Node-RED** orquestra: ingestão de telemetria, lifecycle de alarmes,
  motor de automação, CRUD de timers/setores/sensores, dispatcher de
  e-mail, sweeper de tokens MQTT, retenção de dados.
- **Nginx** com gzip, cache de assets, HTTPS Let's Encrypt, basic auth no
  editor Node-RED.

### 3.2 Frontend (PWA web)
- Login + signup com verificação de e-mail
- Dashboard de dispositivos com filtro online/offline
- **Painel completo do IRR-V1** com 7 abas:
  - **Painel** — bomba (status pulsante), setores (animação de água),
    sensores de temperatura (gauge analógico + digital)
  - **Timers** — CRUD com 3 tipos: fixo, cíclico em janela, cíclico contínuo
  - **Setores** — config detalhada de cada um dos 8 setores
  - **Sensores** — CRUD de sensores DS18B20 (até 4 por equipamento)
  - **Bomba** — config completa de bomba (atrasos, tempos máx, tipo)
  - **Histórico** — eventos com filtro por categoria
  - **Sistema** — config hardware, factory reset
  - **Logs** — últimos 100 eventos crus
- **Automações** — CRUD de regras (trigger + ações)
- **Compartilhamentos** — convidar/aceitar/revogar
- **Tema claro/escuro** com cor primária verde XT (`hsl(156 72% 40%)`)

### 3.3 Rotinas automáticas
- **Backup do banco** todo dia 03:00 (7 daily + 30 weekly + 365 monthly)
- **Aviso de offline** — checa a cada 5 min, alerta por e-mail se device
  offline > 30 min (formato amigável "5 dias 22:56H")
- **Worker de e-mails** — fila SMTP, retry x5, dedup por evento
- **Retenção** — purga diária de telemetria e eventos antigos
- **Sweeper de tokens MQTT** — a cada 5 min, deleta tokens expirados
- **Sweeper de devices offline** — marca offline devices sem heartbeat há > 3x
  do intervalo de telemetria (60s a 15min)

---

## 4. Animações e elementos visuais

### 4.1 Web (já implementado)

| Elemento | Animação |
|---|---|
| **Bomba ligada** | Anel ao redor pulsando verde, ícone girando lento |
| **Bomba parada** | Anel vermelho estático, ícone com X |
| **Setor aberto** | Card com gradiente azul + animação `animate-sector-flow` (água escorrendo) |
| **Setor fechando** | Transição suave azul → cinza |
| **Modo automático** | Engrenagem girando 6s linear infinito |
| **Gauge de temperatura** | Agulha SVG animada, cor de fundo muda por zona (verde/amarelo/vermelho) |
| **Conexão MQTT** | Badge "Online" verde / "Aguardando" cinza |
| **Alarme ativo** | Card vermelho destacado, ícone alerta, badge "ALARME" pulsante |
| **Carregamento de página** | Skeleton placeholders com pulse |
| **Mudança de tab** | Transição fade |
| **Toast de notificação** | Slide-in da borda direita |

### 4.2 Hardware (proposta — a implementar no firmware)

LED RGB ou múltiplos LEDs de status no equipamento:

| Estado | LED indicador |
|---|---|
| Boot | LED branco fixo 2s |
| Wi-Fi conectando | LED azul piscando 1Hz |
| Wi-Fi conectado, MQTT conectando | LED ciano piscando |
| Online OK | LED verde fixo (suave, baixo brilho) |
| Modo AP (configuração) | LED roxo piscando 0.5Hz |
| Bomba ligada | LED secundário verde fixo |
| Alarme ativo | LED vermelho pulsando rápido (até ACK) |
| Erro hardware | LED vermelho fixo |
| Atualizando firmware | LED amarelo piscando rápido |

Display OLED/TFT (opcional, futuro):
- Tela inicial com IP + status
- Animação de bomba ON/OFF (ondas)
- Em alarme: full screen vermelho com mensagem
- Botão físico → menu de configuração local

---

## 5. Wi-Fi (firmware)

### 5.1 Modo dual AP + STA simultâneo

ESP32 suporta nativo (`WIFI_MODE_APSTA`). Configuração:

**Modo AP** (sempre ativo, salvo na flash):
- SSID: `XT-<serial>` (ex.: `XT-IRR-V1-00007`)
- Senha: o `pairing_code` do device (ex.: `H7K3M9`) — está na etiqueta
- IP: `192.168.4.1` (default ESP32)
- Portal de configuração na raiz: `http://192.168.4.1/`
- DNS captive portal: redireciona qualquer domínio pro portal (cliente
  abre o navegador e cai automaticamente)

**Modo STA** (se config Wi-Fi presente na NVS):
- Conecta na rede do cliente em paralelo.
- Internet flui pela STA quando conectada.
- AP continua ligado pra reconfiguração futura sem precisar resetar.

### 5.2 Wi-Fi scan + portal

Portal de configuração (servido pelo próprio ESP32):

1. **Tela inicial**: status atual ("Wi-Fi: desconectado", "Internet: NÃO").
2. **Botão "Buscar redes"** → ESP faz `esp_wifi_scan_start()` ativo.
3. **Lista** de redes encontradas, com:
   - Nome (SSID)
   - Sinal (barras de RSSI: ▂▄▆█)
   - Cadeado se tem senha (rede aberta = sem cadeado)
   - Canal (informativo)
4. **Selecionar rede** → form de senha:
   - Campo senha mascarado
   - **Toggle "👁 mostrar senha"** (mostra/oculta texto)
   - Se rede aberta: form sem campo de senha (texto: "Esta rede não exige senha")
   - Botão "Conectar"
5. **Tentativa de conexão**:
   - Tela "Conectando..." com spinner
   - Em sucesso: salva NVS (`wifi_ssid`, `wifi_pass`), mostra IP recebido
   - Em falha: mensagem clara ("Senha incorreta" / "Sinal fraco" / "Roteador
     não respondeu") + botão voltar pra tentar de novo
6. **Após conectar com internet**: ESP testa MQTT. Se OK, exibe checkmark
   verde "Online no XT Connect Hub".

### 5.3 Cenários

| Cenário | Comportamento |
|---|---|
| Primeira vez ligando | AP ativo, STA off (não tem credenciais), portal aberto |
| Wi-Fi configurado, rede on-line | AP ainda ativo, STA conectado, MQTT conectado |
| Wi-Fi caiu temporariamente | STA tentando reconectar com backoff. AP continua. MQTT em retry. |
| Trocou de rede | Cliente conecta no AP, escolhe outra rede, configurou. Reconecta. |
| Reset de fábrica | Apaga `wifi_ssid`/`wifi_pass`/`mqtt_pass`. Volta ao estado primeira vez. |

### 5.4 Segurança do AP
- Senha do AP = `pairing_code` (8 caracteres alfanuméricos sem 0/O/1/I/L).
- Após primeiro Wi-Fi configurado, AP fica em **modo silencioso** —
  permanece ativo mas oculto (`hidden = true`) e o user precisa digitar
  o nome manualmente pra acessar. Reduz poluição de rede.
- Reset de fábrica volta o AP visível.

---

## 6. Hardware IRR-V1 — Pinout

> ⚠️ **Pinout proposto pelo dono em 2026-04-28.** Algumas atribuições estão
> marcadas como **TBD** — preciso de confirmação. Os defaults da migration
> 011 no banco usam outros pinos (16, 17, 18, 19, 21, 22, 23, 25 pros 8
> setores). Quando confirmar, atualizo aqui e atualizo o seed do banco.

### 6.1 Microcontrolador
- ESP32 ou ESP32-S3, 4 MB+ flash.

### 6.2 Pinout (confirmado 2026-04-28)

| Função | GPIO | Lado da placa | Notas |
|---|---|---|---|
| **Bomba (relé)** | 13 | A | active-high default |
| **Setor 1 (relé)** | 12 | A | |
| **Setor 2 (relé)** | 14 | A | |
| **Setor 3 (relé)** | 27 | A | |
| **Setor 4 (relé)** | 26 | A | |
| **Setor 5 (relé)** | 25 | A | |
| **Setor 6 (relé)** | 33 | A | |
| **Setor 7 (relé)** | 32 | A | último output-capable do lado A |
| **Setor 8 (relé)** | 23 | B | lado A esgotou em 7 outputs no ESP32 DevKit |
| **DS18B20 (1-Wire)** | 15 | A | até 4 sensores no barramento |
| **DS3231 SDA** | 21 | — | I2C default ESP32 |
| **DS3231 SCL** | 22 | — | I2C default ESP32 |
| **Botão Bomba** | 4 | B | input pull-up, debounce 50ms |
| **Botão Setor 1** | 16 | B | input pull-up |
| **Botão Setor 2** | 17 | B | input pull-up |
| Botões setores 3-8 | — | — | não implementados nesta versão |
| **LED status** | 2 | — | built-in da maioria dos boards ESP32 DevKit |

**Aplicado em**:
- ✅ `provision_irr_v1_defaults()` (migration `022_irr_v1_pinout_v2.sql`)
- ✅ `DEFAULT_DEVICE_CONFIG` no simulator (`public/simulator-irr-v1.html`)

**Observação importante**: o **ESP é fonte de verdade do pinout** — quando
o firmware iniciar, ele publica `config/current` retained com seus pinos
reais e o servidor faz UPSERT. Os defaults da migration servem só pra
provisionamento inicial e pro simulador. Se o ESP usar pinos diferentes
em revisões futuras de placa, basta o firmware republicar `config/current`.

### 6.3 Considerações de hardware

- **Relés**: padrão `nivel_ativo_rele = "high"` (configurável por setor pra
  high/low). Considerar relé com optoisolador.
- **Bomba**: `nivel_ativo_bomba` configurável (alguns relés de bomba são
  active-low). Configurar `tipo_bomba = monofasica | inverter`.
- **Reforço de relé**: opção `reforco_rele_ativo` — se `true`, mantém o
  relé energizado periodicamente pra evitar travamento (útil em irrigação).
- **DS3231 (RTC)**: backup de tempo em caso de NTP indisponível.
  Bateria CR2032. Sincroniza com NTP quando online; usa o RTC quando offline.
  GPIO 21 (SDA) e 22 (SCL) são os I2C default do ESP32 — OK.
- **DS18B20 (1-Wire)**: até 4 sensores no mesmo barramento. ROM ID
  identifica cada um. GPIO configurável via `gpio_1wire` (default 15).
- **Botões físicos**: tipo configurável por setor (`pulso_alterna`,
  `pulso_liga`, `pulso_desliga`, `retentivo`). Debounce em ms configurável.

### 6.4 Setores 4-8 sem botão físico

Hoje o protótipo só tem botão físico pra bomba + setor 1 + setor 2.
**Não é problema arquitetural**: cada setor no banco já tem
`tipo_botao_fisico` e `gpio_botao` opcionais (`NULL` quando não tem
botão físico). UI mostra config sem fricção.

Quando setores 4-8 ganharem botão, basta atualizar a config dos setores
no app.

---

## 7. Bibliotecas/recursos do firmware

### 7.1 Wi-Fi & Networking
- `esp_wifi` (modo APSTA)
- `esp_netif`, `esp_event`
- `mdns` opcional (descoberta `xt-irr-v1.local`)
- `esp_http_server` (portal de configuração)
- DNS hijack pra captive portal: usar `dns_server` simples

### 7.2 MQTT & TLS
- `esp-mqtt` (oficial Espressif)
- `mbedtls` (já vem no ESP-IDF)
- Cert raiz Let's Encrypt embutido no firmware (ou validation against
  global CA store)

### 7.3 Tempo
- `esp_sntp` (com servidores `pool.ntp.org` ou `a.st1.ntp.br`)
- DS3231 via `i2c_master` (lib pronta no ESP-IDF) — fallback

### 7.4 Sensores
- `onewire_bus` + `ds18b20` (componentes do ESP-IDF)
- ROM scan no boot pra catalogar sensores conectados

### 7.5 Persistência
- `nvs_flash` pra config + estado de alarme
- Opcional: `spiffs` ou `littlefs` pra buffer offline de eventos (até 100)

### 7.6 JSON
- `cJSON` (vem com ESP-IDF) ou `ArduinoJson` v7

---

## 8. Próximos modelos previstos

Baseado no schema multi-modelo (Plano C concluído):

- **GER-V1**: gerador a diesel monitorado (eventos: gerador_partiu,
  gerador_parou, falha_combustivel, rede_caiu, rede_voltou)
- **INC-V1**: chocadeira (temp, umidade, viragem de ovos)
- **BMB-V1**: bomba de poço (vazão, pressão, runtime)
- **CTN-V1**: container/galpão (temp, umidade, porta aberta)
- **OFG-V1**: off-grid (carga das baterias, painel solar, consumo)

Cada um vai precisar de:
1. Migration ou seed de event_types/alarm_types no banco
2. Função `provision_<prefixo>_<version>_defaults()` no Postgres
3. Tabelas de config específicas (ex.: `generator_configs`)
4. Handlers no Node-RED (similar aos `_e041`/`_e042` etc. do IRR-V1)
5. Tela de detalhe no frontend (similar à `IrrigacaoDashboardPage`)
6. Firmware seguindo o protocolo (PROTOCOLO-IOT.md)

Doc específica em `infra/docs/adicionar-novo-modelo.md`.

---

## 9. Como evoluir esta visão

Quando algo mudar, atualize **uma das três seções**:

| Seção | Quando atualizar |
|---|---|
| §3 (o que faz hoje) | Adicionou feature nova ou removeu algo |
| §6 (pinout) | Confirmou/mudou um pino |
| §8 (próximos modelos) | Começou a implementar um modelo novo |

Documentos relacionados:
- [`PROTOCOLO-IOT.md`](./PROTOCOLO-IOT.md) — protocolo MQTT detalhado
- [`FIRMWARE-QUICKSTART.md`](./FIRMWARE-QUICKSTART.md) — quickstart pra IA gerar firmware
- [`adicionar-novo-modelo.md`](./adicionar-novo-modelo.md) — passo-a-passo de novo modelo
- [`STATUS-2026-04-28.md`](./STATUS-2026-04-28.md) — snapshot do estado atual
- [`debts.md`](./debts.md) — débitos técnicos catalogados
- [`deploy.md`](./deploy.md) — como rodar deploy
- [`restore.md`](./restore.md) — como restaurar backup

---

**Fim do documento. Mantenha versionado no git pra histórico.**
