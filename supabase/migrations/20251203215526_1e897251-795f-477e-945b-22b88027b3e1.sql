-- Fix: Device INSERT policy should validate owner_id
DROP POLICY IF EXISTS "Authenticated users can insert devices" ON public.devices;

CREATE POLICY "Authenticated users can insert devices" 
ON public.devices 
FOR INSERT 
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (owner_id = auth.uid() OR usuario_id = auth.uid())
);