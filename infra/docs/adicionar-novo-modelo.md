# Como adicionar um novo modelo de equipamento

A partir da migration `021_device_capabilities.sql`, adicionar um novo
modelo (gerador, chocadeira, bomba de poço, etc.) **não exige mais
ALTER TABLE**. É só popular as tabelas de catálogo.

## Passo a passo

### 1. Cadastrar o modelo

```sql
INSERT INTO modelos_dispositivo (prefixo, major_version, nome, descricao, ativo)
VALUES ('GER', 'V1', 'Gerador v1', 'Gerador a diesel monitorado', TRUE)
RETURNING id;
-- guarda o uuid retornado, vai usar nas próximas queries
```

### 2. Cadastrar os tipos de evento que esse modelo pode publicar

```sql
INSERT INTO device_event_types (modelo_id, event_type, descricao) VALUES
  ('<uuid-do-modelo>', 'gerador_partiu',         'Gerador iniciou'),
  ('<uuid-do-modelo>', 'gerador_parou',          'Gerador parou'),
  ('<uuid-do-modelo>', 'falha_combustivel',      'Combustível esgotando'),
  ('<uuid-do-modelo>', 'rede_voltou',            'Rede elétrica voltou'),
  ('<uuid-do-modelo>', 'rede_caiu',              'Rede elétrica caiu');
```

Esses são os únicos `event_type` que o firmware desse modelo poderá
publicar via MQTT. Qualquer outro vai dar erro `check_violation` no
INSERT.

### 3. Cadastrar os tipos de alarme

```sql
INSERT INTO device_alarm_types (modelo_id, alarm_type, severidade, descricao) VALUES
  ('<uuid-do-modelo>', 'combustivel_baixo',   'warning',  'Reserva de combustível < 20%'),
  ('<uuid-do-modelo>', 'oleo_baixo',          'critical', 'Pressão de óleo baixa'),
  ('<uuid-do-modelo>', 'temp_motor_alta',     'critical', 'Temperatura do motor crítica');
```

### 4. (Opcional) Provisionar comportamento default

Se o modelo precisa criar tabelas de configuração específicas (igual
o IRR-V1 faz com `irrigation_configs`/`irrigation_sectors`):

```sql
-- Crie funções de provisionamento similares a provision_irr_v1_defaults()
-- e chame quando um device desse modelo for claimed.
```

### 5. Pronto

Devices cadastrados com esse `modelo_id` agora aceitam os eventos e
alarmes catalogados. Adicionar mais tipos depois é só `INSERT` na
tabela de catálogo (sem ALTER, sem migration).

## Como remover um tipo

```sql
DELETE FROM device_event_types WHERE modelo_id = ? AND event_type = ?;
```

Eventos antigos no histórico (`irrigation_events`) com esse tipo
continuam armazenados — a validação só acontece no INSERT.

## Como ver o que cada modelo aceita

```sql
SELECT m.prefixo || '-' || m.major_version AS modelo,
       array_agg(et.event_type ORDER BY et.event_type) AS eventos
  FROM modelos_dispositivo m
  LEFT JOIN device_event_types et ON et.modelo_id = m.id
 GROUP BY m.id ORDER BY m.prefixo;
```
