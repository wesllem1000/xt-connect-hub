-- ============================================================================
-- Migration 003 — Schema v2 XT Conect Hub
-- ============================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE tipo_widget AS ENUM (
    'temperatura','umidade','tensao','corrente','sensor_generico',
    'botao','slider','switch','switch_personalizado','campo_texto',
    'led','status','gauge','valor_texto'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE direcao_dado AS ENUM ('receber','enviar','bidirecional');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE permissao_compartilhamento AS ENUM ('leitura','controle');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION set_atualizado_em()
RETURNS TRIGGER AS $$
BEGIN NEW.atualizado_em = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS telefone TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check
  CHECK (role IN ('user','admin','instalador'));

UPDATE app_users SET role = 'admin' WHERE email = 'wesllem1000@gmail.com';

CREATE TABLE IF NOT EXISTS modelos_dispositivo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL UNIQUE,
  fabricante TEXT NOT NULL,
  descricao TEXT,
  imagem_url TEXT,
  especificacoes JSONB NOT NULL DEFAULT '{}'::jsonb,
  protocolos_suportados TEXT[] NOT NULL DEFAULT ARRAY['mqtt']::TEXT[],
  retencao_historico_horas INT NOT NULL DEFAULT 168
    CHECK (retencao_historico_horas BETWEEN 1 AND 2160),
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_por UUID REFERENCES app_users(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_modelos_dispositivo_updated ON modelos_dispositivo;
CREATE TRIGGER trg_modelos_dispositivo_updated BEFORE UPDATE ON modelos_dispositivo
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
CREATE INDEX IF NOT EXISTS idx_modelos_dispositivo_ativo
  ON modelos_dispositivo(ativo) WHERE ativo = TRUE;

CREATE TABLE IF NOT EXISTS catalogo_widgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  tipo tipo_widget NOT NULL UNIQUE,
  descricao TEXT,
  icone TEXT NOT NULL DEFAULT 'gauge',
  configuracao_padrao JSONB NOT NULL DEFAULT '{}'::jsonb,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_catalogo_widgets_updated ON catalogo_widgets;
CREATE TRIGGER trg_catalogo_widgets_updated BEFORE UPDATE ON catalogo_widgets
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

CREATE TABLE IF NOT EXISTS modelo_widgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id UUID NOT NULL REFERENCES modelos_dispositivo(id) ON DELETE CASCADE,
  widget_id UUID NOT NULL REFERENCES catalogo_widgets(id) ON DELETE RESTRICT,
  titulo TEXT NOT NULL,
  ordem INT NOT NULL DEFAULT 0,
  coluna INT NOT NULL DEFAULT 0 CHECK (coluna BETWEEN 0 AND 11),
  linha INT NOT NULL DEFAULT 0 CHECK (linha >= 0),
  largura INT NOT NULL DEFAULT 4 CHECK (largura BETWEEN 1 AND 12),
  altura INT NOT NULL DEFAULT 2 CHECK (altura BETWEEN 1 AND 12),
  direcao direcao_dado NOT NULL DEFAULT 'receber',
  json_path_leitura TEXT,
  nome_comando TEXT,
  configuracao JSONB NOT NULL DEFAULT '{}'::jsonb,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_modelo_widget_direcao CHECK (
    (direcao = 'receber' AND json_path_leitura IS NOT NULL AND nome_comando IS NULL)
 OR (direcao = 'enviar' AND nome_comando IS NOT NULL AND json_path_leitura IS NULL)
 OR (direcao = 'bidirecional' AND json_path_leitura IS NOT NULL AND nome_comando IS NOT NULL)
  )
);
DROP TRIGGER IF EXISTS trg_modelo_widgets_updated ON modelo_widgets;
CREATE TRIGGER trg_modelo_widgets_updated BEFORE UPDATE ON modelo_widgets
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
CREATE INDEX IF NOT EXISTS idx_modelo_widgets_modelo_ordem ON modelo_widgets(modelo_id, ordem);
CREATE INDEX IF NOT EXISTS idx_modelo_widgets_ativo ON modelo_widgets(modelo_id) WHERE ativo = TRUE;

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS modelo_id UUID REFERENCES modelos_dispositivo(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS nome_amigavel TEXT,
  ADD COLUMN IF NOT EXISTS localizacao TEXT;
CREATE INDEX IF NOT EXISTS idx_devices_modelo_id ON devices(modelo_id);

CREATE TABLE IF NOT EXISTS dispositivo_ultimo_valor (
  dispositivo_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  widget_id UUID NOT NULL REFERENCES modelo_widgets(id) ON DELETE CASCADE,
  valor JSONB NOT NULL,
  recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (dispositivo_id, widget_id)
);
DROP TRIGGER IF EXISTS trg_dispositivo_ultimo_valor_updated ON dispositivo_ultimo_valor;
CREATE TRIGGER trg_dispositivo_ultimo_valor_updated BEFORE UPDATE ON dispositivo_ultimo_valor
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
CREATE INDEX IF NOT EXISTS idx_dispositivo_ultimo_valor_recebido
  ON dispositivo_ultimo_valor(dispositivo_id, recebido_em DESC);

CREATE TABLE IF NOT EXISTS dispositivo_compartilhado (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispositivo_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  com_usuario_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  criado_por UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  permissao permissao_compartilhamento NOT NULL DEFAULT 'leitura',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dispositivo_id, com_usuario_id)
);
DROP TRIGGER IF EXISTS trg_dispositivo_compartilhado_updated ON dispositivo_compartilhado;
CREATE TRIGGER trg_dispositivo_compartilhado_updated BEFORE UPDATE ON dispositivo_compartilhado
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
CREATE INDEX IF NOT EXISTS idx_dispositivo_compartilhado_usuario
  ON dispositivo_compartilhado(com_usuario_id);

INSERT INTO catalogo_widgets (nome, tipo, descricao, icone, configuracao_padrao) VALUES
  ('Temperatura','temperatura','Leitura de sensor de temperatura em °C','thermometer','{"unidade":"°C","casas_decimais":1,"minimo":-20,"maximo":80,"cor":"#f97316"}'::jsonb),
  ('Umidade','umidade','Leitura de sensor de umidade relativa em %','droplets','{"unidade":"%","casas_decimais":1,"minimo":0,"maximo":100,"cor":"#3b82f6"}'::jsonb),
  ('Tensão','tensao','Leitura de tensão elétrica em V','zap','{"unidade":"V","casas_decimais":2,"minimo":0,"maximo":240,"cor":"#eab308"}'::jsonb),
  ('Corrente','corrente','Leitura de corrente elétrica em A','activity','{"unidade":"A","casas_decimais":2,"minimo":0,"maximo":50,"cor":"#a855f7"}'::jsonb),
  ('Sensor Genérico','sensor_generico','Leitura numérica genérica com unidade customizável','gauge','{"unidade":"","casas_decimais":2,"cor":"#64748b"}'::jsonb),
  ('Botão','botao','Envia um comando ao pressionar (momentâneo)','mouse-pointer-click','{"texto":"Acionar","cor":"#f97316","payload_envio":{"valor":1}}'::jsonb),
  ('Slider','slider','Controle deslizante para envio de valor contínuo','sliders-horizontal','{"minimo":0,"maximo":100,"passo":1,"unidade":"","cor":"#f97316"}'::jsonb),
  ('Switch','switch','Liga/desliga simples (booleano)','toggle-right','{"texto_ligado":"ON","texto_desligado":"OFF","cor_ligado":"#22c55e","cor_desligado":"#64748b"}'::jsonb),
  ('Switch Personalizado','switch_personalizado','Seletor de múltiplos estados com payloads customizados','list-checks','{"opcoes":[{"rotulo":"Auto","valor":"auto"},{"rotulo":"Manual","valor":"manual"}]}'::jsonb),
  ('Campo de Texto','campo_texto','Envio de texto livre ao dispositivo','type','{"placeholder":"Digite...","tamanho_maximo":120}'::jsonb),
  ('LED','led','Indicador luminoso (aceso/apagado)','lightbulb','{"cor_aceso":"#22c55e","cor_apagado":"#1e293b","valor_aceso":1}'::jsonb),
  ('Status','status','Texto de status colorido (online/offline/erro)','circle-dot','{"mapeamento":{"online":"#22c55e","offline":"#64748b","erro":"#ef4444"}}'::jsonb),
  ('Gauge','gauge','Medidor circular tipo velocímetro','gauge-circle','{"minimo":0,"maximo":100,"unidade":"","casas_decimais":0,"cor":"#f97316"}'::jsonb),
  ('Valor em Texto','valor_texto','Exibe um valor simples em destaque','text','{"prefixo":"","sufixo":"","cor":"#0f172a","tamanho":"grande"}'::jsonb)
ON CONFLICT (tipo) DO NOTHING;

DO $$
DECLARE v_widgets INT; v_admin INT;
BEGIN
  SELECT COUNT(*) INTO v_widgets FROM catalogo_widgets;
  SELECT COUNT(*) INTO v_admin   FROM app_users WHERE role = 'admin';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Migration 003 aplicada com sucesso.';
  RAISE NOTICE '  - Widgets no catálogo: %', v_widgets;
  RAISE NOTICE '  - Admins cadastrados:  %', v_admin;
  RAISE NOTICE '============================================================';
  IF v_widgets < 14 THEN RAISE WARNING 'Esperado 14 widgets, encontrados %', v_widgets; END IF;
  IF v_admin < 1 THEN RAISE WARNING 'Nenhum admin cadastrado — verifique o email wesllem1000@gmail.com em app_users'; END IF;
END $$;

COMMIT;
