import { Activity, AlertTriangle, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVfdLive } from '../hooks/useVfdLive'

type Props = { serial: string | undefined }

function Metric({ label, value, unit, className }: { label: string; value: string; unit?: string; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="flex items-baseline gap-0.5">
        <span className={cn('text-base font-bold font-mono tabular-nums', className)}>{value}</span>
        {unit && <span className="text-[10px] text-muted-foreground">{unit}</span>}
      </div>
    </div>
  )
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
      ok ? 'bg-green-600/15 text-green-700 dark:text-green-400' : 'bg-red-600/15 text-red-700 dark:text-red-400',
    )}>
      <span className={cn('h-1.5 w-1.5 rounded-full', ok ? 'bg-green-500' : 'bg-red-500')} />
      {label}
    </span>
  )
}

export function VfdLiveCard({ serial }: Props) {
  const vfd = useVfdLive(serial)
  if (!vfd) return null  // device sem inverter ou ainda sem primeiro /data

  const ageS = Math.max(0, Math.round((Date.now() - vfd.ts) / 1000))
  const stale = ageS > 90  // 3x cadência 30s
  const statusLabel = vfd.running ? 'RODANDO' : 'PARADO'
  const statusClass = vfd.running
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-muted-foreground'
  const freqColor = vfd.running ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Inversor (VFD)
          </span>
        </div>
        <span className={cn('text-xs font-bold tracking-wide', statusClass)}>{statusLabel}</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <StatusBadge ok={vfd.comm_ok} label="Comm RS485" />
        {vfd.fault && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-red-600/15 text-red-700 dark:text-red-400">
            <AlertTriangle className="h-3 w-3" /> Fault
          </span>
        )}
        {!vfd.running && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
            <Activity className="h-3 w-3" /> Stopped
          </span>
        )}
        {stale && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-amber-600/15 text-amber-700 dark:text-amber-400">
            stale ({ageS}s)
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
        <Metric label="Frequência"  value={vfd.freq_out_hz.toFixed(1)}                      unit="Hz"  className={freqColor} />
        <Metric label="Set-point"   value={vfd.freq_set_hz.toFixed(1)}                      unit="Hz" />
        <Metric label="Corrente"    value={vfd.i_out_a.toFixed(2)}                          unit="A" />
        <Metric label="Potência"    value={vfd.p_kva.toFixed(2)}                            unit="kVA" />
        <Metric label="Tensão DC"   value={vfd.v_bus_v.toFixed(0)}                          unit="V" />
        <Metric label="Torque"      value={(vfd.torque_pct >= 0 ? '+' : '') + vfd.torque_pct.toFixed(0)} unit="%" />
      </div>

      <div className="flex justify-end text-[10px] text-muted-foreground border-t pt-2">
        <span>atualizado há {ageS}s</span>
      </div>
    </div>
  )
}
