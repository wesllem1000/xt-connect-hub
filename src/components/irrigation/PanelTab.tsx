import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Droplets, Power, PowerOff, Wifi, WifiOff, Clock, AlertTriangle, Sprout, Radio } from "lucide-react";
import { IrrigationSnapshot } from "@/hooks/useIrrigationMQTT";

interface PanelTabProps {
  snapshot: IrrigationSnapshot | null;
  isCommandPending: boolean;
  onSetMode: (mode: "manual" | "automatic") => void;
  onSetPump: (on: boolean) => void;
  onSetSector: (index: number, open: boolean) => void;
  sectorNames?: Record<number, string>;
}

const DAY_LABELS: Record<string, string> = {
  mon: "Seg", tue: "Ter", wed: "Qua", thu: "Qui", fri: "Sex", sat: "Sáb", sun: "Dom"
};

export default function PanelTab({ snapshot, isCommandPending, onSetMode, onSetPump, onSetSector, sectorNames = {} }: PanelTabProps) {
  if (!snapshot) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <div className="text-center space-y-2">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          <p>Aguardando dados do dispositivo...</p>
        </div>
      </div>
    );
  }

  const isManual = snapshot.mode === "manual";
  const sectors = [
    { index: 1, enabled: snapshot.sector_1_enabled, on: snapshot.sector_1_on },
    { index: 2, enabled: snapshot.sector_2_enabled, on: snapshot.sector_2_on },
    { index: 3, enabled: snapshot.sector_3_enabled, on: snapshot.sector_3_on },
    { index: 4, enabled: snapshot.sector_4_enabled, on: snapshot.sector_4_on },
  ];

  return (
    <div className="space-y-4">
      {/* Warning banner */}
      {snapshot.warning && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive border border-destructive/20">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{snapshot.warning}</span>
        </div>
      )}

      {!snapshot.time_valid && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border border-yellow-500/20">
          <Clock className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">Hora do dispositivo inválida. Operações automáticas podem não funcionar corretamente.</span>
        </div>
      )}

      {/* Status indicators */}
      <div className="flex flex-wrap gap-2">
        <Badge variant={snapshot.wifi_connected ? "default" : "secondary"} className="gap-1">
          {snapshot.wifi_connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          WiFi
        </Badge>
        <Badge variant={snapshot.mqtt_connected ? "default" : "secondary"} className="gap-1">
          <Radio className="h-3 w-3" />
          MQTT
        </Badge>
        <Badge variant={snapshot.time_valid ? "default" : "destructive"} className="gap-1">
          <Clock className="h-3 w-3" />
          {snapshot.time_source || "NTP"}
        </Badge>
      </div>

      {/* Operation card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Droplets className="h-5 w-5 text-primary" />
            Operação
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mode */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Modo</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={isManual ? "default" : "outline"}
                onClick={() => onSetMode("manual")}
                disabled={isCommandPending}
              >
                Manual
              </Button>
              <Button
                size="sm"
                variant={!isManual ? "default" : "outline"}
                onClick={() => onSetMode("automatic")}
                disabled={isCommandPending}
              >
                Automático
              </Button>
            </div>
          </div>

          {/* Pump */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Bomba</span>
            <Button
              size="sm"
              variant={snapshot.pump_on ? "destructive" : "default"}
              onClick={() => onSetPump(!snapshot.pump_on)}
              disabled={isCommandPending || !isManual}
              className={`gap-1 ${!snapshot.pump_on ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
            >
              {snapshot.pump_on ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
              {snapshot.pump_on ? "Desligar" : "Ligar"}
            </Button>
          </div>
          {!isManual && (
            <p className="text-xs text-muted-foreground">Controle manual da bomba disponível apenas no modo manual.</p>
          )}
        </CardContent>
      </Card>

      {/* Sectors card */}
      {snapshot.sectorization_enabled && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Sprout className="h-5 w-5 text-green-600" />
              Setores
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {sectors.filter(s => s.enabled).map(sector => (
                <div key={sector.index} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                  <div>
                    <p className="text-sm font-medium">{sectorNames[sector.index] || `Setor ${sector.index}`}</p>
                    <Badge variant={sector.on ? "default" : "secondary"} className="text-xs mt-1">
                      {sector.on ? "Aberto" : "Fechado"}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant={sector.on ? "destructive" : "default"}
                    onClick={() => onSetSector(sector.index, !sector.on)}
                    disabled={isCommandPending || !isManual}
                    className={`${!sector.on ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
                  >
                    {sector.on ? "Fechar" : "Abrir"}
                  </Button>
                </div>
              ))}
            </div>
            {!isManual && (
              <p className="text-xs text-muted-foreground mt-2">Controle manual dos setores disponível apenas no modo manual.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Next event card */}
      {snapshot.next_event_time && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-500" />
              Próximo Evento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">
                  {snapshot.next_event_type === "pump" ? "Bomba" : `Setor ${snapshot.next_event_target}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(snapshot.next_event_time).toLocaleString("pt-BR")}
                </p>
              </div>
              <Badge variant="outline">Programado</Badge>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
