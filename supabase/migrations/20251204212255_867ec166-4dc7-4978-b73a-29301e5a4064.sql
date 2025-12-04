-- Fix: Restrict installer access to only their actual clients' profiles
DROP POLICY IF EXISTS "Instaladores podem ver perfis de seus clientes" ON public.profiles;

CREATE POLICY "Instaladores podem ver perfis de seus clientes"
ON public.profiles
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM devices d
    WHERE d.instalador_id = auth.uid()
      AND d.usuario_id = profiles.id
  )
);