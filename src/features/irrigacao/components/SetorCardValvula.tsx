import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

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
  onClick?: () => void
}

function deriveEstado(s: IrrigationSector): EstadoVisual {
  if (!s.habilitado) return 'desabilitado'
  if (s.pausado) return 'pausada'
  // Fase 1 mock: sem MQTT live, assume fechada por default.
  return 'fechada'
}

const colorMap: Record<EstadoVisual, { ring: string; fill: string; badge: string; label: string }> = {
  desabilitado: { ring: 'stroke-muted-foreground/30', fill: 'fill-muted/20', badge: 'bg-muted text-muted-foreground', label: 'Desabilitado' },
  fechada:      { ring: 'stroke-slate-400', fill: 'fill-slate-100', badge: 'bg-slate-400 text-white hover:bg-slate-400', label: 'Fechada' },
  abrindo:      { ring: 'stroke-emerald-500 animate-pulse', fill: 'fill-emerald-50', badge: 'bg-emerald-400 text-white hover:bg-emerald-400', label: 'Abrindo' },
  aberta:       { ring: 'stroke-emerald-600', fill: 'fill-emerald-100', badge: 'bg-emerald-600 text-white hover:bg-emerald-600', label: 'Aberta' },
  fechando:     { ring: 'stroke-amber-500 animate-pulse', fill: 'fill-amber-50', badge: 'bg-amber-500 text-white hover:bg-amber-500', label: 'Fechando' },
  pausada:      { ring: 'stroke-amber-500', fill: 'fill-amber-50', badge: 'bg-amber-500 text-white hover:bg-amber-500', label: 'Pausada' },
}

export function SetorCardValvula({ setor, estadoLive, onClick }: Props) {
  const estado: EstadoVisual = estadoLive
    ? (FIRMWARE_TO_VISUAL[estadoLive as EstadoFirmware] ?? (estadoLive as EstadoVisual))
    : deriveEstado(setor)
  const c = colorMap[estado]
  const clickable = Boolean(onClick) && setor.habilitado

  return (
    <Card
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : -1}
      onClick={clickable ? onClick : undefined}
      onKeyDown={(e) => {
        if (!clickable) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
      className={cn(
        'transition-shadow',
        clickable && 'cursor-pointer hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        estado === 'desabilitado' && 'opacity-60',
      )}
    >
      <CardContent className="p-4 flex items-center gap-3">
        <svg viewBox="0 0 48 48" className="h-14 w-14 shrink-0" aria-hidden>
          {/* Válvula: círculo externo (corpo) + haste superior + indicador interno */}
          <circle cx="24" cy="26" r="16" className={cn(c.fill, c.ring)} strokeWidth="2.5" />
          <rect x="22" y="4" width="4" height="10" className={cn(c.fill, c.ring)} strokeWidth="1.5" />
          {estado === 'aberta' || estado === 'abrindo' ? (
            <circle cx="24" cy="26" r="6" className="fill-emerald-500" />
          ) : estado === 'pausada' ? (
            <>
              <rect x="20" y="21" width="2.5" height="10" className="fill-amber-600" />
              <rect x="25.5" y="21" width="2.5" height="10" className="fill-amber-600" />
            </>
          ) : (
            <line x1="15" y1="26" x2="33" y2="26" stroke="currentColor" strokeWidth="2" className="text-slate-400" />
          )}
        </svg>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-sm truncate">{setor.nome}</p>
            <Badge className={cn('shrink-0', c.badge)}>{c.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">
            #{setor.numero} · GPIO {setor.gpio_rele}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
