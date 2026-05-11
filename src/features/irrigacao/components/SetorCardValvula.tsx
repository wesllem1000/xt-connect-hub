import { Clock, Gauge, Loader2, Timer } from 'lucide-react'
import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

import { SectorStatusIndicator } from './SectorStatusIndicator'
import type { IrrigationSector } from '../types'

type EstadoVisual = 'desabilitado' | 'fechada' | 'aberta' | 'abrindo' | 'fechando' | 'pausada'
type EstadoFirmware = 'closed' | 'opening' | 'open' | 'closing' | 'paused'

const FIRMWARE_TO_VISUAL: Record<EstadoFirmware, EstadoVisual> = {
  closed: 'fechada',
  opening: 'abrindo',
  open: 'aberta',
  closing: 'fechando',
  paused: 'pausada',
}

type Props = {
  setor: IrrigationSector
  /** Estado adicional vindo do MQTT live. Aceita estado do firmware (en) ou visual (pt). */
  estadoLive?: EstadoFirmware | EstadoVisual
  /** Origem reportada pelo firmware no /state — sinaliza controle por timer/auto. */
  sourceLive?: string | null
  /** Próximo fechamento programado (timer/duração). */
  scheduledCloseAtLive?: string | null
  onClick?: () => void
  /** Card desabilitado (mutation global em voo ou estado transiente do firmware). */
  disabled?: boolean
  /** Este card específico despachou o comando e está aguardando ack. */
  pending?: boolean
}

function deriveEstado(s: IrrigationSector): EstadoVisual {
  if (!s.habilitado) return 'desabilitado'
  if (s.pausado) return 'pausada'
  return 'fechada'
}

const labelMap: Record<EstadoVisual, { badge: string; label: string }> = {
  desabilitado: { badge: 'bg-muted text-muted-foreground', label: 'Desabilitado' },
  fechada: { badge: 'bg-slate-400 text-white hover:bg-slate-400', label: 'Fechada' },
  abrindo: { badge: 'bg-emerald-400 text-white hover:bg-emerald-400 animate-pulse', label: 'Abrindo' },
  aberta: { badge: 'bg-emerald-600 text-white hover:bg-emerald-600', label: 'Aberta' },
  fechando: { badge: 'bg-amber-500 text-white hover:bg-amber-500 animate-pulse', label: 'Fechando' },
  pausada: { badge: 'bg-amber-500 text-white hover:bg-amber-500', label: 'Pausada' },
}

function isTimerSource(source?: string | null): boolean {
  if (!source) return false
  const s = source.toLowerCase()
  return s.startsWith('timer') || s === 'auto' || s === 'automatic' || s === 'schedule'
}

function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m >= 60) {
    const h = Math.floor(m / 60)
    const mm = m % 60
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

function useCountdown(targetIso: string | null | undefined): number | null {
  const [secs, setSecs] = useState<number | null>(() =>
    targetIso ? Math.max(0, Math.floor((new Date(targetIso).getTime() - Date.now()) / 1000)) : null,
  )
  useEffect(() => {
    if (!targetIso) {
      setSecs(null)
      return
    }
    const target = new Date(targetIso).getTime()
    const tick = () => setSecs(Math.max(0, Math.floor((target - Date.now()) / 1000)))
    tick()
    const i = setInterval(tick, 1000)
    return () => clearInterval(i)
  }, [targetIso])
  return secs
}

export function SetorCardValvula({
  setor,
  estadoLive,
  sourceLive,
  scheduledCloseAtLive,
  onClick,
  disabled,
  pending,
}: Props) {
  const estado: EstadoVisual = estadoLive
    ? (FIRMWARE_TO_VISUAL[estadoLive as EstadoFirmware] ?? (estadoLive as EstadoVisual))
    : deriveEstado(setor)
  const meta = labelMap[estado]
  const clickable = Boolean(onClick) && setor.habilitado && !disabled
  const indicatorOpen = estado === 'aberta' || estado === 'abrindo'
  const isOpenLike = indicatorOpen || estado === 'fechando'

  const timerControlled = isTimerSource(sourceLive)
  const remaining = useCountdown(isOpenLike ? scheduledCloseAtLive ?? null : null)
  const showCountdown = isOpenLike && remaining != null && remaining > 0
  const showPower = setor.power_pct != null

  return (
    <Card
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : -1}
      aria-disabled={disabled || !setor.habilitado}
      onClick={clickable ? onClick : undefined}
      onKeyDown={(e) => {
        if (!clickable) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
      className={cn(
        'transition-shadow relative',
        clickable && 'cursor-pointer hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        !clickable && setor.habilitado && 'cursor-not-allowed',
        estado === 'desabilitado' && 'opacity-60',
        disabled && 'opacity-75',
      )}
    >
      <CardContent className="p-4 flex items-center gap-4">
        <SectorStatusIndicator isOpen={indicatorOpen} size={88} />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-sm truncate">{setor.nome}</p>
            <Badge className={cn('shrink-0', meta.badge)}>{meta.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">Setor {setor.numero}</p>

          {(timerControlled || showCountdown || showPower) && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {timerControlled && (
                <Badge
                  variant="outline"
                  className="h-5 px-1.5 gap-1 text-[10px] border-emerald-500/60 text-emerald-700 dark:text-emerald-400"
                >
                  <Timer className="h-3 w-3" />
                  Timer ativo
                </Badge>
              )}
              {showCountdown && (
                <Badge
                  variant="outline"
                  className="h-5 px-1.5 gap-1 text-[10px] font-mono tabular-nums"
                >
                  <Clock className="h-3 w-3" />
                  {formatCountdown(remaining!)}
                </Badge>
              )}
              {showPower && (
                <Badge
                  variant="outline"
                  className="h-5 px-1.5 gap-1 text-[10px] font-mono tabular-nums"
                  title="Potência configurada do inverter para este setor (fw 0.16+)"
                >
                  <Gauge className="h-3 w-3" />
                  {setor.power_pct}%
                </Badge>
              )}
            </div>
          )}

          {showPower && (
            <div className="relative h-1 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  'absolute inset-y-0 left-0 rounded-full transition-all duration-500',
                  isOpenLike ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                )}
                style={{ width: `${Math.max(0, Math.min(100, setor.power_pct ?? 0))}%` }}
              />
            </div>
          )}
        </div>
        {pending && (
          <Loader2
            aria-label="Comando em voo"
            className="h-4 w-4 animate-spin text-muted-foreground absolute top-2 right-2"
          />
        )}
      </CardContent>
    </Card>
  )
}
