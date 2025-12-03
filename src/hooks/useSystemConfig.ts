import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface SystemConfig {
  status_timeout_minutes: number;
}

const DEFAULT_CONFIG: SystemConfig = {
  status_timeout_minutes: 10,
};

export function useSystemConfig() {
  const [config, setConfig] = useState<SystemConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchConfig = async () => {
      const { data, error } = await supabase
        .from("system_config")
        .select("chave, valor");

      if (error) {
        console.error("Erro ao carregar configurações:", error);
        setLoading(false);
        return;
      }

      const configObj: SystemConfig = { ...DEFAULT_CONFIG };
      
      data?.forEach((item: { chave: string; valor: string }) => {
        if (item.chave === "status_timeout_minutes") {
          configObj.status_timeout_minutes = parseInt(item.valor, 10) || DEFAULT_CONFIG.status_timeout_minutes;
        }
      });

      setConfig(configObj);
      setLoading(false);
    };

    fetchConfig();
  }, []);

  return { config, loading };
}

// Função utilitária para calcular se dispositivo está online
export function isDeviceOnline(ultimaConexao: string | null, timeoutMinutes: number): boolean {
  if (!ultimaConexao) return false;
  
  const lastConnection = new Date(ultimaConexao);
  const now = new Date();
  const diffMs = now.getTime() - lastConnection.getTime();
  const diffMinutes = diffMs / (1000 * 60);
  
  return diffMinutes <= timeoutMinutes;
}
