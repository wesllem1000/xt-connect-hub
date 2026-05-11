import { Gauge } from 'lucide-react'
import { cn } from '@/lib/utils'

type PumpState = 'off' | 'starting' | 'on' | 'stopping'

type Props = {
  pumpState: PumpState
  effectivePowerPct: number | null | undefined
  targetPowerPct: number | null | undefined
}

/**
 * Tile VFD do inverter da bomba.
 *
 * Retorna null se `targetPowerPct` é null/undefined — fw 0.15.5 não publica
 * esses campos, então o tile não aparece em IRR-V1-00009 (Eliza). Fica visível
 * só em devices fw 0.16+ que publicam `pump.target_power_pct` no /state.
 *
 * "ACELERANDO" dispara em duas situações:
 *  - state === 'starting' (firmware está rampando até o target)
 *  - effective < target (independente do state — pode acontecer durante operação)
 */
export function PumpVfdTile({ pumpState, effectivePowerPct, targetPowerPct }: Props) {
  if (targetPowerPct == null) return null

  const target = clampPct(targetPowerPct)
  const effective = effectivePowerPct == null ? 0 : clampPct(effectivePowerPct)

  const pumpRunning = pumpState === 'on' || pumpState === 'starting' || pumpState === 'stopping'
  const accelerating = pumpState === 'starting' || (pumpRunning && effective < target - 1)
  const decelerating = pumpRunning && effective > target + 1
  const stable = pumpRunning && !accelerating && !decelerating

  let statusLabel: string
  let statusClass: string
  if (!pumpRunning) {
    statusLabel = 'PARADA'
    statusClass = 'text-muted-foreground'
  } else if (accelerating) {
    statusLabel = 'ACELERANDO'
    statusClass = 'text-orange-600 dark:text-orange-400'
  } else if (decelerating) {
    statusLabel = 'DESACELERANDO'
    statusClass = 'text-amber-600 dark:text-amber-400'
  } else {
    statusLabel = 'ESTÁVEL'
    statusClass = 'text-emerald-600 dark:text-emerald-400'
  }

  const barColor = accelerating
    ? 'bg-orange-500'
    : decelerating
      ? 'bg-amber-500'
      : stable
        ? 'bg-emerald-500'
        : 'bg-muted-foreground/30'

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Inversor (VFD)
          </span>
        </div>
        <span className={cn('text-xs font-bold tracking-wide', statusClass)}>
          {statusLabel}
        </span>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-1">
          <span
            className={cn(
              'text-4xl font-bold font-mono tabular-nums tracking-tight transition-colors',
              accelerating
                ? 'text-orange-600 dark:text-orange-400'
                : decelerating
                  ? 'text-amber-600 dark:text-amber-400'
                  : pumpRunning
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-muted-foreground',
            )}
          >
            {effective}
          </span>
          <span className="text-lg font-semibold text-muted-foreground">%</span>
        </div>
        {target !== effective && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Alvo</p>
            <p className="text-sm font-semibold font-mono tabular-nums">{target}%</p>
          </div>
        )}
      </div>

      <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden">
        {/* Barra do alvo (referência fixa, suave) */}
        <div
          className="absolute inset-y-0 left-0 bg-muted-foreground/20 rounded-full"
          style={{ width: `${target}%` }}
        />
        {/* Barra do efetivo (animada, pulse laranja se acelerando) */}
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full transition-all duration-500',
            barColor,
            accelerating && 'pump-vfd-pulse',
          )}
          style={{ width: `${effective}%` }}
        />
      </div>
    </div>
  )
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}
