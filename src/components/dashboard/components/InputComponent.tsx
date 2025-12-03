import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Type, Send } from "lucide-react";

interface Props {
  label: string;
  value: string;
  config: Record<string, unknown>;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export default function InputComponent({ label, value, config, disabled, onChange }: Props) {
  const [localValue, setLocalValue] = useState(value || "");
  const placeholder = (config.placeholder as string) || "Digite um valor...";
  const inputType = (config.inputType as string) || "text";

  const handleSend = () => {
    onChange(localValue);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-lg bg-primary/10">
          <Type className="h-4 w-4 text-primary" />
        </div>
        <span className="font-medium text-sm">{label}</span>
      </div>

      <div className="flex gap-2">
        <Input
          type={inputType}
          placeholder={placeholder}
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          disabled={disabled}
        />
        <Button 
          size="icon" 
          disabled={disabled}
          onClick={handleSend}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
