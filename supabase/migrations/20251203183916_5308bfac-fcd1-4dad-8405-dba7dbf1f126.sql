-- Adicionar colunas à tabela devices
ALTER TABLE public.devices 
ADD COLUMN IF NOT EXISTS device_id TEXT,
ADD COLUMN IF NOT EXISTS device_model_id UUID REFERENCES public.device_models(id),
ADD COLUMN IF NOT EXISTS owner_id UUID;

-- Copiar dados existentes de usuario_id para owner_id
UPDATE public.devices SET owner_id = usuario_id WHERE owner_id IS NULL;

-- Criar índice único para device_id (permitindo NULL temporariamente para dados existentes)
CREATE UNIQUE INDEX IF NOT EXISTS devices_device_id_unique ON public.devices(device_id) WHERE device_id IS NOT NULL;

-- Criar tabela de compartilhamento de dispositivos
CREATE TABLE IF NOT EXISTS public.device_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  shared_by_user_id UUID NOT NULL,
  shared_with_user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(device_id, shared_with_user_id)
);

-- Habilitar RLS na tabela de compartilhamento
ALTER TABLE public.device_shares ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para device_shares

-- Donos podem ver compartilhamentos de seus dispositivos
CREATE POLICY "Owners can view shares of their devices"
ON public.device_shares
FOR SELECT
USING (
  shared_by_user_id = auth.uid() 
  OR shared_with_user_id = auth.uid()
);

-- Apenas donos podem criar compartilhamentos
CREATE POLICY "Owners can create shares"
ON public.device_shares
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.devices d
    WHERE d.id = device_shares.device_id 
    AND (d.owner_id = auth.uid() OR d.usuario_id = auth.uid())
  )
);

-- Donos podem deletar compartilhamentos
CREATE POLICY "Owners can delete shares"
ON public.device_shares
FOR DELETE
USING (
  shared_by_user_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- Atualizar políticas RLS da tabela devices para incluir compartilhamentos

-- Remover políticas antigas
DROP POLICY IF EXISTS "Usuários podem ver seus próprios dispositivos" ON public.devices;

-- Nova política: usuários podem ver dispositivos próprios ou compartilhados
CREATE POLICY "Users can view own or shared devices"
ON public.devices
FOR SELECT
USING (
  owner_id = auth.uid() 
  OR usuario_id = auth.uid()
  OR instalador_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.device_shares ds
    WHERE ds.device_id = id 
    AND ds.shared_with_user_id = auth.uid()
  )
);

-- Política para inserção (apenas usuários autenticados)
DROP POLICY IF EXISTS "Instaladores podem inserir dispositivos" ON public.devices;
CREATE POLICY "Authenticated users can insert devices"
ON public.devices
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Política para atualização (apenas dono ou instalador)
DROP POLICY IF EXISTS "Usuários podem atualizar seus dispositivos" ON public.devices;
DROP POLICY IF EXISTS "Instaladores podem atualizar dispositivos que instalaram" ON public.devices;
CREATE POLICY "Owners can update their devices"
ON public.devices
FOR UPDATE
USING (
  owner_id = auth.uid() 
  OR usuario_id = auth.uid()
  OR instalador_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- Política para deleção (apenas dono ou admin)
DROP POLICY IF EXISTS "Instaladores podem deletar dispositivos" ON public.devices;
CREATE POLICY "Owners or admins can delete devices"
ON public.devices
FOR DELETE
USING (
  owner_id = auth.uid() 
  OR usuario_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
);