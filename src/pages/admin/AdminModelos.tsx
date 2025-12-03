import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Search, Loader2, LayoutGrid } from "lucide-react";
import AdminLayout from "./AdminLayout";

interface DeviceModel {
  id: string;
  nome: string;
  fabricante: string;
  descricao: string | null;
  especificacoes: Record<string, unknown>;
  protocolos_suportados: string[];
  imagem_url: string | null;
  ativo: boolean;
}

const emptyModel: Omit<DeviceModel, "id"> = {
  nome: "",
  fabricante: "",
  descricao: "",
  especificacoes: {},
  protocolos_suportados: [],
  imagem_url: "",
  ativo: true,
};

export default function AdminModelos() {
  const [models, setModels] = useState<DeviceModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingModel, setEditingModel] = useState<Partial<DeviceModel> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [protocolsInput, setProtocolsInput] = useState("");
  const [specsInput, setSpecsInput] = useState("");

  const fetchModels = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("device_models")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Erro ao carregar modelos");
    } else {
      setModels((data || []).map(d => ({
        ...d,
        especificacoes: (d.especificacoes || {}) as Record<string, unknown>,
      })));
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchModels();
  }, []);

  const openNewDialog = () => {
    setEditingModel(emptyModel);
    setProtocolsInput("");
    setSpecsInput("");
    setIsNew(true);
    setDialogOpen(true);
  };

  const openEditDialog = (model: DeviceModel) => {
    setEditingModel(model);
    setProtocolsInput(model.protocolos_suportados.join(", "));
    setSpecsInput(JSON.stringify(model.especificacoes, null, 2));
    setIsNew(false);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!editingModel?.nome || !editingModel?.fabricante) {
      toast.error("Preencha os campos obrigatórios");
      return;
    }

    let specs = {};
    try {
      specs = specsInput ? JSON.parse(specsInput) : {};
    } catch {
      toast.error("Especificações devem estar em formato JSON válido");
      return;
    }

    const protocols = protocolsInput.split(",").map(p => p.trim()).filter(Boolean);

    const payload = {
      nome: editingModel.nome,
      fabricante: editingModel.fabricante,
      descricao: editingModel.descricao || null,
      especificacoes: specs,
      protocolos_suportados: protocols,
      imagem_url: editingModel.imagem_url || null,
      ativo: editingModel.ativo ?? true,
    };

    if (isNew) {
      const { error } = await supabase.from("device_models").insert(payload);
      if (error) {
        toast.error("Erro ao criar modelo");
        return;
      }
      toast.success("Modelo criado com sucesso");
    } else {
      const { error } = await supabase
        .from("device_models")
        .update(payload)
        .eq("id", editingModel.id);
      if (error) {
        toast.error("Erro ao atualizar modelo");
        return;
      }
      toast.success("Modelo atualizado com sucesso");
    }

    setDialogOpen(false);
    fetchModels();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este modelo?")) return;

    const { error } = await supabase.from("device_models").delete().eq("id", id);

    if (error) {
      toast.error("Erro ao excluir modelo");
      return;
    }

    toast.success("Modelo excluído com sucesso");
    fetchModels();
  };

  const filteredModels = models.filter(m =>
    m.nome.toLowerCase().includes(search.toLowerCase()) ||
    m.fabricante.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Modelos de Dispositivos</h2>
            <p className="text-muted-foreground">Cadastre e gerencie os modelos de dispositivos</p>
          </div>
          <Button onClick={openNewDialog}>
            <Plus className="w-4 h-4 mr-2" />
            Novo Modelo
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou fabricante..."
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Fabricante</TableHead>
                    <TableHead>Protocolos</TableHead>
                    <TableHead>Dashboards</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredModels.map((model) => (
                    <TableRow key={model.id}>
                      <TableCell className="font-medium">{model.nome}</TableCell>
                      <TableCell>{model.fabricante}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {model.protocolos_suportados.slice(0, 3).map((p) => (
                            <Badge key={p} variant="outline" className="text-xs">
                              {p}
                            </Badge>
                          ))}
                          {model.protocolos_suportados.length > 3 && (
                            <Badge variant="outline" className="text-xs">
                              +{model.protocolos_suportados.length - 3}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/admin/modelos/${model.id}/dashboards`}>
                            <LayoutGrid className="w-4 h-4 mr-1" />
                            Configurar
                          </Link>
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Badge variant={model.ativo ? "default" : "secondary"}>
                          {model.ativo ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="icon" onClick={() => openEditDialog(model)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="outline" size="icon" onClick={() => handleDelete(model.id)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{isNew ? "Novo Modelo" : "Editar Modelo"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome *</Label>
                  <Input
                    value={editingModel?.nome || ""}
                    onChange={(e) => setEditingModel(prev => ({ ...prev, nome: e.target.value }))}
                    placeholder="Ex: Sensor de Temperatura T100"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Fabricante *</Label>
                  <Input
                    value={editingModel?.fabricante || ""}
                    onChange={(e) => setEditingModel(prev => ({ ...prev, fabricante: e.target.value }))}
                    placeholder="Ex: XT Devices"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea
                  value={editingModel?.descricao || ""}
                  onChange={(e) => setEditingModel(prev => ({ ...prev, descricao: e.target.value }))}
                  placeholder="Descrição do dispositivo..."
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Protocolos Suportados (separados por vírgula)</Label>
                <Input
                  value={protocolsInput}
                  onChange={(e) => setProtocolsInput(e.target.value)}
                  placeholder="Ex: MQTT, HTTP, WebSocket"
                />
              </div>
              <div className="space-y-2">
                <Label>Especificações Técnicas (JSON)</Label>
                <Textarea
                  value={specsInput}
                  onChange={(e) => setSpecsInput(e.target.value)}
                  placeholder='Ex: {"tensao": "5V", "consumo": "50mA"}'
                  rows={4}
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label>URL da Imagem</Label>
                <Input
                  value={editingModel?.imagem_url || ""}
                  onChange={(e) => setEditingModel(prev => ({ ...prev, imagem_url: e.target.value }))}
                  placeholder="https://..."
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={editingModel?.ativo ?? true}
                  onCheckedChange={(checked) => setEditingModel(prev => ({ ...prev, ativo: checked }))}
                />
                <Label>Modelo Ativo</Label>
              </div>
              <Button onClick={handleSave} className="w-full">
                {isNew ? "Criar Modelo" : "Salvar Alterações"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
