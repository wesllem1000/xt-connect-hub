-- Remove unique constraint that prevents duplicate components per model
ALTER TABLE public.device_model_dashboards 
DROP CONSTRAINT IF EXISTS device_model_dashboards_device_model_id_dashboard_component_key;

-- Add new columns for customization
ALTER TABLE public.device_model_dashboards 
ADD COLUMN IF NOT EXISTS titulo_personalizado TEXT,
ADD COLUMN IF NOT EXISTS tipo_visualizacao TEXT DEFAULT 'padrao';

-- Add indicador_texto to the dashboard_component_type enum
ALTER TYPE dashboard_component_type ADD VALUE IF NOT EXISTS 'indicador_texto';

-- Note: The INSERT for the new component type will be done in a separate migration
-- because Postgres requires a transaction commit after ALTER TYPE ADD VALUE