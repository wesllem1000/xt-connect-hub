import { Activity } from "lucide-react";

interface Props {
  label: string;
  value: string | boolean;
  config: Record<string, unknown>;
}

export default function StatusComponent({ label, value, config }: Props) {
  const statusMap = (config.statusMap as Record<string, { label: string; color: string }>) || {
    true: { label: "Ativo", color: "#22c55e" },
    false: { label: "Inativo", color: "#ef4444" }
  };

  const statusKey = String(value);
  const status = statusMap[statusKey] || { label: String(value), color: "#6b7280" };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-lg bg-primary/10">
          <Activity className="h-4 w-4 text-primary" />
        </div>
        <span className="font-medium text-sm">{label}</span>
      </div>

      <div className="flex justify-center py-4">
        <div 
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full"
          style={{ backgroundColor: `${status.color}20` }}
        >
          <div 
            className="w-3 h-3 rounded-full animate-pulse"
            style={{ backgroundColor: status.color }}
          />
          <span className="font-medium" style={{ color: status.color }}>
            {status.label}
          </span>
        </div>
      </div>
    </div>
  );
}
