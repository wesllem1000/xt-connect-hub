import { Thermometer, Droplets, Zap, Activity, Gauge } from "lucide-react";

interface Props {
  label: string;
  value: number;
  config: Record<string, unknown>;
  tipo: string;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  sensor_tensao: Zap,
  sensor_temperatura: Thermometer,
  sensor_umidade: Droplets,
  sensor_corrente: Activity,
  sensor_generico: Gauge
};

const unitMap: Record<string, string> = {
  sensor_tensao: "V",
  sensor_temperatura: "°C",
  sensor_umidade: "%",
  sensor_corrente: "A",
  sensor_generico: ""
};

export default function SensorComponent({ label, value, config, tipo }: Props) {
  const Icon = iconMap[tipo] || Gauge;
  const unit = (config.unidade as string) || unitMap[tipo] || "";
  const min = (config.min as number) ?? 0;
  const max = (config.max as number) ?? 100;
  
  const displayValue = typeof value === "number" ? value.toFixed(1) : "0.0";
  const percentage = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-primary/10">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <span className="font-medium text-sm">{label}</span>
        </div>
      </div>
      
      <div className="text-center py-4">
        <span className="text-4xl font-bold">{displayValue}</span>
        <span className="text-lg text-muted-foreground ml-1">{unit}</span>
      </div>

      <div className="space-y-1">
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div 
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{min}{unit}</span>
          <span>{max}{unit}</span>
        </div>
      </div>
    </div>
  );
}
