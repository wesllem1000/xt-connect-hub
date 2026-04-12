
-- 1. Fix device_last_values: restrict service-role policy to actual service_role
DROP POLICY IF EXISTS "Service role can manage device values" ON public.device_last_values;

CREATE POLICY "Service role can manage device values"
ON public.device_last_values
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 2. Fix device_value_history: restrict service-role policy to actual service_role
DROP POLICY IF EXISTS "Service role can manage device history" ON public.device_value_history;

CREATE POLICY "Service role can manage device history"
ON public.device_value_history
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 3. Fix user_roles: prevent non-admin self-insert privilege escalation
-- The existing "Admins can manage roles" ALL policy is for public role.
-- We need to ensure non-admins cannot INSERT/UPDATE/DELETE.
-- Drop the ALL policy and recreate with explicit per-operation policies.
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;

CREATE POLICY "Admins can insert roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 4. Fix system_config: require authentication for reads
DROP POLICY IF EXISTS "Anyone can view system config" ON public.system_config;

CREATE POLICY "Authenticated users can view system config"
ON public.system_config
FOR SELECT
TO authenticated
USING (true);

-- 5. Harden handle_new_user to never trust user-supplied tipo_usuario
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, nome_completo, tipo_usuario)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome_completo', 'Usuário'),
    'usuario_final'::user_type
  );
  RETURN NEW;
END;
$$;
