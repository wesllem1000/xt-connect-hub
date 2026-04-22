import { useEffect, useState } from 'react'
import { subscribeTopic } from '@/lib/mqttClient'

export type LiveReading = {
  ts: number
  readings: Record<string, number>
}

/**
 * Aceita dois formatos de payload:
 *   - envelope E2.2 formal: { ts: number, readings: { k: number } }
 *   - payload flat (firmware E3.x): { uptime_s, umidade_solo, firmware: "0.1.0", ... }
 *     → ts = Date.now(), readings = só chaves com valor number finito
 *       (strings como "firmware"/"modelo" e booleans como "burst" são descartados)
 */
function parseLiveReading(value: unknown): LiveReading | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>

  const hasEnvelope =
    typeof v.ts === 'number' &&
    Number.isFinite(v.ts) &&
    v.readings &&
    typeof v.readings === 'object' &&
    !Array.isArray(v.readings)

  if (hasEnvelope) {
    const r = v.readings as Record<string, unknown>
    const readings: Record<string, number> = {}
    for (const k of Object.keys(r)) {
      const x = r[k]
      if (typeof x === 'number' && Number.isFinite(x)) readings[k] = x
    }
    if (Object.keys(readings).length === 0) return null
    return { ts: v.ts as number, readings }
  }

  // Flat: filtra chaves numéricas finitas.
  const readings: Record<string, number> = {}
  for (const k of Object.keys(v)) {
    const x = v[k]
    if (typeof x === 'number' && Number.isFinite(x)) readings[k] = x
  }
  if (Object.keys(readings).length === 0) return null
  return { ts: Date.now(), readings }
}

export function useDeviceLiveData(serial: string | undefined): LiveReading | null {
  const [last, setLast] = useState<LiveReading | null>(null)
  useEffect(() => {
    if (!serial) return
    setLast(null)
    const unsub = subscribeTopic(`devices/${serial}/data`, (payload) => {
      const parsed = parseLiveReading(payload)
      if (parsed) setLast(parsed)
    })
    return unsub
  }, [serial])
  return last
}
