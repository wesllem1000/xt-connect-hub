import { AlertTriangle, Check, ShieldAlert } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import { useAckAlarm } from '../hooks/useAckAlarm'
import type { IrrigationAlarme } from '../types'

const TIPO_LABEL: Record<string, string> = {
  temperature_high: 'Temperatura alta',
  sensor_missing: 'Sensor perdido',
  pump_runtime_exceeded: 'Bomba excedeu tempo máximo',
  communication_lost: 'Comunicação perdida',
}

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

type Props = {
  deviceId: string
  alarms: IrrigationAlarme[]
}

export function AlarmsBanner({ deviceId, alarms }: Props) {
  const ack = useAckAlarm(deviceId)
  if (alarms.length === 0) return null

  return (
    <Alert
      variant="destructive"
      className="border-2 border-red-600 bg-red-50 dark:bg-red-950/40"
    >
      <ShieldAlert className="h-5 w-5" />
      <AlertTitle className="text-base font-bold uppercase tracking-wide">
        {alarms.length} alarme(s) ativo(s) — bomba e setores cortados pelo
        firmware
      </AlertTitle>
      <AlertDescription className="mt-2 space-y-2">
        {alarms.map((a) => {
          const acked = a.acked_at != null
          return (
            <div
              key={a.id}
              className="flex items-start gap-3 rounded border border-red-300 bg-white/70 dark:bg-black/30 p-3"
            >
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">
                  {TIPO_LABEL[a.tipo] ?? a.tipo}
                </div>
                <div className="text-sm text-foreground">{a.message}</div>
                <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap gap-x-3">
                  <span>Início: {fmtTs(a.triggered_at)}</span>
                  {a.sensor_rom_id && (
                    <span className="font-mono">ROM: {a.sensor_rom_id}</span>
                  )}
                  {acked && (
                    <span className="text-emerald-700 dark:text-emerald-400">
                      ✓ ack {fmtTs(a.acked_at)}
                    </span>
                  )}
                </div>
              </div>
              {!acked && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => ack.mutate(a.id)}
                  disabled={ack.isPending}
                  className="shrink-0"
                >
                  <Check className="h-4 w-4 mr-1" />
                  Reconhecer
                </Button>
              )}
            </div>
          )
        })}
        <p className="text-[11px] text-muted-foreground pt-1">
          Reconhecer limpa o alarme aqui e no firmware. Bomba e setores foram
          cortados como segurança e permanecem desligados — você precisa
          religá-los manualmente depois de confirmar que o problema foi
          resolvido.
        </p>
      </AlertDescription>
    </Alert>
  )
}
