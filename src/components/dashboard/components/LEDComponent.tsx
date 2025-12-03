import { Lightbulb } from "lucide-react";

interface Props {
  label: string;
  value: boolean;
  config: Record<string, unknown>;
}

export default function LEDComponent({ label, value, config }: Props) {
  const colorOn = (config.colorOn as string) || "#22c55e";
  const colorOff = (config.colorOff as string) || "#6b7280";
  const labelOn = (config.labelOn as string) || "Ligado";
  const labelOff = (config.labelOff as string) || "Desligado";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-lg bg-primary/10">
          <Lightbulb className="h-4 w-4 text-primary" />
        </div>
        <span className="font-medium text-sm">{label}</span>
      </div>

      <div className="flex flex-col items-center py-4 space-y-3">
        <div 
          className="w-12 h-12 rounded-full transition-all duration-300"
          style={{ 
            backgroundColor: value ? colorOn : colorOff,
            boxShadow: value ? `0 0 20px ${colorOn}` : "none"
          }}
        />
        <span className={`text-sm font-medium ${
          value ? "text-green-500" : "text-muted-foreground"
        }`}>
          {value ? labelOn : labelOff}
        </span>
      </div>
    </div>
  );
}
