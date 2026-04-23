import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { subscribeTopic } from '@/lib/mqttClient'

/**
 * Subscribe em devices/<serial>/state via MQTT WSS (retained).
 * Ao chegar mensagem nova, invalida a query do snapshot — react-query
 * refetch pega o state atualizado pelo subscriber backend.
 *
 * Rápido o suficiente porque state é retained; qualquer novo cliente
 * recebe estado atual imediatamente no subscribe.
 */
export function useDeviceStateLive(
  serial: string | undefined,
  deviceId: string | undefined,
): void {
  const qc = useQueryClient()

  useEffect(() => {
    if (!serial || !deviceId) return
    const unsub = subscribeTopic(`devices/${serial}/state`, () => {
      qc.invalidateQueries({ queryKey: ['irrigacao', 'snapshot', deviceId] })
    })
    return unsub
  }, [serial, deviceId, qc])
}
