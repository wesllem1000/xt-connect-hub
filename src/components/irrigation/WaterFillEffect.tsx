import { useEffect, useState, useMemo } from "react";

interface WaterFillEffectProps {
  active: boolean;
}

/**
 * Phases:
 * idle      → nothing rendered
 * dripping  → droplets fall from top, getting thicker (2s)
 * splashing → stream hits bottom, splash spreads (2s), water starts rising at end
 * rising    → water rises with turbulence/splash, calming near top (7s)
 * full      → calm waves + bubbles
 * draining  → water level drops (3.5s)
 */
type Phase = "idle" | "dripping" | "splashing" | "rising" | "full" | "draining";

export default function WaterFillEffect({ active }: WaterFillEffectProps) {
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    if (active) {
      // Start dripping after 2s delay
      const t = setTimeout(() => setPhase("dripping"), 2000);
      return () => clearTimeout(t);
    } else {
      if (phase !== "idle") {
        setPhase("draining");
      }
    }
  }, [active]);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    switch (phase) {
      case "dripping":
        // Droplets fall for 2s, then stream hits bottom
        t = setTimeout(() => setPhase("splashing"), 2000);
        break;
      case "splashing":
        // Splash spreads for 2s, then water starts rising
        t = setTimeout(() => setPhase("rising"), 2000);
        break;
      case "rising":
        // Water rises for 7s
        t = setTimeout(() => setPhase("full"), 7000);
        break;
      case "draining":
        t = setTimeout(() => setPhase("idle"), 3500);
        break;
    }
    return () => clearTimeout(t!);
  }, [phase]);

  // Random bubbles
  const bubbles = useMemo(() => {
    return Array.from({ length: 14 }, () => ({
      cx: 30 + Math.random() * 340,
      r: 1 + Math.random() * 3,
      delay: Math.random() * 4,
      duration: 2.5 + Math.random() * 3,
      opacity: 0.12 + Math.random() * 0.2,
    }));
  }, []);

  // Splash particles at bottom
  const splashParticles = useMemo(() => {
    return Array.from({ length: 10 }, (_, i) => ({
      x: 180 + (Math.random() - 0.5) * 60,
      delay: i * 0.15,
      dx: (Math.random() - 0.5) * 80,
      dy: -(10 + Math.random() * 30),
      size: 2 + Math.random() * 3,
      duration: 0.6 + Math.random() * 0.5,
    }));
  }, []);

  // Turbulence drops while rising
  const turbulenceDrops = useMemo(() => {
    return Array.from({ length: 8 }, () => ({
      cx: 40 + Math.random() * 320,
      delay: Math.random() * 5,
      duration: 1 + Math.random() * 1.5,
      size: 1.5 + Math.random() * 2.5,
    }));
  }, []);

  if (phase === "idle") return null;

  const showStream = phase === "dripping" || phase === "splashing" || phase === "rising";
  const showSplashBottom = phase === "splashing";
  const showWater = phase === "rising" || phase === "full" || phase === "draining";
  const showTurbulence = phase === "rising";
  const showBubbles = phase === "rising" || phase === "full";

  return (
    <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none z-0">
      {/* === FAUCET STREAM === */}
      {showStream && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10" style={{ width: 40 }}>
          {/* Dripping phase: individual drops falling */}
          {phase === "dripping" && (
            <>
              {[...Array(5)].map((_, i) => (
                <div
                  key={`drip-${i}`}
                  className="pump-drip-drop"
                  style={{
                    animationDelay: `${i * 0.35}s`,
                    left: `${18 + (Math.random() - 0.5) * 8}px`,
                  }}
                />
              ))}
            </>
          )}

          {/* Splashing/Rising: full stream that thickens */}
          {(phase === "splashing" || phase === "rising") && (
            <svg
              width="40"
              height="100%"
              viewBox="0 0 40 300"
              preserveAspectRatio="none"
              className="absolute top-0 left-0 w-full pump-stream-appear"
              style={{ height: "100%" }}
            >
              <defs>
                <linearGradient id="stream-grad-v2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(205, 85%, 58%)" stopOpacity="0.65" />
                  <stop offset="50%" stopColor="hsl(200, 80%, 52%)" stopOpacity="0.4" />
                  <stop offset="85%" stopColor="hsl(200, 75%, 50%)" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="hsl(200, 70%, 50%)" stopOpacity="0.1" />
                </linearGradient>
              </defs>
              {/* Main stream - organic wobble */}
              <path
                className="pump-stream-path-v2"
                d="M20,0 Q18,40 22,80 Q24,120 19,160 Q16,200 21,240 Q23,270 20,300"
                stroke="url(#stream-grad-v2)"
                strokeWidth={phase === "rising" ? "6" : "4"}
                fill="none"
                strokeLinecap="round"
              />
              {/* Thin secondary stream */}
              <path
                className="pump-stream-path-v2-thin"
                d="M20,0 Q22,35 18,75 Q15,115 21,155 Q24,195 19,235 Q17,265 20,300"
                stroke="hsl(205, 85%, 62%)"
                strokeOpacity="0.2"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          )}

          {/* Side droplets spraying from stream */}
          {(phase === "splashing" || phase === "rising") && (
            <>
              {[...Array(6)].map((_, i) => (
                <div
                  key={`spray-${i}`}
                  className="pump-organic-drop"
                  style={{
                    '--drop-x': `${(Math.random() - 0.5) * 50}px`,
                    '--drop-y': `${-8 - Math.random() * 25}px`,
                    '--drop-size': `${2 + Math.random() * 2.5}px`,
                    animationDelay: `${i * 0.35}s`,
                    animationDuration: `${0.7 + Math.random() * 0.5}s`,
                    bottom: '0',
                  } as React.CSSProperties}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* === BOTTOM SPLASH when stream hits bottom === */}
      {showSplashBottom && (
        <svg
          className="absolute inset-0 w-full h-full z-[5]"
          viewBox="0 0 400 300"
          preserveAspectRatio="none"
        >
          {splashParticles.map((p, i) => (
            <circle
              key={`splash-${i}`}
              cx={p.x}
              cy={290}
              r={p.size}
              fill="hsl(205, 80%, 60%)"
              fillOpacity="0.4"
              className="pump-bottom-splash"
              style={{
                '--splash-dx': `${p.dx}px`,
                '--splash-dy': `${p.dy}px`,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
              } as React.CSSProperties}
            />
          ))}
          {/* Spreading ripple at bottom */}
          <ellipse
            cx="200"
            cy="290"
            rx="0"
            ry="0"
            fill="none"
            stroke="hsl(205, 80%, 60%)"
            strokeOpacity="0.25"
            strokeWidth="1.5"
            className="pump-ripple-spread"
          />
          <ellipse
            cx="200"
            cy="290"
            rx="0"
            ry="0"
            fill="none"
            stroke="hsl(200, 75%, 55%)"
            strokeOpacity="0.15"
            strokeWidth="1"
            className="pump-ripple-spread"
            style={{ animationDelay: "0.4s" }}
          />
        </svg>
      )}

      {/* === WATER BODY === */}
      {showWater && (
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 400 300"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="pump-water-org-v2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(205, 80%, 55%)" stopOpacity="0.08" />
              <stop offset="40%" stopColor="hsl(200, 78%, 48%)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="hsl(210, 85%, 40%)" stopOpacity="0.3" />
            </linearGradient>
            <linearGradient id="pump-wave-org-1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(200, 85%, 60%)" stopOpacity="0.14" />
              <stop offset="100%" stopColor="hsl(205, 80%, 50%)" stopOpacity="0.06" />
            </linearGradient>
            <linearGradient id="pump-wave-org-2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(195, 90%, 65%)" stopOpacity="0.1" />
              <stop offset="100%" stopColor="hsl(200, 80%, 55%)" stopOpacity="0.04" />
            </linearGradient>
          </defs>

          <g className={
            phase === "rising" ? "pump-organic-fill" :
            phase === "full" ? "pump-organic-full" :
            phase === "draining" ? "pump-organic-drain" : ""
          }>
            {/* Wave surface 1 - main */}
            <path
              className={`pump-wave-surface-1 ${showTurbulence ? 'pump-wave-turbulent' : ''}`}
              d="M-20,30 C40,15 80,45 140,28 C200,11 240,42 300,25 C360,8 380,35 420,22 L420,320 L-20,320 Z"
              fill="url(#pump-water-org-v2)"
            />
            {/* Wave surface 2 */}
            <path
              className={`pump-wave-surface-2 ${showTurbulence ? 'pump-wave-turbulent-2' : ''}`}
              d="M-20,35 C50,48 100,20 160,38 C220,56 260,18 320,35 C370,50 400,28 420,32 L420,320 L-20,320 Z"
              fill="url(#pump-wave-org-1)"
            />
            {/* Wave surface 3 */}
            <path
              className="pump-wave-surface-3"
              d="M-20,28 C30,42 90,18 150,35 C210,52 250,22 310,38 C350,48 390,25 420,30 L420,320 L-20,320 Z"
              fill="url(#pump-wave-org-2)"
            />

            {/* Turbulence splashes while rising */}
            {showTurbulence && turbulenceDrops.map((d, i) => (
              <circle
                key={`turb-${i}`}
                cx={d.cx}
                cy={20}
                r={d.size}
                fill="hsl(205, 80%, 60%)"
                fillOpacity="0.2"
                className="pump-turbulence-drop"
                style={{
                  animationDelay: `${d.delay}s`,
                  animationDuration: `${d.duration}s`,
                }}
              />
            ))}

            {/* Bubbles */}
            {showBubbles && bubbles.map((b, i) => (
              <circle
                key={`bub-${i}`}
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
        </svg>
      )}
    </div>
  );
}
