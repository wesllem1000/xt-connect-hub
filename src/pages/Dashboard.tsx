import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin } from "@/hooks/useAdmin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Zap, LogOut, Cpu, Gauge, Settings, Activity, Plus, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import DeviceCard from "@/components/devices/DeviceCard";

interface Profile {
  nome_completo: string;
  tipo_usuario: "instalador" | "usuario_final";
}

interface Device {
  id: string;
  device_id: string;
  nome: string;
  tipo: string;
  localizacao: string | null;
  status: string;
  owner_id: string | null;
  isShared?: boolean;
  sharedBy?: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { isAdmin } = useAdmin();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        navigate("/auth");
        return;
      }

      // Buscar perfil
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("nome_completo, tipo_usuario")
        .eq("id", session.user.id)
        .single();

      if (profileError) {
        toast.error("Erro ao carregar perfil");
        console.error(profileError);
      } else {
        setProfile(profileData);
      }

      // Buscar dispositivos próprios
      const { data: ownDevices, error: devicesError } = await supabase
        .from("devices")
        .select("id, device_id, nome, tipo, localizacao, status, owner_id")
        .or(`owner_id.eq.${session.user.id},usuario_id.eq.${session.user.id}`);

      if (devicesError) {
        console.error(devicesError);
      }

      // Buscar dispositivos compartilhados
      const { data: sharedDevicesData } = await supabase
        .from("device_shares")
        .select(`
          device_id,
          shared_by_user_id,
          devices (
            id, device_id, nome, tipo, localizacao, status, owner_id
          )
        `)
        .eq("shared_with_user_id", session.user.id);

      // Buscar nomes dos que compartilharam
      let sharedWithNames: Record<string, string> = {};
      if (sharedDevicesData && sharedDevicesData.length > 0) {
        const userIds = [...new Set(sharedDevicesData.map(s => s.shared_by_user_id))];
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, nome_completo")
          .in("id", userIds);
        
        if (profiles) {
          sharedWithNames = profiles.reduce((acc, p) => {
            acc[p.id] = p.nome_completo;
            return acc;
          }, {} as Record<string, string>);
        }
      }

      // Combinar dispositivos
      const allDevices: Device[] = [
        ...(ownDevices || []).map(d => ({ ...d, isShared: false })),
        ...(sharedDevicesData || [])
          .filter(s => s.devices)
          .map(s => ({
            ...(s.devices as unknown as Device),
            isShared: true,
            sharedBy: sharedWithNames[s.shared_by_user_id] || "Usuário"
          }))
      ];

      // Remover duplicatas (caso o dispositivo próprio também apareça como compartilhado)
      const uniqueDevices = allDevices.reduce((acc, device) => {
        if (!acc.find(d => d.id === device.id)) {
          acc.push(device);
        }
        return acc;
      }, [] as Device[]);

      setDevices(uniqueDevices);
      setLoading(false);
    };

    fetchData();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        navigate("/auth");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Erro ao sair");
    } else {
      toast.success("Até logo!");
      navigate("/auth");
    }
  };

  const onlineDevices = devices.filter(d => d.status === "online").length;
  const ownDevices = devices.filter(d => !d.isShared).length;
  const sharedDevices = devices.filter(d => d.isShared).length;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-glow">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">XT CONECT</h1>
              <p className="text-xs text-muted-foreground">by XT AUTOMATIZE</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium">{profile?.nome_completo}</p>
              <Badge variant="outline" className="text-xs">
                {profile?.tipo_usuario === "instalador" ? "Instalador" : "Usuário Final"}
              </Badge>
            </div>
            {isAdmin && (
              <Button variant="outline" asChild>
                <Link to="/admin">
                  <Shield className="h-4 w-4 mr-2" />
                  Admin
                </Link>
              </Button>
            )}
            <Button variant="outline" size="icon" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="mb-8 animate-slide-up">
          <h2 className="text-3xl font-bold mb-2">
            Bem-vindo, {profile?.nome_completo?.split(" ")[0]}! 👋
          </h2>
          <p className="text-muted-foreground">
            {profile?.tipo_usuario === "instalador" 
              ? "Gerencie dispositivos e instalações de seus clientes"
              : "Controle seus dispositivos e automações inteligentes"}
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Dispositivos
                </CardTitle>
                <Cpu className="h-4 w-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{ownDevices}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {sharedDevices > 0 && `+ ${sharedDevices} compartilhados`}
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Online
                </CardTitle>
                <Activity className="h-4 w-4 text-green-500" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{onlineDevices}</div>
              <p className="text-xs text-muted-foreground mt-1">Dispositivos ativos</p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Automações
                </CardTitle>
                <Gauge className="h-4 w-4 text-secondary" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">0</div>
              <p className="text-xs text-muted-foreground mt-1">Automações ativas</p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Configurações
                </CardTitle>
                <Settings className="h-4 w-4 text-blue-500" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">-</div>
              <p className="text-xs text-muted-foreground mt-1">Ver configurações</p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Ações Rápidas</CardTitle>
              <CardDescription>
                Gerencie seus dispositivos e automações
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button 
                className="w-full justify-start gradient-primary" 
                size="lg"
                onClick={() => navigate("/devices/new")}
              >
                <Plus className="mr-2 h-5 w-5" />
                {profile?.tipo_usuario === "instalador" 
                  ? "Adicionar Novo Dispositivo"
                  : "Conectar Dispositivo"}
              </Button>
              <Button variant="outline" className="w-full justify-start" size="lg">
                <Gauge className="mr-2 h-5 w-5" />
                Criar Nova Automação
              </Button>
              <Button variant="outline" className="w-full justify-start" size="lg">
                <Activity className="mr-2 h-5 w-5" />
                Ver Monitoramento
              </Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Meus Dispositivos</CardTitle>
                  <CardDescription>
                    {devices.length === 0 
                      ? "Nenhum dispositivo cadastrado ainda"
                      : `${devices.length} dispositivo(s) cadastrado(s)`
                    }
                  </CardDescription>
                </div>
                {devices.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => navigate("/devices/new")}>
                    <Plus className="h-4 w-4 mr-1" />
                    Novo
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {devices.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Cpu className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-sm">
                    {profile?.tipo_usuario === "instalador" 
                      ? "Comece adicionando dispositivos para seus clientes"
                      : "Conecte seu primeiro dispositivo para começar"}
                  </p>
                  <Button 
                    className="mt-4" 
                    onClick={() => navigate("/devices/new")}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Cadastrar Dispositivo
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {devices.slice(0, 4).map((device) => (
                    <DeviceCard key={device.id} device={device} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}