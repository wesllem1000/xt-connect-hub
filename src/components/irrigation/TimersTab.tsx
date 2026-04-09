import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, RefreshCw, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ScheduleItem } from "@/hooks/useIrrigationMQTT";

const DAYS = [
  { key: "mon", label: "Seg" },
  { key: "tue", label: "Ter" },
  { key: "wed", label: "Qua" },
  { key: "thu", label: "Qui" },
  { key: "fri", label: "Sex" },
  { key: "sat", label: "Sáb" },
  { key: "sun", label: "Dom" },
];

interface TimersTabProps {
  schedules: ScheduleItem[];
  isCommandPending: boolean;
  sectorNames?: Record<number, string>;
  onListSchedules: () => Promise<unknown>;
  onAddSchedule: (schedule: Omit<ScheduleItem, "id">) => Promise<unknown>;
  onUpdateSchedule: (schedule: Partial<ScheduleItem> & { id: number }) => Promise<unknown>;
  onDeleteSchedule: (id: number) => Promise<unknown>;
  onSetScheduleEnabled: (id: number, enabled: boolean) => Promise<unknown>;
}

interface FormData {
  target_type: "pump" | "sector";
  target_index: number;
  start_time: string;
  duration_min: number;
  days: string[];
  enabled: boolean;
}

const defaultForm: FormData = {
  target_type: "pump",
  target_index: 1,
  start_time: "08:00",
  duration_min: 30,
  days: ["mon", "tue", "wed", "thu", "fri"],
  enabled: true,
};

export default function TimersTab({
  schedules, isCommandPending, sectorNames = {},
  onListSchedules, onAddSchedule, onUpdateSchedule, onDeleteSchedule, onSetScheduleEnabled,
}: TimersTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(defaultForm);
  const [loading, setLoading] = useState(false);

  const handleRefresh = async () => {
    try { await onListSchedules(); } catch { toast.error("Erro ao listar timers"); }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(defaultForm);
    setDialogOpen(true);
  };

  const openEdit = (item: ScheduleItem) => {
    setEditingId(item.id);
    setForm({
      target_type: item.target_type,
      target_index: item.target_index || 1,
      start_time: item.start_time,
      duration_min: item.duration_min,
      days: item.days,
      enabled: item.enabled,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      if (editingId !== null) {
        await onUpdateSchedule({ id: editingId, ...form });
        toast.success("Timer atualizado!");
      } else {
        await onAddSchedule(form);
        toast.success("Timer criado!");
      }
      setDialogOpen(false);
      await onListSchedules();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar timer");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await onDeleteSchedule(id);
      toast.success("Timer excluído!");
      await onListSchedules();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir timer");
    }
  };

  const handleToggle = async (id: number, enabled: boolean) => {
    try {
      await onSetScheduleEnabled(id, enabled);
      await onListSchedules();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao alterar timer");
    }
  };

  const toggleDay = (day: string) => {
    setForm(prev => ({
      ...prev,
      days: prev.days.includes(day) ? prev.days.filter(d => d !== day) : [...prev.days, day],
    }));
  };

  const getTargetLabel = (item: ScheduleItem) => {
    if (item.target_type === "pump") return "Bomba";
    const name = sectorNames[item.target_index || 0];
    return name || `Setor ${item.target_index}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Timers Programados</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isCommandPending}>
            <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
          </Button>
          <Button size="sm" onClick={openCreate} disabled={isCommandPending}>
            <Plus className="h-4 w-4 mr-1" /> Novo Timer
          </Button>
        </div>
      </div>

      {schedules.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>Nenhum timer programado.</p>
            <p className="text-sm mt-1">Crie um novo timer para agendar a irrigação.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {schedules.map(item => (
            <Card key={item.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{getTargetLabel(item)}</span>
                      <Badge variant={item.enabled ? "default" : "secondary"} className="text-xs">
                        {item.enabled ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {item.start_time} • {item.duration_min} min
                    </p>
                    <div className="flex gap-1 flex-wrap">
                      {DAYS.map(d => (
                        <Badge key={d.key} variant={item.days.includes(d.key) ? "default" : "outline"} className="text-xs px-1.5">
                          {d.label}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={item.enabled} onCheckedChange={(v) => handleToggle(item.id, v)} />
                    <Button variant="ghost" size="icon" onClick={() => openEdit(item)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)} className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId !== null ? "Editar Timer" : "Novo Timer"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Alvo</Label>
                <Select value={form.target_type} onValueChange={(v) => setForm(prev => ({ ...prev, target_type: v as "pump" | "sector" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pump">Bomba</SelectItem>
                    <SelectItem value="sector">Setor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.target_type === "sector" && (
                <div>
                  <Label>Setor</Label>
                  <Select value={String(form.target_index)} onValueChange={(v) => setForm(prev => ({ ...prev, target_index: Number(v) }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1,2,3,4].map(i => (
                        <SelectItem key={i} value={String(i)}>{sectorNames[i] || `Setor ${i}`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Horário</Label>
                <Input type="time" value={form.start_time} onChange={(e) => setForm(prev => ({ ...prev, start_time: e.target.value }))} />
              </div>
              <div>
                <Label>Duração (min)</Label>
                <Input type="number" min={1} max={480} value={form.duration_min} onChange={(e) => setForm(prev => ({ ...prev, duration_min: Number(e.target.value) }))} />
              </div>
            </div>
            <div>
              <Label>Dias da semana</Label>
              <div className="flex gap-1 mt-1">
                {DAYS.map(d => (
                  <Button
                    key={d.key}
                    size="sm"
                    variant={form.days.includes(d.key) ? "default" : "outline"}
                    onClick={() => toggleDay(d.key)}
                    className="px-2 text-xs"
                  >
                    {d.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={loading || form.days.length === 0}>
              {loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {editingId !== null ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
