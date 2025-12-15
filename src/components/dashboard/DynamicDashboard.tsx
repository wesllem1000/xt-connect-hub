import { useState, useEffect, forwardRef, useImperativeHandle, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
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
import TextValueComponent from "./components/TextValueComponent";
import TemperatureComponent from "./components/TemperatureComponent";
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

  // Função para atualizar ultima_conexao no banco
  const updateLastConnection = useCallback(async () => {
    const { error } = await supabase
      .from("devices")
      .update({ ultima_conexao: new Date().toISOString(), status: "online" })
      .eq("id", device.id);
    
    if (error) {
      console.error("Erro ao atualizar ultima_conexao:", error);
    }
  }, [device.id]);

  // Hook de conexão MQTT
  const { status: mqttStatus, publish, error: mqttError } = useMQTT({
    deviceId: device.device_id,
    autoConnect: true,
    onMessage: useCallback((message) => {
      console.log("📨 Processando mensagem:", message);
      
      // Verificar se a mensagem é do dispositivo correto (comparação direta - UPPERCASE)
      const payloadDeviceId = String(message.payload.device_id || "");
      const expectedDeviceId = device.device_id || "";
      
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
      
      // Atualizar ultima_conexao no banco de dados
      updateLastConnection();
    }, [device.device_id, dashboardConfigs, updateLastConnection])
  });

  // Comando padrão para solicitar atualização em tempo real
  const requestRealTimeUpdate = async (): Promise<void> => {
    const message = {
      device_id: device.device_id,
      command: "request_update",
      timestamp: new Date().toISOString()
    };
    
    console.log("📡 Enviando comando request_update:", message);
    publish(`devices/${device.device_id}/commands`, message);
    
    // Aguardar um pouco para dar tempo da mensagem ser enviada
    await new Promise(resolve => setTimeout(resolve, 100));
  };

  // Expor funções via ref
  useImperativeHandle(ref, () => ({
    requestRealTimeUpdate,
    mqttStatus
  }));

  const validateCommandValue = (value: unknown, config: DashboardConfig): { valid: boolean; sanitizedValue: unknown; error?: string } => {
    const componentConfig = {
      ...config.dashboard_component.configuracao_padrao,
      ...config.configuracao
    };
    const tipo = config.dashboard_component.tipo;

    // Validate based on component type
    if (tipo === "controle_switch") {
      if (typeof value !== "boolean") {
        return { valid: false, sanitizedValue: null, error: "Valor inválido para switch" };
      }
      return { valid: true, sanitizedValue: value };
    }

    if (tipo === "controle_slider") {
      if (typeof value !== "number" || isNaN(value)) {
        return { valid: false, sanitizedValue: null, error: "Valor numérico inválido" };
      }
      const min = typeof componentConfig.min === "number" ? componentConfig.min : 0;
      const max = typeof componentConfig.max === "number" ? componentConfig.max : 100;
      const clampedValue = Math.max(min, Math.min(max, value));
      return { valid: true, sanitizedValue: clampedValue };
    }

    if (tipo === "controle_botao") {
      // Buttons always send true
      return { valid: true, sanitizedValue: true };
    }

    if (tipo === "controle_input") {
      if (typeof value !== "string") {
        return { valid: false, sanitizedValue: null, error: "Valor deve ser texto" };
      }
      // Limit string length and sanitize
      const sanitized = String(value).substring(0, 500).trim();
      return { valid: true, sanitizedValue: sanitized };
    }

    // For other types, ensure basic type safety
    if (value === null || value === undefined) {
      return { valid: false, sanitizedValue: null, error: "Valor não pode ser vazio" };
    }

    return { valid: true, sanitizedValue: value };
  };

  const validateTopic = (topic: string): boolean => {
    // Topic must follow device topic pattern
    const validTopicPattern = /^devices\/[A-Z0-9-]+\/commands$/;
    return validTopicPattern.test(topic);
  };

  const handleSendCommand = (config: DashboardConfig, value: unknown) => {
    // Validate the topic
    const topic = config.mqtt_topic_override || `devices/${device.device_id}/commands`;
    
    // Only allow default topic pattern for security - reject custom overrides
    const expectedTopic = `devices/${device.device_id}/commands`;
    if (config.mqtt_topic_override && config.mqtt_topic_override !== expectedTopic) {
      console.warn("⚠️ Tópico customizado bloqueado por segurança:", config.mqtt_topic_override);
      // Use default topic instead of custom override
    }
    const safeTopic = expectedTopic;

    // Validate and sanitize the value
    const validation = validateCommandValue(value, config);
    if (!validation.valid) {
      console.error("❌ Validação falhou:", validation.error);
      return;
    }

    // Validate json_path_send (command name)
    const commandName = config.json_path_send;
    if (!commandName || typeof commandName !== "string" || commandName.length > 100) {
      console.error("❌ Nome do comando inválido");
      return;
    }
    // Sanitize command name - only allow alphanumeric, underscores, dots
    const safeCommandName = commandName.replace(/[^a-zA-Z0-9_.\-]/g, "");

    const message = {
      device_id: device.device_id,
      command: safeCommandName,
      value: validation.sanitizedValue,
      timestamp: new Date().toISOString()
    };
    
    if (import.meta.env.DEV) {
      console.log("📤 Enviando comando MQTT:", safeTopic, message);
    }
    publish(safeTopic, message);
    
    // Atualizar valor local para feedback imediato
    setValues(prev => ({ ...prev, [config.id]: validation.sanitizedValue }));
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
    const label = config.titulo_personalizado || config.dashboard_component.nome;
    const tipoVisualizacao = config.tipo_visualizacao || "padrao";

    // Para sensores, verificar qual visualização usar
    if (tipo.startsWith("sensor_") || tipo === "indicador_gauge") {
      // Para sensor de temperatura, usar componente especializado
      if (tipo === "sensor_temperatura" && tipoVisualizacao === "padrao") {
        return (
          <TemperatureComponent
            label={label}
            value={value as number}
            config={componentConfig}
          />
        );
      }
      
      switch (tipoVisualizacao) {
        case "gauge":
          return (
            <GaugeComponent
              label={label}
              value={value as number}
              config={componentConfig}
            />
          );
        case "texto":
          return (
            <TextValueComponent
              label={label}
              value={value}
              config={componentConfig}
            />
          );
        case "temperatura":
          return (
            <TemperatureComponent
              label={label}
              value={value as number}
              config={componentConfig}
            />
          );
        case "padrao":
        default:
          if (tipo === "indicador_gauge") {
            return (
              <GaugeComponent
                label={label}
                value={value as number}
                config={componentConfig}
              />
            );
          }
          return (
            <SensorComponent
              label={label}
              value={value as number}
              config={componentConfig}
              tipo={tipo}
            />
          );
      }
    }

    switch (tipo) {
      case "indicador_texto":
        return (
          <TextValueComponent
            label={label}
            value={value}
            config={componentConfig}
          />
        );

      case "controle_slider":
        return (
          <SliderComponent
            label={label}
            value={value as number}
            config={componentConfig}
            disabled={!canSend}
            onChange={(val) => handleSendCommand(config, val)}
          />
        );

      case "controle_switch":
        return (
          <SwitchComponent
            label={label}
            value={value as boolean}
            config={componentConfig}
            disabled={!canSend}
            onChange={(val) => handleSendCommand(config, val)}
          />
        );

      case "controle_botao":
        return (
          <ButtonComponent
            label={label}
            config={componentConfig}
            disabled={!canSend}
            onClick={() => handleSendCommand(config, true)}
          />
        );

      case "indicador_led":
        return (
          <LEDComponent
            label={label}
            value={value as boolean}
            config={componentConfig}
          />
        );

      case "indicador_status":
        return (
          <StatusComponent
            label={label}
            value={value as string | boolean}
            config={componentConfig}
          />
        );

      case "controle_input":
        return (
          <InputComponent
            label={label}
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
