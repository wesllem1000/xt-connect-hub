import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MqttTestRequest {
  host: string;
  port: number;
  username?: string;
  password?: string;
  useSsl: boolean;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify the user is authenticated and is an admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.log('Missing authorization header');
      return new Response(
        JSON.stringify({ success: false, message: 'Não autorizado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client to verify user and check admin role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    
    if (authError || !user) {
      console.log('Authentication failed:', authError?.message);
      return new Response(
        JSON.stringify({ success: false, message: 'Não autorizado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user has admin role using the has_role function
    const { data: isAdmin, error: roleError } = await userClient.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin'
    });

    if (roleError || !isAdmin) {
      console.log('User is not admin:', user.id);
      return new Response(
        JSON.stringify({ success: false, message: 'Acesso restrito a administradores' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Admin user authenticated:', user.id);

    const { host, port, username, password, useSsl } = await req.json() as MqttTestRequest;

    console.log(`Testing MQTT connection to ${host}:${port} (SSL: ${useSsl})`);

    if (!host || !port) {
      return new Response(
        JSON.stringify({ success: false, message: 'Host e porta são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Try a TCP connection to test basic connectivity
    const testTcpConnection = async (): Promise<{ success: boolean; message: string }> => {
      try {
        const conn = await Deno.connect({
          hostname: host,
          port: port,
          transport: "tcp",
        });
        conn.close();
        return { success: true, message: 'Servidor MQTT acessível!' };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
        console.error('TCP connection error:', errorMessage);
        return { success: false, message: `Servidor inacessível: ${errorMessage}` };
      }
    };

    // Try TCP connection
    const tcpResult = await testTcpConnection();
    
    if (tcpResult.success) {
      return new Response(
        JSON.stringify({ success: true, message: 'Conexão com servidor MQTT estabelecida com sucesso!' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify(tcpResult),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('Error testing MQTT connection:', errorMessage);
    return new Response(
      JSON.stringify({ success: false, message: `Erro interno: ${errorMessage}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
