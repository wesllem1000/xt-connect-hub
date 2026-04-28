import { Loader2 } from 'lucide-react'

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

export function SetorCardValvula({ setor, estadoLive, onClick, disabled, pending }: Props) {
  const estado: EstadoVisual = estadoLive
    ? (FIRMWARE_TO_VISUAL[estadoLive as EstadoFirmware] ?? (estadoLive as EstadoVisual))
    : deriveEstado(setor)
  const meta = labelMap[estado]
  const clickable = Boolean(onClick) && setor.habilitado && !disabled
  // SectorStatusIndicator: enche se aberta/abrindo, esvazia caso contrário.
  const indicatorOpen = estado === 'aberta' || estado === 'abrindo'

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
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-sm truncate">{setor.nome}</p>
            <Badge className={cn('shrink-0', meta.badge)}>{meta.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">
            #{setor.numero} · GPIO {setor.gpio_rele}
          </p>
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
