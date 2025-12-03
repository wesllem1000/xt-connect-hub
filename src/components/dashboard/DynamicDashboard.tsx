import { useState, useEffect, forwardRef, useImperativeHandle, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useMQTT, MQTTStatus } from "@/hooks/useMQTT";
import { getValueByPath } from "@/lib/jsonPath";
import GaugeComponent from "./components/GaugeComponent";
import SliderComponent from "./components/SliderComponent";
import SwitchComponent from "./components/SwitchComponent";
import ButtonComponent from "./components/ButtonComponent";
import LEDComponent from "./components/LEDComponent";
import StatusComponent from "./components/StatusComponent";
import InputComponent from "./components/InputComponent";
import SensorComponent from "./components/SensorComponent";
import { Wifi, WifiOff, Loader2, AlertCircle, Clock } from "lucide-react";

interface Device {
  id: string;
  device_id: string;
  nome: string;
  status: string;
}

interface DashboardConfig {
  id: string;
  ordem: number;
  direcao: string;
  json_path_receive: string | null;
  json_path_send: string | null;
  mqtt_topic_override: string | null;
  configuracao: Record<string, unknown>;
  dashboard_component: {
    id: string;
    nome: string;
    tipo: string;
    icone: string | null;
    configuracao_padrao: Record<string, unknown>;
  };
}

interface Props {
  device: Device;
  dashboardConfigs: DashboardConfig[];
}

export interface DynamicDashboardRef {
  requestRealTimeUpdate: () => Promise<void>;
  mqttStatus: MQTTStatus;
}

const DynamicDashboard = forwardRef<DynamicDashboardRef, Props>(({ device, dashboardConfigs }, ref) => {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Hook de conexão MQTT
  const { status: mqttStatus, publish, error: mqttError } = useMQTT({
    deviceId: device.device_id,
    autoConnect: true,
    onMessage: useCallback((message) => {
      console.log("📨 Processando mensagem:", message);
      
      // Verificar se a mensagem é do dispositivo correto (comparação case-insensitive)
      const payloadDeviceId = String(message.payload.device_id || "").toLowerCase();
      const expectedDeviceId = (device.device_id || "").toLowerCase();
      
      if (message.payload.device_id && payloadDeviceId !== expectedDeviceId) {
        console.log(`⚠️ Device ID não corresponde: recebido "${payloadDeviceId}", esperado "${expectedDeviceId}"`);
        return;
      }

      // Atualizar valores baseado nos json_path configurados
      setValues(prev => {
        const newValues = { ...prev };
        
        dashboardConfigs.forEach(config => {
          if (config.json_path_receive && (config.direcao === "receive" || config.direcao === "both")) {
            const value = getValueByPath(message.payload, config.json_path_receive);
            if (value !== undefined) {
              newValues[config.id] = value;
              console.log(`📊 ${config.dashboard_component.nome}: ${value}`);
            }
          }
        });

        return newValues;
      });

      setLastUpdate(new Date());
    }, [device.device_id, dashboardConfigs])
  });

  // Comando padrão para solicitar atualização em tempo real
  const requestRealTimeUpdate = async (): Promise<void> => {
    const normalizedDeviceId = device.device_id.toLowerCase();
    const message = {
      device_id: normalizedDeviceId,
      command: "request_update",
      timestamp: new Date().toISOString()
    };
    
    console.log("📡 Enviando comando request_update:", message);
    publish(`devices/${normalizedDeviceId}/commands`, message);
    
    // Aguardar um pouco para dar tempo da mensagem ser enviada
    await new Promise(resolve => setTimeout(resolve, 100));
  };

  // Expor funções via ref
  useImperativeHandle(ref, () => ({
    requestRealTimeUpdate,
    mqttStatus
  }));

  const handleSendCommand = (config: DashboardConfig, value: unknown) => {
    const normalizedDeviceId = device.device_id.toLowerCase();
    const topic = config.mqtt_topic_override || `devices/${normalizedDeviceId}/commands`;
    const message = {
      device_id: normalizedDeviceId,
      command: config.json_path_send,
      value: value,
      timestamp: new Date().toISOString()
    };
    
    console.log("📤 Enviando comando MQTT:", topic, message);
    publish(topic, message);
    
    // Atualizar valor local para feedback imediato
    setValues(prev => ({ ...prev, [config.id]: value }));
  };

  const getValue = (config: DashboardConfig): unknown => {
    return values[config.id];
  };

  const renderMQTTStatus = () => {
    const statusConfig: Record<MQTTStatus, { icon: typeof Wifi; label: string; variant: "secondary" | "outline" | "default" | "destructive"; animate?: boolean }> = {
      disconnected: { icon: WifiOff, label: "Desconectado", variant: "secondary" },
      connecting: { icon: Loader2, label: "Conectando...", variant: "outline", animate: true },
      connected: { icon: Wifi, label: "Conectado", variant: "default" },
      error: { icon: AlertCircle, label: "Erro", variant: "destructive" },
    };

    const config = statusConfig[mqttStatus];
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="gap-1">
        <Icon className={`h-3 w-3 ${config.animate ? "animate-spin" : ""}`} />
        {config.label}
      </Badge>
    );
  };

  const formatLastUpdate = () => {
    if (!lastUpdate) return null;
    
    const now = new Date();
    const diff = Math.floor((now.getTime() - lastUpdate.getTime()) / 1000);
    
    if (diff < 60) return `há ${diff}s`;
    if (diff < 3600) return `há ${Math.floor(diff / 60)}min`;
    return `há ${Math.floor(diff / 3600)}h`;
  };

  const renderComponent = (config: DashboardConfig) => {
    const tipo = config.dashboard_component.tipo;
    const componentConfig = {
      ...config.dashboard_component.configuracao_padrao,
      ...config.configuracao
    };
    const value = getValue(config);
    const canSend = config.direcao === "send" || config.direcao === "both";

    switch (tipo) {
      case "sensor_tensao":
      case "sensor_temperatura":
      case "sensor_umidade":
      case "sensor_corrente":
      case "sensor_generico":
        return (
          <SensorComponent
            label={config.dashboard_component.nome}
            value={value as number}
            config={componentConfig}
            tipo={tipo}
          />
        );

      case "indicador_gauge":
        return (
          <GaugeComponent
            label={config.dashboard_component.nome}
            value={value as number}
            config={componentConfig}
          />
        );

      case "controle_slider":
        return (
          <SliderComponent
            label={config.dashboard_component.nome}
            value={value as number}
            config={componentConfig}
            disabled={!canSend}
            onChange={(val) => handleSendCommand(config, val)}
          />
        );

      case "controle_switch":
        return (
          <SwitchComponent
            label={config.dashboard_component.nome}
            value={value as boolean}
            config={componentConfig}
            disabled={!canSend}
            onChange={(val) => handleSendCommand(config, val)}
          />
        );

      case "controle_botao":
        return (
          <ButtonComponent
            label={config.dashboard_component.nome}
            config={componentConfig}
            disabled={!canSend}
            onClick={() => handleSendCommand(config, true)}
          />
        );

      case "indicador_led":
        return (
          <LEDComponent
            label={config.dashboard_component.nome}
            value={value as boolean}
            config={componentConfig}
          />
        );

      case "indicador_status":
        return (
          <StatusComponent
            label={config.dashboard_component.nome}
            value={value as string | boolean}
            config={componentConfig}
          />
        );

      case "controle_input":
        return (
          <InputComponent
            label={config.dashboard_component.nome}
            value={value as string}
            config={componentConfig}
            disabled={!canSend}
            onChange={(val) => handleSendCommand(config, val)}
          />
        );

      default:
        return (
          <div className="text-center text-muted-foreground">
            Componente não suportado: {tipo}
          </div>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Status da Conexão MQTT */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Conexão MQTT</CardTitle>
            <div className="flex items-center gap-2">
              {lastUpdate && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Última atualização: {formatLastUpdate()}
                </span>
              )}
              {renderMQTTStatus()}
            </div>
          </div>
        </CardHeader>
        {mqttError && (
          <CardContent className="pt-0">
            <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
              {mqttError}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Card de Documentação */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Padrão de Comunicação MQTT</CardTitle>
            <Badge variant="outline" className="text-xs">Documentação</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="p-3 bg-muted rounded-lg font-mono text-xs">
            <p className="text-muted-foreground mb-1">// Tópico para enviar dados do dispositivo:</p>
            <p className="text-primary">devices/{device.device_id}/data</p>
          </div>
          <div className="p-3 bg-muted rounded-lg font-mono text-xs">
            <p className="text-muted-foreground mb-1">// Tópico para receber comandos:</p>
            <p className="text-primary">devices/{device.device_id}/commands</p>
          </div>
          <div className="p-3 bg-muted rounded-lg font-mono text-xs">
            <p className="text-muted-foreground mb-1">// Formato de mensagem de dados:</p>
            <p>{"{"} "device_id": "{device.device_id}", "data": {"{"} "temperatura": 25.5 {"}"} {"}"}</p>
          </div>
          <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg font-mono text-xs">
            <p className="text-primary font-semibold mb-1">// Comando padrão: request_update</p>
            <p>{"{"} "device_id": "{device.device_id}", "command": "request_update" {"}"}</p>
          </div>
        </CardContent>
      </Card>

      {/* Grid de Componentes */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {dashboardConfigs.map((config) => (
          <Card key={config.id} className="overflow-hidden">
            <CardContent className="p-4">
              {renderComponent(config)}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
});

DynamicDashboard.displayName = "DynamicDashboard";

export default DynamicDashboard;
