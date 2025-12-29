import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

interface MQTTPayload {
  device_id: string;
  data: Record<string, unknown>;
  timestamp?: string;
}

interface ConfigMapping {
  config_id: string;
  json_path: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate webhook secret (optional but recommended)
    const webhookSecret = req.headers.get('x-webhook-secret');
    const expectedSecret = Deno.env.get('MQTT_WEBHOOK_SECRET');
    
    if (expectedSecret && webhookSecret !== expectedSecret) {
      console.error('Invalid webhook secret');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const payload: MQTTPayload = await req.json();
    console.log('📨 Received MQTT webhook:', JSON.stringify(payload));

    // Validate payload structure
    if (!payload.device_id || typeof payload.device_id !== 'string') {
      console.error('Missing or invalid device_id');
      return new Response(
        JSON.stringify({ error: 'device_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!payload.data || typeof payload.data !== 'object') {
      console.error('Missing or invalid data');
      return new Response(
        JSON.stringify({ error: 'data object is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client with service role for backend operations
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find the device by device_id
    const { data: device, error: deviceError } = await supabase
      .from('devices')
      .select('id, device_model_id')
      .eq('device_id', payload.device_id)
      .maybeSingle();

    if (deviceError) {
      console.error('Error finding device:', deviceError);
      return new Response(
        JSON.stringify({ error: 'Database error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!device) {
      console.warn(`Device not found: ${payload.device_id}`);
      return new Response(
        JSON.stringify({ error: 'Device not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`✅ Found device: ${device.id}`);

    // Update device's ultima_conexao
    const { error: updateError } = await supabase
      .from('devices')
      .update({ 
        ultima_conexao: new Date().toISOString(),
        status: 'online'
      })
      .eq('id', device.id);

    if (updateError) {
      console.error('Error updating device connection:', updateError);
    } else {
      console.log('✅ Updated ultima_conexao');
    }

    // Get dashboard configs for this device model to map json_paths to config_ids
    if (device.device_model_id) {
      const { data: dashboardConfigs, error: configError } = await supabase
        .from('device_model_dashboards')
        .select('id, json_path_receive, direcao')
        .eq('device_model_id', device.device_model_id)
        .eq('ativo', true);

      if (configError) {
        console.error('Error fetching dashboard configs:', configError);
      } else if (dashboardConfigs && dashboardConfigs.length > 0) {
        console.log(`📊 Found ${dashboardConfigs.length} dashboard configs`);

        // Process each config and extract values from payload.data
        const upsertPromises = dashboardConfigs
          .filter(config => 
            config.json_path_receive && 
            (config.direcao === 'receive' || config.direcao === 'both')
          )
          .map(async (config) => {
            // Extract value using json_path_receive
            const value = getValueByPath(payload.data, config.json_path_receive!);
            
            if (value !== undefined) {
              console.log(`📊 Config ${config.id}: ${config.json_path_receive} = ${JSON.stringify(value)}`);
              
              const timestamp = payload.timestamp || new Date().toISOString();
              const valueObj = { value };

              // Upsert into device_last_values (keeps only latest value)
              const { error: upsertError } = await supabase
                .from('device_last_values')
                .upsert({
                  device_id: device.id,
                  config_id: config.id,
                  value: valueObj,
                  received_at: timestamp
                }, {
                  onConflict: 'device_id,config_id'
                });

              if (upsertError) {
                console.error(`Error upserting value for config ${config.id}:`, upsertError);
              }

              // Also insert into device_value_history (keeps ALL values for charting)
              const { error: historyError } = await supabase
                .from('device_value_history')
                .insert({
                  device_id: device.id,
                  config_id: config.id,
                  value: valueObj,
                  received_at: timestamp
                });

              if (historyError) {
                console.error(`Error inserting history for config ${config.id}:`, historyError);
              }
            }
          });

        await Promise.all(upsertPromises);
        console.log('✅ Saved all values to device_last_values and device_value_history');
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        device_id: device.id,
        message: 'Data processed successfully'
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error processing MQTT webhook:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Helper function to get value by JSON path (e.g., "sensors.temperature" or just "temperature")
function getValueByPath(obj: Record<string, unknown>, path: string): unknown {
  if (!path || !obj) return undefined;
  
  const keys = path.split('.');
  let current: unknown = obj;
  
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  
  return current;
}
