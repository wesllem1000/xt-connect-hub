import { Gauge } from "lucide-react";

interface Props {
  label: string;
  value: number;
  config: Record<string, unknown>;
}

export default function GaugeComponent({ label, value, config }: Props) {
  const min = (config.min as number) ?? 0;
  const max = (config.max as number) ?? 100;
  const unit = (config.unidade as string) || "";
  
  const displayValue = typeof value === "number" ? value.toFixed(1) : "0.0";
  const percentage = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const rotation = (percentage / 100) * 180 - 90; // -90 to 90 degrees

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-lg bg-primary/10">
          <Gauge className="h-4 w-4 text-primary" />
        </div>
        <span className="font-medium text-sm">{label}</span>
      </div>

      <div className="relative flex justify-center py-4">
        {/* Gauge background */}
        <div className="relative w-32 h-16 overflow-hidden">
          <div className="absolute inset-0 rounded-t-full border-8 border-muted" />
          <div 
            className="absolute inset-0 rounded-t-full border-8 border-primary origin-bottom"
            style={{
              clipPath: `polygon(0 100%, 50% 100%, 50% 0, ${50 + percentage / 2}% 0, ${50 + percentage / 2}% 100%, 100% 100%, 100% 100%, 0 100%)`
            }}
          />
          {/* Needle */}
          <div 
            className="absolute bottom-0 left-1/2 w-1 h-14 bg-foreground origin-bottom transition-transform duration-500"
            style={{ transform: `translateX(-50%) rotate(${rotation}deg)` }}
          />
          <div className="absolute bottom-0 left-1/2 w-3 h-3 rounded-full bg-foreground -translate-x-1/2 translate-y-1/2" />
        </div>
      </div>

      <div className="text-center">
        <span className="text-2xl font-bold">{displayValue}</span>
        <span className="text-sm text-muted-foreground ml-1">{unit}</span>
      </div>

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
