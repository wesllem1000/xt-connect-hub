-- E4.1 — Procedure provision_irr_v1_defaults (refs #71)
--
-- Idempotente. Aceita ser chamada no endpoint de provisionamento admin
-- (após INSERT em devices) OU defensivamente no claim (catch-all pra
-- devices legacy sem template).
--
-- Regra R1 (baked): bomba habilitada por default; 8 setores criados
-- com habilitado=FALSE. ULN2003 ⇒ nivel_ativo='high' pra bomba + setores.

BEGIN;

CREATE OR REPLACE FUNCTION provision_irr_v1_defaults(p_device_id UUID)
RETURNS TABLE (
  config_created BOOLEAN,
  sectors_created INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_config_created BOOLEAN := FALSE;
  v_sectors_created INT := 0;
  v_existing_sectors INT;
  v_gpio_map INT[] := ARRAY[16,17,18,19,21,22,23,25];  -- placeholder; firmware é autoridade do pinout real
  i INT;
BEGIN
  -- 1) Config default: 1:1 com device, idempotente
  INSERT INTO irrigation_configs (
    device_id,
    protocol_version,
    modo_operacao,
    tipo_bomba,
    reforco_rele_ativo,
    nivel_ativo_bomba,
    atraso_abrir_valvula_antes_bomba_s,
    tempo_bomba_desligada_antes_fechar_valvula_s,
    atraso_religar_bomba_apos_fechamento_s,
    tempo_max_continuo_bomba_min,
    tempo_max_manual_local_min,
    tempo_max_manual_remoto_sem_internet_min,
    botao_fisico_tipo,
    botao_debounce_ms,
    botao_assume_manual,
    gpio_1wire
  )
  VALUES (
    p_device_id,
    1,
    'manual',
    'monofasica',
    FALSE,
    'high',
    3,
    2,
    5,
    120,
    60,
    60,
    'pulso_alterna',
    50,
    TRUE,
    15
  )
  ON CONFLICT (device_id) DO NOTHING;

  GET DIAGNOSTICS v_config_created = ROW_COUNT;

  -- 2) 8 setores — todos habilitado=FALSE; só a bomba fica on por default (R1)
  SELECT COUNT(*) INTO v_existing_sectors
    FROM irrigation_sectors WHERE device_id = p_device_id;

  IF v_existing_sectors = 0 THEN
    FOR i IN 1..8 LOOP
      INSERT INTO irrigation_sectors (
        device_id, numero, nome, habilitado, pausado,
        gpio_rele, nivel_ativo_rele, debounce_ms
      ) VALUES (
        p_device_id,
        i,
        'Setor ' || i,
        FALSE,       -- R1: todos desabilitados
        FALSE,
        v_gpio_map[i],
        'high',      -- ULN2003
        50
      );
      v_sectors_created := v_sectors_created + 1;
    END LOOP;
  END IF;

  RETURN QUERY SELECT v_config_created, v_sectors_created;
END;
$$;

COMMENT ON FUNCTION provision_irr_v1_defaults(UUID) IS
  'E4.1 — Idempotente. Insere config default (§R9) + 8 sectors desabilitados (§R1). Não toca timers/sensors (ficam vazios). Chamada em provisionamento admin + defensivamente no claim.';

COMMIT;
