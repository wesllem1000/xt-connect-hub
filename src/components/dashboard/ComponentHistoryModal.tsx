import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { format, subHours, subDays, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

interface ComponentHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceId: string;
  configId: string;
  componentName: string;
  componentType: string;
}

interface HistoryData {
  id: string;
  value: unknown;
  received_at: string;
}

interface ChartDataPoint {
  time: string;
  value: number;
  rawTime: Date;
}

type TimeScale = "hourly" | "daily";

export function ComponentHistoryModal({
  open,
  onOpenChange,
  deviceId,
  configId,
  componentName,
  componentType,
}: ComponentHistoryModalProps) {
  const [loading, setLoading] = useState(true);
  const [historyData, setHistoryData] = useState<HistoryData[]>([]);
  const [timeScale, setTimeScale] = useState<TimeScale>("hourly");
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);

  // Stats
  const [stats, setStats] = useState<{
    min: number;
    max: number;
    avg: number;
    current: number;
    trend: "up" | "down" | "stable";
  } | null>(null);

  useEffect(() => {
    if (open && deviceId && configId) {
      fetchHistory();
    }
  }, [open, deviceId, configId, timeScale]);

  const fetchHistory = async () => {
    setLoading(true);

    const now = new Date();
    const startTime = timeScale === "hourly" 
      ? subHours(now, 24) 
      : subDays(now, 30);

    const { data, error } = await supabase
      .from("device_value_history")
      .select("id, value, received_at")
      .eq("device_id", deviceId)
      .eq("config_id", configId)
      .gte("received_at", startTime.toISOString())
      .order("received_at", { ascending: true })
      .limit(1000);

    if (error) {
      console.error("Error fetching history:", error);
      setLoading(false);
      return;
    }

    setHistoryData(data || []);
    processChartData(data || []);
    setLoading(false);
  };

  const processChartData = (data: HistoryData[]) => {
    if (!data.length) {
      setChartData([]);
      setStats(null);
      return;
    }

    // Extract numeric values
    const processedData: ChartDataPoint[] = data
      .map((item) => {
        // Handle both { value: x } and raw value formats
        const rawItem = item.value as Record<string, unknown> | unknown;
        const rawValue = typeof rawItem === 'object' && rawItem !== null && 'value' in rawItem 
          ? (rawItem as { value: unknown }).value 
          : rawItem;
        let numericValue: number;

        if (typeof rawValue === "number") {
          numericValue = rawValue;
        } else if (typeof rawValue === "boolean") {
          numericValue = rawValue ? 1 : 0;
        } else if (typeof rawValue === "string") {
          numericValue = parseFloat(rawValue) || 0;
        } else {
          numericValue = 0;
        }

        const rawTime = parseISO(item.received_at);
        const timeFormat = timeScale === "hourly" ? "HH:mm" : "dd/MM";

        return {
          time: format(rawTime, timeFormat, { locale: ptBR }),
          value: numericValue,
          rawTime,
        };
      })
      .filter((item) => !isNaN(item.value));

    // Aggregate data by time period if needed
    const aggregatedData = aggregateData(processedData);
    setChartData(aggregatedData);

    // Calculate stats
    if (aggregatedData.length > 0) {
      const values = aggregatedData.map((d) => d.value);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const current = values[values.length - 1];

      // Calculate trend (compare last 3 values)
      let trend: "up" | "down" | "stable" = "stable";
      if (values.length >= 3) {
        const recentAvg = (values[values.length - 1] + values[values.length - 2]) / 2;
        const previousAvg = (values[values.length - 3] + values[values.length - 2]) / 2;
        if (recentAvg > previousAvg * 1.05) trend = "up";
        else if (recentAvg < previousAvg * 0.95) trend = "down";
      }

      setStats({ min, max, avg, current, trend });
    } else {
      setStats(null);
    }
  };

  const aggregateData = (data: ChartDataPoint[]): ChartDataPoint[] => {
    if (data.length <= 100) return data;

    // Group by time label and average
    const grouped = new Map<string, { sum: number; count: number; rawTime: Date }>();
    
    data.forEach((point) => {
      const existing = grouped.get(point.time);
      if (existing) {
        existing.sum += point.value;
        existing.count++;
      } else {
        grouped.set(point.time, { sum: point.value, count: 1, rawTime: point.rawTime });
      }
    });

    return Array.from(grouped.entries()).map(([time, { sum, count, rawTime }]) => ({
      time,
      value: Math.round((sum / count) * 100) / 100,
      rawTime,
    }));
  };

  const isBarChart = componentType === "switch" || componentType === "button" || componentType === "led";

  const formatValue = (value: number): string => {
    if (isBarChart) {
      return value === 1 ? "ON" : "OFF";
    }
    return value.toFixed(2);
  };

  const TrendIcon = stats?.trend === "up" 
    ? TrendingUp 
    : stats?.trend === "down" 
    ? TrendingDown 
    : Minus;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            Histórico: {componentName}
            {stats && (
              <Badge variant="outline" className="ml-2">
                <TrendIcon className="w-3 h-3 mr-1" />
                {stats.trend === "up" ? "Subindo" : stats.trend === "down" ? "Descendo" : "Estável"}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Time scale selector */}
          <div className="flex gap-2">
            <Button
              variant={timeScale === "hourly" ? "default" : "outline"}
              size="sm"
              onClick={() => setTimeScale("hourly")}
            >
              Por Hora (24h)
            </Button>
            <Button
              variant={timeScale === "daily" ? "default" : "outline"}
              size="sm"
              onClick={() => setTimeScale("daily")}
            >
              Por Dia (30 dias)
            </Button>
          </div>

          {/* Stats cards */}
          {stats && (
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Atual</p>
                <p className="text-lg font-semibold">{formatValue(stats.current)}</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Média</p>
                <p className="text-lg font-semibold">{formatValue(stats.avg)}</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Mínimo</p>
                <p className="text-lg font-semibold">{formatValue(stats.min)}</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Máximo</p>
                <p className="text-lg font-semibold">{formatValue(stats.max)}</p>
              </div>
            </div>
          )}

          {/* Chart */}
          <div className="h-[300px] w-full">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : chartData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Nenhum dado histórico encontrado para este período
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                {isBarChart ? (
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="time" 
                      className="text-xs fill-muted-foreground"
                      tick={{ fontSize: 10 }}
                    />
                    <YAxis 
                      domain={[0, 1]}
                      ticks={[0, 1]}
                      tickFormatter={(v) => (v === 1 ? "ON" : "OFF")}
                      className="text-xs fill-muted-foreground"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                      formatter={(value: number) => [value === 1 ? "ON" : "OFF", "Estado"]}
                    />
                    <Bar 
                      dataKey="value" 
                      fill="hsl(var(--primary))" 
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                ) : (
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="time" 
                      className="text-xs fill-muted-foreground"
                      tick={{ fontSize: 10 }}
                    />
                    <YAxis 
                      className="text-xs fill-muted-foreground"
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                      formatter={(value: number) => [value.toFixed(2), componentName]}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={chartData.length < 50}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                )}
              </ResponsiveContainer>
            )}
          </div>

          {/* Data count */}
          {!loading && chartData.length > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              {historyData.length} registros encontrados • 
              {timeScale === "hourly" ? " Últimas 24 horas" : " Últimos 30 dias"}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
