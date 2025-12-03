import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { ArrowLeft, Trash2, Share2, UserMinus, Loader2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface Device {
  id: string;
  device_id: string;
  nome: string;
  localizacao: string | null;
  owner_id: string | null;
}

interface DeviceShare {
  id: string;
  shared_with_user_id: string;
  created_at: string;
  shared_with_profile: {
    nome_completo: string;
  } | null;
}

export default function DeviceSettings() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const navigate = useNavigate();
  const [device, setDevice] = useState<Device | null>(null);
  const [shares, setShares] = useState<DeviceShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [sharingLoading, setSharingLoading] = useState(false);
  const [formData, setFormData] = useState({
    nome: "",
    localizacao: ""
  });

  useEffect(() => {
    if (deviceId) {
      fetchDevice();
      fetchShares();
    }
  }, [deviceId]);

  const fetchDevice = async () => {
    const { data, error } = await supabase
      .from("devices")
      .select("id, device_id, nome, localizacao, owner_id")
      .eq("id", deviceId)
      .maybeSingle();

    if (error || !data) {
      toast.error("Dispositivo não encontrado");
      navigate("/dashboard");
      return;
    }

    setDevice(data);
    setFormData({
      nome: data.nome,
      localizacao: data.localizacao || ""
    });
    setLoading(false);
  };

  const fetchShares = async () => {
    const { data, error } = await supabase
      .from("device_shares")
      .select(`
        id,
        shared_with_user_id,
        created_at
      `)
      .eq("device_id", deviceId);

    if (error) {
      console.error(error);
      return;
    }

    // Buscar perfis dos usuários compartilhados
    if (data && data.length > 0) {
      const userIds = data.map(s => s.shared_with_user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, nome_completo")
        .in("id", userIds);

      const sharesWithProfiles = data.map(share => ({
        ...share,
        shared_with_profile: profiles?.find(p => p.id === share.shared_with_user_id) || null
      }));

      setShares(sharesWithProfiles);
    } else {
      setShares([]);
    }
  };

  const handleSave = async () => {
    if (!formData.nome.trim()) {
      toast.error("O nome é obrigatório");
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("devices")
      .update({
        nome: formData.nome,
        localizacao: formData.localizacao || null
      })
      .eq("id", deviceId);

    if (error) {
      toast.error("Erro ao salvar alterações");
      console.error(error);
    } else {
      toast.success("Alterações salvas");
    }
    setSaving(false);
  };

  const handleShareByEmail = async () => {
    const email = shareEmail.trim().toLowerCase();
    
    if (!email) {
      toast.error("Digite o e-mail do usuário");
      return;
    }

    // Validação básica de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error("Digite um e-mail válido");
      return;
    }

    setSharingLoading(true);

    try {
      const { data: session } = await supabase.auth.getSession();
      const currentUserId = session?.session?.user?.id;
      const currentUserEmail = session?.session?.user?.email?.toLowerCase();

      if (email === currentUserEmail) {
        toast.error("Você não pode compartilhar consigo mesmo");
        setSharingLoading(false);
        return;
      }

      // Buscar usuário pelo email na tabela profiles
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, nome_completo, email")
        .ilike("email", email)
        .maybeSingle();

      if (profileError || !profile) {
        toast.error("Usuário não encontrado com este e-mail");
        setSharingLoading(false);
        return;
      }

      // Verificar se já existe compartilhamento
      const { data: existingShare } = await supabase
        .from("device_shares")
        .select("id")
        .eq("device_id", deviceId)
        .eq("shared_with_user_id", profile.id)
        .maybeSingle();

      if (existingShare) {
        toast.error("Dispositivo já compartilhado com este usuário");
        setSharingLoading(false);
        return;
      }

      // Criar compartilhamento
      const { error } = await supabase
        .from("device_shares")
        .insert({
          device_id: deviceId,
          shared_by_user_id: currentUserId,
          shared_with_user_id: profile.id
        });

      if (error) {
        console.error(error);
        toast.error("Erro ao compartilhar dispositivo");
      } else {
        toast.success(`Dispositivo compartilhado com ${profile.nome_completo}`);
        setShareEmail("");
        fetchShares();
      }
    } catch (err) {
      console.error(err);
      toast.error("Erro ao compartilhar dispositivo");
    } finally {
      setSharingLoading(false);
    }
  };

  const handleRemoveShare = async (shareId: string) => {
    const { error } = await supabase
      .from("device_shares")
      .delete()
      .eq("id", shareId);

    if (error) {
      toast.error("Erro ao remover compartilhamento");
      console.error(error);
    } else {
      toast.success("Compartilhamento removido");
      fetchShares();
    }
  };

  const handleDelete = async () => {
    const { error } = await supabase
      .from("devices")
      .delete()
      .eq("id", deviceId);

    if (error) {
      toast.error("Erro ao excluir dispositivo");
      console.error(error);
    } else {
      toast.success("Dispositivo excluído");
      navigate("/dashboard");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/devices/${deviceId}`)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">Configurações</h1>
            <p className="text-xs text-muted-foreground">{device?.nome}</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl space-y-6">
        {/* Informações básicas */}
        <Card>
          <CardHeader>
            <CardTitle>Informações do Dispositivo</CardTitle>
            <CardDescription>Edite as informações básicas do dispositivo</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>ID do Dispositivo</Label>
              <Input value={device?.device_id || ""} disabled className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nome">Nome</Label>
              <Input
                id="nome"
                value={formData.nome}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="localizacao">Localização</Label>
              <Input
                id="localizacao"
                value={formData.localizacao}
                onChange={(e) => setFormData({ ...formData, localizacao: e.target.value })}
              />
            </div>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar Alterações
            </Button>
          </CardContent>
        </Card>

        {/* Compartilhamento */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5" />
              Compartilhamento
            </CardTitle>
            <CardDescription>
              Compartilhe o acesso ao dispositivo com outros usuários
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="E-mail do usuário"
                value={shareEmail}
                onChange={(e) => setShareEmail(e.target.value)}
              />
              <Button 
                onClick={handleShareByEmail} 
                disabled={sharingLoading}
              >
                {sharingLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Compartilhar"
                )}
              </Button>
            </div>

            {shares.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <Label>Compartilhado com:</Label>
                  {shares.map((share) => (
                    <div key={share.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div>
                        <p className="font-medium">
                          {share.shared_with_profile?.nome_completo || "Usuário"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Desde {new Date(share.created_at).toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveShare(share.id)}
                      >
                        <UserMinus className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Zona de perigo */}
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Zona de Perigo</CardTitle>
            <CardDescription>
              Ações irreversíveis para o dispositivo
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="gap-2">
                  <Trash2 className="h-4 w-4" />
                  Excluir Dispositivo
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir dispositivo?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação não pode ser desfeita. O dispositivo será removido permanentemente
                    e todos os compartilhamentos serão cancelados.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>
                    Excluir
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
