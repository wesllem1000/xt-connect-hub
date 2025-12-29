-- Create device_value_history table for storing all historical MQTT data
CREATE TABLE public.device_value_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id UUID NOT NULL,
  config_id UUID NOT NULL,
  value JSONB NOT NULL,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create composite index for fast queries by device + config + time
CREATE INDEX idx_device_value_history_lookup 
  ON public.device_value_history(device_id, config_id, received_at DESC);

-- Enable Row Level Security
ALTER TABLE public.device_value_history ENABLE ROW LEVEL SECURITY;

-- RLS policy: Users can view history for their devices
CREATE POLICY "Users can view their device history" 
ON public.device_value_history 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM devices d
    WHERE d.id = device_value_history.device_id
    AND (
      d.owner_id = auth.uid() 
      OR d.usuario_id = auth.uid() 
      OR d.instalador_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM device_shares ds 
        WHERE ds.device_id = d.id 
        AND ds.shared_with_user_id = auth.uid()
      )
    )
  )
);

-- RLS policy: Service role can manage all history (for edge functions)
CREATE POLICY "Service role can manage device history" 
ON public.device_value_history 
FOR ALL 
USING (true)
WITH CHECK (true);

-- Add history_retention_hours column to device_models (default 24 hours)
ALTER TABLE public.device_models 
ADD COLUMN history_retention_hours INTEGER NOT NULL DEFAULT 24;