import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Settings, Share2, Wifi, WifiOff, RefreshCw } from "lucide-react";
import DynamicDashboard, { DynamicDashboardRef } from "@/components/dashboard/DynamicDashboard";
import IrrigationDashboard, { IrrigationDashboardRef } from "@/components/irrigation/IrrigationDashboard";
import { useSystemConfig, isDeviceOnline } from "@/hooks/useSystemConfig";
import { ThemeToggle } from "@/components/ThemeToggle";

interface Device {
  id: string;
  device_id: string;
  nome: string;
  tipo: string;
  modelo: string | null;
  localizacao: string | null;
  status: string;
  owner_id: string | null;
  device_model_id: string | null;
  ultima_conexao: string | null;
}

interface DeviceModel {
  id: string;
  nome: string;
  fabricante: string;
}

interface DashboardConfig {
  id: string;
  ordem: number;
  direcao: string;
  json_path_receive: string | null;
  json_path_send: string | null;
  mqtt_topic_override: string | null;
  configuracao: Record<string, unknown>;
  titulo_personalizado: string | null;
  tipo_visualizacao: string | null;
  dashboard_component: {
    id: string;
    nome: string;
    tipo: string;
    icone: string | null;
    configuracao_padrao: Record<string, unknown>;
  };
}

export default function DeviceDetail() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const navigate = useNavigate();
  const { config } = useSystemConfig();
  const [device, setDevice] = useState<Device | null>(null);
  const [model, setModel] = useState<DeviceModel | null>(null);
  const [dashboardConfigs, setDashboardConfigs] = useState<DashboardConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [isShared, setIsShared] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const dashboardRef = useRef<DynamicDashboardRef | null>(null);
  const irrigationRef = useRef<IrrigationDashboardRef | null>(null);

  const isIrrigationModel = model?.nome === "XT Automatize Irrigacao";

  const handleRealTimeUpdate = async () => {
    if (!device) return;
    
    const activeRef = isIrrigationModel ? irrigationRef.current : dashboardRef.current;
    
    if (activeRef?.mqttStatus !== "connected") {
      toast.error("Não conectado ao MQTT. Aguarde a conexão...");
      return;
    }
    
    setIsRefreshing(true);
    toast.info("Solicitando atualização em tempo real...");
    
    try {
      await activeRef.requestRealTimeUpdate();
      toast.success("Comando enviado! Aguardando resposta do dispositivo...");
    } catch (error) {
      toast.error("Erro ao solicitar atualização");
    } finally {
      setTimeout(() => setIsRefreshing(false), 2000);
    }
  };

  useEffect(() => {
    if (deviceId) {
      fetchDevice();
    }
  }, [deviceId]);

  const fetchDevice = async () => {
    try {
      const { data: session } = await supabase.auth.getSession();
      const currentUserId = session?.session?.user?.id;

      // Buscar dispositivo
      const { data: deviceData, error: deviceError } = await supabase
        .from("devices")
        .select("id, device_id, nome, tipo, modelo, localizacao, status, owner_id, usuario_id, device_model_id, ultima_conexao")
        .eq("id", deviceId)
        .maybeSingle();

      if (deviceError || !deviceData) {
        toast.error("Dispositivo não encontrado");
        navigate("/dashboard");
        return;
      }

      setDevice(deviceData);
      setIsOwner(deviceData.owner_id === currentUserId || deviceData.usuario_id === currentUserId);

      // Verificar se é compartilhado
      const { data: shareData } = await supabase
        .from("device_shares")
        .select("id")
        .eq("device_id", deviceId)
        .eq("shared_with_user_id", currentUserId)
        .maybeSingle();

      setIsShared(!!shareData);

      // Buscar modelo se existir
      if (deviceData.device_model_id) {
        const { data: modelData } = await supabase
          .from("device_models")
          .select("id, nome, fabricante")
          .eq("id", deviceData.device_model_id)
          .single();

        if (modelData) {
          setModel(modelData);
          
          // Buscar configurações de dashboard do modelo
          const { data: dashConfigs } = await supabase
            .from("device_model_dashboards")
            .select(`
              id,
              ordem,
              direcao,
              json_path_receive,
              json_path_send,
              mqtt_topic_override,
              configuracao,
              titulo_personalizado,
              tipo_visualizacao,
              dashboard_components (
                id,
                nome,
                tipo,
                icone,
                configuracao_padrao
              )
            `)
            .eq("device_model_id", deviceData.device_model_id)
            .eq("ativo", true)
            .order("ordem");

          if (dashConfigs) {
            const formattedConfigs = dashConfigs.map(config => ({
              ...config,
              configuracao: config.configuracao as Record<string, unknown>,
              dashboard_component: {
                ...config.dashboard_components,
                configuracao_padrao: config.dashboard_components?.configuracao_padrao as Record<string, unknown>
              }
            })) as unknown as DashboardConfig[];
            setDashboardConfigs(formattedConfigs);
          }
        }
      }
    } catch (err) {
      console.error(err);
      toast.error("Erro ao carregar dispositivo");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!device) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-2 sm:px-4 py-2 sm:py-4">
          {/* Row 1: Back + Title + Action buttons */}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 sm:h-9 sm:w-9" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
            </Button>
            
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-lg md:text-xl font-bold truncate">{device.nome}</h1>
                {isShared && (
                  <Badge variant="secondary" className="gap-1 shrink-0 text-[10px] sm:text-xs">
                    <Share2 className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                    <span className="hidden sm:inline">Compartilhado</span>
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1 text-[10px] sm:text-xs text-muted-foreground">
                <span className="font-mono truncate max-w-[80px] sm:max-w-[120px] md:max-w-none">{device.device_id}</span>
                {model && (
                  <>
                    <span>•</span>
                    <span className="truncate max-w-[80px] sm:max-w-none">{model.nome}</span>
                  </>
                )}
              </div>
            </div>

            {/* Actions - compact on mobile */}
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <Button 
                variant="outline" 
                size="icon"
                onClick={handleRealTimeUpdate}
                disabled={isRefreshing}
                className="h-8 w-8 sm:h-9 sm:w-auto sm:px-3"
              >
                <RefreshCw className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline ml-1.5">{isRefreshing ? "Atualizando..." : "Atualizar"}</span>
              </Button>
              <Badge 
                variant={isDeviceOnline(device.ultima_conexao, config.status_timeout_minutes) ? "default" : "secondary"} 
                className="gap-1 text-[10px] sm:text-xs px-1.5 sm:px-2"
              >
                {isDeviceOnline(device.ultima_conexao, config.status_timeout_minutes) ? (
                  <Wifi className="h-3 w-3" />
                ) : (
                  <WifiOff className="h-3 w-3" />
                )}
                <span className="hidden sm:inline">{isDeviceOnline(device.ultima_conexao, config.status_timeout_minutes) ? "Online" : "Offline"}</span>
              </Badge>
              <ThemeToggle />
              {isOwner && (
                <Button variant="outline" size="icon" className="h-8 w-8 sm:h-9 sm:w-9" onClick={() => navigate(`/devices/${deviceId}/settings`)}>
                  <Settings className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {isIrrigationModel ? (
          <IrrigationDashboard
            ref={irrigationRef}
            device={device}
          />
        ) : dashboardConfigs.length > 0 ? (
          <DynamicDashboard
            ref={dashboardRef}
            device={device}
            dashboardConfigs={dashboardConfigs}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Dashboard</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12 text-muted-foreground">
                <p>Este modelo de dispositivo não possui componentes de dashboard configurados.</p>
                <p className="text-sm mt-2">
                  Entre em contato com o administrador para configurar os componentes.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
