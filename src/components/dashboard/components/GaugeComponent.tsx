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
  
  // SVG arc calculation
  const radius = 70;
  const strokeWidth = 12;
  const center = 80;
  const startAngle = -210;
  const endAngle = 30;
  const angleRange = endAngle - startAngle;
  const currentAngle = startAngle + (percentage / 100) * angleRange;
  
  const polarToCartesian = (angle: number) => {
    const rad = (angle * Math.PI) / 180;
    return {
      x: center + radius * Math.cos(rad),
      y: center + radius * Math.sin(rad)
    };
  };
  
  const createArc = (start: number, end: number) => {
    const startPoint = polarToCartesian(start);
    const endPoint = polarToCartesian(end);
    const largeArcFlag = Math.abs(end - start) > 180 ? 1 : 0;
    return `M ${startPoint.x} ${startPoint.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endPoint.x} ${endPoint.y}`;
  };
  
  // Needle position
  const needleAngle = currentAngle;
  const needleLength = radius - 15;
  const needleEnd = polarToCartesian(needleAngle);
  const needleBase1 = {
    x: center + 6 * Math.cos((needleAngle + 90) * Math.PI / 180),
    y: center + 6 * Math.sin((needleAngle + 90) * Math.PI / 180)
  };
  const needleBase2 = {
    x: center + 6 * Math.cos((needleAngle - 90) * Math.PI / 180),
    y: center + 6 * Math.sin((needleAngle - 90) * Math.PI / 180)
  };
  
  // Color based on percentage
  const getColor = (pct: number) => {
    if (pct < 30) return "hsl(var(--primary))";
    if (pct < 70) return "hsl(142.1 76.2% 36.3%)"; // green
    return "hsl(0 84.2% 60.2%)"; // red
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-lg bg-primary/10">
          <Gauge className="h-4 w-4 text-primary" />
        </div>
        <span className="font-medium text-sm">{label}</span>
      </div>

      <div className="relative flex justify-center">
        <svg width="160" height="110" viewBox="0 0 160 120" className="drop-shadow-sm">
          {/* Background gradient */}
          <defs>
            <linearGradient id={`gaugeGrad-${label}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
              <stop offset="50%" stopColor="hsl(142.1 76.2% 36.3%)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="hsl(0 84.2% 60.2%)" stopOpacity="0.3" />
            </linearGradient>
            <linearGradient id={`needleGrad-${label}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="hsl(var(--foreground))" />
              <stop offset="100%" stopColor="hsl(var(--muted-foreground))" />
            </linearGradient>
            <filter id={`glow-${label}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          
          {/* Background track */}
          <path
            d={createArc(startAngle, endAngle)}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            className="opacity-50"
          />
          
          {/* Colored gradient track */}
          <path
            d={createArc(startAngle, endAngle)}
            fill="none"
            stroke={`url(#gaugeGrad-${label})`}
            strokeWidth={strokeWidth - 2}
            strokeLinecap="round"
          />
          
          {/* Active value arc */}
          {percentage > 0 && (
            <path
              d={createArc(startAngle, currentAngle)}
              fill="none"
              stroke={getColor(percentage)}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              filter={`url(#glow-${label})`}
              className="transition-all duration-500 ease-out"
            />
          )}
          
          {/* Tick marks */}
          {[0, 25, 50, 75, 100].map((tick) => {
            const tickAngle = startAngle + (tick / 100) * angleRange;
            const innerRadius = radius - strokeWidth / 2 - 8;
            const outerRadius = radius - strokeWidth / 2 - 3;
            const inner = polarToCartesian(tickAngle);
            const outer = {
              x: center + innerRadius * Math.cos((tickAngle * Math.PI) / 180),
              y: center + innerRadius * Math.sin((tickAngle * Math.PI) / 180)
            };
            return (
              <line
                key={tick}
                x1={outer.x}
                y1={outer.y}
                x2={inner.x - (inner.x - center) * 0.15}
                y2={inner.y - (inner.y - center) * 0.15}
                stroke="hsl(var(--muted-foreground))"
                strokeWidth="1.5"
                strokeLinecap="round"
                className="opacity-40"
              />
            );
          })}
          
          {/* Needle */}
          <polygon
            points={`${needleBase1.x},${needleBase1.y} ${needleEnd.x},${needleEnd.y} ${needleBase2.x},${needleBase2.y}`}
            fill={`url(#needleGrad-${label})`}
            className="transition-all duration-500 ease-out drop-shadow-md"
          />
          
          {/* Center cap */}
          <circle
            cx={center}
            cy={center}
            r="10"
            fill="hsl(var(--card))"
            stroke="hsl(var(--border))"
            strokeWidth="2"
            className="drop-shadow-sm"
          />
          <circle
            cx={center}
            cy={center}
            r="5"
            fill="hsl(var(--foreground))"
            className="drop-shadow-sm"
          />
        </svg>
      </div>

      <div className="text-center -mt-2">
        <span className="text-3xl font-bold tracking-tight" style={{ color: getColor(percentage) }}>
          {displayValue}
        </span>
        <span className="text-sm text-muted-foreground ml-1">{unit}</span>
      </div>

      <div className="flex justify-between text-xs text-muted-foreground px-4">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}
