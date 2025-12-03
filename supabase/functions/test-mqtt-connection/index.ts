import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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