-- Create table to store last received values per device and dashboard config
CREATE TABLE public.device_last_values (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES public.device_model_dashboards(id) ON DELETE CASCADE,
  value JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(device_id, config_id)
);

-- Indexes for performance
CREATE INDEX idx_device_last_values_device ON public.device_last_values(device_id);
CREATE INDEX idx_device_last_values_config ON public.device_last_values(config_id);

-- Enable RLS
ALTER TABLE public.device_last_values ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view values of their own devices (or shared)
CREATE POLICY "Users can view their device values" ON public.device_last_values
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.devices d
      WHERE d.id = device_last_values.device_id
      AND (
        d.owner_id = auth.uid() 
        OR d.usuario_id = auth.uid() 
        OR d.instalador_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.device_shares ds
          WHERE ds.device_id = d.id AND ds.shared_with_user_id = auth.uid()
        )
      )
    )
  );

-- Policy: Backend (service role) can insert/update values
CREATE POLICY "Service role can manage device values" ON public.device_last_values
  FOR ALL USING (true) WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_device_last_values_updated_at
  BEFORE UPDATE ON public.device_last_values
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();