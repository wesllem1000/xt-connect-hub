import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { History, Filter, Power, Clock, Wifi, Radio, ShieldAlert, Settings } from "lucide-react";
import { HistoryEvent } from "@/hooks/useIrrigationMQTT";

type FilterCategory = "tudo" | HistoryEvent["category"];

const CATEGORY_CONFIG: Record<HistoryEvent["category"], { label: string; icon: typeof Power; color: string }> = {
  manual: { label: "Manual", icon: Power, color: "text-blue-500" },
  automacao: { label: "Automação", icon: Clock, color: "text-green-500" },
  conectividade: { label: "Conectividade", icon: Wifi, color: "text-yellow-500" },
  mqtt: { label: "MQTT", icon: Radio, color: "text-purple-500" },
  seguranca: { label: "Segurança", icon: ShieldAlert, color: "text-destructive" },
  sistema: { label: "Sistema", icon: Settings, color: "text-muted-foreground" },
};

const FILTERS: { value: FilterCategory; label: string }[] = [
  { value: "tudo", label: "Tudo" },
  { value: "manual", label: "Manual" },
  { value: "automacao", label: "Automação" },
  { value: "conectividade", label: "Rede" },
  { value: "mqtt", label: "MQTT" },
  { value: "seguranca", label: "Alertas" },
];

interface HistoryTabProps {
  history: HistoryEvent[];
}

export default function HistoryTab({ history }: HistoryTabProps) {
  const [filter, setFilter] = useState<FilterCategory>("tudo");

  const filtered = filter === "tudo" ? history : history.filter(e => e.category === filter);

  const formatTimestamp = (ts: string) => {
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return ts;
      return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch {
      return ts;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <History className="h-5 w-5" />
          Histórico Recente
        </h3>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(f => (
          <Button
            key={f.value}
            size="sm"
            variant={filter === f.value ? "default" : "outline"}
            onClick={() => setFilter(f.value)}
            className="h-7 text-xs"
          >
            <Filter className="h-3 w-3 mr-1" />
            {f.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[400px]">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Nenhum evento registrado.</p>
                <p className="text-sm mt-1">Os eventos aparecerão conforme o dispositivo opera.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filtered.map((event, idx) => {
                  const cfg = CATEGORY_CONFIG[event.category];
                  const Icon = cfg.icon;
                  return (
                    <div key={idx} className="flex items-start gap-3 px-4 py-3">
                      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${cfg.color}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">{event.description}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{formatTimestamp(event.timestamp)}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {cfg.label}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        {filtered.length} {filtered.length === 1 ? "evento" : "eventos"}
        {filter !== "tudo" ? ` (filtro: ${FILTERS.find(f => f.value === filter)?.label})` : ""}
      </p>
    </div>
  );
}
