import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Loader2, Save, Clock } from "lucide-react";
import { toast } from "sonner";
import { IrrigationFullConfig } from "@/hooks/useIrrigationMQTT";

interface SystemTabProps {
  fullConfig: IrrigationFullConfig | null;
  isCommandPending: boolean;
  userType: string;
  onSetSystemConfig: (config: Record<string, unknown>) => Promise<unknown>;
  onSetRelayConfig: (config: Record<string, unknown>) => Promise<unknown>;
  onSetDatetime: (datetime: string) => Promise<unknown>;
  onGetFullConfig: () => Promise<unknown>;
}

export default function SystemTab({ fullConfig, isCommandPending, userType, onSetSystemConfig, onSetRelayConfig, onSetDatetime, onGetFullConfig }: SystemTabProps) {
  const [safetyTime, setSafetyTime] = useState("60");
  const [publishInterval, setPublishInterval] = useState("300");
  const [savingSystem, setSavingSystem] = useState(false);
  const [savingRelay, setSavingRelay] = useState(false);
  const [savingDatetime, setSavingDatetime] = useState(false);
  const [datetime, setDatetime] = useState("");

  const isInstaller = userType === "instalador";

  useEffect(() => {
    if (fullConfig?.system) {
      setSafetyTime(String(fullConfig.system.safety_time_sec || 60));
      setPublishInterval(String(fullConfig.system.publish_interval_sec || 300));
    }
  }, [fullConfig]);

  const handleSaveSystem = async () => {
    setSavingSystem(true);
    try {
      await onSetSystemConfig({
        safety_time_sec: Number(safetyTime),
        publish_interval_sec: Number(publishInterval),
      });
      toast.success("Configurações do sistema atualizadas");
      await onGetFullConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setSavingSystem(false);
    }
  };

  const handleSyncDatetime = async () => {
    setSavingDatetime(true);
    try {
      const dt = datetime || new Date().toISOString();
      await onSetDatetime(dt);
      toast.success("Data/hora sincronizada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setSavingDatetime(false);
    }
  };

  const handleSaveRelay = async () => {
    setSavingRelay(true);
    try {
      await onSetRelayConfig(fullConfig?.relay || {});
      toast.success("Configuração de relés atualizada");
      await onGetFullConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setSavingRelay(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Parâmetros do Sistema
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Tempo de Segurança (s)</Label>
              <Input type="number" min={10} max={600} value={safetyTime} onChange={(e) => setSafetyTime(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Tempo máximo de operação contínua</p>
            </div>
            <div>
              <Label>Intervalo de Publicação (s)</Label>
              <Input type="number" min={10} max={3600} value={publishInterval} onChange={(e) => setPublishInterval(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Frequência de envio de snapshots</p>
            </div>
          </div>
          <Button onClick={handleSaveSystem} disabled={isCommandPending || savingSystem}>
            {savingSystem ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar Parâmetros
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Data e Hora
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Sincronizar com horário atual</Label>
            <p className="text-xs text-muted-foreground">Envia a data/hora atual do navegador para o dispositivo</p>
          </div>
          <div className="flex gap-2">
            <Input type="datetime-local" value={datetime} onChange={(e) => setDatetime(e.target.value)} />
            <Button onClick={handleSyncDatetime} disabled={isCommandPending || savingDatetime}>
              {savingDatetime ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Clock className="h-4 w-4 mr-1" />}
              Sincronizar
            </Button>
          </div>
        </CardContent>
      </Card>

      {isInstaller && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="h-5 w-5 text-orange-500" />
              Configuração de Relés
              <span className="text-xs font-normal text-muted-foreground">(Técnico)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Configuração avançada de polaridade e nível ativo dos relés. Disponível apenas para perfil técnico.</p>
            <Button variant="outline" onClick={handleSaveRelay} disabled={isCommandPending || savingRelay}>
              {savingRelay ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Aplicar Configuração
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
