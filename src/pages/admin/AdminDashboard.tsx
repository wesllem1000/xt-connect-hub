import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Cpu, Radio, Server } from "lucide-react";
import AdminLayout from "./AdminLayout";

interface Stats {
  usuarios: number;
  modelos: number;
  comunicacoes: number;
  servidores: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats>({ usuarios: 0, modelos: 0, comunicacoes: 0, servidores: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      const [usuarios, modelos, comunicacoes, servidores] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("device_models").select("id", { count: "exact", head: true }),
        supabase.from("communication_types").select("id", { count: "exact", head: true }),
        supabase.from("mqtt_servers").select("id", { count: "exact", head: true }),
      ]);

      setStats({
        usuarios: usuarios.count || 0,
        modelos: modelos.count || 0,
        comunicacoes: comunicacoes.count || 0,
        servidores: servidores.count || 0,
      });
      setLoading(false);
    };

    fetchStats();
  }, []);

  const cards = [
    { title: "Total de Usuários", value: stats.usuarios, icon: Users, color: "text-blue-500" },
    { title: "Modelos de Dispositivos", value: stats.modelos, icon: Cpu, color: "text-green-500" },
    { title: "Tipos de Comunicação", value: stats.comunicacoes, icon: Radio, color: "text-orange-500" },
    { title: "Servidores MQTT", value: stats.servidores, icon: Server, color: "text-purple-500" },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Dashboard Administrativo</h2>
          <p className="text-muted-foreground">Visão geral do sistema</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {cards.map((card) => (
            <Card key={card.title}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.title}
                </CardTitle>
                <card.icon className={`w-5 h-5 ${card.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {loading ? "..." : card.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
