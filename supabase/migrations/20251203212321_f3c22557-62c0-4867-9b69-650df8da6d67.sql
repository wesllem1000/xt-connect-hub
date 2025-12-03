-- Criar tabela de configurações do sistema
CREATE TABLE public.system_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chave TEXT NOT NULL UNIQUE,
  valor TEXT NOT NULL,
  descricao TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

-- Políticas: admins podem gerenciar, todos podem ver
CREATE POLICY "Admins can manage system config"
ON public.system_config
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Anyone can view system config"
ON public.system_config
FOR SELECT
USING (true);

-- Inserir configuração padrão de tempo de verificação (em minutos)
INSERT INTO public.system_config (chave, valor, descricao)
VALUES ('status_timeout_minutes', '10', 'Tempo em minutos sem comunicação para considerar dispositivo offline');

-- Trigger para atualizar updated_at
CREATE TRIGGER update_system_config_updated_at
BEFORE UPDATE ON public.system_config
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();