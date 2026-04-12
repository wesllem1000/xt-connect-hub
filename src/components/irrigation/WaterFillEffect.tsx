import { useEffect, useState, useMemo } from "react";

interface WaterFillEffectProps {
  active: boolean;
}

export default function WaterFillEffect({ active }: WaterFillEffectProps) {
  const [phase, setPhase] = useState<"idle" | "filling" | "full" | "draining">("idle");

  useEffect(() => {
    if (active) {
      const t = setTimeout(() => setPhase("filling"), 2000);
      return () => clearTimeout(t);
    } else {
      if (phase === "filling" || phase === "full") {
        setPhase("draining");
      }
    }
  }, [active]);

  useEffect(() => {
    if (phase === "filling") {
      const t = setTimeout(() => setPhase("full"), 7000);
      return () => clearTimeout(t);
    }
    if (phase === "draining") {
      const t = setTimeout(() => setPhase("idle"), 3500);
      return () => clearTimeout(t);
    }
  }, [phase]);

  // Generate random bubbles once
  const bubbles = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 12; i++) {
      arr.push({
        cx: 30 + Math.random() * 340,
        r: 1.2 + Math.random() * 2.8,
        delay: Math.random() * 4,
        duration: 2.5 + Math.random() * 3,
        opacity: 0.15 + Math.random() * 0.2,
      });
    }
    return arr;
  }, []);

  if (phase === "idle") return null;

  const isFilling = phase === "filling";
  const isFull = phase === "full";
  const isDraining = phase === "draining";

  return (
    <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none z-0">
      {/* Faucet stream - organic water pour */}
      {isFilling && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10 pump-faucet-container">
          {/* Main stream */}
          <svg width="30" height="140" viewBox="0 0 30 140" className="pump-faucet-svg">
            <defs>
              <linearGradient id="stream-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(205, 85%, 55%)" stopOpacity="0.7" />
                <stop offset="60%" stopColor="hsl(200, 80%, 50%)" stopOpacity="0.4" />
                <stop offset="100%" stopColor="hsl(200, 75%, 50%)" stopOpacity="0.15" />
              </linearGradient>
            </defs>
            {/* Organic stream path that wiggles */}
            <path
              className="pump-stream-path"
              d="M15,0 Q13,25 16,45 Q18,65 14,85 Q11,105 16,125 Q18,135 15,140"
              stroke="url(#stream-grad)"
              strokeWidth="5"
              fill="none"
              strokeLinecap="round"
            />
            <path
              className="pump-stream-path-thin"
              d="M15,0 Q17,30 13,55 Q10,75 16,95 Q19,115 14,135"
              stroke="hsl(205, 85%, 60%)"
              strokeOpacity="0.3"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
          {/* Splash droplets */}
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="pump-organic-drop"
              style={{
                '--drop-x': `${(Math.random() - 0.5) * 40}px`,
                '--drop-y': `${-5 - Math.random() * 20}px`,
                '--drop-size': `${2 + Math.random() * 3}px`,
                animationDelay: `${0.3 + i * 0.4}s`,
                animationDuration: `${0.8 + Math.random() * 0.6}s`,
              } as React.CSSProperties}
            />
          ))}
        </div>
      )}

      {/* Water body with organic waves */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 400 300"
        preserveAspectRatio="none"
      >
        <defs>
          {/* Deeper blue gradient */}
          <linearGradient id="pump-water-organic" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(205, 80%, 55%)" stopOpacity="0.08" />
            <stop offset="40%" stopColor="hsl(200, 78%, 48%)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="hsl(210, 85%, 40%)" stopOpacity="0.28" />
          </linearGradient>
          <linearGradient id="pump-wave-organic-1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(200, 85%, 60%)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="hsl(205, 80%, 50%)" stopOpacity="0.06" />
          </linearGradient>
          <linearGradient id="pump-wave-organic-2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(195, 90%, 65%)" stopOpacity="0.08" />
            <stop offset="100%" stopColor="hsl(200, 80%, 55%)" stopOpacity="0.04" />
          </linearGradient>
        </defs>

        {/* Main water body with organic wave top */}
        <g className={
          isFilling ? "pump-organic-fill" :
          isFull ? "pump-organic-full" :
          isDraining ? "pump-organic-drain" : ""
        }>
          {/* Primary wave surface */}
          <path
            className="pump-wave-surface-1"
            d="M-20,30 C40,15 80,45 140,28 C200,11 240,42 300,25 C360,8 380,35 420,22 L420,320 L-20,320 Z"
            fill="url(#pump-water-organic)"
          />
          {/* Secondary wave surface - offset */}
          <path
            className="pump-wave-surface-2"
            d="M-20,35 C50,48 100,20 160,38 C220,56 260,18 320,35 C370,50 400,28 420,32 L420,320 L-20,320 Z"
            fill="url(#pump-wave-organic-1)"
          />
          {/* Third wave layer - subtle */}
          <path
            className="pump-wave-surface-3"
            d="M-20,28 C30,42 90,18 150,35 C210,52 250,22 310,38 C350,48 390,25 420,30 L420,320 L-20,320 Z"
            fill="url(#pump-wave-organic-2)"
          />
        </g>

        {/* Bubbles - only when water is present */}
        {(isFull || isFilling) && (
          <g className={isFilling ? "pump-organic-fill" : "pump-organic-full"}>
            {bubbles.map((b, i) => (
              <circle
                key={i}
                cx={b.cx}
                cy={280}
                r={b.r}
                fill="white"
                fillOpacity={b.opacity}
                className="pump-organic-bubble"
                style={{
                  animationDelay: `${b.delay}s`,
                  animationDuration: `${b.duration}s`,
                }}
              />
            ))}
          </g>
        )}

        {/* Foam/froth at water surface during fill */}
        {isFilling && (
          <g className="pump-organic-fill">
            {[...Array(8)].map((_, i) => (
              <circle
                key={`foam-${i}`}
                cx={20 + i * 50 + Math.random() * 20}
                cy={25 + Math.random() * 10}
                r={3 + Math.random() * 4}
                fill="white"
                fillOpacity={0.08 + Math.random() * 0.08}
                className="pump-foam-dot"
                style={{ animationDelay: `${i * 0.3}s` }}
              />
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}
