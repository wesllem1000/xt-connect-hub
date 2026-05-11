import { useEffect, useState } from 'react'
import { subscribeTopic } from '@/lib/mqttClient'

export type DeviceStatus = {
  online: boolean
  lastSeenAt: string | null
}

/**
 * Shape B do tópico MQTT `devices/<serial>/status` — MQTT_CONTRACT §3a.
 * Guard canônico: `typeof payload === "object" && payload.type === "device_status_changed"`
 * Campos opcionais extras (device_id, serial, source) presentes na Shape B mas
 * nao consumidos por este hook — expostos pra evitar acesso não tipado em callsites.
 */
type StatusEvent = {
  type: 'device_status_changed'
  online: boolean
  last_seen_at?: string | null
  device_id?: string
  serial?: string
  user_id?: string
  source?: 'status-mirror' | 'ingest' | 'sweeper'
}

function isStatusEvent(value: unknown): value is StatusEvent {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return v.type === 'device_status_changed' && typeof v.online === 'boolean'
}

// Semente vem da API. Quando o serial muda (navegação entre devices),
// re-semeia com o initial novo. Eventos MQTT sobrescrevem live.
export function useDeviceStatus(
  serial: string | undefined,
  initial: DeviceStatus,
): DeviceStatus {
  const [status, setStatus] = useState<DeviceStatus>(initial)

  // Re-semeia ao trocar de device. Sem isso, `useState(initial)` mantém
  // o estado do primeiro mount mesmo navegando entre detail pages.
  useEffect(() => {
    setStatus(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial])

  useEffect(() => {
    if (!serial) return
    const unsub = subscribeTopic(`devices/${serial}/status`, (payload) => {
      if (!isStatusEvent(payload)) return
      setStatus({
        online: payload.online,
        lastSeenAt: payload.last_seen_at ?? new Date().toISOString(),
      })
    })
    return unsub
  }, [serial])

  return status
}
