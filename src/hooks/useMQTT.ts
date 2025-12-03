import { useState, useEffect, useCallback, useRef } from "react";
import mqtt, { MqttClient } from "mqtt";
import { supabase } from "@/integrations/supabase/client";

export type MQTTStatus = "disconnected" | "connecting" | "connected" | "error";

interface MQTTMessage {
  topic: string;
  payload: Record<string, unknown>;
  timestamp: Date;
}

interface MQTTServerConfig {
  host: string;
  porta: number;
  usuario: string | null;
  senha: string | null;
  usa_ssl: boolean;
}

interface UseMQTTOptions {
  deviceId: string;
  onMessage?: (message: MQTTMessage) => void;
  autoConnect?: boolean;
}

interface UseMQTTReturn {
  status: MQTTStatus;
  lastMessage: MQTTMessage | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  publish: (topic: string, payload: Record<string, unknown>) => void;
  subscribe: (topic: string) => void;
  error: string | null;
}

export function useMQTT({ deviceId, onMessage, autoConnect = true }: UseMQTTOptions): UseMQTTReturn {
  const [status, setStatus] = useState<MQTTStatus>("disconnected");
  const [lastMessage, setLastMessage] = useState<MQTTMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<MqttClient | null>(null);
  const onMessageRef = useRef(onMessage);

  // Manter referência atualizada do callback
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  // Buscar configuração do servidor MQTT via edge function segura
  const fetchMQTTConfig = async (): Promise<MQTTServerConfig | null> => {
    try {
      const { data, error } = await supabase.functions.invoke('get-mqtt-config');

      if (error || !data) {
        console.error("Erro ao buscar configuração MQTT:", error);
        return null;
      }

      // Check if the response contains an error message
      if (data.error) {
        console.error("Erro ao buscar configuração MQTT:", data.error);
        return null;
      }

      return data as MQTTServerConfig;
    } catch (err) {
      console.error("Erro ao buscar configuração MQTT:", err);
      return null;
    }
  };

  const connect = useCallback(async () => {
    if (clientRef.current?.connected) {
      console.log("MQTT já conectado");
      return;
    }

    setStatus("connecting");
    setError(null);

    try {
      const config = await fetchMQTTConfig();
      
      if (!config) {
        setError("Nenhum servidor MQTT configurado");
        setStatus("error");
        return;
      }

      // Construir URL WebSocket
      const protocol = config.usa_ssl ? "wss" : "ws";
      const port = config.porta || (config.usa_ssl ? 8884 : 8083);
      const url = `${protocol}://${config.host}:${port}/mqtt`;

      console.log("🔌 Conectando ao MQTT:", url);

      const options: mqtt.IClientOptions = {
        clientId: `xtconect_${deviceId}_${Date.now()}`,
        clean: true,
        connectTimeout: 10000,
        reconnectPeriod: 5000,
      };

      // Adicionar credenciais se existirem
      if (config.usuario) {
        options.username = config.usuario;
      }
      if (config.senha) {
        options.password = config.senha;
      }

      const client = mqtt.connect(url, options);
      clientRef.current = client;

      client.on("connect", () => {
        console.log("✅ MQTT conectado");
        setStatus("connected");
        setError(null);

        // Normalizar device_id para lowercase para compatibilidade case-insensitive
        const normalizedDeviceId = deviceId.toLowerCase();
        
        // Subscrever nos tópicos do dispositivo
        const dataTopic = `devices/${normalizedDeviceId}/data`;
        const statusTopic = `devices/${normalizedDeviceId}/status`;
        
        client.subscribe([dataTopic, statusTopic], (err) => {
          if (err) {
            console.error("Erro ao subscrever:", err);
          } else {
            console.log("📡 Subscrito em:", dataTopic, statusTopic);
          }
        });
      });

      client.on("message", (topic, message) => {
        try {
          const payloadStr = message.toString();
          console.log("📨 Mensagem recebida:", topic, payloadStr);
          
          const payload = JSON.parse(payloadStr);
          const mqttMessage: MQTTMessage = {
            topic,
            payload,
            timestamp: new Date(),
          };

          setLastMessage(mqttMessage);
          
          if (onMessageRef.current) {
            onMessageRef.current(mqttMessage);
          }
        } catch (err) {
          console.error("Erro ao processar mensagem MQTT:", err);
        }
      });

      client.on("error", (err) => {
        console.error("❌ Erro MQTT:", err);
        setError(err.message);
        setStatus("error");
      });

      client.on("close", () => {
        console.log("🔌 MQTT desconectado");
        setStatus("disconnected");
      });

      client.on("reconnect", () => {
        console.log("🔄 Reconectando MQTT...");
        setStatus("connecting");
      });

    } catch (err) {
      console.error("Erro ao conectar MQTT:", err);
      setError(err instanceof Error ? err.message : "Erro desconhecido");
      setStatus("error");
    }
  }, [deviceId]);

  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.end(true);
      clientRef.current = null;
      setStatus("disconnected");
      console.log("🔌 MQTT desconectado manualmente");
    }
  }, []);

  const publish = useCallback((topic: string, payload: Record<string, unknown>) => {
    if (!clientRef.current?.connected) {
      console.warn("MQTT não conectado, não foi possível publicar");
      return;
    }

    const message = JSON.stringify(payload);
    console.log("📤 Publicando:", topic, message);
    
    clientRef.current.publish(topic, message, { qos: 1 }, (err) => {
      if (err) {
        console.error("Erro ao publicar:", err);
      }
    });
  }, []);

  const subscribe = useCallback((topic: string) => {
    if (!clientRef.current?.connected) {
      console.warn("MQTT não conectado, não foi possível subscrever");
      return;
    }

    clientRef.current.subscribe(topic, (err) => {
      if (err) {
        console.error("Erro ao subscrever:", err);
      } else {
        console.log("📡 Subscrito em:", topic);
      }
    });
  }, []);

  // Auto-conectar se habilitado
  useEffect(() => {
    if (autoConnect && deviceId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, deviceId, connect, disconnect]);

  return {
    status,
    lastMessage,
    connect,
    disconnect,
    publish,
    subscribe,
    error,
  };
}
