-- Adicionar campo senha na tabela mqtt_servers
ALTER TABLE public.mqtt_servers ADD COLUMN IF NOT EXISTS senha text;

-- Criar enum para tipos de componentes de dashboard
CREATE TYPE public.dashboard_component_type AS ENUM (
  'sensor_tensao',
  'sensor_temperatura', 
  'sensor_umidade',
  'sensor_corrente',
  'sensor_generico',
  'controle_botao',
  'controle_slider',
  'controle_switch',
  'controle_input',
  'indicador_led',
  'indicador_status',
  'indicador_gauge'
);

-- Criar enum para direção do dado (entrada/saída)
CREATE TYPE public.data_direction AS ENUM ('receive', 'send', 'both');

-- Tabela de templates de componentes de dashboard
CREATE TABLE public.dashboard_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  tipo dashboard_component_type NOT NULL,
  descricao text,
  icone text,
  configuracao_padrao jsonb DEFAULT '{}'::jsonb,
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Tabela de associação entre modelos de dispositivo e componentes de dashboard
CREATE TABLE public.device_model_dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_model_id uuid NOT NULL REFERENCES public.device_models(id) ON DELETE CASCADE,
  dashboard_component_id uuid NOT NULL REFERENCES public.dashboard_components(id) ON DELETE CASCADE,
  ordem integer DEFAULT 0,
  direcao data_direction NOT NULL DEFAULT 'receive',
  json_path_receive text, -- caminho no JSON para receber dados (ex: "payload.temperature")
  json_path_send text, -- caminho no JSON para enviar comandos (ex: "command.setValue")
  mqtt_topic_override text, -- tópico MQTT específico se diferente do padrão
  configuracao jsonb DEFAULT '{}'::jsonb, -- configurações específicas (min, max, unidade, etc)
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(device_model_id, dashboard_component_id)
);

-- Habilitar RLS
ALTER TABLE public.dashboard_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_model_dashboards ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para dashboard_components
CREATE POLICY "Admins can manage dashboard components"
ON public.dashboard_components FOR ALL
USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Anyone can view active dashboard components"
ON public.dashboard_components FOR SELECT
USING (ativo = true OR has_role(auth.uid(), 'admin'));

-- Políticas RLS para device_model_dashboards
CREATE POLICY "Admins can manage device model dashboards"
ON public.device_model_dashboards FOR ALL
USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Anyone can view active device model dashboards"
ON public.device_model_dashboards FOR SELECT
USING (ativo = true OR has_role(auth.uid(), 'admin'));

-- Triggers para updated_at
CREATE TRIGGER update_dashboard_components_updated_at
BEFORE UPDATE ON public.dashboard_components
FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER update_device_model_dashboards_updated_at
BEFORE UPDATE ON public.device_model_dashboards
FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Inserir componentes padrão
INSERT INTO public.dashboard_components (nome, tipo, descricao, icone, configuracao_padrao) VALUES
('Tensão', 'sensor_tensao', 'Exibe leitura de tensão elétrica', 'Zap', '{"unidade": "V", "min": 0, "max": 250, "casas_decimais": 1}'),
('Temperatura', 'sensor_temperatura', 'Exibe leitura de temperatura', 'Thermometer', '{"unidade": "°C", "min": -20, "max": 100, "casas_decimais": 1}'),
('Umidade', 'sensor_umidade', 'Exibe leitura de umidade relativa', 'Droplets', '{"unidade": "%", "min": 0, "max": 100, "casas_decimais": 0}'),
('Corrente', 'sensor_corrente', 'Exibe leitura de corrente elétrica', 'Activity', '{"unidade": "A", "min": 0, "max": 100, "casas_decimais": 2}'),
('Sensor Genérico', 'sensor_generico', 'Sensor configurável para qualquer grandeza', 'Gauge', '{"unidade": "", "min": 0, "max": 100, "casas_decimais": 2}'),
('Botão', 'controle_botao', 'Botão para enviar comandos', 'Square', '{"texto": "Executar", "comando": "action"}'),
('Slider', 'controle_slider', 'Controle deslizante para ajuste de valores', 'SlidersHorizontal', '{"min": 0, "max": 100, "passo": 1}'),
('Switch', 'controle_switch', 'Interruptor liga/desliga', 'ToggleLeft', '{"comando_on": "on", "comando_off": "off"}'),
('Input Numérico', 'controle_input', 'Campo para entrada de valores', 'Hash', '{"min": 0, "max": 1000, "passo": 1}'),
('LED', 'indicador_led', 'Indicador visual de estado on/off', 'Circle', '{"cor_on": "#22c55e", "cor_off": "#ef4444"}'),
('Status', 'indicador_status', 'Indicador de status com texto', 'Info', '{"estados": {"0": "Desligado", "1": "Ligado"}}'),
('Gauge', 'indicador_gauge', 'Medidor visual circular', 'Gauge', '{"min": 0, "max": 100, "cores": ["#22c55e", "#eab308", "#ef4444"]}')