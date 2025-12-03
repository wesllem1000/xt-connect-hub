import { Switch } from "@/components/ui/switch";
import { ToggleLeft } from "lucide-react";

interface Props {
  label: string;
  value: boolean;
  config: Record<string, unknown>;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}

export default function SwitchComponent({ label, value, config, disabled, onChange }: Props) {
  const labelOn = (config.labelOn as string) || "Ligado";
  const labelOff = (config.labelOff as string) || "Desligado";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-lg bg-primary/10">
          <ToggleLeft className="h-4 w-4 text-primary" />
        </div>
        <span className="font-medium text-sm">{label}</span>
      </div>

      <div className="flex items-center justify-between py-2">
        <span className={`text-sm ${!value ? "text-foreground" : "text-muted-foreground"}`}>
          {labelOff}
        </span>
        <Switch
          checked={!!value}
          onCheckedChange={onChange}
          disabled={disabled}
        />
        <span className={`text-sm ${value ? "text-foreground" : "text-muted-foreground"}`}>
          {labelOn}
        </span>
      </div>

      <div className="text-center">
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
          value 
            ? "bg-green-500/10 text-green-500" 
            : "bg-muted text-muted-foreground"
        }`}>
          {value ? labelOn : labelOff}
        </span>
      </div>
    </div>
  );
}
