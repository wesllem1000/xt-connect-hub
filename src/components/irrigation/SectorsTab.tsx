import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Sprout, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { IrrigationSnapshot, IrrigationFullConfig } from "@/hooks/useIrrigationMQTT";

interface SectorsTabProps {
  snapshot: IrrigationSnapshot | null;
  fullConfig: IrrigationFullConfig | null;
  isCommandPending: boolean;
  onSetSectorization: (enabled: boolean) => Promise<unknown>;
  onSetSectorEnabled: (index: number, enabled: boolean) => Promise<unknown>;
  onSetSectorName: (index: number, name: string) => Promise<unknown>;
  onGetFullConfig: () => Promise<unknown>;
}

export default function SectorsTab({ snapshot, fullConfig, isCommandPending, onSetSectorization, onSetSectorEnabled, onSetSectorName, onGetFullConfig }: SectorsTabProps) {
  const [editingNames, setEditingNames] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<number | null>(null);

  const sectorization = snapshot?.sectorization_enabled ?? false;
  const sectors = fullConfig?.sectors || [
    { index: 1, enabled: snapshot?.sector_1_enabled ?? false, name: "Setor 1" },
    { index: 2, enabled: snapshot?.sector_2_enabled ?? false, name: "Setor 2" },
    { index: 3, enabled: snapshot?.sector_3_enabled ?? false, name: "Setor 3" },
    { index: 4, enabled: snapshot?.sector_4_enabled ?? false, name: "Setor 4" },
  ];

  const handleToggleSectorization = async (enabled: boolean) => {
    try {
      await onSetSectorization(enabled);
      toast.success(enabled ? "Setorização habilitada" : "Setorização desabilitada");
      await onGetFullConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  };

  const handleToggleSector = async (index: number, enabled: boolean) => {
    try {
      await onSetSectorEnabled(index, enabled);
      toast.success(`Setor ${index} ${enabled ? "habilitado" : "desabilitado"}`);
      await onGetFullConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  };

  const handleSaveName = async (index: number) => {
    const name = editingNames[index];
    if (!name || name.trim().length === 0) return;
    setSaving(index);
    try {
      await onSetSectorName(index, name.trim());
      toast.success(`Nome do setor ${index} atualizado`);
      setEditingNames(prev => { const n = { ...prev }; delete n[index]; return n; });
      await onGetFullConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Setorização</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Habilitar setorização</p>
              <p className="text-xs text-muted-foreground">Permite controlar setores individuais de irrigação</p>
            </div>
            <Switch checked={sectorization} onCheckedChange={handleToggleSectorization} disabled={isCommandPending} />
          </div>
        </CardContent>
      </Card>

      {sectorization && (
        <div className="space-y-3">
          {sectors.map(sector => (
            <Card key={sector.index}>
              <CardContent className="p-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sprout className="h-4 w-4 text-green-600" />
                      <span className="font-medium text-sm">{sector.name}</span>
                    </div>
                    <Switch checked={sector.enabled} onCheckedChange={(v) => handleToggleSector(sector.index, v)} disabled={isCommandPending} />
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder={`Nome do setor ${sector.index}`}
                      value={editingNames[sector.index] ?? sector.name}
                      onChange={(e) => setEditingNames(prev => ({ ...prev, [sector.index]: e.target.value }))}
                      className="text-sm"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSaveName(sector.index)}
                      disabled={isCommandPending || saving === sector.index || !(editingNames[sector.index] && editingNames[sector.index] !== sector.name)}
                    >
                      {saving === sector.index ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
