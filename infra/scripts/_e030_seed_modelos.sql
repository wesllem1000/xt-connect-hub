-- E3.1 seed — 3 modelos iniciais (refs #65)
--
-- Linha legada "automação off grid" preservada sem prefixo/major_version
-- (não é provisionável pelo novo fluxo até um admin configurar).

INSERT INTO modelos_dispositivo
  (nome, fabricante, descricao, especificacoes, prefixo, major_version, rate_default_segundos, ativo)
VALUES
  ('Irrigação v1', 'XT Conect', 'Controle de irrigação agrícola',
   '{"fields":["temp","umid","valvula"]}'::jsonb,
   'IRR', 'V1', 30, TRUE),
  ('Interruptor inteligente v2', 'XT Conect', 'Interruptor conectado com medição',
   '{"fields":["estado","corrente"]}'::jsonb,
   'INT', 'V2', 30, TRUE),
  ('Offgrid v1', 'XT Conect', 'Monitoramento de sistema off-grid',
   '{"fields":["bateria","carga","solar","consumo"]}'::jsonb,
   'OFG', 'V1', 30, TRUE)
ON CONFLICT (nome) DO UPDATE SET
  prefixo = EXCLUDED.prefixo,
  major_version = EXCLUDED.major_version,
  especificacoes = EXCLUDED.especificacoes,
  rate_default_segundos = EXCLUDED.rate_default_segundos;
