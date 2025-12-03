-- Remove the overly permissive policy that exposes MQTT credentials to all users
DROP POLICY IF EXISTS "Anyone can view active MQTT servers" ON public.mqtt_servers;

-- Create a more restrictive policy that only allows admins to view MQTT servers
-- Regular users will get credentials through the secure edge function
CREATE POLICY "Only admins can view MQTT servers" 
ON public.mqtt_servers 
FOR SELECT 
USING (has_role(auth.uid(), 'admin'::app_role));