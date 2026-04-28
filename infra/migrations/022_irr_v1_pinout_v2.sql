-- E5.17 — Atualiza pinout default IRR-V1 conforme placa fisica do prototipo.
--
-- Pinout confirmado pelo dono em 2026-04-28:
--   Bomba          : GPIO 13   (lado A)
--   Setor 1 (rele) : GPIO 12   (lado A)
--   Setor 2 (rele) : GPIO 14   (lado A)
--   Setores 3-7    : sequencia ascendente lado A: 27, 26, 25, 33, 32
--   Setor 8 (rele) : GPIO 23   (lado B — lado A esgotou em 7 outputs no ESP32 DevKit)
--   DS18B20 1-Wire : GPIO 15   (lado A, mantido)
--   Botoes (lado B): a definir no firmware (sugestao no doc PROJETO.md)
--
-- Migration faz:
--   1. Atualiza provision_irr_v1_defaults (novos provisionamentos pegam pinout novo)
--   2. NAO altera devices ja provisionados — eles tem config_pinout aplicada e o
--      ESP e fonte de verdade. Quando ESP novo conectar, ele republica config/current
--      com seu pinout real.
--
-- Aditiva.

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
  v_rc INT;
  -- Pinout fisico v2 (2026-04-28): 7 setores no lado A em sequencia,
  -- 8o no lado B (lado A esgotou). Bomba=13. DS18B20=15.
  v_gpio_map INT[] := ARRAY[12, 14, 27, 26, 25, 33, 32, 23];
  i INT;
BEGIN
  -- 1) Config default
  INSERT INTO irrigation_configs (
    device_id, protocol_version, modo_operacao,
    tipo_bomba, reforco_rele_ativo, nivel_ativo_bomba,
    atraso_abrir_valvula_antes_bomba_s,
    tempo_bomba_desligada_antes_fechar_valvula_s,
    atraso_religar_bomba_apos_fechamento_s,
    tempo_max_continuo_bomba_min,
    tempo_max_manual_local_min,
    tempo_max_manual_remoto_sem_internet_min,
    botao_fisico_tipo, botao_debounce_ms, botao_assume_manual,
    gpio_1wire
  ) VALUES (
    p_device_id, 1, 'manual',
    'monofasica', FALSE, 'high',
    3, 2, 5,
    120, 60, 60,
    'pulso_alterna', 50, TRUE,
    15
  )
  ON CONFLICT (device_id) DO NOTHING;

  GET DIAGNOSTICS v_rc = ROW_COUNT;
  v_config_created := (v_rc > 0);

  -- 2) 8 setores — pinout fisico v2
  SELECT COUNT(*) INTO v_existing_sectors
    FROM irrigation_sectors WHERE device_id = p_device_id;

  IF v_existing_sectors = 0 THEN
    FOR i IN 1..8 LOOP
      INSERT INTO irrigation_sectors (
        device_id, numero, nome, habilitado, pausado,
        gpio_rele, nivel_ativo_rele, debounce_ms
      ) VALUES (
        p_device_id, i, 'Setor ' || i,
        FALSE, FALSE,
        v_gpio_map[i],
        'high', 50
      );
      v_sectors_created := v_sectors_created + 1;
    END LOOP;
  END IF;

  RETURN QUERY SELECT v_config_created, v_sectors_created;
END;
$$;

COMMENT ON FUNCTION provision_irr_v1_defaults(UUID) IS
  'E4.1 + E5.17 — pinout fisico v2 (bomba=13, setores 12,14,27,26,25,33,32,23, gpio_1wire=15). ESP e fonte de verdade do pinout real (config/current).';

COMMIT;
