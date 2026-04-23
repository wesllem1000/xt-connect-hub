import { Loader2, Power } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { useComando } from '../hooks/useComando'

type PumpState = 'off' | 'starting' | 'on' | 'stopping'

type Props = {
  deviceId: string | undefined
  pumpState: PumpState
  disabled?: boolean
  onBeforePumpOn?: () => Promise<boolean> | boolean
  onBeforePumpOff?: () => Promise<boolean> | boolean
}

export function BombaCommandButton({
  deviceId,
  pumpState,
  disabled,
  onBeforePumpOn,
  onBeforePumpOff,
}: Props) {
  const cmd = useComando(deviceId)

  const transient = pumpState === 'starting' || pumpState === 'stopping'
  const isOn = pumpState === 'on' || pumpState === 'stopping'

  async function handleClick() {
    if (cmd.isPending || transient || disabled) return
    if (isOn) {
      if (onBeforePumpOff) {
        const go = await onBeforePumpOff()
        if (!go) return
      }
      cmd.mutate({ cmd: 'pump_off' })
    } else {
      if (onBeforePumpOn) {
        const go = await onBeforePumpOn()
        if (!go) return
      }
      cmd.mutate({ cmd: 'pump_on' })
    }
  }

  const label =
    pumpState === 'starting' ? 'Iniciando…'
    : pumpState === 'stopping' ? 'Desligando…'
    : isOn ? 'Desligar bomba'
    : 'Ligar bomba'

  const loading = cmd.isPending || transient

  return (
    <Button
      onClick={handleClick}
      disabled={loading || disabled}
      className={cn(
        'w-full sm:w-auto h-12 text-base',
        !isOn && !loading && 'bg-emerald-600 hover:bg-emerald-700',
        isOn && !loading && 'bg-red-600 hover:bg-red-700',
      )}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Power className="h-4 w-4 mr-2" />
      )}
      {label}
    </Button>
  )
}
