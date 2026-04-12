import { useEffect, useState } from "react";

interface WaterFillEffectProps {
  active: boolean;
}

export default function WaterFillEffect({ active }: WaterFillEffectProps) {
  const [phase, setPhase] = useState<"idle" | "filling" | "full" | "draining">("idle");

  useEffect(() => {
    if (active) {
      // Delay 2s before starting fill
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
      // After fill animation (6s), switch to full
      const t = setTimeout(() => setPhase("full"), 6000);
      return () => clearTimeout(t);
    }
    if (phase === "draining") {
      // After drain animation (3s), go idle
      const t = setTimeout(() => setPhase("idle"), 3000);
      return () => clearTimeout(t);
    }
  }, [phase]);

  if (phase === "idle") return null;

  const isFilling = phase === "filling";
  const isFull = phase === "full";
  const isDraining = phase === "draining";

  return (
    <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none z-0">
      {/* Faucet stream - only while filling */}
      {isFilling && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10">
          <div className="pump-faucet-stream" />
          {/* Splash drops */}
          <div className="pump-splash-drop pump-splash-drop-1" />
          <div className="pump-splash-drop pump-splash-drop-2" />
          <div className="pump-splash-drop pump-splash-drop-3" />
        </div>
      )}

      {/* Water body */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 400 300"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="pump-water-grad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="hsl(200, 75%, 45%)" stopOpacity="0.18" />
            <stop offset="50%" stopColor="hsl(195, 70%, 55%)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="hsl(190, 65%, 65%)" stopOpacity="0.06" />
          </linearGradient>
          <linearGradient id="pump-water-wave" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="hsl(200, 80%, 50%)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="hsl(195, 70%, 60%)" stopOpacity="0.04" />
          </linearGradient>
        </defs>

        {/* Main water rect */}
        <rect
          x="0"
          y="0"
          width="400"
          height="360"
          fill="url(#pump-water-grad)"
          className={
            isFilling ? "animate-pump-fill" :
            isFull ? "animate-pump-full-idle" :
            isDraining ? "animate-pump-drain" : ""
          }
        />

        {/* Wave overlay */}
        {(isFull || isFilling) && (
          <rect
            x="-50"
            y="0"
            width="500"
            height="360"
            fill="url(#pump-water-wave)"
            className={`animate-pump-wave ${isFilling ? "animate-pump-fill" : "animate-pump-full-idle"}`}
          />
        )}

        {/* Bubbles */}
        {(isFull || isFilling) && (
          <>
            <circle cx="80" cy="220" r="3" fill="white" fillOpacity="0.25" className="animate-pump-bubble" />
            <circle cx="200" cy="250" r="2" fill="white" fillOpacity="0.2" className="animate-pump-bubble-delayed" />
            <circle cx="310" cy="230" r="2.5" fill="white" fillOpacity="0.22" className="animate-pump-bubble-slow" />
            <circle cx="140" cy="260" r="1.8" fill="white" fillOpacity="0.18" className="animate-pump-bubble" style={{ animationDelay: "0.8s" }} />
            <circle cx="260" cy="240" r="2.2" fill="white" fillOpacity="0.2" className="animate-pump-bubble-delayed" style={{ animationDelay: "0.5s" }} />
          </>
        )}
      </svg>
    </div>
  );
}
