import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Pencil, Trash2, Shield, Search, Loader2 } from "lucide-react";
import AdminLayout from "./AdminLayout";

interface Profile {
  id: string;
  nome_completo: string;
  tipo_usuario: "instalador" | "usuario_final";
  telefone: string | null;
  created_at: string;
  isAdmin?: boolean;
}

export default function AdminUsuarios() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchProfiles = async () => {
    setLoading(true);
    const { data: profilesData, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Erro ao carregar usuários");
      setLoading(false);
      return;
    }

    // Get admin roles
    const { data: rolesData } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    const adminIds = new Set(rolesData?.map(r => r.user_id) || []);

    setProfiles(
      (profilesData || []).map(p => ({
        ...p,
        isAdmin: adminIds.has(p.id)
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    fetchProfiles();
  }, []);

  const handleUpdate = async () => {
    if (!editingProfile) return;

    const { error } = await supabase
      .from("profiles")
      .update({
        nome_completo: editingProfile.nome_completo,
        tipo_usuario: editingProfile.tipo_usuario,
        telefone: editingProfile.telefone,
      })
      .eq("id", editingProfile.id);

    if (error) {
      toast.error("Erro ao atualizar usuário");
      return;
    }

    toast.success("Usuário atualizado com sucesso");
    setDialogOpen(false);
    fetchProfiles();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este usuário?")) return;

    const { error } = await supabase.from("profiles").delete().eq("id", id);

    if (error) {
      toast.error("Erro ao excluir usuário");
      return;
    }

    toast.success("Usuário excluído com sucesso");
    fetchProfiles();
  };

  const toggleAdmin = async (userId: string, isCurrentlyAdmin: boolean) => {
    if (isCurrentlyAdmin) {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", "admin");

      if (error) {
        toast.error("Erro ao remover permissão de admin");
        return;
      }
      toast.success("Permissão de admin removida");
    } else {
      const { error } = await supabase
        .from("user_roles")
        .insert({ user_id: userId, role: "admin" });

      if (error) {
        toast.error("Erro ao adicionar permissão de admin");
        return;
      }
      toast.success("Permissão de admin adicionada");
    }
    fetchProfiles();
  };

  const filteredProfiles = profiles.filter(p =>
    p.nome_completo.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Gerenciar Usuários</h2>
            <p className="text-muted-foreground">Gerencie todos os usuários do sistema</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
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
                    <TableHead>Telefone</TableHead>
                    <TableHead>Admin</TableHead>
                    <TableHead>Cadastro</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProfiles.map((profile) => (
                    <TableRow key={profile.id}>
                      <TableCell className="font-medium">{profile.nome_completo}</TableCell>
                      <TableCell>
                        <Badge variant={profile.tipo_usuario === "instalador" ? "default" : "secondary"}>
                          {profile.tipo_usuario === "instalador" ? "Instalador" : "Usuário Final"}
                        </Badge>
                      </TableCell>
                      <TableCell>{profile.telefone || "-"}</TableCell>
                      <TableCell>
                        {profile.isAdmin && (
                          <Badge className="bg-amber-500 text-white">Admin</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {new Date(profile.created_at).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => toggleAdmin(profile.id, !!profile.isAdmin)}
                            title={profile.isAdmin ? "Remover Admin" : "Tornar Admin"}
                          >
                            <Shield className={`w-4 h-4 ${profile.isAdmin ? "text-amber-500" : ""}`} />
                          </Button>
                          <Dialog open={dialogOpen && editingProfile?.id === profile.id} onOpenChange={(open) => {
                            setDialogOpen(open);
                            if (open) setEditingProfile(profile);
                          }}>
                            <DialogTrigger asChild>
                              <Button variant="outline" size="icon">
                                <Pencil className="w-4 h-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Editar Usuário</DialogTitle>
                              </DialogHeader>
                              <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                  <Label>Nome Completo</Label>
                                  <Input
                                    value={editingProfile?.nome_completo || ""}
                                    onChange={(e) =>
                                      setEditingProfile(prev => prev ? { ...prev, nome_completo: e.target.value } : null)
                                    }
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Tipo de Usuário</Label>
                                  <Select
                                    value={editingProfile?.tipo_usuario}
                                    onValueChange={(value: "instalador" | "usuario_final") =>
                                      setEditingProfile(prev => prev ? { ...prev, tipo_usuario: value } : null)
                                    }
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="usuario_final">Usuário Final</SelectItem>
                                      <SelectItem value="instalador">Instalador</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-2">
                                  <Label>Telefone</Label>
                                  <Input
                                    value={editingProfile?.telefone || ""}
                                    onChange={(e) =>
                                      setEditingProfile(prev => prev ? { ...prev, telefone: e.target.value } : null)
                                    }
                                  />
                                </div>
                                <Button onClick={handleUpdate} className="w-full">
                                  Salvar Alterações
                                </Button>
                              </div>
                            </DialogContent>
                          </Dialog>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => handleDelete(profile.id)}
                          >
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
      </div>
    </AdminLayout>
  );
}
