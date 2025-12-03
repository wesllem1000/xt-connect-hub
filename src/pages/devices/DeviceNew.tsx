import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Cpu, Loader2 } from "lucide-react";

interface DeviceModel {
  id: string;
  nome: string;
  fabricante: string;
  descricao: string | null;
  imagem_url: string | null;
}

export default function DeviceNew() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<DeviceModel[]>([]);
  const [formData, setFormData] = useState({
    device_id: "",
    device_model_id: "",
    nome: "",
    localizacao: ""
  });

  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = async () => {
    const { data, error } = await supabase
      .from("device_models")
      .select("id, nome, fabricante, descricao, imagem_url")
      .eq("ativo", true)
      .order("nome");

    if (error) {
      toast.error("Erro ao carregar modelos");
      console.error(error);
    } else {
      setModels(data || []);
    }
  };

  const checkDeviceIdExists = async (deviceId: string) => {
    const { data, error } = await supabase
      .from("devices")
      .select("id, owner_id")
      .eq("device_id", deviceId)
      .maybeSingle();

    if (error) {
      console.error(error);
      return { exists: false, ownedByOther: false };
    }

    if (data) {
      const { data: session } = await supabase.auth.getSession();
      const currentUserId = session?.session?.user?.id;
      return { 
        exists: true, 
        ownedByOther: data.owner_id !== currentUserId 
      };
    }

    return { exists: false, ownedByOther: false };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.device_id || !formData.device_model_id || !formData.nome) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    setLoading(true);

    try {
      // Verificar se device_id já existe
      const { exists, ownedByOther } = await checkDeviceIdExists(formData.device_id);
      
      if (exists && ownedByOther) {
        toast.error("Este dispositivo já foi cadastrado por outro usuário");
        setLoading(false);
        return;
      }

      if (exists && !ownedByOther) {
        toast.error("Você já cadastrou este dispositivo");
        setLoading(false);
        return;
      }

      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.user?.id) {
        toast.error("Sessão expirada. Faça login novamente.");
        navigate("/auth");
        return;
      }

      const selectedModel = models.find(m => m.id === formData.device_model_id);

      const { data, error } = await supabase
        .from("devices")
        .insert({
          device_id: formData.device_id,
          device_model_id: formData.device_model_id,
          nome: formData.nome,
          tipo: selectedModel?.nome || "Dispositivo",
          modelo: selectedModel?.fabricante || "",
          localizacao: formData.localizacao || null,
          owner_id: session.session.user.id,
          usuario_id: session.session.user.id,
          status: "offline"
        })
        .select()
        .single();

      if (error) {
        console.error(error);
        toast.error("Erro ao cadastrar dispositivo");
      } else {
        toast.success("Dispositivo cadastrado com sucesso!");
        navigate(`/devices/${data.id}`);
      }
    } catch (err) {
      console.error(err);
      toast.error("Erro inesperado ao cadastrar dispositivo");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">Cadastrar Dispositivo</h1>
            <p className="text-xs text-muted-foreground">Adicione um novo dispositivo à sua conta</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5" />
              Novo Dispositivo
            </CardTitle>
            <CardDescription>
              Preencha as informações do seu dispositivo. O ID do dispositivo é único e vem gravado no hardware.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="device_id">ID do Dispositivo *</Label>
                <Input
                  id="device_id"
                  placeholder="Ex: XT-001-ABC123"
                  value={formData.device_id}
                  onChange={(e) => setFormData({ ...formData, device_id: e.target.value.toUpperCase() })}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Este é o código único gravado no hardware do dispositivo
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="device_model_id">Modelo do Dispositivo *</Label>
                <Select
                  value={formData.device_model_id}
                  onValueChange={(value) => setFormData({ ...formData, device_model_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o modelo" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        <div className="flex flex-col">
                          <span>{model.nome}</span>
                          <span className="text-xs text-muted-foreground">{model.fabricante}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="nome">Nome do Dispositivo *</Label>
                <Input
                  id="nome"
                  placeholder="Ex: Sensor da Sala"
                  value={formData.nome}
                  onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="localizacao">Localização (opcional)</Label>
                <Input
                  id="localizacao"
                  placeholder="Ex: Sala de Estar"
                  value={formData.localizacao}
                  onChange={(e) => setFormData({ ...formData, localizacao: e.target.value })}
                />
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => navigate("/dashboard")}
                >
                  Cancelar
                </Button>
                <Button type="submit" className="flex-1" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Cadastrar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
