import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Copy, Check, Server, FileCode, Wifi, ArrowDownUp, RefreshCw } from "lucide-react";
import AdminLayout from "./AdminLayout";

interface MqttServer {
  id: string;
  nome: string;
  host: string;
  porta: number;
  usa_ssl: boolean;
  usuario: string | null;
  topico_padrao: string | null;
}

export default function AdminDocumentacao() {
  const [mqttServers, setMqttServers] = useState<MqttServer[]>([]);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  useEffect(() => {
    fetchMqttServers();
  }, []);

  const fetchMqttServers = async () => {
    const { data } = await supabase
      .from("mqtt_servers")
      .select("id, nome, host, porta, usa_ssl, usuario, topico_padrao")
      .eq("ativo", true);
    
    if (data) setMqttServers(data);
  };

  const copyToClipboard = async (text: string, section: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedSection(section);
    toast.success("Copiado para a área de transferência!");
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const generateFullDocumentation = () => {
    const serverInfo = mqttServers.length > 0 
      ? mqttServers.map(s => `
Servidor: ${s.nome}
  Host: ${s.host}
  Porta: ${s.porta}
  SSL/TLS: ${s.usa_ssl ? "Sim" : "Não"}
  ${s.usuario ? `Usuário: ${s.usuario}` : "Autenticação: Não requerida"}
  ${s.topico_padrao ? `Tópico Padrão: ${s.topico_padrao}` : ""}
`).join("\n")
      : "Nenhum servidor MQTT cadastrado.";

    return `
================================================================================
                    XT CONECT - DOCUMENTAÇÃO DE INTEGRAÇÃO
                         Padrões de Comunicação MQTT
================================================================================

1. VISÃO GERAL
--------------------------------------------------------------------------------
A plataforma XT CONECT utiliza o protocolo MQTT para comunicação bidirecional
com dispositivos IoT. Este documento descreve os padrões de implementação que
devem ser seguidos pelos dispositivos para garantir compatibilidade.

2. SERVIDORES MQTT CADASTRADOS
--------------------------------------------------------------------------------
${serverInfo}

3. ESTRUTURA DE TÓPICOS
--------------------------------------------------------------------------------
Os dispositivos devem utilizar a seguinte estrutura de tópicos:

  • Receber comandos:  devices/{DEVICE_ID}/commands
  • Enviar dados:      devices/{DEVICE_ID}/data
  • Status:            devices/{DEVICE_ID}/status

Onde {DEVICE_ID} é o identificador único do dispositivo cadastrado na plataforma.

4. FORMATO DE MENSAGENS
--------------------------------------------------------------------------------

4.1 MENSAGEM DE DADOS (Dispositivo → Plataforma)
------------------------------------------------
O dispositivo deve enviar seus dados no seguinte formato JSON:

{
  "device_id": "DEVICE_ID",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "temperatura": 25.5,
    "umidade": 65,
    "tensao": 220.3,
    "corrente": 2.1
    // ... outros campos conforme o modelo do dispositivo
  }
}

Campos obrigatórios:
  • device_id: String - Identificador único do dispositivo
  • data: Object - Objeto contendo os valores dos sensores/atuadores

Campos opcionais:
  • timestamp: String ISO 8601 - Data/hora da leitura (se não enviado, usa hora do servidor)

4.2 MENSAGEM DE COMANDO (Plataforma → Dispositivo)
--------------------------------------------------
A plataforma envia comandos no seguinte formato:

{
  "device_id": "DEVICE_ID",
  "command": "nome_do_comando",
  "value": <valor>,
  "timestamp": "2024-01-15T10:30:00Z"
}

Exemplos de comandos:
  • Ligar/Desligar: { "command": "power", "value": true }
  • Ajustar valor:  { "command": "setpoint", "value": 75 }
  • Configuração:   { "command": "config", "value": { "interval": 60 } }

5. COMANDO PADRÃO: request_update
--------------------------------------------------------------------------------
Todos os dispositivos DEVEM implementar o comando "request_update".

Quando recebido, o dispositivo deve imediatamente enviar todos os seus dados
atuais para a plataforma, independente do intervalo de envio configurado.

Formato do comando recebido:
{
  "device_id": "DEVICE_ID",
  "command": "request_update",
  "timestamp": "2024-01-15T10:30:00Z"
}

Resposta esperada do dispositivo:
{
  "device_id": "DEVICE_ID",
  "timestamp": "2024-01-15T10:30:01Z",
  "data": {
    // todos os dados atuais do dispositivo
  }
}

6. MENSAGEM DE STATUS
--------------------------------------------------------------------------------
O dispositivo deve publicar seu status de conexão:

Ao conectar (Last Will Testament - LWT):
{
  "device_id": "DEVICE_ID",
  "status": "online",
  "timestamp": "2024-01-15T10:30:00Z"
}

Configurar LWT para quando desconectar:
{
  "device_id": "DEVICE_ID",
  "status": "offline",
  "timestamp": "2024-01-15T10:30:00Z"
}

7. INTERVALO DE ENVIO DE DADOS
--------------------------------------------------------------------------------
  • Recomendado: 30 segundos a 5 minutos (configurável por modelo)
  • Mínimo: 10 segundos (para evitar sobrecarga do servidor)
  • O comando request_update força envio imediato independente do intervalo

8. QUALIDADE DE SERVIÇO (QoS)
--------------------------------------------------------------------------------
  • Dados de sensores: QoS 0 (at most once) - para dados frequentes
  • Comandos: QoS 1 (at least once) - para garantir entrega
  • Status: QoS 1 com retain flag ativada

9. EXEMPLO DE IMPLEMENTAÇÃO (Arduino/ESP32)
--------------------------------------------------------------------------------
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

const char* DEVICE_ID = "seu_device_id";
const char* MQTT_SERVER = "${mqttServers[0]?.host || "mqtt.seuservidor.com"}";
const int MQTT_PORT = ${mqttServers[0]?.porta || 1883};

// Tópicos
String topicCommands = "devices/" + String(DEVICE_ID) + "/commands";
String topicData = "devices/" + String(DEVICE_ID) + "/data";
String topicStatus = "devices/" + String(DEVICE_ID) + "/status";

void callback(char* topic, byte* payload, unsigned int length) {
  StaticJsonDocument<256> doc;
  deserializeJson(doc, payload, length);
  
  const char* command = doc["command"];
  
  if (strcmp(command, "request_update") == 0) {
    // Enviar todos os dados atuais imediatamente
    sendCurrentData();
  }
  // Processar outros comandos...
}

void sendCurrentData() {
  StaticJsonDocument<512> doc;
  doc["device_id"] = DEVICE_ID;
  doc["timestamp"] = getISOTimestamp();
  
  JsonObject data = doc.createNestedObject("data");
  data["temperatura"] = readTemperature();
  data["umidade"] = readHumidity();
  // Adicionar outros sensores...
  
  char buffer[512];
  serializeJson(doc, buffer);
  client.publish(topicData.c_str(), buffer);
}

================================================================================
                              FIM DA DOCUMENTAÇÃO
================================================================================
`;
  };

  const CopyButton = ({ text, section }: { text: string; section: string }) => (
    <Button
      variant="outline"
      size="sm"
      onClick={() => copyToClipboard(text, section)}
      className="gap-2"
    >
      {copiedSection === section ? (
        <>
          <Check className="h-4 w-4 text-green-500" />
          Copiado!
        </>
      ) : (
        <>
          <Copy className="h-4 w-4" />
          Copiar
        </>
      )}
    </Button>
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Documentação de Integração</h2>
            <p className="text-muted-foreground">
              Padrões de comunicação MQTT para dispositivos XT CONECT
            </p>
          </div>
          <Button 
            onClick={() => copyToClipboard(generateFullDocumentation(), "full")}
            className="gap-2"
          >
            {copiedSection === "full" ? (
              <>
                <Check className="h-4 w-4" />
                Documentação Copiada!
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Copiar Documentação Completa
              </>
            )}
          </Button>
        </div>

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="grid grid-cols-5 w-full max-w-2xl">
            <TabsTrigger value="overview">Visão Geral</TabsTrigger>
            <TabsTrigger value="messages">Mensagens</TabsTrigger>
            <TabsTrigger value="commands">Comandos</TabsTrigger>
            <TabsTrigger value="servers">Servidores</TabsTrigger>
            <TabsTrigger value="example">Exemplo</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wifi className="h-5 w-5" />
                  Protocolo de Comunicação
                </CardTitle>
                <CardDescription>
                  Visão geral da arquitetura de comunicação
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="p-4 rounded-lg bg-muted">
                    <h4 className="font-semibold mb-2">Protocolo</h4>
                    <Badge>MQTT 3.1.1</Badge>
                  </div>
                  <div className="p-4 rounded-lg bg-muted">
                    <h4 className="font-semibold mb-2">Formato de Dados</h4>
                    <Badge variant="secondary">JSON</Badge>
                  </div>
                  <div className="p-4 rounded-lg bg-muted">
                    <h4 className="font-semibold mb-2">Encoding</h4>
                    <Badge variant="outline">UTF-8</Badge>
                  </div>
                </div>

                <div className="p-4 rounded-lg border">
                  <h4 className="font-semibold mb-3">Estrutura de Tópicos</h4>
                  <div className="space-y-2 font-mono text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="w-24">Comandos</Badge>
                      <code className="bg-muted px-2 py-1 rounded">devices/{"{DEVICE_ID}"}/commands</code>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="w-24">Dados</Badge>
                      <code className="bg-muted px-2 py-1 rounded">devices/{"{DEVICE_ID}"}/data</code>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="w-24">Status</Badge>
                      <code className="bg-muted px-2 py-1 rounded">devices/{"{DEVICE_ID}"}/status</code>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="messages" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <ArrowDownUp className="h-5 w-5" />
                    Formato de Mensagens
                  </CardTitle>
                  <CardDescription>
                    Estrutura JSON para envio e recebimento de dados
                  </CardDescription>
                </div>
                <CopyButton 
                  text={`// Mensagem de Dados (Dispositivo → Plataforma)
{
  "device_id": "DEVICE_ID",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "temperatura": 25.5,
    "umidade": 65,
    "tensao": 220.3
  }
}

// Mensagem de Comando (Plataforma → Dispositivo)
{
  "device_id": "DEVICE_ID",
  "command": "nome_do_comando",
  "value": <valor>,
  "timestamp": "2024-01-15T10:30:00Z"
}`}
                  section="messages"
                />
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="font-semibold mb-2 text-green-600">Dispositivo → Plataforma (Envio de Dados)</h4>
                  <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-sm">
{`{
  "device_id": "DEVICE_ID",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "temperatura": 25.5,
    "umidade": 65,
    "tensao": 220.3,
    "corrente": 2.1
  }
}`}
                  </pre>
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-blue-600">Plataforma → Dispositivo (Comandos)</h4>
                  <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-sm">
{`{
  "device_id": "DEVICE_ID",
  "command": "power",
  "value": true,
  "timestamp": "2024-01-15T10:30:00Z"
}`}
                  </pre>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="commands" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <RefreshCw className="h-5 w-5" />
                    Comando Padrão: request_update
                  </CardTitle>
                  <CardDescription>
                    Comando obrigatório para todos os dispositivos
                  </CardDescription>
                </div>
                <CopyButton 
                  text={`// Comando recebido pelo dispositivo
{
  "device_id": "DEVICE_ID",
  "command": "request_update",
  "timestamp": "2024-01-15T10:30:00Z"
}

// Resposta esperada do dispositivo
{
  "device_id": "DEVICE_ID",
  "timestamp": "2024-01-15T10:30:01Z",
  "data": {
    // todos os dados atuais do dispositivo
  }
}`}
                  section="commands"
                />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-primary/10 border border-primary/20 rounded-lg">
                  <p className="text-sm">
                    <strong>Importante:</strong> Todos os dispositivos DEVEM implementar o comando 
                    <code className="mx-1 px-2 py-0.5 bg-background rounded">request_update</code>. 
                    Quando recebido, o dispositivo deve imediatamente enviar todos os seus dados 
                    atuais para a plataforma, independente do intervalo de envio configurado.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <h4 className="font-semibold mb-2">Comando Recebido</h4>
                    <pre className="p-4 bg-muted rounded-lg text-sm">
{`{
  "device_id": "DEVICE_ID",
  "command": "request_update",
  "timestamp": "ISO_DATE"
}`}
                    </pre>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-2">Resposta Esperada</h4>
                    <pre className="p-4 bg-muted rounded-lg text-sm">
{`{
  "device_id": "DEVICE_ID",
  "timestamp": "ISO_DATE",
  "data": {
    // dados atuais
  }
}`}
                    </pre>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="servers" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5" />
                  Servidores MQTT Cadastrados
                </CardTitle>
                <CardDescription>
                  Configurações dos servidores disponíveis para conexão
                </CardDescription>
              </CardHeader>
              <CardContent>
                {mqttServers.length > 0 ? (
                  <div className="space-y-4">
                    {mqttServers.map((server) => (
                      <div key={server.id} className="p-4 rounded-lg border">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="font-semibold">{server.nome}</h4>
                          <CopyButton 
                            text={`Host: ${server.host}\nPorta: ${server.porta}\nSSL: ${server.usa_ssl ? "Sim" : "Não"}${server.usuario ? `\nUsuário: ${server.usuario}` : ""}${server.topico_padrao ? `\nTópico Padrão: ${server.topico_padrao}` : ""}`}
                            section={`server-${server.id}`}
                          />
                        </div>
                        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Host:</span>
                            <p className="font-mono">{server.host}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Porta:</span>
                            <p className="font-mono">{server.porta}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">SSL/TLS:</span>
                            <p>{server.usa_ssl ? "Habilitado" : "Desabilitado"}</p>
                          </div>
                          {server.usuario && (
                            <div>
                              <span className="text-muted-foreground">Usuário:</span>
                              <p className="font-mono">{server.usuario}</p>
                            </div>
                          )}
                        </div>
                        {server.topico_padrao && (
                          <div className="mt-2 text-sm">
                            <span className="text-muted-foreground">Tópico Padrão:</span>
                            <code className="ml-2 px-2 py-0.5 bg-muted rounded">{server.topico_padrao}</code>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    Nenhum servidor MQTT cadastrado. Configure em "Servidores MQTT".
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="example" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <FileCode className="h-5 w-5" />
                    Exemplo de Implementação (ESP32/Arduino)
                  </CardTitle>
                  <CardDescription>
                    Código de referência para implementação em dispositivos
                  </CardDescription>
                </div>
                <CopyButton 
                  text={`#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

const char* DEVICE_ID = "seu_device_id";
const char* MQTT_SERVER = "${mqttServers[0]?.host || "mqtt.seuservidor.com"}";
const int MQTT_PORT = ${mqttServers[0]?.porta || 1883};

WiFiClient espClient;
PubSubClient client(espClient);

String topicCommands = "devices/" + String(DEVICE_ID) + "/commands";
String topicData = "devices/" + String(DEVICE_ID) + "/data";
String topicStatus = "devices/" + String(DEVICE_ID) + "/status";

void callback(char* topic, byte* payload, unsigned int length) {
  StaticJsonDocument<256> doc;
  deserializeJson(doc, payload, length);
  
  const char* command = doc["command"];
  
  if (strcmp(command, "request_update") == 0) {
    sendCurrentData();
  }
  // Processar outros comandos...
}

void sendCurrentData() {
  StaticJsonDocument<512> doc;
  doc["device_id"] = DEVICE_ID;
  
  JsonObject data = doc.createNestedObject("data");
  data["temperatura"] = readTemperature();
  data["umidade"] = readHumidity();
  
  char buffer[512];
  serializeJson(doc, buffer);
  client.publish(topicData.c_str(), buffer);
}

void setup() {
  Serial.begin(115200);
  // Configurar WiFi e MQTT...
  client.setServer(MQTT_SERVER, MQTT_PORT);
  client.setCallback(callback);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();
}`}
                  section="example"
                />
              </CardHeader>
              <CardContent>
                <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-sm">
{`#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

const char* DEVICE_ID = "seu_device_id";
const char* MQTT_SERVER = "${mqttServers[0]?.host || "mqtt.seuservidor.com"}";
const int MQTT_PORT = ${mqttServers[0]?.porta || 1883};

WiFiClient espClient;
PubSubClient client(espClient);

// Tópicos MQTT
String topicCommands = "devices/" + String(DEVICE_ID) + "/commands";
String topicData = "devices/" + String(DEVICE_ID) + "/data";
String topicStatus = "devices/" + String(DEVICE_ID) + "/status";

void callback(char* topic, byte* payload, unsigned int length) {
  StaticJsonDocument<256> doc;
  deserializeJson(doc, payload, length);
  
  const char* command = doc["command"];
  
  // Comando obrigatório: request_update
  if (strcmp(command, "request_update") == 0) {
    sendCurrentData();
  }
  // Processar outros comandos...
}

void sendCurrentData() {
  StaticJsonDocument<512> doc;
  doc["device_id"] = DEVICE_ID;
  
  JsonObject data = doc.createNestedObject("data");
  data["temperatura"] = readTemperature();
  data["umidade"] = readHumidity();
  
  char buffer[512];
  serializeJson(doc, buffer);
  client.publish(topicData.c_str(), buffer);
}

void setup() {
  Serial.begin(115200);
  client.setServer(MQTT_SERVER, MQTT_PORT);
  client.setCallback(callback);
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop();
}`}
                </pre>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
