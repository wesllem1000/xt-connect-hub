import { Slider } from "@/components/ui/slider";
import { SlidersHorizontal } from "lucide-react";

interface Props {
  label: string;
  value: number;
  config: Record<string, unknown>;
  disabled?: boolean;
  onChange: (value: number) => void;
}

export default function SliderComponent({ label, value, config, disabled, onChange }: Props) {
  const min = (config.min as number) ?? 0;
  const max = (config.max as number) ?? 100;
  const step = (config.step as number) ?? 1;
  const unit = (config.unidade as string) || "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-primary/10">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
          </div>
          <span className="font-medium text-sm">{label}</span>
        </div>
        <span className="text-lg font-bold">
          {typeof value === "number" ? value : min}{unit}
        </span>
      </div>

      <Slider
        value={[typeof value === "number" ? value : min]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(val) => onChange(val[0])}
        className="py-2"
      />

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}
