import { useEffect, useState, useRef } from "react";
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
  const [localSectorization, setLocalSectorization] = useState<boolean | null>(null);
  const [localSectorEnabled, setLocalSectorEnabled] = useState<Record<number, boolean>>({});

  // Track what was requested to only clear when confirmed
  const requestedSectorizationRef = useRef<boolean | null>(null);
  const requestedSectorEnabledRef = useRef<Record<number, boolean>>({});

  // Only clear localSectorization when snapshot matches requested value
  useEffect(() => {
    if (localSectorization === null) return;
    const serverValue = snapshot?.sectorization_enabled ?? fullConfig?.sectorization_enabled;
    if (serverValue === localSectorization) {
      setLocalSectorization(null);
      requestedSectorizationRef.current = null;
    }
  }, [snapshot?.sectorization_enabled, fullConfig?.sectorization_enabled, localSectorization]);

  // Only clear localSectorEnabled for indices where snapshot matches requested value
  useEffect(() => {
    if (Object.keys(localSectorEnabled).length === 0) return;
    const snapshotSectors = snapshot?.sectors || [];
    const configSectors = fullConfig?.sectors || [];

    setLocalSectorEnabled(prev => {
      const next = { ...prev };
      let changed = false;
      for (const idxStr of Object.keys(next)) {
        const idx = Number(idxStr);
        const requestedValue = next[idx];
        // Check both snapshot and fullConfig for confirmed value
        const snapshotSector = snapshotSectors.find(s => s.index === idx);
        const configSector = configSectors.find(s => s.index === idx);
        const confirmedValue = snapshotSector?.enabled ?? configSector?.enabled;
        if (confirmedValue === requestedValue) {
          delete next[idx];
          delete requestedSectorEnabledRef.current[idx];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [snapshot?.sectors, fullConfig?.sectors, localSectorEnabled]);

  // Derive effective sectorization from: local optimistic > snapshot > fullConfig
  const sectorization = localSectorization ?? snapshot?.sectorization_enabled ?? fullConfig?.sectorization_enabled ?? false;

  // Build sectors list: merge snapshot (live) with fullConfig (metadata)
  const buildSectors = () => {
    const sectorMap = new Map<number, { index: number; enabled: boolean; name: string }>();

    // Start with fullConfig for metadata
    (fullConfig?.sectors || []).forEach(s => {
      sectorMap.set(s.index, { index: s.index, enabled: s.enabled, name: s.name });
    });

    // Override with snapshot live data
    (snapshot?.sectors || []).forEach(s => {
      const existing = sectorMap.get(s.index);
      sectorMap.set(s.index, {
        index: s.index,
        enabled: s.enabled ?? existing?.enabled ?? true,
        name: s.name || existing?.name || `Setor ${s.index}`,
      });
    });

    // If still empty, provide defaults
    if (sectorMap.size === 0) {
      for (let i = 1; i <= 4; i++) {
        sectorMap.set(i, { index: i, enabled: false, name: `Setor ${i}` });
      }
    }

    return Array.from(sectorMap.values()).sort((a, b) => a.index - b.index);
  };

  const sectors = buildSectors();

  const handleToggleSectorization = async (enabled: boolean) => {
    setLocalSectorization(enabled);
    requestedSectorizationRef.current = enabled;
    try {
      await onSetSectorization(enabled);
      toast.success(enabled ? "Setorização habilitada" : "Setorização desabilitada");
      await onGetFullConfig();
    } catch (err) {
      setLocalSectorization(null);
      requestedSectorizationRef.current = null;
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  };

  const handleToggleSector = async (index: number, enabled: boolean) => {
    setLocalSectorEnabled(prev => ({ ...prev, [index]: enabled }));
    requestedSectorEnabledRef.current[index] = enabled;
    try {
      await onSetSectorEnabled(index, enabled);
      toast.success(`Setor ${index} ${enabled ? "habilitado" : "desabilitado"}`);
      await onGetFullConfig();
    } catch (err) {
      setLocalSectorEnabled(prev => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
      delete requestedSectorEnabledRef.current[index];
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
          {sectors.map(sector => {
            const effectiveEnabled = localSectorEnabled[sector.index] ?? sector.enabled;

            return (
              <Card key={sector.index}>
                <CardContent className="p-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sprout className="h-4 w-4 text-green-600" />
                        <span className="font-medium text-sm">{sector.name}</span>
                      </div>
                      <Switch checked={effectiveEnabled} onCheckedChange={(v) => handleToggleSector(sector.index, v)} disabled={isCommandPending} />
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
            );
          })}
        </div>
      )}
    </div>
  );
}
