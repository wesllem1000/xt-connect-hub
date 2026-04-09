import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Copy, Check, Server, FileCode, Wifi, ArrowDownUp, RefreshCw, Globe, Eye, EyeOff, AlertTriangle } from "lucide-react";
import AdminLayout from "./AdminLayout";

interface MqttServer {
  id: string;
  nome: string;
  host: string;
  porta: number;
  usa_ssl: boolean;
  usuario: string | null;
  senha: string | null;
  topico_padrao: string | null;
}

export default function AdminDocumentacao() {
  const [mqttServers, setMqttServers] = useState<MqttServer[]>([]);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchMqttServers();
  }, []);

  const fetchMqttServers = async () => {
    const { data } = await supabase
      .from("mqtt_servers")
      .select("id, nome, host, porta, usa_ssl, usuario, senha, topico_padrao")
      .eq("ativo", true);
    
    if (data) setMqttServers(data);
  };

  const copyToClipboard = async (text: string, section: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedSection(section);
    toast.success("Copiado para a área de transferência!");
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const togglePassword = (serverId: string) => {
    setShowPasswords(prev => ({ ...prev, [serverId]: !prev[serverId] }));
  };

  const webhookUrl = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID || "omnzbpguabgqdkkjneys"}.supabase.co/functions/v1/mqtt-webhook`;

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

  const generateFullDocumentation = () => {
    const serverInfo = mqttServers.length > 0 
      ? mqttServers.map(s => `
Servidor: ${s.nome}
  Host: ${s.host}
  Porta: ${s.porta}
  SSL/TLS: ${s.usa_ssl ? "Sim" : "Não"}
  Protocolo: ${s.usa_ssl ? "mqtts" : "mqtt"}
  ${s.usuario ? `Usuário: ${s.usuario}` : "Autenticação: Não requerida"}
  ${s.senha ? `Senha: ${s.senha}` : ""}
  ${s.topico_padrao ? `Tópico Padrão: ${s.topico_padrao}` : ""}
`).join("\n")
      : "Nenhum servidor MQTT cadastrado.";

    return `
================================================================================
                    XT CONECT - DOCUMENTAÇÃO DE INTEGRAÇÃO
                         Padrões de Comunicação
================================================================================

1. VISÃO GERAL
--------------------------------------------------------------------------------
A plataforma XT CONECT utiliza o protocolo MQTT para comunicação bidirecional
com dispositivos IoT. Os dados recebidos são processados por um webhook HTTP
que salva os valores no banco de dados para exibição nos dashboards.

FLUXO DE DADOS:
  [Dispositivo IoT] --MQTT--> [Broker MQTT] --Node-RED/Bridge--> [Webhook HTTP] --> [Banco de Dados]

2. SERVIDORES MQTT CADASTRADOS
--------------------------------------------------------------------------------
${serverInfo}

3. WEBHOOK HTTP (Recepção de Dados)
--------------------------------------------------------------------------------
URL: ${webhookUrl}
Método: POST
Content-Type: application/json

Payload:
{
  "device_id": "ID_DO_DISPOSITIVO",
  "data": {
    "campo1": valor1,
    "campo2": valor2
  },
  "timestamp": "2024-01-15T10:30:00Z" (opcional)
}

4. ESTRUTURA DE TÓPICOS MQTT
--------------------------------------------------------------------------------
  • Enviar dados:      devices/{DEVICE_ID}/data
  • Receber comandos:  devices/{DEVICE_ID}/commands
  • Status:            devices/{DEVICE_ID}/status

5. FORMATO DE MENSAGENS
--------------------------------------------------------------------------------

5.1 Dispositivo → Plataforma (Envio de Dados):
{
  "device_id": "DEVICE_ID",
  "data": {
    "temperatura": 25.5,
    "umidade": 65
  }
}

5.2 Plataforma → Dispositivo (Comandos):
{
  "device_id": "DEVICE_ID",
  "command": "nome_do_comando",
  "value": <valor>,
  "timestamp": "2024-01-15T10:30:00Z"
}

6. COMANDO OBRIGATÓRIO: request_update
--------------------------------------------------------------------------------
Todos os dispositivos DEVEM implementar o comando "request_update".
Quando recebido, enviar imediatamente todos os dados atuais.

7. INTEGRAÇÃO VIA NODE-RED
--------------------------------------------------------------------------------
Para que os dados sejam salvos mesmo com o frontend fechado, é necessário
configurar um bridge (ponte) entre o broker MQTT e o webhook HTTP.

Fluxo Node-RED recomendado:
  [mqtt in] → [function] → [http request]

Nó mqtt in:
  Servidor: ${mqttServers[0]?.host || "seu_broker"} : ${mqttServers[0]?.porta || 1883}
  ${mqttServers[0]?.usuario ? `Usuário: ${mqttServers[0].usuario}` : ""}
  ${mqttServers[0]?.senha ? `Senha: ${mqttServers[0].senha}` : ""}
  Tópico: devices/+/data

Nó function (JavaScript):
  var parts = msg.topic.split('/');
  var device_id = parts[1];
  msg.payload = {
      device_id: device_id,
      data: msg.payload,
      timestamp: new Date().toISOString()
  };
  msg.headers = { 'Content-Type': 'application/json' };
  return msg;

Nó http request:
  Método: POST
  URL: ${webhookUrl}

================================================================================
                               FIM DA DOCUMENTAÇÃO
================================================================================
`;
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Documentação de Integração</h2>
            <p className="text-muted-foreground">
              Instruções completas para conectar dispositivos à plataforma XT CONECT
            </p>
          </div>
          <Button 
            onClick={() => copyToClipboard(generateFullDocumentation(), "full")}
            className="gap-2"
          >
            {copiedSection === "full" ? (
              <>
                <Check className="h-4 w-4" />
                Copiada!
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
          <TabsList className="grid grid-cols-3 md:grid-cols-6 w-full">
            <TabsTrigger value="overview">Visão Geral</TabsTrigger>
            <TabsTrigger value="servers">Servidores</TabsTrigger>
            <TabsTrigger value="webhook">Webhook</TabsTrigger>
            <TabsTrigger value="messages">Mensagens</TabsTrigger>
            <TabsTrigger value="nodered">Node-RED</TabsTrigger>
            <TabsTrigger value="example">ESP32</TabsTrigger>
          </TabsList>

          {/* === VISÃO GERAL === */}
          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wifi className="h-5 w-5" />
                  Arquitetura de Comunicação
                </CardTitle>
                <CardDescription>
                  Como os dados fluem do dispositivo até o dashboard
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 rounded-lg border bg-muted/50">
                  <h4 className="font-semibold mb-3">Fluxo de Dados</h4>
                  <div className="flex flex-wrap items-center gap-2 text-sm font-mono">
                    <Badge variant="outline">Dispositivo IoT</Badge>
                    <span>→ MQTT →</span>
                    <Badge variant="outline">Broker MQTT</Badge>
                    <span>→ Node-RED →</span>
                    <Badge variant="outline">Webhook HTTP</Badge>
                    <span>→</span>
                    <Badge variant="outline">Banco de Dados</Badge>
                    <span>→</span>
                    <Badge variant="outline">Dashboard</Badge>
                  </div>
                </div>

                <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                    <div className="text-sm">
                      <p className="font-semibold text-amber-600 dark:text-amber-400">Importante: Bridge Necessário</p>
                      <p className="mt-1 text-muted-foreground">
                        Para que os dados sejam salvos no banco de dados mesmo quando o frontend está fechado, 
                        é necessário configurar um <strong>Node-RED</strong> (ou bridge similar) que escute o broker MQTT 
                        e encaminhe os dados para o webhook HTTP da plataforma.
                      </p>
                    </div>
                  </div>
                </div>

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
                  <h4 className="font-semibold mb-3">Estrutura de Tópicos MQTT</h4>
                  <div className="space-y-2 font-mono text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="w-24">Dados</Badge>
                      <code className="bg-muted px-2 py-1 rounded">devices/{"{DEVICE_ID}"}/data</code>
                      <span className="text-xs text-muted-foreground">← dispositivo publica aqui</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="w-24">Comandos</Badge>
                      <code className="bg-muted px-2 py-1 rounded">devices/{"{DEVICE_ID}"}/commands</code>
                      <span className="text-xs text-muted-foreground">← dispositivo escuta aqui</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="w-24">Status</Badge>
                      <code className="bg-muted px-2 py-1 rounded">devices/{"{DEVICE_ID}"}/status</code>
                      <span className="text-xs text-muted-foreground">← online/offline</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* === SERVIDORES MQTT === */}
          <TabsContent value="servers" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5" />
                  Servidores MQTT - Credenciais de Acesso
                </CardTitle>
                <CardDescription>
                  Dados de conexão para configurar nos dispositivos e no Node-RED
                </CardDescription>
              </CardHeader>
              <CardContent>
                {mqttServers.length > 0 ? (
                  <div className="space-y-4">
                    {mqttServers.map((server) => (
                      <div key={server.id} className="p-4 rounded-lg border">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="font-semibold text-lg">{server.nome}</h4>
                          <CopyButton 
                            text={[
                              `Host: ${server.host}`,
                              `Porta: ${server.porta}`,
                              `Protocolo: ${server.usa_ssl ? "mqtts (SSL/TLS)" : "mqtt"}`,
                              `SSL: ${server.usa_ssl ? "Sim" : "Não"}`,
                              server.usuario ? `Usuário: ${server.usuario}` : null,
                              server.senha ? `Senha: ${server.senha}` : null,
                              server.topico_padrao ? `Tópico Padrão: ${server.topico_padrao}` : null,
                            ].filter(Boolean).join("\n")}
                            section={`server-${server.id}`}
                          />
                        </div>
                        <div className="grid gap-3 md:grid-cols-2 text-sm">
                          <div className="space-y-2">
                            <div className="flex justify-between p-2 bg-muted rounded">
                              <span className="text-muted-foreground">Host:</span>
                              <span className="font-mono font-semibold">{server.host}</span>
                            </div>
                            <div className="flex justify-between p-2 bg-muted rounded">
                              <span className="text-muted-foreground">Porta:</span>
                              <span className="font-mono font-semibold">{server.porta}</span>
                            </div>
                            <div className="flex justify-between p-2 bg-muted rounded">
                              <span className="text-muted-foreground">SSL/TLS:</span>
                              <Badge variant={server.usa_ssl ? "default" : "secondary"}>
                                {server.usa_ssl ? "Habilitado" : "Desabilitado"}
                              </Badge>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="flex justify-between p-2 bg-muted rounded">
                              <span className="text-muted-foreground">Usuário:</span>
                              <span className="font-mono font-semibold">{server.usuario || "—"}</span>
                            </div>
                            <div className="flex justify-between items-center p-2 bg-muted rounded">
                              <span className="text-muted-foreground">Senha:</span>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-semibold">
                                  {server.senha 
                                    ? (showPasswords[server.id] ? server.senha : "••••••••") 
                                    : "—"
                                  }
                                </span>
                                {server.senha && (
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-6 w-6"
                                    onClick={() => togglePassword(server.id)}
                                  >
                                    {showPasswords[server.id] ? (
                                      <EyeOff className="h-3.5 w-3.5" />
                                    ) : (
                                      <Eye className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                )}
                              </div>
                            </div>
                            {server.topico_padrao && (
                              <div className="flex justify-between p-2 bg-muted rounded">
                                <span className="text-muted-foreground">Tópico:</span>
                                <code className="font-mono font-semibold">{server.topico_padrao}</code>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Connection string for easy copy */}
                        <div className="mt-3 p-3 bg-muted/50 border rounded">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-muted-foreground font-semibold">String de Conexão:</span>
                            <CopyButton 
                              text={`${server.usa_ssl ? "mqtts" : "mqtt"}://${server.usuario ? `${server.usuario}:${server.senha || ""}@` : ""}${server.host}:${server.porta}`}
                              section={`conn-${server.id}`}
                            />
                          </div>
                          <code className="text-sm font-mono break-all">
                            {server.usa_ssl ? "mqtts" : "mqtt"}://{server.usuario ? `${server.usuario}:${showPasswords[server.id] ? server.senha : "****"}@` : ""}{server.host}:{server.porta}
                          </code>
                        </div>
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

          {/* === WEBHOOK HTTP === */}
          <TabsContent value="webhook" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-5 w-5" />
                  Webhook HTTP - Recepção de Dados
                </CardTitle>
                <CardDescription>
                  Endpoint que recebe dados dos dispositivos e salva no banco de dados
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-muted/50 border rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold">URL do Webhook:</span>
                    <CopyButton text={webhookUrl} section="webhook-url" />
                  </div>
                  <code className="text-sm font-mono break-all text-primary">{webhookUrl}</code>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="p-3 bg-muted rounded-lg text-center">
                    <span className="text-xs text-muted-foreground">Método</span>
                    <p className="font-mono font-bold text-lg">POST</p>
                  </div>
                  <div className="p-3 bg-muted rounded-lg text-center">
                    <span className="text-xs text-muted-foreground">Content-Type</span>
                    <p className="font-mono font-bold text-sm">application/json</p>
                  </div>
                  <div className="p-3 bg-muted rounded-lg text-center">
                    <span className="text-xs text-muted-foreground">Autenticação</span>
                    <p className="font-mono font-bold text-sm">Nenhuma</p>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold">Payload (corpo da requisição):</h4>
                    <CopyButton 
                      text={`{
  "device_id": "SEU_DEVICE_ID",
  "data": {
    "temperatura": 25.5,
    "umidade": 65
  },
  "timestamp": "2024-01-15T10:30:00Z"
}`}
                      section="webhook-payload"
                    />
                  </div>
                  <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-sm">
{`{
  "device_id": "SEU_DEVICE_ID",   ← ID cadastrado do dispositivo
  "data": {                        ← Dados dos sensores/atuadores
    "temperatura": 25.5,
    "umidade": 65,
    "tensao": 220.3
  },
  "timestamp": "2024-01-15T10:30:00Z"  ← Opcional (usa hora do servidor se omitido)
}`}
                  </pre>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Campos:</h4>
                  <div className="space-y-2 text-sm">
                    <div className="p-2 bg-muted rounded flex gap-3">
                      <code className="text-primary font-semibold whitespace-nowrap">device_id</code>
                      <span><Badge variant="destructive" className="text-xs mr-1">obrigatório</Badge> Identificador único do dispositivo, igual ao cadastrado na plataforma</span>
                    </div>
                    <div className="p-2 bg-muted rounded flex gap-3">
                      <code className="text-primary font-semibold whitespace-nowrap">data</code>
                      <span><Badge variant="destructive" className="text-xs mr-1">obrigatório</Badge> Objeto JSON com os valores. As chaves devem corresponder ao <code>json_path_receive</code> configurado no modelo do dispositivo</span>
                    </div>
                    <div className="p-2 bg-muted rounded flex gap-3">
                      <code className="text-primary font-semibold whitespace-nowrap">timestamp</code>
                      <span><Badge variant="secondary" className="text-xs mr-1">opcional</Badge> Data/hora ISO 8601. Se omitido, usa a hora do servidor</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Teste com cURL:</h4>
                  <CopyButton 
                    text={`curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"device_id": "SEU_DEVICE_ID", "data": {"temperatura": 25.5, "umidade": 65}}'`}
                    section="curl-test"
                  />
                  <pre className="mt-2 p-4 bg-muted rounded-lg overflow-x-auto text-sm">
{`curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"device_id": "SEU_DEVICE_ID", "data": {"temperatura": 25.5, "umidade": 65}}'`}
                  </pre>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Respostas:</h4>
                  <div className="space-y-2 text-sm">
                    <div className="p-2 bg-green-500/10 border border-green-500/20 rounded">
                      <span className="font-mono font-semibold text-green-600">200 OK</span> — Dados processados com sucesso
                    </div>
                    <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded">
                      <span className="font-mono font-semibold text-amber-600">400 Bad Request</span> — device_id ou data ausente/inválido
                    </div>
                    <div className="p-2 bg-red-500/10 border border-red-500/20 rounded">
                      <span className="font-mono font-semibold text-red-600">404 Not Found</span> — Dispositivo não cadastrado na plataforma
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* === MENSAGENS === */}
          <TabsContent value="messages" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <ArrowDownUp className="h-5 w-5" />
                    Formato de Mensagens MQTT
                  </CardTitle>
                  <CardDescription>
                    Estrutura JSON para envio e recebimento de dados via MQTT
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-green-600 dark:text-green-400">Dispositivo → Broker (Publicar em devices/{"{ID}"}/data)</h4>
                    <CopyButton 
                      text={`{
  "device_id": "SEU_DEVICE_ID",
  "data": {
    "temperatura": 25.5,
    "umidade": 65,
    "tensao": 220.3
  }
}`}
                      section="msg-data"
                    />
                  </div>
                  <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-sm">
{`{
  "device_id": "SEU_DEVICE_ID",
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
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-blue-600 dark:text-blue-400">Plataforma → Dispositivo (Subscrever devices/{"{ID}"}/commands)</h4>
                    <CopyButton 
                      text={`{
  "device_id": "SEU_DEVICE_ID",
  "command": "power",
  "value": true,
  "timestamp": "2024-01-15T10:30:00Z"
}`}
                      section="msg-cmd"
                    />
                  </div>
                  <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-sm">
{`{
  "device_id": "SEU_DEVICE_ID",
  "command": "power",
  "value": true,
  "timestamp": "2024-01-15T10:30:00Z"
}`}
                  </pre>
                </div>

                <Card className="border-primary/30">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <RefreshCw className="h-4 w-4" />
                      Comando Obrigatório: request_update
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg text-sm">
                      <strong>Todos os dispositivos DEVEM implementar este comando.</strong> Quando recebido, 
                      o dispositivo deve enviar imediatamente todos os seus dados atuais.
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <h5 className="text-sm font-semibold mb-1">Comando Recebido:</h5>
                        <pre className="p-3 bg-muted rounded-lg text-sm">
{`{
  "device_id": "ID",
  "command": "request_update"
}`}
                        </pre>
                      </div>
                      <div>
                        <h5 className="text-sm font-semibold mb-1">Resposta Esperada:</h5>
                        <pre className="p-3 bg-muted rounded-lg text-sm">
{`{
  "device_id": "ID",
  "data": { ... todos os dados }
}`}
                        </pre>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="p-4 rounded-lg border">
                  <h4 className="font-semibold mb-2">QoS Recomendado</h4>
                  <div className="space-y-1 text-sm">
                    <p>• <strong>Dados de sensores:</strong> QoS 0 (dados frequentes)</p>
                    <p>• <strong>Comandos:</strong> QoS 1 (garantir entrega)</p>
                    <p>• <strong>Status:</strong> QoS 1 com retain flag</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* === NODE-RED === */}
          <TabsContent value="nodered" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ArrowDownUp className="h-5 w-5" />
                  Integração via Node-RED
                </CardTitle>
                <CardDescription>
                  Configure o Node-RED como ponte entre o broker MQTT e a plataforma para salvar dados automaticamente
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-primary/10 border border-primary/20 rounded-lg text-sm">
                  <strong>Para que serve?</strong> O Node-RED escuta o broker MQTT 24 horas e encaminha 
                  os dados para o webhook da plataforma. Assim os dados são salvos mesmo com o navegador fechado.
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Passo 1 — Instalar Node-RED</h4>
                  <CopyButton 
                    text="bash <(curl -sL https://raw.githubusercontent.com/node-red/linux-installers/master/deb/update-nodejs-and-nodered)"
                    section="nodered-install"
                  />
                  <pre className="mt-2 p-3 bg-muted rounded-lg text-sm overflow-x-auto">
{`# Raspberry Pi / Ubuntu / Debian:
bash <(curl -sL https://raw.githubusercontent.com/node-red/linux-installers/master/deb/update-nodejs-and-nodered)

# Iniciar automaticamente:
sudo systemctl enable nodered
sudo systemctl start nodered

# Acessar: http://seu_ip:1880`}
                  </pre>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Passo 2 — Criar o Fluxo</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    No Node-RED, crie 3 nós conectados em sequência:
                  </p>
                  
                  <div className="space-y-3">
                    <div className="p-3 bg-muted rounded-lg">
                      <h5 className="font-semibold text-sm mb-2">Nó 1: mqtt in</h5>
                      <div className="text-sm space-y-1">
                        {mqttServers[0] ? (
                          <>
                            <p>• Servidor: <code className="bg-background px-1 rounded">{mqttServers[0].host}:{mqttServers[0].porta}</code></p>
                            {mqttServers[0].usuario && <p>• Usuário: <code className="bg-background px-1 rounded">{mqttServers[0].usuario}</code></p>}
                            {mqttServers[0].senha && (
                              <p>• Senha: <code className="bg-background px-1 rounded">
                                {showPasswords['nodered'] ? mqttServers[0].senha : "••••••••"}
                              </code>
                              <Button variant="ghost" size="icon" className="h-5 w-5 ml-1 inline-flex" onClick={() => togglePassword('nodered')}>
                                {showPasswords['nodered'] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                              </Button>
                              </p>
                            )}
                            {mqttServers[0].usa_ssl && <p>• TLS: <strong>Habilitado</strong></p>}
                          </>
                        ) : (
                          <p className="text-muted-foreground">Configure um servidor MQTT primeiro.</p>
                        )}
                        <p>• Tópico: <code className="bg-background px-1 rounded">devices/+/data</code></p>
                        <p>• Saída: <strong>parsed JSON object</strong></p>
                      </div>
                    </div>

                    <div className="p-3 bg-muted rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <h5 className="font-semibold text-sm">Nó 2: function</h5>
                        <CopyButton 
                          text={`var parts = msg.topic.split('/');
var device_id = parts[1];

msg.payload = {
    device_id: device_id,
    data: msg.payload,
    timestamp: new Date().toISOString()
};

msg.headers = {
    'Content-Type': 'application/json'
};

return msg;`}
                          section="nodered-function"
                        />
                      </div>
                      <pre className="p-3 bg-background rounded text-xs overflow-x-auto">
{`var parts = msg.topic.split('/');
var device_id = parts[1];

msg.payload = {
    device_id: device_id,
    data: msg.payload,
    timestamp: new Date().toISOString()
};

msg.headers = {
    'Content-Type': 'application/json'
};

return msg;`}
                      </pre>
                    </div>

                    <div className="p-3 bg-muted rounded-lg">
                      <h5 className="font-semibold text-sm mb-2">Nó 3: http request</h5>
                      <div className="text-sm space-y-1">
                        <p>• Método: <code className="bg-background px-1 rounded">POST</code></p>
                        <p>• URL: <code className="bg-background px-1 rounded text-xs break-all">{webhookUrl}</code></p>
                        <p>• Tipo retorno: <code className="bg-background px-1 rounded">JSON object</code></p>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold">Fluxo Pronto para Importar (JSON)</h4>
                    <CopyButton 
                      text={JSON.stringify([
                        {
                          id: "mqtt_in_xtconect",
                          type: "mqtt in",
                          name: "XT CONECT - Dados",
                          topic: "devices/+/data",
                          broker: "mqtt_broker_xtconect",
                          datatype: "json",
                          wires: [["function_xtconect"]]
                        },
                        {
                          id: "function_xtconect",
                          type: "function",
                          name: "Formatar Payload",
                          func: "var parts = msg.topic.split('/');\nvar device_id = parts[1];\n\nmsg.payload = {\n    device_id: device_id,\n    data: msg.payload,\n    timestamp: new Date().toISOString()\n};\n\nmsg.headers = {\n    'Content-Type': 'application/json'\n};\n\nreturn msg;",
                          wires: [["http_xtconect"]]
                        },
                        {
                          id: "http_xtconect",
                          type: "http request",
                          name: "Enviar para XT CONECT",
                          method: "POST",
                          url: webhookUrl,
                          ret: "obj",
                          wires: [[]]
                        },
                        {
                          id: "mqtt_broker_xtconect",
                          type: "mqtt-broker",
                          name: mqttServers[0]?.nome || "Broker MQTT",
                          broker: mqttServers[0]?.host || "seu_broker",
                          port: String(mqttServers[0]?.porta || 1883),
                          tls: mqttServers[0]?.usa_ssl ? "tls_config" : "",
                          credentials: {
                            user: mqttServers[0]?.usuario || "",
                            password: mqttServers[0]?.senha || ""
                          }
                        }
                      ], null, 2)}
                      section="nodered-flow"
                    />
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">
                    No Node-RED, vá em <strong>Menu → Importar → Colar</strong> o JSON abaixo:
                  </p>
                  <pre className="p-3 bg-muted rounded-lg text-xs overflow-x-auto max-h-48">
{`[
  { "type": "mqtt in", "topic": "devices/+/data", "datatype": "json" },
  { "type": "function", "name": "Formatar Payload" },
  { "type": "http request", "method": "POST", "url": "${webhookUrl}" }
]

⬆ Use o botão "Copiar" acima para copiar o fluxo completo com todas as configurações`}
                  </pre>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* === EXEMPLO ESP32 === */}
          <TabsContent value="example" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <FileCode className="h-5 w-5" />
                    Exemplo Completo — ESP32 / Arduino
                  </CardTitle>
                  <CardDescription>
                    Código de referência com conexão WiFi, MQTT e envio de dados
                  </CardDescription>
                </div>
                <CopyButton 
                  text={`#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ===== CONFIGURAÇÕES WiFi =====
const char* WIFI_SSID = "SUA_REDE_WIFI";
const char* WIFI_PASSWORD = "SUA_SENHA_WIFI";

// ===== CONFIGURAÇÕES MQTT =====
const char* DEVICE_ID = "SEU_DEVICE_ID";  // ID cadastrado na plataforma
const char* MQTT_SERVER = "${mqttServers[0]?.host || "seu_broker_mqtt"}";
const int   MQTT_PORT = ${mqttServers[0]?.porta || 1883};
${mqttServers[0]?.usuario ? `const char* MQTT_USER = "${mqttServers[0].usuario}";` : '// const char* MQTT_USER = "usuario";  // Descomentar se necessário'}
${mqttServers[0]?.senha ? `const char* MQTT_PASS = "${mqttServers[0].senha}";` : '// const char* MQTT_PASS = "senha";    // Descomentar se necessário'}

// ===== INTERVALO DE ENVIO =====
const unsigned long SEND_INTERVAL = 30000; // 30 segundos (mínimo recomendado: 10s)
unsigned long lastSend = 0;

WiFiClient espClient;
PubSubClient client(espClient);

// Tópicos MQTT
String topicData     = "devices/" + String(DEVICE_ID) + "/data";
String topicCommands = "devices/" + String(DEVICE_ID) + "/commands";
String topicStatus   = "devices/" + String(DEVICE_ID) + "/status";

// ===== FUNÇÕES DE LEITURA DOS SENSORES =====
float readTemperature() {
  // Substitua pela leitura real do seu sensor
  return 25.5 + random(-10, 10) / 10.0;
}

float readHumidity() {
  // Substitua pela leitura real do seu sensor
  return 65.0 + random(-5, 5);
}

// ===== ENVIAR DADOS ATUAIS =====
void sendCurrentData() {
  StaticJsonDocument<512> doc;
  doc["device_id"] = DEVICE_ID;

  JsonObject data = doc.createNestedObject("data");
  data["temperatura"] = readTemperature();
  data["umidade"] = readHumidity();
  // Adicione outros sensores aqui...

  char buffer[512];
  serializeJson(doc, buffer);
  client.publish(topicData.c_str(), buffer);
  Serial.println("Dados enviados: " + String(buffer));
}

// ===== CALLBACK DE COMANDOS =====
void callback(char* topic, byte* payload, unsigned int length) {
  StaticJsonDocument<256> doc;
  deserializeJson(doc, payload, length);

  const char* command = doc["command"];
  Serial.println("Comando recebido: " + String(command));

  // OBRIGATÓRIO: responder a request_update
  if (strcmp(command, "request_update") == 0) {
    sendCurrentData();
    return;
  }

  // Outros comandos personalizados:
  if (strcmp(command, "power") == 0) {
    bool value = doc["value"];
    // Ligar/desligar algo...
  }
}

// ===== CONECTAR AO WiFi =====
void setupWifi() {
  Serial.print("Conectando ao WiFi...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" Conectado! IP: " + WiFi.localIP().toString());
}

// ===== RECONECTAR AO MQTT =====
void reconnect() {
  while (!client.connected()) {
    Serial.print("Conectando ao MQTT...");
    String clientId = "xtconect_" + String(DEVICE_ID);

    // Configurar LWT (Last Will Testament)
    StaticJsonDocument<128> willDoc;
    willDoc["device_id"] = DEVICE_ID;
    willDoc["status"] = "offline";
    char willBuffer[128];
    serializeJson(willDoc, willBuffer);

    bool connected;
${mqttServers[0]?.usuario 
  ? `    connected = client.connect(clientId.c_str(), MQTT_USER, MQTT_PASS, topicStatus.c_str(), 1, true, willBuffer);`
  : `    connected = client.connect(clientId.c_str(), NULL, NULL, topicStatus.c_str(), 1, true, willBuffer);`}

    if (connected) {
      Serial.println(" Conectado!");

      // Publicar status online
      StaticJsonDocument<128> statusDoc;
      statusDoc["device_id"] = DEVICE_ID;
      statusDoc["status"] = "online";
      char statusBuffer[128];
      serializeJson(statusDoc, statusBuffer);
      client.publish(topicStatus.c_str(), statusBuffer, true);

      // Subscrever nos comandos
      client.subscribe(topicCommands.c_str(), 1);
      Serial.println("Subscrito em: " + topicCommands);

      // Enviar dados iniciais
      sendCurrentData();
    } else {
      Serial.println(" Falhou (rc=" + String(client.state()) + "). Tentando novamente em 5s...");
      delay(5000);
    }
  }
}

// ===== SETUP =====
void setup() {
  Serial.begin(115200);
  setupWifi();
  client.setServer(MQTT_SERVER, MQTT_PORT);
  client.setCallback(callback);
}

// ===== LOOP =====
void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  // Enviar dados periodicamente
  if (millis() - lastSend >= SEND_INTERVAL) {
    sendCurrentData();
    lastSend = millis();
  }
}`}
                  section="example"
                />
              </CardHeader>
              <CardContent>
                <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg text-sm mb-4">
                  <strong>Instruções:</strong> Substitua <code>SEU_DEVICE_ID</code> pelo ID do dispositivo cadastrado na plataforma, 
                  configure as credenciais WiFi e MQTT, e adapte as funções de leitura dos sensores para o seu hardware.
                </div>
                <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-xs max-h-[600px] overflow-y-auto">
{`#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ===== CONFIGURAÇÕES WiFi =====
const char* WIFI_SSID = "SUA_REDE_WIFI";
const char* WIFI_PASSWORD = "SUA_SENHA_WIFI";

// ===== CONFIGURAÇÕES MQTT =====
const char* DEVICE_ID = "SEU_DEVICE_ID";
const char* MQTT_SERVER = "${mqttServers[0]?.host || "seu_broker_mqtt"}";
const int   MQTT_PORT = ${mqttServers[0]?.porta || 1883};
${mqttServers[0]?.usuario ? `const char* MQTT_USER = "${mqttServers[0].usuario}";` : '// const char* MQTT_USER = "usuario";'}
${mqttServers[0]?.senha ? `const char* MQTT_PASS = "${mqttServers[0].senha}";` : '// const char* MQTT_PASS = "senha";'}

// ===== INTERVALO DE ENVIO =====
const unsigned long SEND_INTERVAL = 30000; // 30 segundos

WiFiClient espClient;
PubSubClient client(espClient);

String topicData     = "devices/" + String(DEVICE_ID) + "/data";
String topicCommands = "devices/" + String(DEVICE_ID) + "/commands";
String topicStatus   = "devices/" + String(DEVICE_ID) + "/status";

float readTemperature() { return 25.5; } // Substituir
float readHumidity()    { return 65.0; } // Substituir

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

void callback(char* topic, byte* payload, unsigned int length) {
  StaticJsonDocument<256> doc;
  deserializeJson(doc, payload, length);
  const char* command = doc["command"];
  if (strcmp(command, "request_update") == 0) {
    sendCurrentData();
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(500);
  client.setServer(MQTT_SERVER, MQTT_PORT);
  client.setCallback(callback);
}

void reconnect() {
  while (!client.connected()) {
${mqttServers[0]?.usuario 
  ? `    client.connect("xtconect", MQTT_USER, MQTT_PASS);`
  : `    client.connect("xtconect");`}
    if (client.connected()) {
      client.subscribe(topicCommands.c_str(), 1);
      sendCurrentData();
    } else delay(5000);
  }
}

unsigned long lastSend = 0;
void loop() {
  if (!client.connected()) reconnect();
  client.loop();
  if (millis() - lastSend >= SEND_INTERVAL) {
    sendCurrentData();
    lastSend = millis();
  }
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
