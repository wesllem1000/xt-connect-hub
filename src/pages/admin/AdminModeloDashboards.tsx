import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { 
  Plus, Pencil, Trash2, Loader2, ArrowLeft, GripVertical,
  Zap, Thermometer, Droplets, Activity, Gauge,
  Square, SlidersHorizontal, ToggleLeft, Hash,
  Circle, Info, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight
} from "lucide-react";
import AdminLayout from "./AdminLayout";

type DataDirection = 'receive' | 'send' | 'both';

interface DeviceModel {
  id: string;
  nome: string;
  fabricante: string;
}

interface DashboardComponent {
  id: string;
  nome: string;
  tipo: string;
  icone: string | null;
}

interface ModelDashboard {
  id: string;
  device_model_id: string;
  dashboard_component_id: string;
  ordem: number;
  direcao: DataDirection;
  json_path_receive: string | null;
  json_path_send: string | null;
  mqtt_topic_override: string | null;
  configuracao: Record<string, unknown>;
  ativo: boolean;
  dashboard_components?: DashboardComponent;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Zap, Thermometer, Droplets, Activity, Gauge,
  Square, SlidersHorizontal, ToggleLeft, Hash,
  Circle, Info,
};

const directionIcons: Record<DataDirection, React.ComponentType<{ className?: string }>> = {
  receive: ArrowDownToLine,
  send: ArrowUpFromLine,
  both: ArrowLeftRight,
};

const directionLabels: Record<DataDirection, string> = {
  receive: "Receber",
  send: "Enviar",
  both: "Ambos",
};

export default function AdminModeloDashboards() {
  const { modelId } = useParams<{ modelId: string }>();
  const [model, setModel] = useState<DeviceModel | null>(null);
  const [dashboards, setDashboards] = useState<ModelDashboard[]>([]);
  const [availableComponents, setAvailableComponents] = useState<DashboardComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingDash, setEditingDash] = useState<Partial<ModelDashboard> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [configInput, setConfigInput] = useState("");

  const fetchData = async () => {
    if (!modelId) return;
    setLoading(true);

    // Fetch model info
    const { data: modelData } = await supabase
      .from("device_models")
      .select("id, nome, fabricante")
      .eq("id", modelId)
      .maybeSingle();

    if (modelData) setModel(modelData);

    // Fetch model dashboards with component info
    const { data: dashData, error } = await supabase
      .from("device_model_dashboards")
      .select(`
        *,
        dashboard_components (id, nome, tipo, icone)
      `)
      .eq("device_model_id", modelId)
      .order("ordem", { ascending: true });

    if (error) {
      toast.error("Erro ao carregar dashboards");
    } else {
      setDashboards((dashData || []).map(d => ({
        ...d,
        direcao: d.direcao as DataDirection,
        configuracao: (d.configuracao || {}) as Record<string, unknown>,
      })));
    }

    // Fetch available components
    const { data: compData } = await supabase
      .from("dashboard_components")
      .select("id, nome, tipo, icone")
      .eq("ativo", true)
      .order("tipo");

    if (compData) setAvailableComponents(compData);

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [modelId]);

  const openNewDialog = () => {
    setEditingDash({
      device_model_id: modelId,
      dashboard_component_id: "",
      ordem: dashboards.length,
      direcao: "receive",
      json_path_receive: "",
      json_path_send: "",
      mqtt_topic_override: "",
      configuracao: {},
      ativo: true,
    });
    setConfigInput("{}");
    setIsNew(true);
    setDialogOpen(true);
  };

  const openEditDialog = (dash: ModelDashboard) => {
    setEditingDash(dash);
    setConfigInput(JSON.stringify(dash.configuracao, null, 2));
    setIsNew(false);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!editingDash?.dashboard_component_id) {
      toast.error("Selecione um componente");
      return;
    }

    let config = {};
    try {
      config = configInput ? JSON.parse(configInput) : {};
    } catch {
      toast.error("Configuração deve estar em formato JSON válido");
      return;
    }

    const payload = {
      device_model_id: modelId,
      dashboard_component_id: editingDash.dashboard_component_id,
      ordem: editingDash.ordem || 0,
      direcao: editingDash.direcao || "receive",
      json_path_receive: editingDash.json_path_receive || null,
      json_path_send: editingDash.json_path_send || null,
      mqtt_topic_override: editingDash.mqtt_topic_override || null,
      configuracao: config,
      ativo: editingDash.ativo ?? true,
    };

    if (isNew) {
      const { error } = await supabase.from("device_model_dashboards").insert(payload);
      if (error) {
        if (error.code === "23505") {
          toast.error("Este componente já está associado a este modelo");
        } else {
          toast.error("Erro ao adicionar componente");
        }
        return;
      }
      toast.success("Componente adicionado com sucesso");
    } else {
      const { error } = await supabase
        .from("device_model_dashboards")
        .update(payload)
        .eq("id", editingDash.id);
      if (error) {
        toast.error("Erro ao atualizar componente");
        return;
      }
      toast.success("Componente atualizado com sucesso");
    }

    setDialogOpen(false);
    fetchData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja remover este componente do modelo?")) return;

    const { error } = await supabase.from("device_model_dashboards").delete().eq("id", id);

    if (error) {
      toast.error("Erro ao remover componente");
      return;
    }

    toast.success("Componente removido com sucesso");
    fetchData();
  };

  const getIcon = (iconName: string | null) => {
    const IconComponent = iconName ? iconMap[iconName] : Gauge;
    return IconComponent || Gauge;
  };

  const getSelectedComponent = () => {
    return availableComponents.find(c => c.id === editingDash?.dashboard_component_id);
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AdminLayout>
    );
  }

  if (!model) {
    return (
      <AdminLayout>
        <div className="text-center py-8">
          <p className="text-muted-foreground">Modelo não encontrado</p>
          <Button asChild className="mt-4">
            <Link to="/admin/modelos">Voltar para Modelos</Link>
          </Button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" asChild>
            <Link to="/admin/modelos">
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-foreground">Dashboards do Modelo</h2>
            <p className="text-muted-foreground">{model.nome} - {model.fabricante}</p>
          </div>
          <Button onClick={openNewDialog}>
            <Plus className="w-4 h-4 mr-2" />
            Adicionar Componente
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Componentes de Dashboard</CardTitle>
            <CardDescription>
              Configure quais componentes aparecem no dashboard deste modelo e como os dados são mapeados
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dashboards.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>Nenhum componente configurado para este modelo.</p>
                <p className="text-sm mt-1">Clique em "Adicionar Componente" para começar.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Componente</TableHead>
                    <TableHead>Direção</TableHead>
                    <TableHead>JSON Path (Receber)</TableHead>
                    <TableHead>JSON Path (Enviar)</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboards.map((dash, index) => {
                    const comp = dash.dashboard_components;
                    const Icon = comp ? getIcon(comp.icone) : Gauge;
                    const DirIcon = directionIcons[dash.direcao];
                    return (
                      <TableRow key={dash.id}>
                        <TableCell>
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <GripVertical className="w-4 h-4" />
                            {index + 1}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                              <Icon className="w-4 h-4 text-primary" />
                            </div>
                            {comp?.nome || "Componente"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="flex items-center gap-1 w-fit">
                            <DirIcon className="w-3 h-3" />
                            {directionLabels[dash.direcao]}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {dash.json_path_receive || "-"}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {dash.json_path_send || "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={dash.ativo ? "default" : "secondary"}>
                            {dash.ativo ? "Ativo" : "Inativo"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="icon" onClick={() => openEditDialog(dash)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button variant="outline" size="icon" onClick={() => handleDelete(dash.id)}>
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{isNew ? "Adicionar Componente" : "Editar Componente"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Componente *</Label>
                <Select
                  value={editingDash?.dashboard_component_id || ""}
                  onValueChange={(value) => setEditingDash(prev => ({ ...prev, dashboard_component_id: value }))}
                  disabled={!isNew}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um componente" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableComponents.map(comp => {
                      const Icon = getIcon(comp.icone);
                      const isUsed = dashboards.some(d => d.dashboard_component_id === comp.id && d.id !== editingDash?.id);
                      return (
                        <SelectItem key={comp.id} value={comp.id} disabled={isUsed}>
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4" />
                            {comp.nome}
                            {isUsed && <span className="text-xs text-muted-foreground">(já adicionado)</span>}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Direção do Dado *</Label>
                  <Select
                    value={editingDash?.direcao || "receive"}
                    onValueChange={(value) => setEditingDash(prev => ({ ...prev, direcao: value as DataDirection }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="receive">
                        <div className="flex items-center gap-2">
                          <ArrowDownToLine className="w-4 h-4" />
                          Receber (dispositivo → dashboard)
                        </div>
                      </SelectItem>
                      <SelectItem value="send">
                        <div className="flex items-center gap-2">
                          <ArrowUpFromLine className="w-4 h-4" />
                          Enviar (dashboard → dispositivo)
                        </div>
                      </SelectItem>
                      <SelectItem value="both">
                        <div className="flex items-center gap-2">
                          <ArrowLeftRight className="w-4 h-4" />
                          Ambos (bidirecional)
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Ordem</Label>
                  <Input
                    type="number"
                    value={editingDash?.ordem || 0}
                    onChange={(e) => setEditingDash(prev => ({ ...prev, ordem: parseInt(e.target.value) || 0 }))}
                    min={0}
                  />
                </div>
              </div>

              {(editingDash?.direcao === "receive" || editingDash?.direcao === "both") && (
                <div className="space-y-2">
                  <Label>JSON Path (Receber)</Label>
                  <Input
                    value={editingDash?.json_path_receive || ""}
                    onChange={(e) => setEditingDash(prev => ({ ...prev, json_path_receive: e.target.value }))}
                    placeholder="Ex: payload.temperature ou data.sensors.temp"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Caminho no JSON recebido do dispositivo para extrair o valor
                  </p>
                </div>
              )}

              {(editingDash?.direcao === "send" || editingDash?.direcao === "both") && (
                <div className="space-y-2">
                  <Label>JSON Path (Enviar)</Label>
                  <Input
                    value={editingDash?.json_path_send || ""}
                    onChange={(e) => setEditingDash(prev => ({ ...prev, json_path_send: e.target.value }))}
                    placeholder="Ex: command.setValue ou action.toggle"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Caminho no JSON para enviar comandos ao dispositivo
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label>Tópico MQTT Específico (opcional)</Label>
                <Input
                  value={editingDash?.mqtt_topic_override || ""}
                  onChange={(e) => setEditingDash(prev => ({ ...prev, mqtt_topic_override: e.target.value }))}
                  placeholder="Ex: devices/{device_id}/temperature"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Deixe vazio para usar o tópico padrão do dispositivo
                </p>
              </div>

              <div className="space-y-2">
                <Label>Configuração Específica (JSON)</Label>
                <Textarea
                  value={configInput}
                  onChange={(e) => setConfigInput(e.target.value)}
                  placeholder='{"min": 0, "max": 100, "unidade": "°C", "alerta_max": 80}'
                  rows={4}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Sobrescreve a configuração padrão do componente (min, max, unidade, alertas, etc.)
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Switch
                  checked={editingDash?.ativo ?? true}
                  onCheckedChange={(checked) => setEditingDash(prev => ({ ...prev, ativo: checked }))}
                />
                <Label>Componente Ativo neste Modelo</Label>
              </div>

              <Button onClick={handleSave} className="w-full">
                {isNew ? "Adicionar Componente" : "Salvar Alterações"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}