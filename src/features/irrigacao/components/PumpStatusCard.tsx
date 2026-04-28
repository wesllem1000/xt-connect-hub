import { useEffect, useRef, useState } from 'react'

export type PumpRuntime = {
  active: boolean
  mode: 'idle' | 'countdown' | 'elapsed'
  seconds: number
  remainingSec: number
  elapsedSec: number
}

type Props = {
  pumpOn: boolean
  manualMode: boolean
  pumpRuntime?: PumpRuntime | null
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const secs = s % 60
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export function PumpStatusCard({ pumpOn, pumpRuntime }: Props) {
  const [displaySeconds, setDisplaySeconds] = useState(0)
  const lastMqttUpdate = useRef(Date.now())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!pumpOn || !pumpRuntime || pumpRuntime.mode === 'idle') {
      setDisplaySeconds(0)
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }

    const baseSeconds =
      pumpRuntime.mode === 'countdown'
        ? pumpRuntime.remainingSec
        : pumpRuntime.elapsedSec

    setDisplaySeconds(baseSeconds)
    lastMqttUpdate.current = Date.now()

    if (intervalRef.current) clearInterval(intervalRef.current)

    intervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - lastMqttUpdate.current) / 1000
      if (pumpRuntime.mode === 'countdown') {
        setDisplaySeconds(Math.max(0, baseSeconds - elapsed))
      } else {
        setDisplaySeconds(baseSeconds + elapsed)
      }
    }, 500)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [pumpOn, pumpRuntime?.mode, pumpRuntime?.remainingSec, pumpRuntime?.elapsedSec])

  const isCountdown = pumpRuntime?.mode === 'countdown'
  const isElapsed = pumpRuntime?.mode === 'elapsed'
  const isActive = pumpOn && (isCountdown || isElapsed)

  const size = 180
  const strokeWidth = 8
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dashLength = circumference / 8
  const gapLength = circumference / 8

  return (
    <div className="flex flex-col items-center justify-center py-4">
      <div className="relative" style={{ width: size, height: size }}>
        {/* Background ring */}
        <svg width={size} height={size} className="absolute inset-0">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            className="stroke-muted/30"
          />
        </svg>

        {/* Animated ring */}
        <svg
          width={size}
          height={size}
          className={`absolute inset-0 transition-all duration-700 ${isActive ? 'pump-ring-spin' : ''}`}
          style={{ transformOrigin: 'center center' }}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={isActive ? `${dashLength} ${gapLength}` : `${circumference}`}
            className={`transition-all duration-700 ${
              pumpOn ? 'stroke-green-500' : 'stroke-destructive'
            }`}
            style={{
              filter: isActive
                ? 'drop-shadow(0 0 6px hsl(142 71% 45% / 0.5))'
                : undefined,
            }}
          />
        </svg>

        {/* Glow effect when active */}
        {isActive && (
          <svg
            width={size}
            height={size}
            className="absolute inset-0 pump-ring-spin"
            style={{ transformOrigin: 'center center' }}
          >
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              strokeWidth={strokeWidth + 4}
              strokeLinecap="round"
              strokeDasharray={`${dashLength} ${gapLength}`}
              className="stroke-green-500/20"
            />
          </svg>
        )}

        {/* Center text — fixed, does not rotate */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {!pumpOn ? (
            <>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Status
              </span>
              <span className="text-2xl font-bold text-destructive mt-1 transition-all duration-500">
                OFF
              </span>
              <span className="text-xs text-muted-foreground mt-1">Bomba parada</span>
            </>
          ) : isCountdown ? (
            <>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Desliga em
              </span>
              <span className="text-2xl font-bold text-green-500 mt-1 font-mono tabular-nums transition-all duration-500">
                {formatTime(displaySeconds)}
              </span>
              <span className="text-xs text-green-600 mt-1">Bomba ligada</span>
            </>
          ) : (
            <>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Ligada há
              </span>
              <span className="text-2xl font-bold text-green-500 mt-1 font-mono tabular-nums transition-all duration-500">
                {formatTime(displaySeconds)}
              </span>
              <span className="text-xs text-green-600 mt-1">Bomba ligada</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
