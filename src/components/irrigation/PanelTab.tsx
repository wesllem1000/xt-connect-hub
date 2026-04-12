import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Droplets, Power, PowerOff, Wifi, WifiOff, Clock, AlertTriangle, Sprout, Radio, Loader2 } from "lucide-react";
import SectorStatusIndicator from "./SectorStatusIndicator";
import { IrrigationSnapshot, DeviceDecisionError } from "@/hooks/useIrrigationMQTT";
import { IrrigationFullConfig } from "@/hooks/useIrrigationMQTT";
import PumpStatusCard from "./PumpStatusCard";
import WaterFillEffect from "./WaterFillEffect";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

interface PanelTabProps {
  snapshot: IrrigationSnapshot | null;
  fullConfig: IrrigationFullConfig | null;
  isCommandPending: boolean;
  onSetMode: (mode: "manual" | "automatic") => Promise<void>;
  onSetPump: (on: boolean) => Promise<void>;
  onSetSector: (index: number, open: boolean) => Promise<void>;
  onSendCommand: (command: string, params: Record<string, unknown>) => Promise<unknown>;
  sectorNames?: Record<number, string>;
}

interface DecisionDialog {
  open: boolean;
  title: string;
  description: string;
  actions: Array<{ label: string; variant?: "default" | "destructive"; action: () => void }>;
}

export default function PanelTab({ snapshot, fullConfig, isCommandPending, onSetMode, onSetPump, onSetSector, onSendCommand, sectorNames = {} }: PanelTabProps) {
  const [pumpLoading, setPumpLoading] = useState(false);
  const [modeLoading, setModeLoading] = useState(false);
  const [sectorLoading, setSectorLoading] = useState<Record<number, boolean>>({});
  const [currentMode, setCurrentMode] = useState<IrrigationSnapshot["mode"] | null>(snapshot?.mode ?? null);
  const [localSectorStates, setLocalSectorStates] = useState<Record<number, boolean>>({});
  const [decisionDialog, setDecisionDialog] = useState<DecisionDialog>({ open: false, title: "", description: "", actions: [] });

  useEffect(() => {
    if (snapshot?.mode) {
      setCurrentMode(snapshot.mode);
    }
  }, [snapshot?.mode]);

  // Clear local sector states when snapshot confirms the value
  useEffect(() => {
    if (!snapshot?.sectors) return;
    setLocalSectorStates(prev => {
      const next = { ...prev };
      let changed = false;
      snapshot.sectors.forEach(s => {
        if (s.index in next && next[s.index] === s.open) {
          delete next[s.index];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [snapshot?.sectors]);

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
  const sectorizationEnabled = snapshot.sectorization_enabled || fullConfig?.sectorization_enabled || false;
  const sectorMap = new Map<number, { index: number; enabled: boolean; on: boolean; name: string }>();

  // Start with fullConfig for names/enabled metadata
  fullConfig?.sectors?.forEach((sector) => {
    sectorMap.set(sector.index, {
      index: sector.index,
      enabled: sector.enabled,
      on: false,
      name: sector.name,
    });
  });

  // Override with live snapshot data (priority)
  (snapshot.sectors || []).forEach((sector) => {
    const current = sectorMap.get(sector.index);
    sectorMap.set(sector.index, {
      index: sector.index,
      enabled: sector.enabled ?? current?.enabled ?? true,
      on: sector.open,
      name: sector.name || current?.name || `Setor ${sector.index}`,
    });
  });

  const sectors = Array.from(sectorMap.values()).sort((a, b) => a.index - b.index);

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
      if (err instanceof DeviceDecisionError && err.type === "requires_confirmation") {
        setDecisionDialog({
          open: true,
          title: "Confirmação necessária",
          description: err.message,
          actions: [
            {
              label: "Ligar mesmo assim",
              variant: "destructive",
              action: async () => {
                setDecisionDialog(prev => ({ ...prev, open: false }));
                setPumpLoading(true);
                try {
                  await onSendCommand("set_pump", { on: true, force: true });
                  toast.success("Bomba ligada (forçado)");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Erro");
                } finally {
                  setPumpLoading(false);
                }
              },
            },
          ],
        });
      } else {
        toast.error(err instanceof Error ? err.message : "Erro ao controlar bomba");
      }
    } finally {
      setPumpLoading(false);
    }
  };

  const handleSetSector = async (index: number, open: boolean) => {
    // Optimistic update
    setLocalSectorStates(prev => ({ ...prev, [index]: open }));
    setSectorLoading(prev => ({ ...prev, [index]: true }));
    try {
      await onSetSector(index, open);
      toast.success(`${sectorNames[index] || `Setor ${index}`} ${open ? "aberto" : "fechado"}`);
    } catch (err) {
      if (err instanceof DeviceDecisionError && err.type === "requires_decision") {
        // Revert optimistic update
        setLocalSectorStates(prev => {
          const next = { ...prev };
          delete next[index];
          return next;
        });
        // Show decision dialog
        setDecisionDialog({
          open: true,
          title: "Atenção: Bomba ligada",
          description: err.message || "A bomba está ligada. O que deseja fazer?",
          actions: [
            {
              label: "Desligar bomba e fechar setor",
              action: async () => {
                setDecisionDialog(prev => ({ ...prev, open: false }));
                setSectorLoading(prev => ({ ...prev, [index]: true }));
                try {
                  await onSendCommand("set_sector", { index, open: false, strategy: "safe_stop" });
                  toast.success("Bomba desligada e setor fechado");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Erro");
                } finally {
                  setSectorLoading(prev => ({ ...prev, [index]: false }));
                }
              },
            },
            {
              label: "Fechar apenas o setor",
              variant: "destructive",
              action: async () => {
                setDecisionDialog(prev => ({ ...prev, open: false }));
                setSectorLoading(prev => ({ ...prev, [index]: true }));
                try {
                  await onSendCommand("set_sector", { index, open: false, strategy: "force_close" });
                  toast.success(`Setor ${index} fechado (forçado)`);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Erro");
                } finally {
                  setSectorLoading(prev => ({ ...prev, [index]: false }));
                }
              },
            },
          ],
        });
      } else {
        // Revert optimistic update on error
        setLocalSectorStates(prev => {
          const next = { ...prev };
          delete next[index];
          return next;
        });
        toast.error(err instanceof Error ? err.message : "Erro ao controlar setor");
      }
    } finally {
      setSectorLoading(prev => ({ ...prev, [index]: false }));
    }
  };

  return (
    <div className="space-y-4">
      {/* Decision dialog */}
      <AlertDialog open={decisionDialog.open} onOpenChange={(open) => setDecisionDialog(prev => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{decisionDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{decisionDialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            {decisionDialog.actions.map((act, i) => (
              <AlertDialogAction
                key={i}
                onClick={act.action}
                className={act.variant === "destructive" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
              >
                {act.label}
              </AlertDialogAction>
            ))}
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
        <Badge variant={snapshot.wifi_connected ? "default" : "secondary"} className="gap-1" title={snapshot.wifi_detail || undefined}>
          {snapshot.wifi_connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {snapshot.wifi_state_text || (snapshot.wifi_connected ? "WiFi" : "WiFi desconectado")}
        </Badge>
        <Badge variant={snapshot.mqtt_connected ? "default" : "secondary"} className="gap-1">
          <Radio className="h-3 w-3" />
          {snapshot.mqtt_connected ? "MQTT" : "MQTT desconectado"}
        </Badge>
        <Badge variant={snapshot.time_valid ? "default" : "destructive"} className="gap-1">
          <Clock className="h-3 w-3" />
          {snapshot.clock || snapshot.time_source || "NTP"}
        </Badge>
        {snapshot.fw_version && (
          <Badge variant="outline" className="gap-1 text-xs">
            v{snapshot.fw_version}
          </Badge>
        )}
      </div>

      {/* Operation card */}
      <Card className="relative overflow-hidden">
        <WaterFillEffect active={snapshot.pump_on} />
        <CardHeader className="pb-3 relative z-10">
          <CardTitle className="text-base flex items-center gap-2">
            <Droplets className="h-5 w-5 text-primary" />
            Operação
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 relative z-10">
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

          {/* Pump animated card */}
          <PumpStatusCard
            pumpOn={snapshot.pump_on}
            manualMode={isManual}
            pumpRuntime={snapshot.pump_runtime}
          />

          {/* Pump control button */}
          <div className="flex items-center justify-center gap-3">
            {isManual && (
              <Button
                size="lg"
                variant={snapshot.pump_on ? "destructive" : "default"}
                onClick={() => handleSetPump(!snapshot.pump_on)}
                disabled={pumpLoading || isCommandPending}
                className={`gap-2 min-w-[140px] ${!snapshot.pump_on ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
              >
                {pumpLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : snapshot.pump_on ? (
                  <PowerOff className="h-4 w-4" />
                ) : (
                  <Power className="h-4 w-4" />
                )}
                {snapshot.pump_on ? "Desligar Bomba" : "Ligar Bomba"}
              </Button>
            )}
          </div>
          {!isManual && (
            <p className="text-xs text-muted-foreground text-center">Controle manual da bomba disponível apenas no modo manual.</p>
          )}
        </CardContent>
      </Card>

      {/* Sectors card */}
      {sectorizationEnabled && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Sprout className="h-5 w-5 text-green-600" />
              Setores
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {sectors.filter(s => s.enabled).map(sector => {
                const effectiveOn = localSectorStates[sector.index] ?? sector.on;
                return (
                  <div key={sector.index} className={`flex flex-col items-center p-4 rounded-xl border transition-all duration-500 ${
                    effectiveOn 
                      ? "border-green-500/50 bg-green-500/5" 
                      : "bg-card"
                  }`}>
                    <SectorStatusIndicator isOpen={effectiveOn} size={90} />
                    <p className="text-sm font-semibold mt-2">{sector.name || sectorNames[sector.index] || `Setor ${sector.index}`}</p>
                    {isManual && (
                      <Button
                        size="sm"
                        variant={effectiveOn ? "destructive" : "default"}
                        onClick={() => handleSetSector(sector.index, !effectiveOn)}
                        disabled={sectorLoading[sector.index] || isCommandPending}
                        className={`gap-1 mt-3 ${!effectiveOn ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
                      >
                        {sectorLoading[sector.index] ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : effectiveOn ? (
                          <PowerOff className="h-4 w-4" />
                        ) : (
                          <Power className="h-4 w-4" />
                        )}
                        {effectiveOn ? "Fechar" : "Abrir"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
            {!isManual && (
              <p className="text-xs text-muted-foreground mt-2">Controle manual dos setores disponível apenas no modo manual.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Next event card */}
      {(snapshot.next_event || snapshot.next_event_time) && (
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
                  {snapshot.next_event || (
                    snapshot.next_event_type === "pump"
                      ? "Bomba"
                      : `Setor ${snapshot.next_event_target}`
                  )}
                </p>
                {snapshot.next_event_time && (
                  <p className="text-xs text-muted-foreground">
                    {new Date(snapshot.next_event_time).toLocaleString("pt-BR")}
                  </p>
                )}
              </div>
              <Badge variant="outline">Programado</Badge>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
