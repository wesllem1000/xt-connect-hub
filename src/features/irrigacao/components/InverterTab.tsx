import { useEffect, useState } from 'react'
import { Power, Zap, Loader2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import { VfdLiveCard } from './VfdLiveCard'
import { InverterConfigCard } from './InverterConfigCard'
import { useVfdLive } from '../hooks/useVfdLive'
import { useComando } from '../hooks/useComando'
import type { IrrigationConfig } from '../types'

type Props = {
  deviceId: string
  serial: string | undefined
  config: IrrigationConfig | null | undefined
  isInverter: boolean
}

export function InverterTab({ deviceId, serial, config, isInverter }: Props) {
  const vfd = useVfdLive(serial)
  const cmd = useComando(deviceId)

  // Estado real do firmware (vfd.running) chega só a cada 30s (cadência /data).
  // Pra UX responsiva: otimistic toggle local até MQTT sincronizar.
  const [optimistic, setOptimistic] = useState<boolean | null>(null)
  const running = optimistic !== null ? optimistic : vfd?.running === true

  // Limpa otimistic quando estado real bater
  useEffect(() => {
    if (optimistic !== null && vfd?.running === optimistic) setOptimistic(null)
  }, [vfd?.running, optimistic])

  function handleToggle() {
    const next = !running
    setOptimistic(next)
    cmd.mutate(
      { cmd: next ? 'pump_on' : 'pump_off', params: {} },
      {
        onSuccess: (data) => {
          // Refused → reverte optimistic
          if (data.ack_status !== 'executed' && data.ack_status !== 'accepted') {
            setOptimistic(!next)
          }
        },
        onError: () => setOptimistic(null),
      },
    )
  }

  if (!isInverter) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <Zap className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm font-medium">Aba disponivel somente em bombas do tipo <strong>inverter</strong>.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Configure o tipo da bomba na aba <strong>Bomba</strong> para liberar esta secao.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* 1. Leitura ao vivo */}
      <VfdLiveCard serial={serial} />

      {/* 2. Botão único toggle — liga/desliga bomba (com otimistic update) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Controle rápido</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            onClick={handleToggle}
            disabled={cmd.isPending}
            className={cn(
              'w-full gap-2 text-white',
              running
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-emerald-600 hover:bg-emerald-700',
            )}
          >
            {cmd.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
            {cmd.isPending
              ? (running ? 'Desligando…' : 'Ligando…')
              : (running ? 'Desligar bomba' : 'Ligar bomba')}
          </Button>
        </CardContent>
      </Card>

      {/* 3. Configuracao editavel */}
      <InverterConfigCard deviceId={deviceId} config={config} />

      {/* 3. Status RS485 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Status conexao RS485
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {vfd ? (
            <Badge
              className={
                vfd.comm_ok
                  ? 'bg-green-600 hover:bg-green-600 text-white'
                  : 'bg-red-600 hover:bg-red-600 text-white'
              }
            >
              {vfd.comm_ok ? 'Comm RS485 OK' : 'Comm RS485 FALHA'}
            </Badge>
          ) : (
            <Badge variant="outline">Aguardando dados do VFD...</Badge>
          )}
          <p className="text-xs text-muted-foreground">
            Contadores RS485 (ok_count / err_count) serao expostos a partir do firmware 0.18+.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
