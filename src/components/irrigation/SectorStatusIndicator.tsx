import { Sprout } from "lucide-react";

interface SectorStatusIndicatorProps {
  isOpen: boolean;
  size?: number;
}

export default function SectorStatusIndicator({ isOpen, size = 48 }: SectorStatusIndicatorProps) {
  const r = size / 2;
  const strokeWidth = 3;
  const innerR = r - strokeWidth / 2;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0"
      >
        <defs>
          <clipPath id={`circle-clip-${size}`}>
            <circle cx={r} cy={r} r={innerR - 1} />
          </clipPath>
          <linearGradient id="water-gradient" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="hsl(200, 80%, 50%)" stopOpacity="0.7" />
            <stop offset="100%" stopColor="hsl(190, 70%, 60%)" stopOpacity="0.4" />
          </linearGradient>
        </defs>

        {/* Outer ring */}
        <circle
          cx={r}
          cy={r}
          r={innerR}
          fill="none"
          stroke={isOpen ? "hsl(142, 76%, 36%)" : "hsl(var(--muted))"}
          strokeWidth={strokeWidth}
          className="transition-all duration-500"
        />

        {/* Water fill - rises from bottom when open */}
        <g clipPath={`url(#circle-clip-${size})`}>
          {/* Water body */}
          <rect
            x="0"
            y={isOpen ? size * 0.15 : size}
            width={size}
            height={size}
            fill="url(#water-gradient)"
            className="transition-all duration-700 ease-in-out"
          />
          {/* Wave animation on top of water */}
          {isOpen && (
            <>
              <path
                d={`M 0 ${size * 0.18} Q ${size * 0.25} ${size * 0.12}, ${size * 0.5} ${size * 0.18} T ${size} ${size * 0.18} L ${size} ${size * 0.18} Q ${size * 0.75} ${size * 0.24}, ${size * 0.5} ${size * 0.18} T 0 ${size * 0.18}`}
                fill="hsl(200, 80%, 55%)"
                fillOpacity="0.3"
                className="animate-sector-wave"
              />
              <path
                d={`M 0 ${size * 0.2} Q ${size * 0.25} ${size * 0.14}, ${size * 0.5} ${size * 0.2} T ${size} ${size * 0.2}`}
                fill="hsl(190, 70%, 60%)"
                fillOpacity="0.2"
                className="animate-sector-wave-reverse"
              />
            </>
          )}
        </g>
      </svg>

      {/* Sprout icon on top, fixed */}
      <Sprout
        className={`relative z-10 transition-all duration-500 ${
          isOpen
            ? "text-green-600 dark:text-green-400 drop-shadow-sm"
            : "text-muted-foreground"
        }`}
        style={{ width: size * 0.45, height: size * 0.45 }}
      />
    </div>
  );
}
