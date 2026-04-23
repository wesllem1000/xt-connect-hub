import { useEffect, useState } from 'react'
import { subscribeTopic } from '@/lib/mqttClient'

export type DeviceStatus = {
  online: boolean
  lastSeenAt: string | null
}

type StatusEvent = {
  type?: string
  online?: boolean
  last_seen_at?: string | null
}

function isStatusEvent(value: unknown): value is StatusEvent {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return v.type === 'device_status_changed' && typeof v.online === 'boolean'
}

// Semente vem da API; eventos MQTT sobrescrevem live.
// Mudanças posteriores no `initial` (ex.: refetch da lista) não revertem
// o estado local — o MQTT é a fonte mais recente.
export function useDeviceStatus(
  serial: string | undefined,
  initial: DeviceStatus,
): DeviceStatus {
  const [status, setStatus] = useState<DeviceStatus>(initial)

  useEffect(() => {
    if (!serial) return
    const unsub = subscribeTopic(`devices/${serial}/status`, (payload) => {
      if (!isStatusEvent(payload)) return
      setStatus({
        online: payload.online as boolean,
        lastSeenAt: payload.last_seen_at ?? new Date().toISOString(),
      })
    })
    return unsub
  }, [serial])

  return status
}
