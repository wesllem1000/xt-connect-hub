import { useEffect, useState } from 'react'

import { subscribeTopic } from '@/lib/mqttClient'

type SensorReading = {
  tempC: number
  ts: string
}

type Payload = {
  ts?: string
  readings?: Array<{ rom_id?: string; temperature_c?: number }>
}

function isPayload(v: unknown): v is Payload {
  return !!v && typeof v === 'object'
}

/**
 * Live readings de sensores de temperatura via MQTT.
 *
 * O snapshot REST (useIrrigationSnapshot) refeita só a cada 15s, então a
 * temperatura externa fica defasada em modo Tempo Real. Este hook assina
 * `devices/<serial>/telemetry/sensors` direto e mantém um Map<rom_id, temp>
 * atualizado por publish.
 *
 * Render combina: liveReadings.get(rom_id)?.tempC ?? snapshot.ultima_leitura_c
 */
export function useDeviceSensorsLive(serial: string | undefined): Map<string, SensorReading> {
  const [readings, setReadings] = useState<Map<string, SensorReading>>(() => new Map())

  useEffect(() => {
    if (!serial) {
      setReadings(new Map())
      return
    }
    const unsub = subscribeTopic(`devices/${serial}/telemetry/sensors`, (payload) => {
      if (!isPayload(payload)) return
      const arr = payload.readings
      if (!Array.isArray(arr) || arr.length === 0) return
      const ts = payload.ts || new Date().toISOString()
      setReadings((prev) => {
        const next = new Map(prev)
        for (const r of arr) {
          if (r && typeof r.rom_id === 'string' && typeof r.temperature_c === 'number'
              && Number.isFinite(r.temperature_c)) {
            next.set(r.rom_id, { tempC: r.temperature_c, ts })
          }
        }
        return next
      })
    })
    return unsub
  }, [serial])

  return readings
}
