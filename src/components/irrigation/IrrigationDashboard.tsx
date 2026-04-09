import { useState, useEffect, forwardRef, useImperativeHandle, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Wifi, WifiOff, Loader2, AlertCircle, Clock, Database } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useIrrigationMQTT, IrrigationSnapshot } from "@/hooks/useIrrigationMQTT";
import { MQTTStatus } from "@/hooks/useMQTT";
import PanelTab from "./PanelTab";
import TimersTab from "./TimersTab";
import SectorsTab from "./SectorsTab";
import PumpTab from "./PumpTab";
import SystemTab from "./SystemTab";
import LogsTab from "./LogsTab";

interface Device {
  id: string;
  device_id: string;
  nome: string;
  status: string;
}

export interface IrrigationDashboardRef {
  requestRealTimeUpdate: () => Promise<void>;
  mqttStatus: MQTTStatus;
}

interface Props {
  device: Device;
}

const IrrigationDashboard = forwardRef<IrrigationDashboardRef, Props>(({ device }, ref) => {
  const [userType, setUserType] = useState("usuario_final");
  const [isAdmin, setIsAdmin] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const mqtt = useIrrigationMQTT({
    deviceId: device.device_id,
    autoConnect: true,
  });

  // Load user type
  useEffect(() => {
    const loadUserType = async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.user?.id) return;
      const uid = session.session.user.id;
      const { data: profile } = await supabase.from("profiles").select("tipo_usuario").eq("id", uid).single();
      if (profile) setUserType(profile.tipo_usuario);
      const { data: roleData } = await supabase.rpc("has_role", { _user_id: uid, _role: "admin" });
      setIsAdmin(!!roleData);
    };
    loadUserType();
  }, []);

  // Initial data fetch when MQTT connects
  useEffect(() => {
    if (mqtt.mqttStatus === "connected" && initialLoading) {
      const fetchInitial = async () => {
        try {
          await Promise.allSettled([
            mqtt.requestUpdate(),
            mqtt.getFullConfig(),
            mqtt.listSchedules("all"),
          ]);
        } catch {
          // Individual errors handled by toast in tabs
        } finally {
          setInitialLoading(false);
        }
      };
      // Small delay to ensure subscription is ready
      const timer = setTimeout(fetchInitial, 500);
      return () => clearTimeout(timer);
    }
  }, [mqtt.mqttStatus]);

  // After 10s, stop showing initial loading even without response
  useEffect(() => {
    const timer = setTimeout(() => setInitialLoading(false), 10000);
    return () => clearTimeout(timer);
  }, []);

  useImperativeHandle(ref, () => ({
    requestRealTimeUpdate: async () => { await mqtt.requestUpdate(); },
    mqttStatus: mqtt.mqttStatus,
  }));

  const sectorNames: Record<number, string> = {};
  if (mqtt.fullConfig?.sectors) {
    mqtt.fullConfig.sectors.forEach(s => {
      sectorNames[s.index] = s.name;
    });
  }

  const canClearLogs = userType === "instalador" || isAdmin;

  const renderMQTTStatus = () => {
    const configs: Record<MQTTStatus, { icon: typeof Wifi; label: string; variant: "secondary" | "outline" | "default" | "destructive"; animate?: boolean }> = {
      disconnected: { icon: WifiOff, label: "Desconectado", variant: "secondary" },
      connecting: { icon: Loader2, label: "Conectando...", variant: "outline", animate: true },
      connected: { icon: Wifi, label: "Conectado", variant: "default" },
      error: { icon: AlertCircle, label: "Erro", variant: "destructive" },
    };
    const cfg = configs[mqtt.mqttStatus];
    const Icon = cfg.icon;
    return (
      <Badge variant={cfg.variant} className="gap-1">
        <Icon className={`h-3 w-3 ${cfg.animate ? "animate-spin" : ""}`} />
        {cfg.label}
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {renderMQTTStatus()}
        {mqtt.lastSnapshotTime && (
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>Última atualização: {format(mqtt.lastSnapshotTime, "dd/MM/yyyy 'às' HH:mm:ss", { locale: ptBR })}</span>
          </div>
        )}
        {mqtt.isCommandPending && (
          <Badge variant="outline" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Processando...
          </Badge>
        )}
      </div>

      {mqtt.mqttError && (
        <div className="p-3 rounded-lg bg-destructive/10 text-destructive border border-destructive/20 text-sm">
          <AlertCircle className="h-4 w-4 inline mr-1" />
          {mqtt.mqttError}
        </div>
      )}

      <Tabs defaultValue="painel" className="w-full">
        <TabsList className="w-full flex flex-wrap h-auto gap-1">
          <TabsTrigger value="painel">Painel</TabsTrigger>
          <TabsTrigger value="timers">Timers</TabsTrigger>
          <TabsTrigger value="setores">Setores</TabsTrigger>
          <TabsTrigger value="bomba">Bomba</TabsTrigger>
          <TabsTrigger value="sistema">Sistema</TabsTrigger>
          {(canClearLogs || true) && <TabsTrigger value="logs">Logs</TabsTrigger>}
        </TabsList>

        <TabsContent value="painel">
          <PanelTab
            snapshot={mqtt.snapshot}
            isCommandPending={mqtt.isCommandPending}
            onSetMode={async (mode) => { try { await mqtt.setMode(mode); } catch {} }}
            onSetPump={async (on) => { try { await mqtt.setPump(on); } catch {} }}
            onSetSector={async (idx, open) => { try { await mqtt.setSector(idx, open); } catch {} }}
            sectorNames={sectorNames}
          />
        </TabsContent>

        <TabsContent value="timers">
          <TimersTab
            schedules={mqtt.schedules}
            isCommandPending={mqtt.isCommandPending}
            sectorNames={sectorNames}
            onListSchedules={mqtt.listSchedules}
            onAddSchedule={mqtt.addSchedule}
            onUpdateSchedule={mqtt.updateSchedule}
            onDeleteSchedule={mqtt.deleteSchedule}
            onSetScheduleEnabled={mqtt.setScheduleEnabled}
          />
        </TabsContent>

        <TabsContent value="setores">
          <SectorsTab
            snapshot={mqtt.snapshot}
            fullConfig={mqtt.fullConfig}
            isCommandPending={mqtt.isCommandPending}
            onSetSectorization={mqtt.setSectorization}
            onSetSectorEnabled={mqtt.setSectorEnabled}
            onSetSectorName={mqtt.setSectorName}
            onGetFullConfig={mqtt.getFullConfig}
          />
        </TabsContent>

        <TabsContent value="bomba">
          <PumpTab
            fullConfig={mqtt.fullConfig}
            isCommandPending={mqtt.isCommandPending}
            onSetPumpConfig={mqtt.setPumpConfig}
            onGetFullConfig={mqtt.getFullConfig}
          />
        </TabsContent>

        <TabsContent value="sistema">
          <SystemTab
            fullConfig={mqtt.fullConfig}
            isCommandPending={mqtt.isCommandPending}
            userType={userType}
            onSetSystemConfig={mqtt.setSystemConfig}
            onSetRelayConfig={mqtt.setRelayConfig}
            onSetDatetime={mqtt.setDatetime}
            onGetFullConfig={mqtt.getFullConfig}
          />
        </TabsContent>

        <TabsContent value="logs">
          <LogsTab
            logs={mqtt.logs}
            deviceId={device.device_id}
            isCommandPending={mqtt.isCommandPending}
            canClearLogs={canClearLogs}
            onGetLogs={mqtt.getLogs}
            onClearLogs={mqtt.clearLogs}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
});

IrrigationDashboard.displayName = "IrrigationDashboard";
export default IrrigationDashboard;
