

## Plano: Corrigir Setores, Sincronização e Diálogos de Confirmação

### Problemas Raiz Identificados no Código do Dispositivo

1. **`normalizeFullConfig` não lê os campos corretos do dispositivo**
   - O dispositivo envia setores de config como `sectorsConfig` (não `sectors`)
   - O dispositivo envia `sectorizationEnabled` (camelCase) no config, mas o código procura `sectorization_enabled`
   - O response do `get_full_config` aninha dados em `data.config` e `data.runtime`, mas `normalizeFullConfig` procura diretamente em `data`
   - **Resultado**: fullConfig sempre fica com sectors vazio e sectorization_enabled = false

2. **ACK `state` não inclui setores individuais**
   - `fillMqttResponseBase` coloca no `state` apenas `sectorization_enabled`, `pump_on`, etc., mas NÃO inclui array de `sectors`
   - O `sendRuntimeResponse` inclui sectors no `data`, mas o hook só lê `state` do ACK
   - **Resultado**: após comandos, os setores não atualizam na UI

3. **Diálogo de confirmação não implementado**
   - O dispositivo retorna `requiresDecision: true` com `secondaryAction: "safe_stop"` quando tenta fechar último setor com bomba ligada
   - O dispositivo retorna `requiresConfirmation: true` com `confirmationAction: "force"` quando tenta ligar bomba com setores fechados
   - O frontend ignora completamente essas respostas

4. **Switch com visual ruim**
   - Baixo contraste no tema escuro

### Arquivos a Modificar

#### 1. `src/hooks/useIrrigationMQTT.ts`
- Corrigir `normalizeFullConfig` para:
  - Ler `source.config` quando existir (response do `get_full_config`)
  - Ler `sectorsConfig` além de `sectors` 
  - Ler `sectorizationEnabled` (camelCase) além de `sectorization_enabled`
  - Ler `publishIntervalSec` do bloco `mqtt` dentro do config
- No handler de ACK, além do `state`, ler também o bloco `data` que contém `sectors` com estado `open`
- Quando ACK for de `set_sectorization`, `set_sector_enabled`, `set_sector`, aplicar patch otimista no snapshot
- Adicionar tratamento de `requiresDecision` e `requiresConfirmation`: rejeitar a Promise com informações estruturadas para a UI

#### 2. `src/components/irrigation/PanelTab.tsx`
- Adicionar `AlertDialog` para quando o dispositivo retorna `REQUIRES_DECISION` (fechar último setor com bomba ligada):
  - Opção "Desligar bomba e fechar setor" → re-envia comando com `strategy: "safe_stop"`
  - Opção "Fechar mesmo assim" → re-envia com `strategy: "force_close"`
  - Opção "Cancelar"
- Adicionar tratamento para `REQUIRES_CONFIRMATION` (ligar bomba com setores fechados):
  - Opção "Ligar mesmo assim" → re-envia com `force: true`
  - Opção "Cancelar"
- Adicionar estados otimistas locais para setores (evitar flickering)

#### 3. `src/components/irrigation/SectorsTab.tsx`
- Corrigir useEffects que resetam `localSectorization` e `localSectorEnabled` a cada update
  - Só limpar estado local quando valor confirmado bater com valor otimista
- Usar dados de `snapshot.sectors` como fonte primária de estado (enabled/open), com fallback em fullConfig para nomes

#### 4. `src/components/ui/switch.tsx`
- Melhorar contraste do track no estado desligado: usar `bg-input/80` ou similar
- Adicionar borda sutil ao thumb para melhor visibilidade

### Detalhes Técnicos

```text
Estrutura real do response de get_full_config:
{
  "data": {
    "runtime": { sectors: [...], pumpOn, manualMode, ... },
    "config": { sectorizationEnabled, sectorsConfig: [...], mqtt: { publishIntervalSec }, ... }
  },
  "state": { sectorization_enabled, pump_on, ... }
}

normalizeFullConfig atual procura:
  source.sectors → NÃO EXISTE (é sectorsConfig)
  source.sectorization_enabled → NÃO EXISTE (é sectorizationEnabled)

Fluxo de decisão do dispositivo ao fechar setor:
  pump off → fecha direto
  pump on + outros setores abertos → fecha com sequência segura
  pump on + último setor → REQUIRES_DECISION (precisa strategy)
```

### Resultado Esperado
- Setores aparecem corretamente na aba Setores e no Painel
- Switch de setorização reflete estado real e não "pisca"
- Habilitar/desabilitar setor funciona e fica sincronizado
- Diálogo aparece ao fechar setor com bomba ligada
- Diálogo aparece ao ligar bomba com setores fechados
- Switch tem visual adequado no tema escuro

