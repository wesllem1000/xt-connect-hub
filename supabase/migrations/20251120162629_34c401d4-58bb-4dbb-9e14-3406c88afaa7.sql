-- Criar enum para tipos de usuário
CREATE TYPE public.user_type AS ENUM ('instalador', 'usuario_final');

-- Criar enum para status de dispositivo
CREATE TYPE public.device_status AS ENUM ('online', 'offline', 'manutencao');

-- Criar tabela de perfis
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_completo TEXT NOT NULL,
  tipo_usuario user_type NOT NULL DEFAULT 'usuario_final',
  telefone TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Criar tabela de dispositivos
CREATE TABLE public.devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL,
  modelo TEXT,
  numero_serie TEXT UNIQUE,
  status device_status DEFAULT 'offline',
  localizacao TEXT,
  instalador_id UUID REFERENCES public.profiles(id),
  usuario_id UUID REFERENCES public.profiles(id),
  configuracao JSONB DEFAULT '{}',
  ultima_conexao TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Criar tabela de automações
CREATE TABLE public.automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  descricao TEXT,
  usuario_id UUID REFERENCES public.profiles(id) NOT NULL,
  dispositivos_ids UUID[] DEFAULT '{}',
  configuracao JSONB NOT NULL,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;

-- Policies para profiles
CREATE POLICY "Usuários podem ver seu próprio perfil"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Usuários podem atualizar seu próprio perfil"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Instaladores podem ver perfis de seus clientes"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.tipo_usuario = 'instalador'
    )
  );

-- Policies para devices
CREATE POLICY "Usuários podem ver seus próprios dispositivos"
  ON public.devices FOR SELECT
  USING (usuario_id = auth.uid() OR instalador_id = auth.uid());

CREATE POLICY "Instaladores podem inserir dispositivos"
  ON public.devices FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND tipo_usuario = 'instalador'
    )
  );

CREATE POLICY "Instaladores podem atualizar dispositivos que instalaram"
  ON public.devices FOR UPDATE
  USING (instalador_id = auth.uid());

CREATE POLICY "Usuários podem atualizar seus dispositivos"
  ON public.devices FOR UPDATE
  USING (usuario_id = auth.uid());

CREATE POLICY "Instaladores podem deletar dispositivos"
  ON public.devices FOR DELETE
  USING (instalador_id = auth.uid());

-- Policies para automations
CREATE POLICY "Usuários podem ver suas automações"
  ON public.automations FOR SELECT
  USING (usuario_id = auth.uid());

CREATE POLICY "Usuários podem criar automações"
  ON public.automations FOR INSERT
  WITH CHECK (usuario_id = auth.uid());

CREATE POLICY "Usuários podem atualizar suas automações"
  ON public.automations FOR UPDATE
  USING (usuario_id = auth.uid());

CREATE POLICY "Usuários podem deletar suas automações"
  ON public.automations FOR DELETE
  USING (usuario_id = auth.uid());

-- Trigger para criar perfil automaticamente
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, nome_completo, tipo_usuario)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome_completo', 'Usuário'),
    COALESCE((NEW.raw_user_meta_data->>'tipo_usuario')::user_type, 'usuario_final')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER devices_updated_at
  BEFORE UPDATE ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER automations_updated_at
  BEFORE UPDATE ON public.automations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();