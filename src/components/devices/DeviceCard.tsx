import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Cpu, Wifi, WifiOff, Share2, MapPin } from "lucide-react";
import { isDeviceOnline } from "@/hooks/useSystemConfig";

interface Device {
  id: string;
  device_id: string;
  nome: string;
  tipo: string;
  localizacao: string | null;
  status: string;
  ultima_conexao: string | null;
  isShared?: boolean;
  sharedBy?: string;
}

interface Props {
  device: Device;
  statusTimeoutMinutes: number;
}

export default function DeviceCard({ device, statusTimeoutMinutes }: Props) {
  const isOnline = isDeviceOnline(device.ultima_conexao, statusTimeoutMinutes);
  
  return (
    <Link to={`/devices/${device.id}`}>
      <Card className="hover:shadow-lg transition-all hover:border-primary/50 cursor-pointer group">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
              <Cpu className="h-5 w-5 text-primary" />
            </div>
            <div className="flex items-center gap-2">
              {device.isShared && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Share2 className="h-3 w-3" />
                </Badge>
              )}
              <Badge variant={isOnline ? "default" : "secondary"} className="gap-1">
                {isOnline ? (
                  <Wifi className="h-3 w-3" />
                ) : (
                  <WifiOff className="h-3 w-3" />
                )}
                {isOnline ? "Online" : "Offline"}
              </Badge>
            </div>
          </div>

          <div className="space-y-1">
            <h3 className="font-semibold truncate">{device.nome}</h3>
            <p className="text-xs text-muted-foreground font-mono">{device.device_id}</p>
          </div>

          {device.localizacao && (
            <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />
              <span className="truncate">{device.localizacao}</span>
            </div>
          )}

          {device.isShared && device.sharedBy && (
            <p className="text-xs text-muted-foreground mt-2">
              Compartilhado por: {device.sharedBy}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
