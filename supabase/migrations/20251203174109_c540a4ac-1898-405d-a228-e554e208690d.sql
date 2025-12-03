-- 1. Create app_role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- 2. Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. Create security definer function to check roles (avoids recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- 4. Create function to get user type (avoids recursion in profiles)
CREATE OR REPLACE FUNCTION public.get_user_type(_user_id UUID)
RETURNS user_type
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tipo_usuario FROM public.profiles WHERE id = _user_id
$$;

-- 5. RLS for user_roles
CREATE POLICY "Admins can view all roles"
ON public.user_roles FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view their own role"
ON public.user_roles FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Admins can manage roles"
ON public.user_roles FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- 6. Fix profiles RLS - drop problematic policy and recreate
DROP POLICY IF EXISTS "Instaladores podem ver perfis de seus clientes" ON public.profiles;

CREATE POLICY "Instaladores podem ver perfis de seus clientes"
ON public.profiles FOR SELECT
USING (public.get_user_type(auth.uid()) = 'instalador');

CREATE POLICY "Admins can view all profiles"
ON public.profiles FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update all profiles"
ON public.profiles FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete profiles"
ON public.profiles FOR DELETE
USING (public.has_role(auth.uid(), 'admin'));

-- 7. Device Models table
CREATE TABLE public.device_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  fabricante TEXT NOT NULL,
  descricao TEXT,
  especificacoes JSONB DEFAULT '{}'::jsonb,
  protocolos_suportados TEXT[] DEFAULT '{}'::text[],
  imagem_url TEXT,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.device_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active device models"
ON public.device_models FOR SELECT
USING (ativo = true OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage device models"
ON public.device_models FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- 8. Communication Types table
CREATE TABLE public.communication_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('mqtt', 'http', 'websocket')),
  descricao TEXT,
  configuracao_padrao JSONB DEFAULT '{}'::jsonb,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.communication_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active communication types"
ON public.communication_types FOR SELECT
USING (ativo = true OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage communication types"
ON public.communication_types FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- 9. MQTT Servers table
CREATE TABLE public.mqtt_servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  host TEXT NOT NULL,
  porta INTEGER DEFAULT 1883,
  usa_ssl BOOLEAN DEFAULT false,
  usuario TEXT,
  topico_padrao TEXT,
  descricao TEXT,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.mqtt_servers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active MQTT servers"
ON public.mqtt_servers FOR SELECT
USING (ativo = true OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage MQTT servers"
ON public.mqtt_servers FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- 10. Triggers for updated_at
CREATE TRIGGER update_device_models_updated_at
BEFORE UPDATE ON public.device_models
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_communication_types_updated_at
BEFORE UPDATE ON public.communication_types
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_mqtt_servers_updated_at
BEFORE UPDATE ON public.mqtt_servers
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();