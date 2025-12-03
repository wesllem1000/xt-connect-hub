-- Corrigir política RLS para dispositivos compartilhados
DROP POLICY IF EXISTS "Users can view own or shared devices" ON public.devices;

CREATE POLICY "Users can view own or shared devices" 
ON public.devices 
FOR SELECT 
USING (
  (owner_id = auth.uid()) 
  OR (usuario_id = auth.uid()) 
  OR (instalador_id = auth.uid()) 
  OR (EXISTS (
    SELECT 1
    FROM device_shares ds
    WHERE ds.device_id = devices.id 
      AND ds.shared_with_user_id = auth.uid()
  ))
);