import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin } from "@/hooks/useAdmin";
import { useSystemConfig, isDeviceOnline } from "@/hooks/useSystemConfig";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Zap, LogOut, Cpu, Gauge, Settings, Activity, Plus, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import DeviceCard from "@/components/devices/DeviceCard";
import { ThemeToggle } from "@/components/ThemeToggle";

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
  ultima_conexao: string | null;
  owner_id: string | null;
  isShared?: boolean;
  sharedBy?: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { isAdmin } = useAdmin();
  const { config } = useSystemConfig();
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
        .select("id, device_id, nome, tipo, localizacao, status, ultima_conexao, owner_id")
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
            id, device_id, nome, tipo, localizacao, status, ultima_conexao, owner_id
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
        ...(ownDevices || []).map(d => ({ ...d, isShared: false, ultima_conexao: d.ultima_conexao || null })),
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

  const onlineDevices = devices.filter(d => isDeviceOnline(d.ultima_conexao, config.status_timeout_minutes)).length;
  const ownDevicesCount = devices.filter(d => !d.isShared).length;
  const sharedDevicesCount = devices.filter(d => d.isShared).length;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen min-h-[100dvh] bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50 safe-area-inset-top">
        <div className="container mx-auto px-3 sm:px-4 py-3 sm:py-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-glow shrink-0">
              <Zap className="w-5 h-5 sm:w-6 sm:h-6 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold truncate">XT CONECT</h1>
              <p className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">by XT AUTOMATIZE</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <div className="text-right hidden md:block">
              <p className="text-sm font-medium truncate max-w-[150px]">{profile?.nome_completo}</p>
              <Badge variant="outline" className="text-xs">
                {profile?.tipo_usuario === "instalador" ? "Instalador" : "Usuário Final"}
              </Badge>
            </div>
            <ThemeToggle />
            {isAdmin && (
              <Button variant="outline" size="sm" asChild className="hidden sm:flex">
                <Link to="/admin">
                  <Shield className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Admin</span>
                </Link>
              </Button>
            )}
            {isAdmin && (
              <Button variant="outline" size="icon" asChild className="sm:hidden min-touch-none h-9 w-9">
                <Link to="/admin">
                  <Shield className="h-4 w-4" />
                </Link>
              </Button>
            )}
            <Button variant="outline" size="icon" onClick={handleLogout} className="min-touch-none h-9 w-9">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-8 pb-safe">
        <div className="mb-6 sm:mb-8 animate-slide-up">
          <h2 className="text-xl sm:text-3xl font-bold mb-1 sm:mb-2">
            Olá, {profile?.nome_completo?.split(" ")[0]}! 👋
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground">
            {profile?.tipo_usuario === "instalador" 
              ? "Gerencie dispositivos e instalações"
              : "Controle seus dispositivos"}
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 mb-6 sm:mb-8">
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-2 sm:pb-3 p-3 sm:p-6">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                  Dispositivos
                </CardTitle>
                <Cpu className="h-4 w-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent className="p-3 sm:p-6 pt-0">
              <div className="text-xl sm:text-2xl font-bold">{ownDevicesCount}</div>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 truncate">
                {sharedDevicesCount > 0 && `+ ${sharedDevicesCount} compartilhados`}
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-2 sm:pb-3 p-3 sm:p-6">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                  Online
                </CardTitle>
                <Activity className="h-4 w-4 text-success" />
              </div>
            </CardHeader>
            <CardContent className="p-3 sm:p-6 pt-0">
              <div className="text-xl sm:text-2xl font-bold">{onlineDevices}</div>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">Ativos</p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-2 sm:pb-3 p-3 sm:p-6">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                  Automações
                </CardTitle>
                <Gauge className="h-4 w-4 text-secondary" />
              </div>
            </CardHeader>
            <CardContent className="p-3 sm:p-6 pt-0">
              <div className="text-xl sm:text-2xl font-bold">0</div>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">Ativas</p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-2 sm:pb-3 p-3 sm:p-6">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                  Config
                </CardTitle>
                <Settings className="h-4 w-4 text-info" />
              </div>
            </CardHeader>
            <CardContent className="p-3 sm:p-6 pt-0">
              <div className="text-xl sm:text-2xl font-bold">-</div>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">Ver</p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions & Devices */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-8">
          <Card className="lg:col-span-1">
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="text-base sm:text-lg">Ações Rápidas</CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Gerencie seus dispositivos
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-0 space-y-2 sm:space-y-3">
              <Button 
                className="w-full justify-start gradient-primary text-sm sm:text-base" 
                size="lg"
                onClick={() => navigate("/devices/new")}
              >
                <Plus className="mr-2 h-4 w-4 sm:h-5 sm:w-5 shrink-0" />
                <span className="truncate">
                  {profile?.tipo_usuario === "instalador" 
                    ? "Adicionar Dispositivo"
                    : "Conectar Dispositivo"}
                </span>
              </Button>
              <Button variant="outline" className="w-full justify-start text-sm sm:text-base" size="lg">
                <Gauge className="mr-2 h-4 w-4 sm:h-5 sm:w-5 shrink-0" />
                <span className="truncate">Nova Automação</span>
              </Button>
              <Button variant="outline" className="w-full justify-start text-sm sm:text-base" size="lg">
                <Activity className="mr-2 h-4 w-4 sm:h-5 sm:w-5 shrink-0" />
                <span className="truncate">Ver Monitoramento</span>
              </Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader className="p-4 sm:p-6">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="text-base sm:text-lg truncate">Meus Dispositivos</CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    {devices.length === 0 
                      ? "Nenhum dispositivo"
                      : `${devices.length} dispositivo(s)`
                    }
                  </CardDescription>
                </div>
                {devices.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => navigate("/devices/new")} className="shrink-0">
                    <Plus className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">Novo</span>
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-0">
              {devices.length === 0 ? (
                <div className="text-center py-8 sm:py-12 text-muted-foreground">
                  <Cpu className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-xs sm:text-sm">
                    {profile?.tipo_usuario === "instalador" 
                      ? "Adicione dispositivos para seus clientes"
                      : "Conecte seu primeiro dispositivo"}
                  </p>
                  <Button 
                    className="mt-4" 
                    size="sm"
                    onClick={() => navigate("/devices/new")}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Cadastrar
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  {devices.map((device) => (
                    <DeviceCard key={device.id} device={device} statusTimeoutMinutes={config.status_timeout_minutes} />
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