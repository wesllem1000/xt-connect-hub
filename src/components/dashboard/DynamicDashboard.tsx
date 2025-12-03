import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import GaugeComponent from "./components/GaugeComponent";
import SliderComponent from "./components/SliderComponent";
import SwitchComponent from "./components/SwitchComponent";
import ButtonComponent from "./components/ButtonComponent";
import LEDComponent from "./components/LEDComponent";
import StatusComponent from "./components/StatusComponent";
import InputComponent from "./components/InputComponent";
import SensorComponent from "./components/SensorComponent";

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
}

// Dados simulados para demonstração
const mockData: Record<string, number | string | boolean> = {
  tensao: 220.5,
  temperatura: 25.3,
  umidade: 65,
  corrente: 2.5,
  status: true,
  nivel: 75
};

const DynamicDashboard = forwardRef<DynamicDashboardRef, Props>(({ device, dashboardConfigs }, ref) => {
  const [values, setValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    // Inicializar com dados mock
    // Na implementação real, aqui entraria a conexão MQTT
    const initialValues: Record<string, unknown> = {};
    dashboardConfigs.forEach(config => {
      if (config.json_path_receive) {
        const pathKey = config.json_path_receive.replace(/\./g, "_");
        initialValues[pathKey] = mockData[config.json_path_receive] ?? 0;
      }
    });
    setValues(initialValues);
  }, [dashboardConfigs]);

  // Comando padrão para solicitar atualização em tempo real
  const requestRealTimeUpdate = async (): Promise<void> => {
    const message = {
      device_id: device.device_id,
      command: "request_update",
      timestamp: new Date().toISOString()
    };
    
    console.log("📡 Enviando comando request_update:", message);
    // Aqui seria a implementação real de envio MQTT
    // mqtt.publish(`devices/${device.device_id}/commands`, JSON.stringify(message));
    
    // Simular delay de rede
    await new Promise(resolve => setTimeout(resolve, 500));
  };

  // Expor função via ref
  useImperativeHandle(ref, () => ({
    requestRealTimeUpdate
  }));

  const handleSendCommand = (config: DashboardConfig, value: unknown) => {
    // Formatar mensagem MQTT
    const message = {
      device_id: device.device_id,
      command: config.json_path_send,
      value: value
    };
    
    console.log("Enviando comando MQTT:", message);
    // Aqui seria a implementação real de envio MQTT
    
    // Atualizar valor local para feedback
    if (config.json_path_send) {
      const pathKey = config.json_path_send.replace(/\./g, "_");
      setValues(prev => ({ ...prev, [pathKey]: value }));
    }
  };

  const getValue = (config: DashboardConfig): unknown => {
    if (config.json_path_receive) {
      const pathKey = config.json_path_receive.replace(/\./g, "_");
      return values[pathKey];
    }
    if (config.json_path_send) {
      const pathKey = config.json_path_send.replace(/\./g, "_");
      return values[pathKey];
    }
    return undefined;
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

      case "gauge":
        return (
          <GaugeComponent
            label={config.dashboard_component.nome}
            value={value as number}
            config={componentConfig}
          />
        );

      case "slider":
        return (
          <SliderComponent
            label={config.dashboard_component.nome}
            value={value as number}
            config={componentConfig}
            disabled={!canSend}
            onChange={(val) => handleSendCommand(config, val)}
          />
        );

      case "switch":
        return (
          <SwitchComponent
            label={config.dashboard_component.nome}
            value={value as boolean}
            config={componentConfig}
            disabled={!canSend}
            onChange={(val) => handleSendCommand(config, val)}
          />
        );

      case "botao":
        return (
          <ButtonComponent
            label={config.dashboard_component.nome}
            config={componentConfig}
            disabled={!canSend}
            onClick={() => handleSendCommand(config, true)}
          />
        );

      case "led":
        return (
          <LEDComponent
            label={config.dashboard_component.nome}
            value={value as boolean}
            config={componentConfig}
          />
        );

      case "status":
        return (
          <StatusComponent
            label={config.dashboard_component.nome}
            value={value as string | boolean}
            config={componentConfig}
          />
        );

      case "input":
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
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Padrão de Comunicação MQTT</CardTitle>
            <Badge variant="outline" className="text-xs">Documentação</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="p-3 bg-muted rounded-lg font-mono text-xs">
            <p className="text-muted-foreground mb-1">// Formato de mensagem recebida do dispositivo:</p>
            <p>{"{"} "device_id": "{device.device_id}", "data": {"{"} ... {"}"} {"}"}</p>
          </div>
          <div className="p-3 bg-muted rounded-lg font-mono text-xs">
            <p className="text-muted-foreground mb-1">// Formato de comando enviado ao dispositivo:</p>
            <p>{"{"} "device_id": "{device.device_id}", "command": "...", "value": ... {"}"}</p>
          </div>
          <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg font-mono text-xs">
            <p className="text-primary font-semibold mb-1">// Comando padrão: request_update (Atualização em Tempo Real)</p>
            <p className="text-muted-foreground mb-1">// Solicita ao dispositivo que envie todos os dados atuais imediatamente</p>
            <p>{"{"} "device_id": "{device.device_id}", "command": "request_update", "timestamp": "ISO_DATE" {"}"}</p>
          </div>
        </CardContent>
      </Card>

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
