import { Thermometer } from "lucide-react";

interface Props {
  label: string;
  value: number | null;
  config: Record<string, unknown>;
}

export default function TemperatureComponent({ label, value, config }: Props) {
  const unit = (config.unidade as string) || "°C";
  const min = (config.min as number) ?? 0;
  const max = (config.max as number) ?? 100;
  
  const hasValue = value !== null && value !== undefined && !isNaN(value);
  
  // Calculate fill percentage for thermometer
  const percentage = hasValue 
    ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
    : 0;
  
  // Format display value with decimal segments style
  const formatValue = () => {
    if (!hasValue) {
      return (
        <span className="font-mono tracking-wider">
          <span className="text-primary">- -</span>
          <span className="text-primary mx-1">•</span>
          <span className="text-primary">-</span>
        </span>
      );
    }
    
    const parts = value.toFixed(1).split('.');
    return (
      <span className="font-mono tracking-wider">
        {parts[0]}
        <span className="text-primary mx-0.5">•</span>
        {parts[1]}
      </span>
    );
  };

  // Dynamic thermometer color based on temperature
  const getThermometerGradient = () => {
    if (!hasValue) return 'from-muted to-muted';
    if (percentage > 75) return 'from-red-500 to-orange-500';
    if (percentage > 50) return 'from-orange-500 to-yellow-500';
    if (percentage > 25) return 'from-yellow-500 to-green-500';
    return 'from-blue-500 to-cyan-500';
  };

  return (
    <div className="relative flex flex-col items-center justify-center py-4">
      {/* Label */}
      <span className="text-xs uppercase tracking-widest text-muted-foreground mb-4 font-medium">
        {label}
      </span>
      
      {/* Main content - value and thermometer */}
      <div className="flex items-center gap-6">
        {/* Value display */}
        <div className="text-center">
          <div className="text-4xl font-bold text-foreground">
            {formatValue()}
          </div>
          <span className="text-lg text-muted-foreground ml-1">{unit}</span>
        </div>
        
        {/* Stylized Thermometer */}
        <div className="relative h-24 w-8 flex items-end justify-center">
          {/* Thermometer body */}
          <div className="absolute inset-0 flex items-end justify-center">
            {/* Outer glow */}
            <div className="absolute inset-0 rounded-full bg-gradient-to-t from-primary/20 to-transparent blur-sm" />
            
            {/* Glass tube */}
            <div className="relative w-4 h-full rounded-t-full bg-card border border-border/50 overflow-hidden">
              {/* Fill level */}
              <div 
                className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t ${getThermometerGradient()} transition-all duration-700 ease-out`}
                style={{ height: `${percentage}%` }}
              />
              
              {/* Glass reflection */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-foreground/5 to-transparent" />
            </div>
            
            {/* Bulb */}
            <div className="absolute -bottom-2 w-6 h-6 rounded-full bg-card border border-border/50 flex items-center justify-center">
              <div 
                className={`w-4 h-4 rounded-full bg-gradient-to-br ${getThermometerGradient()} shadow-lg`}
                style={{ 
                  boxShadow: hasValue ? `0 0 10px hsl(var(--primary) / 0.5)` : 'none'
                }}
              />
            </div>
          </div>
          
          {/* Decorative icon */}
          <Thermometer 
            className="absolute -right-6 top-1/2 -translate-y-1/2 h-10 w-10 text-primary/30" 
            strokeWidth={1}
          />
        </div>
      </div>
      
      {/* Range indicator */}
      <div className="flex justify-between w-full mt-4 text-xs text-muted-foreground">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}
