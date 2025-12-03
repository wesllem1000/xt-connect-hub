import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Search, Loader2, Radio, Wifi, Globe } from "lucide-react";
import AdminLayout from "./AdminLayout";

interface CommunicationType {
  id: string;
  nome: string;
  tipo: string;
  descricao: string | null;
  configuracao_padrao: Record<string, unknown>;
  ativo: boolean;
}

const emptyComm: Omit<CommunicationType, "id"> = {
  nome: "",
  tipo: "mqtt",
  descricao: "",
  configuracao_padrao: {},
  ativo: true,
};

const typeIcons = {
  mqtt: Radio,
  http: Globe,
  websocket: Wifi,
};

export default function AdminComunicacao() {
  const [comms, setComms] = useState<CommunicationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingComm, setEditingComm] = useState<Partial<CommunicationType> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [configInput, setConfigInput] = useState("");

  const fetchComms = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("communication_types")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Erro ao carregar tipos de comunicação");
    } else {
      setComms((data || []).map(c => ({
        ...c,
        configuracao_padrao: (c.configuracao_padrao || {}) as Record<string, unknown>,
      })));
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchComms();
  }, []);

  const openNewDialog = () => {
    setEditingComm(emptyComm);
    setConfigInput("");
    setIsNew(true);
    setDialogOpen(true);
  };

  const openEditDialog = (comm: CommunicationType) => {
    setEditingComm(comm);
    setConfigInput(JSON.stringify(comm.configuracao_padrao, null, 2));
    setIsNew(false);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!editingComm?.nome || !editingComm?.tipo) {
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
      nome: editingComm.nome,
      tipo: editingComm.tipo,
      descricao: editingComm.descricao || null,
      configuracao_padrao: config,
      ativo: editingComm.ativo ?? true,
    };

    if (isNew) {
      const { error } = await supabase.from("communication_types").insert(payload);
      if (error) {
        toast.error("Erro ao criar tipo de comunicação");
        return;
      }
      toast.success("Tipo de comunicação criado com sucesso");
    } else {
      const { error } = await supabase
        .from("communication_types")
        .update(payload)
        .eq("id", editingComm.id);
      if (error) {
        toast.error("Erro ao atualizar tipo de comunicação");
        return;
      }
      toast.success("Tipo de comunicação atualizado com sucesso");
    }

    setDialogOpen(false);
    fetchComms();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este tipo de comunicação?")) return;

    const { error } = await supabase.from("communication_types").delete().eq("id", id);

    if (error) {
      toast.error("Erro ao excluir tipo de comunicação");
      return;
    }

    toast.success("Tipo de comunicação excluído com sucesso");
    fetchComms();
  };

  const filteredComms = comms.filter(c =>
    c.nome.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Tipos de Comunicação</h2>
            <p className="text-muted-foreground">Configure os tipos de comunicação suportados</p>
          </div>
          <Button onClick={openNewDialog}>
            <Plus className="w-4 h-4 mr-2" />
            Novo Tipo
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar..."
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
                    <TableHead>Tipo</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredComms.map((comm) => {
                    const Icon = typeIcons[comm.tipo];
                    return (
                      <TableRow key={comm.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4 text-muted-foreground" />
                            {comm.nome}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="uppercase">
                            {comm.tipo}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-xs truncate">
                          {comm.descricao || "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={comm.ativo ? "default" : "secondary"}>
                            {comm.ativo ? "Ativo" : "Inativo"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="icon" onClick={() => openEditDialog(comm)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button variant="outline" size="icon" onClick={() => handleDelete(comm.id)}>
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
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{isNew ? "Novo Tipo de Comunicação" : "Editar Tipo"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input
                  value={editingComm?.nome || ""}
                  onChange={(e) => setEditingComm(prev => ({ ...prev, nome: e.target.value }))}
                  placeholder="Ex: MQTT Broker Principal"
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo *</Label>
                <Select
                  value={editingComm?.tipo}
                  onValueChange={(value: "mqtt" | "http" | "websocket") =>
                    setEditingComm(prev => ({ ...prev, tipo: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mqtt">MQTT</SelectItem>
                    <SelectItem value="http">HTTP</SelectItem>
                    <SelectItem value="websocket">WebSocket</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea
                  value={editingComm?.descricao || ""}
                  onChange={(e) => setEditingComm(prev => ({ ...prev, descricao: e.target.value }))}
                  placeholder="Descrição do tipo de comunicação..."
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label>Configuração Padrão (JSON)</Label>
                <Textarea
                  value={configInput}
                  onChange={(e) => setConfigInput(e.target.value)}
                  placeholder='Ex: {"qos": 1, "retain": false}'
                  rows={4}
                  className="font-mono text-sm"
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={editingComm?.ativo ?? true}
                  onCheckedChange={(checked) => setEditingComm(prev => ({ ...prev, ativo: checked }))}
                />
                <Label>Tipo Ativo</Label>
              </div>
              <Button onClick={handleSave} className="w-full">
                {isNew ? "Criar Tipo" : "Salvar Alterações"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
