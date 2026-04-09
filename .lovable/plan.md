

## Plano: Modelo Completo de Irrigacao Solar XT Automatize

### Contexto

A documentacao PDF descreve uma automacao de irrigacao com ESP32 que usa MQTT com comandos complexos: controle de bomba, 4 setores, timers CRUD, modos manual/automatico, logs e configuracoes. O sistema atual de dashboard generico (componentes simples como switch, sensor, botao) nao suporta essa complexidade. Precisamos de uma interface dedicada para irrigacao.

### Abordagem

Criar um **dashboard especializado de irrigacao** que substitui o `DynamicDashboard` generico quando o modelo do dispositivo for "XT Automatize Irrigacao". Este dashboard tera abas dedicadas com toda a logica de comandos MQTT com `request_id`, gerenciamento de timers, configuracoes e logs conforme o PDF.

---

### Etapa 1 - Criar modelo de dispositivo no banco

Inserir na tabela `device_models`:
- Nome: **XT Automatize Irrigacao**
- Fabricante: **XT Devices**
- Descricao: Automacao de irrigacao solar com controle de bomba, setores, timers e monitoramento remoto
- Protocolos: MQTT
- Retencion de historico: 168h (7 dias)

Tambem inserir dashboard components basicos mapeados ao snapshot do ESP (mode, pump_on, sector_1_on...sector_4_on, wifi_connected, mqtt_connected, time_valid, etc.) para que o historico funcione via o sistema existente.

### Etapa 2 - Componente IrrigationDashboard

Criar `src/components/dashboard/IrrigationDashboard.tsx` - dashboard completo com abas:

**Aba Painel (principal):**
- Card de status: modo (manual/automatico), bomba (ligada/desligada), WiFi, MQTT, hora do dispositivo
- Card de setores: estado de cada setor habilitado com nome amigavel, botoes para abrir/fechar no modo manual
- Card de proximo evento: proximo timer programado
- Indicadores visuais: bomba verde/vermelha, setores com cores, modo com badge

**Aba Timers:**
- Listagem de timers (via comando `list_schedules`)
- Formulario para criar timer: target_type (pump/sector), target_index, start_time, duration_min, days[]
- Editar timer existente (via `update_schedule`)
- Excluir timer (via `delete_schedule`)
- Ativar/desativar timer (via `set_schedule_enabled`)

**Aba Setores:**
- Toggle de setorizacao (via `set_sectorization`)
- Habilitar/desabilitar cada setor (via `set_sector_enabled`)
- Renomear setores (via `set_sector_name`)

**Aba Bomba:**
- Configuracao do modo de operacao (via `set_pump_config`)
- Opcoes relacionadas a bomba

**Aba Sistema:**
- Tempos de seguranca, intervalo de publicacao (via `set_system_config`)
- Ajuste de data/hora (via `set_datetime`)
- Configuracao de reles (via `set_relay_config`) - somente para perfil tecnico

**Aba Logs:**
- Visualizar logs (via `get_logs`)
- Botao copiar logs
- Botao atualizar logs
- Botao limpar logs (somente suporte/admin)

### Etapa 3 - Hook useIrrigationMQTT

Criar `src/hooks/useIrrigationMQTT.ts` que extende o `useMQTT` existente com:
- Geracao de `request_id` unico por comando
- Correlacao de respostas por `request_id` no topico `status`
- Subscribe automatico em `devices/{ID}/data` e `devices/{ID}/status`
- Timeout configuravel para comandos (mostrar erro amigavel)
- Estado de loading por comando
- Parse do snapshot de `data` para alimentar o painel
- Parse de respostas de `status` para confirmar acoes

### Etapa 4 - Integracao no DeviceDetail

Modificar `src/pages/devices/DeviceDetail.tsx` para:
- Detectar quando o modelo do dispositivo e "XT Automatize Irrigacao" (por nome ou por um campo especifico)
- Renderizar `IrrigationDashboard` em vez de `DynamicDashboard`
- Enviar `request_update`, `get_full_config` e `list_schedules` ao abrir a pagina
- Mostrar skeleton/loading enquanto aguarda primeiro lote de respostas

### Etapa 5 - Comportamento visual conforme PDF

- Botao ligar: **verde** quando a acao for ligar
- Botao desligar: **vermelho** quando a acao for desligar
- Bloquear botao durante comando em andamento (loading)
- Ao receber `ok=true`, atualizar estado imediatamente
- Ao receber erro, restaurar estado anterior + mensagem amigavel
- Dispositivo offline: mostrar ultima informacao com selo "desatualizado"
- Hora invalida: destaque no painel + bloquear operacoes automaticas

### Etapa 6 - Permissoes por perfil

- **Usuario final**: modo, bomba, setores, timers, nomes amigaveis
- **Suporte/instalador**: tudo acima + logs, relay config, manutencao
- **Admin**: tudo acima + configuracao MQTT remota

Usar o `tipo_usuario` do perfil (usuario_final, instalador) e `has_role(admin)` para controlar visibilidade das abas.

---

### Arquivos a criar

| Arquivo | Descricao |
|---------|-----------|
| `src/hooks/useIrrigationMQTT.ts` | Hook MQTT com request_id e correlacao de respostas |
| `src/components/irrigation/IrrigationDashboard.tsx` | Dashboard principal com abas |
| `src/components/irrigation/PanelTab.tsx` | Aba painel: status, bomba, setores, proximo evento |
| `src/components/irrigation/TimersTab.tsx` | Aba timers: CRUD de agendamentos |
| `src/components/irrigation/SectorsTab.tsx` | Aba setores: habilitar, renomear |
| `src/components/irrigation/PumpTab.tsx` | Aba bomba: configuracoes |
| `src/components/irrigation/SystemTab.tsx` | Aba sistema: tempos, data/hora, reles |
| `src/components/irrigation/LogsTab.tsx` | Aba logs: visualizar, copiar, limpar |

### Arquivos a modificar

| Arquivo | Mudanca |
|---------|---------|
| `src/pages/devices/DeviceDetail.tsx` | Detectar modelo irrigacao e renderizar IrrigationDashboard |

### Dados a inserir no banco

- 1 registro em `device_models` (XT Automatize Irrigacao)
- ~10 registros em `device_model_dashboards` mapeando componentes ao snapshot do ESP (para historico via sistema existente)

