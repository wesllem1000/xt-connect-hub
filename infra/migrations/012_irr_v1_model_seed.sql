-- E4.1 — IRR-V1 model: flag requires_provisioning_template (refs #71)
--
-- O row do modelo IRR-V1 já foi seedado em _e030_seed_modelos.sql
-- (commit 33d719b). Esta migration estende `especificacoes` com a flag
-- que o endpoint de provisionamento consulta pra decidir se precisa
-- rodar a procedure provision_irr_v1_defaults.
--
-- Idempotente via ON CONFLICT DO UPDATE.

BEGIN;

UPDATE modelos_dispositivo
   SET especificacoes = COALESCE(especificacoes, '{}'::jsonb)
                        || jsonb_build_object(
                             'flags', jsonb_build_object(
                               'requires_provisioning_template', true,
                               'provisioning_procedure', 'provision_irr_v1_defaults'
                             )
                           ),
       atualizado_em = NOW()
 WHERE prefixo = 'IRR' AND major_version = 'V1';

-- Se por acaso o seed E3.1 ainda não rodou nesse ambiente, cria o row.
-- Idempotente via ON CONFLICT (nome).
INSERT INTO modelos_dispositivo
  (nome, fabricante, descricao, especificacoes, prefixo, major_version,
   rate_default_segundos, ativo)
VALUES
  ('Irrigação v1', 'XT Conect',
   'Automação de irrigação: 1 bomba + 8 setores + até 4 sensores DS18B20 + timers fixed/cyclic.',
   jsonb_build_object(
     'fields', jsonb_build_array('uptime_s','umidade_solo','bomba_ligada'),
     'flags', jsonb_build_object(
       'requires_provisioning_template', true,
       'provisioning_procedure', 'provision_irr_v1_defaults'
     )
   ),
   'IRR', 'V1', 5, TRUE)
ON CONFLICT (nome) DO UPDATE SET
  especificacoes = EXCLUDED.especificacoes,
  atualizado_em = NOW();

COMMIT;
