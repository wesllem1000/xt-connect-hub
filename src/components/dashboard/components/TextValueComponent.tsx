import { Type } from "lucide-react";

interface Props {
  label: string;
  value: unknown;
  config: Record<string, unknown>;
}

export default function TextValueComponent({ label, value, config }: Props) {
  const unidade = (config.unidade as string) || "";
  const tamanho = (config.tamanho as string) || "grande";
  
  const textSizeClasses = {
    pequeno: "text-2xl",
    medio: "text-3xl",
    grande: "text-4xl",
    enorme: "text-5xl",
  };

  const displayValue = value !== undefined && value !== null 
    ? typeof value === "number" 
      ? value.toFixed(1) 
      : String(value)
    : "--";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-lg bg-primary/10">
          <Type className="h-4 w-4 text-primary" />
        </div>
        <span className="font-medium text-sm">{label}</span>
      </div>
      
      <div className="text-center py-6">
        <span className={`${textSizeClasses[tamanho as keyof typeof textSizeClasses] || textSizeClasses.grande} font-bold`}>
          {displayValue}
        </span>
        {unidade && (
          <span className="text-lg text-muted-foreground ml-2">{unidade}</span>
        )}
      </div>
    </div>
  );
}
