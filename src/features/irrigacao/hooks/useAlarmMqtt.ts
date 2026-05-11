import { useEffect, useState } from 'react'

import { subscribeTopic } from '@/lib/mqttClient'

import type { AlarmMqttPayload } from '../types'

/**
 * Assina `devices/<serial>/alarm/active` (retained, QoS 1 via E5.5).
 *
 * Retorna:
 *   - `null`  → serial ainda não disponível OU nenhum alarme ativo
 *               (broker enviou payload vazio "")
 *   - `AlarmMqttPayload` → alarme ativo (severity + ack_state atualizados)
 *
 * Estado compartilhado: o backend (Node-RED) é quem publica o retained.
 * Múltiplas abas recebem o mesmo payload via broker — nunca useState isolado.
 */
export function useAlarmMqtt(serial: string | undefined): AlarmMqttPayload | null {
  const [alarm, setAlarm] = useState<AlarmMqttPayload | null>(null)

  useEffect(() => {
    if (!serial) return

    const topic = `devices/${serial}/alarm/active`

    const unsub = subscribeTopic(topic, (raw) => {
      // Payload vazio ("") ou null → nenhum alarme ativo
      if (!raw || raw === '') {
        setAlarm(null)
        return
      }

      // Validação mínima da shape (TypeScript em runtime)
      if (
        typeof raw !== 'object' ||
        Array.isArray(raw) ||
        !('alarm_id' in (raw as object)) ||
        !('ack_state' in (raw as object))
      ) {
        console.warn('[useAlarmMqtt] payload inesperado:', raw)
        return
      }

      const p = raw as AlarmMqttPayload

      // ack_state 'acknowledged_final' → banner deve sumir
      if (p.ack_state === 'acknowledged_final') {
        setAlarm(null)
        return
      }

      setAlarm(p)
    })

    return unsub
  }, [serial])

  return alarm
}
