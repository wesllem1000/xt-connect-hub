import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Droplets, Power, PowerOff, Wifi, WifiOff, Clock, AlertTriangle, Sprout, Radio, Loader2 } from "lucide-react";
import { IrrigationSnapshot } from "@/hooks/useIrrigationMQTT";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface PanelTabProps {
  snapshot: IrrigationSnapshot | null;
  isCommandPending: boolean;
  onSetMode: (mode: "manual" | "automatic") => Promise<void>;
  onSetPump: (on: boolean) => Promise<void>;
  onSetSector: (index: number, open: boolean) => Promise<void>;
  sectorNames?: Record<number, string>;
}

export default function PanelTab({ snapshot, isCommandPending, onSetMode, onSetPump, onSetSector, sectorNames = {} }: PanelTabProps) {
  const [pumpLoading, setPumpLoading] = useState(false);
  const [modeLoading, setModeLoading] = useState(false);
  const [sectorLoading, setSectorLoading] = useState<Record<number, boolean>>({});
  const [currentMode, setCurrentMode] = useState<IrrigationSnapshot["mode"] | null>(snapshot?.mode ?? null);

  useEffect(() => {
    if (snapshot?.mode) {
      setCurrentMode(snapshot.mode);
    }
  }, [snapshot?.mode]);

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

  const isManual = currentMode === "manual";
  const sectors = [
    { index: 1, enabled: snapshot.sector_1_enabled, on: snapshot.sector_1_on },
    { index: 2, enabled: snapshot.sector_2_enabled, on: snapshot.sector_2_on },
    { index: 3, enabled: snapshot.sector_3_enabled, on: snapshot.sector_3_on },
    { index: 4, enabled: snapshot.sector_4_enabled, on: snapshot.sector_4_on },
  ];

  const handleSetMode = async (mode: "manual" | "automatic") => {
    const previousMode = currentMode;
    setCurrentMode(mode);
    setModeLoading(true);
    try {
      await onSetMode(mode);
      toast.success(`Modo alterado para ${mode === "manual" ? "Manual" : "Automático"}`);
    } catch (err) {
      setCurrentMode(previousMode);
      toast.error(err instanceof Error ? err.message : "Erro ao alterar modo");
    } finally {
      setModeLoading(false);
    }
  };

  const handleSetPump = async (on: boolean) => {
    setPumpLoading(true);
    try {
      await onSetPump(on);
      toast.success(`Bomba ${on ? "ligada" : "desligada"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao controlar bomba");
    } finally {
      setPumpLoading(false);
    }
  };

  const handleSetSector = async (index: number, open: boolean) => {
    setSectorLoading(prev => ({ ...prev, [index]: true }));
    try {
      await onSetSector(index, open);
      toast.success(`${sectorNames[index] || `Setor ${index}`} ${open ? "aberto" : "fechado"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao controlar setor");
    } finally {
      setSectorLoading(prev => ({ ...prev, [index]: false }));
    }
  };

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
        <CardContent className="space-y-6">
          {/* Mode */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Modo</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={isManual ? "default" : "outline"}
                onClick={() => handleSetMode("manual")}
                disabled={modeLoading || isCommandPending}
              >
                {modeLoading && isManual ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                Manual
              </Button>
              <Button
                size="sm"
                variant={!isManual ? "default" : "outline"}
                onClick={() => handleSetMode("automatic")}
                disabled={modeLoading || isCommandPending}
              >
                {modeLoading && !isManual ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                Automático
              </Button>
            </div>
          </div>

          {/* Pump visual status + control */}
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Animated pump indicator */}
                <div className={`relative flex items-center justify-center w-12 h-12 rounded-full border-2 transition-all duration-500 ${
                  snapshot.pump_on 
                    ? "border-green-500 bg-green-500/10" 
                    : "border-muted bg-muted/30"
                }`}>
                  <Droplets className={`h-6 w-6 transition-all duration-300 ${
                    snapshot.pump_on 
                      ? "text-green-600 animate-bounce" 
                      : "text-muted-foreground"
                  }`} />
                  {snapshot.pump_on && (
                    <span className="absolute inset-0 rounded-full border-2 border-green-500 animate-ping opacity-30" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium">Bomba</p>
                  <p className={`text-xs font-semibold ${snapshot.pump_on ? "text-green-600" : "text-muted-foreground"}`}>
                    {snapshot.pump_on ? "● Ligada" : "○ Desligada"}
                  </p>
                </div>
              </div>

              {isManual && (
                <Button
                  size="sm"
                  variant={snapshot.pump_on ? "destructive" : "default"}
                  onClick={() => handleSetPump(!snapshot.pump_on)}
                  disabled={pumpLoading || isCommandPending}
                  className={`gap-1 min-w-[100px] ${!snapshot.pump_on ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
                >
                  {pumpLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : snapshot.pump_on ? (
                    <PowerOff className="h-4 w-4" />
                  ) : (
                    <Power className="h-4 w-4" />
                  )}
                  {snapshot.pump_on ? "Desligar" : "Ligar"}
                </Button>
              )}
            </div>
            {!isManual && (
              <p className="text-xs text-muted-foreground">Controle manual da bomba disponível apenas no modo manual.</p>
            )}
          </div>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {sectors.filter(s => s.enabled).map(sector => (
                <div key={sector.index} className={`flex items-center justify-between p-3 rounded-lg border transition-all duration-300 ${
                  sector.on 
                    ? "border-green-500/50 bg-green-500/5" 
                    : "bg-card"
                }`}>
                  <div className="flex items-center gap-3">
                    {/* Sector visual indicator */}
                    <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all duration-300 ${
                      sector.on 
                        ? "border-green-500 bg-green-500/10" 
                        : "border-muted bg-muted/30"
                    }`}>
                      <Sprout className={`h-5 w-5 transition-colors duration-300 ${
                        sector.on ? "text-green-600" : "text-muted-foreground"
                      }`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{sectorNames[sector.index] || `Setor ${sector.index}`}</p>
                      <p className={`text-xs font-semibold ${sector.on ? "text-green-600" : "text-muted-foreground"}`}>
                        {sector.on ? "● Aberto" : "○ Fechado"}
                      </p>
                    </div>
                  </div>
                  {isManual && (
                    <Button
                      size="sm"
                      variant={sector.on ? "destructive" : "default"}
                      onClick={() => handleSetSector(sector.index, !sector.on)}
                      disabled={sectorLoading[sector.index] || isCommandPending}
                      className={`gap-1 ${!sector.on ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
                    >
                      {sectorLoading[sector.index] ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : sector.on ? (
                        <PowerOff className="h-4 w-4" />
                      ) : (
                        <Power className="h-4 w-4" />
                      )}
                      {sector.on ? "Fechar" : "Abrir"}
                    </Button>
                  )}
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
