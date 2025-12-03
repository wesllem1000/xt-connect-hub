import { Button } from "@/components/ui/button";
import { Power } from "lucide-react";

interface Props {
  label: string;
  config: Record<string, unknown>;
  disabled?: boolean;
  onClick: () => void;
}

export default function ButtonComponent({ label, config, disabled, onClick }: Props) {
  const buttonLabel = (config.buttonLabel as string) || "Executar";
  const variant = (config.variant as "default" | "outline" | "destructive") || "default";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-lg bg-primary/10">
          <Power className="h-4 w-4 text-primary" />
        </div>
        <span className="font-medium text-sm">{label}</span>
      </div>

      <div className="flex justify-center py-4">
        <Button
          variant={variant}
          size="lg"
          disabled={disabled}
          onClick={onClick}
          className="w-full"
        >
          {buttonLabel}
        </Button>
      </div>
    </div>
  );
}
