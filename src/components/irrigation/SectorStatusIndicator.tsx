import { Sprout } from "lucide-react";

interface SectorStatusIndicatorProps {
  isOpen: boolean;
  size?: number;
}

export default function SectorStatusIndicator({ isOpen, size = 96 }: SectorStatusIndicatorProps) {
  const r = size / 2;
  const strokeWidth = 3.5;
  const innerR = r - strokeWidth;

  // Water level: 85% filled when open, 100% (empty) when closed
  const waterTopY = isOpen ? size * 0.2 : size + 10;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0"
      >
        <defs>
          <clipPath id={`sector-clip-${size}`}>
            <circle cx={r} cy={r} r={innerR - 0.5} />
          </clipPath>
          <linearGradient id="sector-water-grad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="hsl(200, 75%, 45%)" stopOpacity="0.6" />
            <stop offset="60%" stopColor="hsl(195, 70%, 55%)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="hsl(190, 65%, 65%)" stopOpacity="0.25" />
          </linearGradient>
          <linearGradient id="sector-water-wave1" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="hsl(200, 80%, 50%)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="hsl(195, 70%, 60%)" stopOpacity="0.15" />
          </linearGradient>
        </defs>

        {/* Background circle */}
        <circle
          cx={r}
          cy={r}
          r={innerR}
          fill={isOpen ? "hsl(142, 76%, 36%, 0.06)" : "hsl(var(--muted) / 0.1)"}
          className="transition-all duration-700"
        />

        {/* Water fill group */}
        <g clipPath={`url(#sector-clip-${size})`}>
          {/* Main water body */}
          <rect
            x="0"
            y={waterTopY}
            width={size}
            height={size}
            fill="url(#sector-water-grad)"
            className="transition-[y] duration-[1500ms] ease-in-out"
          />

          {/* Wave layer 1 - slow, wide */}
          <path
            d={`
              M -${size * 0.5} ${waterTopY + 2}
              Q ${size * 0.1} ${waterTopY - 6}, ${size * 0.35} ${waterTopY + 2}
              T ${size * 0.7} ${waterTopY + 2}
              T ${size * 1.05} ${waterTopY + 2}
              T ${size * 1.4} ${waterTopY + 2}
              L ${size * 1.5} ${size}
              L -${size * 0.5} ${size} Z
            `}
            fill="url(#sector-water-wave1)"
            className={`transition-[d] duration-[1500ms] ease-in-out ${isOpen ? "animate-sector-wave-slow" : ""}`}
          />

          {/* Wave layer 2 - faster, narrower */}
          <path
            d={`
              M -${size * 0.3} ${waterTopY + 4}
              Q ${size * 0.15} ${waterTopY - 3}, ${size * 0.3} ${waterTopY + 4}
              T ${size * 0.6} ${waterTopY + 4}
              T ${size * 0.9} ${waterTopY + 4}
              T ${size * 1.2} ${waterTopY + 4}
              L ${size * 1.3} ${size}
              L -${size * 0.3} ${size} Z
            `}
            fill="hsl(195, 70%, 55%)"
            fillOpacity="0.18"
            className={`transition-[d] duration-[1500ms] ease-in-out ${isOpen ? "animate-sector-wave-fast" : ""}`}
          />

          {/* Bubble particles when open */}
          {isOpen && (
            <>
              <circle cx={size * 0.3} cy={size * 0.65} r="2" fill="white" fillOpacity="0.4" className="animate-sector-bubble" />
              <circle cx={size * 0.55} cy={size * 0.75} r="1.5" fill="white" fillOpacity="0.3" className="animate-sector-bubble-delayed" />
              <circle cx={size * 0.7} cy={size * 0.6} r="1.8" fill="white" fillOpacity="0.35" className="animate-sector-bubble-slow" />
            </>
          )}
        </g>

        {/* Outer ring */}
        <circle
          cx={r}
          cy={r}
          r={innerR}
          fill="none"
          stroke={isOpen ? "hsl(142, 76%, 36%)" : "hsl(var(--muted))"}
          strokeWidth={strokeWidth}
          className="transition-all duration-700"
        />
      </svg>

      {/* Sprout icon on top */}
      <div className="relative z-10 flex flex-col items-center">
        <Sprout
          className={`transition-all duration-500 ${
            isOpen
              ? "text-green-600 dark:text-green-400 drop-shadow-md"
              : "text-muted-foreground"
          }`}
          style={{ width: size * 0.38, height: size * 0.38 }}
        />
        <span className={`text-[10px] font-bold mt-0.5 transition-colors duration-500 ${
          isOpen ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
        }`}>
          {isOpen ? "Aberto" : "Fechado"}
        </span>
      </div>
    </div>
  );
}
