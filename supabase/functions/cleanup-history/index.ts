import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🧹 Starting history cleanup...');

    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all device models with their retention settings
    const { data: models, error: modelsError } = await supabase
      .from('device_models')
      .select('id, nome, history_retention_hours');

    if (modelsError) {
      console.error('Error fetching models:', modelsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch models' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📊 Found ${models?.length || 0} device models`);

    let totalDeleted = 0;
    const results: { model: string; retention_hours: number; deleted: number }[] = [];

    for (const model of models || []) {
      const retentionHours = model.history_retention_hours || 24;
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - retentionHours);

      console.log(`🔍 Processing model "${model.nome}" (${model.id}): retention=${retentionHours}h, cutoff=${cutoffTime.toISOString()}`);

      // Get devices for this model
      const { data: devices, error: devicesError } = await supabase
        .from('devices')
        .select('id')
        .eq('device_model_id', model.id);

      if (devicesError) {
        console.error(`Error fetching devices for model ${model.id}:`, devicesError);
        continue;
      }

      if (!devices || devices.length === 0) {
        console.log(`  No devices found for model "${model.nome}"`);
        continue;
      }

      const deviceIds = devices.map(d => d.id);
      console.log(`  Found ${deviceIds.length} devices`);

      // Delete old history records for these devices
      const { error: deleteError, count } = await supabase
        .from('device_value_history')
        .delete({ count: 'exact' })
        .in('device_id', deviceIds)
        .lt('received_at', cutoffTime.toISOString());

      if (deleteError) {
        console.error(`Error deleting history for model ${model.id}:`, deleteError);
        continue;
      }

      const deletedCount = count || 0;
      totalDeleted += deletedCount;

      results.push({
        model: model.nome,
        retention_hours: retentionHours,
        deleted: deletedCount,
      });

      console.log(`  ✅ Deleted ${deletedCount} records for model "${model.nome}"`);
    }

    console.log(`🎉 Cleanup complete! Total deleted: ${totalDeleted} records`);

    return new Response(
      JSON.stringify({
        success: true,
        total_deleted: totalDeleted,
        details: results,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in cleanup-history:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
