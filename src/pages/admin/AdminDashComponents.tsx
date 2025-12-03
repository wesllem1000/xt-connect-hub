import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { 
  Plus, Pencil, Trash2, Search, Loader2,
  Zap, Thermometer, Droplets, Activity, Gauge,
  Square, SlidersHorizontal, ToggleLeft, Hash,
  Circle, Info
} from "lucide-react";
import AdminLayout from "./AdminLayout";

type DashboardComponentType = 
  | 'sensor_tensao'
  | 'sensor_temperatura'
  | 'sensor_umidade'
  | 'sensor_corrente'
  | 'sensor_generico'
  | 'controle_botao'
  | 'controle_slider'
  | 'controle_switch'
  | 'controle_input'
  | 'indicador_led'
  | 'indicador_status'
  | 'indicador_gauge';

interface DashboardComponent {
  id: string;
  nome: string;
  tipo: DashboardComponentType;
  descricao: string | null;
  icone: string | null;
  configuracao_padrao: Record<string, unknown>;
  ativo: boolean;
}

const componentTypes: { value: DashboardComponentType; label: string; category: string }[] = [
  { value: 'sensor_tensao', label: 'Tensão', category: 'Sensores' },
  { value: 'sensor_temperatura', label: 'Temperatura', category: 'Sensores' },
  { value: 'sensor_umidade', label: 'Umidade', category: 'Sensores' },
  { value: 'sensor_corrente', label: 'Corrente', category: 'Sensores' },
  { value: 'sensor_generico', label: 'Genérico', category: 'Sensores' },
  { value: 'controle_botao', label: 'Botão', category: 'Controles' },
  { value: 'controle_slider', label: 'Slider', category: 'Controles' },
  { value: 'controle_switch', label: 'Switch', category: 'Controles' },
  { value: 'controle_input', label: 'Input', category: 'Controles' },
  { value: 'indicador_led', label: 'LED', category: 'Indicadores' },
  { value: 'indicador_status', label: 'Status', category: 'Indicadores' },
  { value: 'indicador_gauge', label: 'Gauge', category: 'Indicadores' },
];

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Zap, Thermometer, Droplets, Activity, Gauge,
  Square, SlidersHorizontal, ToggleLeft, Hash,
  Circle, Info,
};

const typeIconMap: Record<DashboardComponentType, string> = {
  sensor_tensao: 'Zap',
  sensor_temperatura: 'Thermometer',
  sensor_umidade: 'Droplets',
  sensor_corrente: 'Activity',
  sensor_generico: 'Gauge',
  controle_botao: 'Square',
  controle_slider: 'SlidersHorizontal',
  controle_switch: 'ToggleLeft',
  controle_input: 'Hash',
  indicador_led: 'Circle',
  indicador_status: 'Info',
  indicador_gauge: 'Gauge',
};

const emptyComponent: Omit<DashboardComponent, "id"> = {
  nome: "",
  tipo: "sensor_generico",
  descricao: "",
  icone: "Gauge",
  configuracao_padrao: {},
  ativo: true,
};

export default function AdminDashComponents() {
  const [components, setComponents] = useState<DashboardComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingComponent, setEditingComponent] = useState<Partial<DashboardComponent> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [configInput, setConfigInput] = useState("");

  const fetchComponents = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("dashboard_components")
      .select("*")
      .order("tipo", { ascending: true });

    if (error) {
      toast.error("Erro ao carregar componentes");
    } else {
      setComponents((data || []).map(d => ({
        ...d,
        tipo: d.tipo as DashboardComponentType,
        configuracao_padrao: (d.configuracao_padrao || {}) as Record<string, unknown>,
      })));
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchComponents();
  }, []);

  const openNewDialog = () => {
    setEditingComponent(emptyComponent);
    setConfigInput("{}");
    setIsNew(true);
    setDialogOpen(true);
  };

  const openEditDialog = (component: DashboardComponent) => {
    setEditingComponent(component);
    setConfigInput(JSON.stringify(component.configuracao_padrao, null, 2));
    setIsNew(false);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!editingComponent?.nome || !editingComponent?.tipo) {
      toast.error("Preencha os campos obrigatórios");
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
      nome: editingComponent.nome,
      tipo: editingComponent.tipo,
      descricao: editingComponent.descricao || null,
      icone: editingComponent.icone || typeIconMap[editingComponent.tipo],
      configuracao_padrao: config,
      ativo: editingComponent.ativo ?? true,
    };

    if (isNew) {
      const { error } = await supabase.from("dashboard_components").insert(payload);
      if (error) {
        toast.error("Erro ao criar componente");
        return;
      }
      toast.success("Componente criado com sucesso");
    } else {
      const { error } = await supabase
        .from("dashboard_components")
        .update(payload)
        .eq("id", editingComponent.id);
      if (error) {
        toast.error("Erro ao atualizar componente");
        return;
      }
      toast.success("Componente atualizado com sucesso");
    }

    setDialogOpen(false);
    fetchComponents();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este componente?")) return;

    const { error } = await supabase.from("dashboard_components").delete().eq("id", id);

    if (error) {
      toast.error("Erro ao excluir componente");
      return;
    }

    toast.success("Componente excluído com sucesso");
    fetchComponents();
  };

  const getIcon = (iconName: string | null) => {
    const IconComponent = iconName ? iconMap[iconName] : Gauge;
    return IconComponent || Gauge;
  };

  const getTypeLabel = (tipo: DashboardComponentType) => {
    return componentTypes.find(t => t.value === tipo)?.label || tipo;
  };

  const getTypeCategory = (tipo: DashboardComponentType) => {
    return componentTypes.find(t => t.value === tipo)?.category || "Outro";
  };

  const filteredComponents = components.filter(c =>
    c.nome.toLowerCase().includes(search.toLowerCase()) ||
    c.tipo.toLowerCase().includes(search.toLowerCase())
  );

  const groupedComponents = filteredComponents.reduce((acc, comp) => {
    const category = getTypeCategory(comp.tipo);
    if (!acc[category]) acc[category] = [];
    acc[category].push(comp);
    return acc;
  }, {} as Record<string, DashboardComponent[]>);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Componentes de Dashboard</h2>
            <p className="text-muted-foreground">Gerencie os componentes disponíveis para dashboards</p>
          </div>
          <Button onClick={openNewDialog}>
            <Plus className="w-4 h-4 mr-2" />
            Novo Componente
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar componentes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedComponents).map(([category, comps]) => (
                  <div key={category}>
                    <h3 className="text-sm font-semibold text-muted-foreground mb-3">{category}</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Componente</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Descrição</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {comps.map((component) => {
                          const Icon = getIcon(component.icone);
                          return (
                            <TableRow key={component.id}>
                              <TableCell className="font-medium">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                                    <Icon className="w-4 h-4 text-primary" />
                                  </div>
                                  {component.nome}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{getTypeLabel(component.tipo)}</Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground text-sm max-w-xs truncate">
                                {component.descricao || "-"}
                              </TableCell>
                              <TableCell>
                                <Badge variant={component.ativo ? "default" : "secondary"}>
                                  {component.ativo ? "Ativo" : "Inativo"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                  <Button variant="outline" size="icon" onClick={() => openEditDialog(component)}>
                                    <Pencil className="w-4 h-4" />
                                  </Button>
                                  <Button variant="outline" size="icon" onClick={() => handleDelete(component.id)}>
                                    <Trash2 className="w-4 h-4 text-destructive" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{isNew ? "Novo Componente" : "Editar Componente"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input
                  value={editingComponent?.nome || ""}
                  onChange={(e) => setEditingComponent(prev => ({ ...prev, nome: e.target.value }))}
                  placeholder="Ex: Temperatura Ambiente"
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo *</Label>
                <Select
                  value={editingComponent?.tipo || "sensor_generico"}
                  onValueChange={(value) => setEditingComponent(prev => ({ 
                    ...prev, 
                    tipo: value as DashboardComponentType,
                    icone: typeIconMap[value as DashboardComponentType]
                  }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['Sensores', 'Controles', 'Indicadores'].map(category => (
                      <div key={category}>
                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{category}</div>
                        {componentTypes.filter(t => t.category === category).map(type => (
                          <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                        ))}
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea
                  value={editingComponent?.descricao || ""}
                  onChange={(e) => setEditingComponent(prev => ({ ...prev, descricao: e.target.value }))}
                  placeholder="Descrição do componente..."
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label>Configuração Padrão (JSON)</Label>
                <Textarea
                  value={configInput}
                  onChange={(e) => setConfigInput(e.target.value)}
                  placeholder='{"min": 0, "max": 100, "unidade": "°C"}'
                  rows={4}
                  className="font-mono text-sm"
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={editingComponent?.ativo ?? true}
                  onCheckedChange={(checked) => setEditingComponent(prev => ({ ...prev, ativo: checked }))}
                />
                <Label>Componente Ativo</Label>
              </div>
              <Button onClick={handleSave} className="w-full">
                {isNew ? "Criar Componente" : "Salvar Alterações"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}