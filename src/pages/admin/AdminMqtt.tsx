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
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Search, Loader2, Server, Lock } from "lucide-react";
import AdminLayout from "./AdminLayout";

interface MqttServer {
  id: string;
  nome: string;
  host: string;
  porta: number;
  usa_ssl: boolean;
  usuario: string | null;
  topico_padrao: string | null;
  descricao: string | null;
  ativo: boolean;
}

const emptyServer: Omit<MqttServer, "id"> = {
  nome: "",
  host: "",
  porta: 1883,
  usa_ssl: false,
  usuario: "",
  topico_padrao: "",
  descricao: "",
  ativo: true,
};

export default function AdminMqtt() {
  const [servers, setServers] = useState<MqttServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingServer, setEditingServer] = useState<Partial<MqttServer> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isNew, setIsNew] = useState(false);

  const fetchServers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("mqtt_servers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Erro ao carregar servidores");
    } else {
      setServers(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchServers();
  }, []);

  const openNewDialog = () => {
    setEditingServer(emptyServer);
    setIsNew(true);
    setDialogOpen(true);
  };

  const openEditDialog = (server: MqttServer) => {
    setEditingServer(server);
    setIsNew(false);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!editingServer?.nome || !editingServer?.host) {
      toast.error("Preencha os campos obrigatórios");
      return;
    }

    const payload = {
      nome: editingServer.nome,
      host: editingServer.host,
      porta: editingServer.porta || 1883,
      usa_ssl: editingServer.usa_ssl ?? false,
      usuario: editingServer.usuario || null,
      topico_padrao: editingServer.topico_padrao || null,
      descricao: editingServer.descricao || null,
      ativo: editingServer.ativo ?? true,
    };

    if (isNew) {
      const { error } = await supabase.from("mqtt_servers").insert(payload);
      if (error) {
        toast.error("Erro ao criar servidor");
        return;
      }
      toast.success("Servidor criado com sucesso");
    } else {
      const { error } = await supabase
        .from("mqtt_servers")
        .update(payload)
        .eq("id", editingServer.id);
      if (error) {
        toast.error("Erro ao atualizar servidor");
        return;
      }
      toast.success("Servidor atualizado com sucesso");
    }

    setDialogOpen(false);
    fetchServers();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este servidor?")) return;

    const { error } = await supabase.from("mqtt_servers").delete().eq("id", id);

    if (error) {
      toast.error("Erro ao excluir servidor");
      return;
    }

    toast.success("Servidor excluído com sucesso");
    fetchServers();
  };

  const filteredServers = servers.filter(s =>
    s.nome.toLowerCase().includes(search.toLowerCase()) ||
    s.host.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Servidores MQTT</h2>
            <p className="text-muted-foreground">Configure os servidores MQTT para recepção de dados</p>
          </div>
          <Button onClick={openNewDialog}>
            <Plus className="w-4 h-4 mr-2" />
            Novo Servidor
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou host..."
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
                    <TableHead>Host</TableHead>
                    <TableHead>Porta</TableHead>
                    <TableHead>SSL</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredServers.map((server) => (
                    <TableRow key={server.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Server className="w-4 h-4 text-muted-foreground" />
                          {server.nome}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{server.host}</TableCell>
                      <TableCell>{server.porta}</TableCell>
                      <TableCell>
                        {server.usa_ssl ? (
                          <Lock className="w-4 h-4 text-green-500" />
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={server.ativo ? "default" : "secondary"}>
                          {server.ativo ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="icon" onClick={() => openEditDialog(server)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="outline" size="icon" onClick={() => handleDelete(server.id)}>
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
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{isNew ? "Novo Servidor MQTT" : "Editar Servidor"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input
                  value={editingServer?.nome || ""}
                  onChange={(e) => setEditingServer(prev => ({ ...prev, nome: e.target.value }))}
                  placeholder="Ex: Broker Principal"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Host *</Label>
                  <Input
                    value={editingServer?.host || ""}
                    onChange={(e) => setEditingServer(prev => ({ ...prev, host: e.target.value }))}
                    placeholder="Ex: mqtt.example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Porta</Label>
                  <Input
                    type="number"
                    value={editingServer?.porta || 1883}
                    onChange={(e) => setEditingServer(prev => ({ ...prev, porta: parseInt(e.target.value) || 1883 }))}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Usuário</Label>
                <Input
                  value={editingServer?.usuario || ""}
                  onChange={(e) => setEditingServer(prev => ({ ...prev, usuario: e.target.value }))}
                  placeholder="Usuário de autenticação"
                />
              </div>
              <div className="space-y-2">
                <Label>Tópico Padrão</Label>
                <Input
                  value={editingServer?.topico_padrao || ""}
                  onChange={(e) => setEditingServer(prev => ({ ...prev, topico_padrao: e.target.value }))}
                  placeholder="Ex: devices/#"
                />
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea
                  value={editingServer?.descricao || ""}
                  onChange={(e) => setEditingServer(prev => ({ ...prev, descricao: e.target.value }))}
                  placeholder="Descrição do servidor..."
                  rows={2}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={editingServer?.usa_ssl ?? false}
                    onCheckedChange={(checked) => setEditingServer(prev => ({ ...prev, usa_ssl: checked }))}
                  />
                  <Label>Usar SSL/TLS</Label>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={editingServer?.ativo ?? true}
                    onCheckedChange={(checked) => setEditingServer(prev => ({ ...prev, ativo: checked }))}
                  />
                  <Label>Servidor Ativo</Label>
                </div>
              </div>
              <Button onClick={handleSave} className="w-full">
                {isNew ? "Criar Servidor" : "Salvar Alterações"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
