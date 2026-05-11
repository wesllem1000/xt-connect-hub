import { useEffect, useState } from 'react'
import { Clock, Bot } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type Props = {
  /** Nome do timer atualmente rodando (state.pump.active_timer_name, fw 0.17+). */
  activeTimerName?: string | null
  /** scheduled_off_at do firmware (ISO string ou null) */
  scheduledOffAt?: string | null
  /** Estado da bomba — só renderiza se on */
  pumpOn: boolean
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0s'
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m === 0) return `${s}s`
  if (s === 0) return `${m}min`
  return `${m}min ${s}s`
}

export function RunningTimerBanner({ activeTimerName, scheduledOffAt, pumpOn }: Props) {
  // Tick 1s pra atualizar countdown
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!scheduledOffAt) return
    const i = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(i)
  }, [scheduledOffAt])

  if (!pumpOn || !activeTimerName) return null

  const offMs = scheduledOffAt ? new Date(scheduledOffAt).getTime() : null
  const remainMs = offMs != null ? Math.max(0, offMs - Date.now()) : null
  // Se scheduled_off_at == null mas bomba ON via auto: rampa/aceleração
  const accelerating = pumpOn && !scheduledOffAt

  return (
    <Card className="border-emerald-500/60 bg-emerald-50/50 dark:bg-emerald-950/20">
      <CardContent className="p-3 flex items-center gap-3">
        <div className="shrink-0 h-9 w-9 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <Bot className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-medium">
              Em execução
            </span>
            {accelerating && (
              <Badge className="bg-orange-500 hover:bg-orange-500 text-[9px] h-4 px-1.5 animate-pulse">
                ACELERANDO
              </Badge>
            )}
          </div>
          <p className="text-sm font-semibold truncate text-emerald-900 dark:text-emerald-200">
            {activeTimerName}
          </p>
        </div>
        {remainMs != null && (
          <div className="shrink-0 text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">restante</div>
            <div className={cn(
              'font-mono text-sm tabular-nums font-bold',
              remainMs < 30000 ? 'text-orange-600' : 'text-emerald-700 dark:text-emerald-400',
            )}>
              <Clock className="inline h-3 w-3 mr-0.5" />
              {formatRemaining(remainMs)}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
