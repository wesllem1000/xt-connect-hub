import { useEffect, useState } from 'react'
import { subscribeTopic } from '@/lib/mqttClient'

export type LiveReading = {
  ts: number
  readings: Record<string, number>
}

function isLiveReading(value: unknown): value is LiveReading {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v.ts !== 'number' || !Number.isFinite(v.ts)) return false
  if (!v.readings || typeof v.readings !== 'object' || Array.isArray(v.readings)) return false
  const r = v.readings as Record<string, unknown>
  return Object.values(r).every((x) => typeof x === 'number' && Number.isFinite(x))
}

export function useDeviceLiveData(serial: string | undefined): LiveReading | null {
  const [last, setLast] = useState<LiveReading | null>(null)
  useEffect(() => {
    if (!serial) return
    setLast(null)
    const unsub = subscribeTopic(`devices/${serial}/data`, (payload) => {
      if (isLiveReading(payload)) setLast(payload)
    })
    return unsub
  }, [serial])
  return last
}
