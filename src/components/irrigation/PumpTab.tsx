import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Droplets, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { IrrigationFullConfig } from "@/hooks/useIrrigationMQTT";

interface PumpTabProps {
  fullConfig: IrrigationFullConfig | null;
  isCommandPending: boolean;
  onSetPumpConfig: (config: Record<string, unknown>) => Promise<unknown>;
  onGetFullConfig: () => Promise<unknown>;
}

export default function PumpTab({ fullConfig, isCommandPending, onSetPumpConfig, onGetFullConfig }: PumpTabProps) {
  const [mode, setMode] = useState("normal");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (fullConfig?.pump) {
      setMode(String(fullConfig.pump.mode || "normal"));
    }
  }, [fullConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSetPumpConfig({ mode });
      toast.success("Configuração da bomba atualizada");
      await onGetFullConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Droplets className="h-5 w-5 text-primary" />
            Configuração da Bomba
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Modo de Operação</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="inverted">Invertido</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">Define o comportamento padrão do relé da bomba.</p>
          </div>
          <Button onClick={handleSave} disabled={isCommandPending || saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
