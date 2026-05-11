import { useEffect, useState } from 'react'
import { subscribeTopic } from '@/lib/mqttClient'

/**
 * Snapshot do bloco vfd{} publicado em devices/<serial>/data (cadência 30s).
 * Schema oficial fw 0.17.0+ — só presente quando tipo_bomba=="inverter" e gVfdTaskAlive.
 */
export type VfdLiveSnapshot = {
  ts: number  // ms epoch
  freq_out_hz: number
  freq_set_hz: number
  i_out_a: number
  p_kva: number
  v_bus_v: number
  torque_pct: number
  running: boolean
  fault: boolean
  comm_ok: boolean
}

function parseVfd(value: unknown): VfdLiveSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const env = value as Record<string, unknown>
  const v = env.vfd as Record<string, unknown> | undefined
  if (!v || typeof v !== 'object') return null

  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
  const bool = (x: unknown) => (typeof x === 'boolean' ? x : null)

  const fields = {
    freq_out_hz: num(v.freq_out_hz),
    freq_set_hz: num(v.freq_set_hz),
    i_out_a:     num(v.i_out_a),
    p_kva:       num(v.p_kva),
    v_bus_v:     num(v.v_bus_v),
    torque_pct:  num(v.torque_pct),
    running:     bool(v.running),
    fault:       bool(v.fault),
    comm_ok:     bool(v.comm_ok),
  }
  // Todos os 9 obrigatórios pra considerar válido
  for (const val of Object.values(fields)) if (val === null) return null

  let ts: number
  if (typeof env.ts === 'string') {
    const p = Date.parse(env.ts)
    ts = Number.isFinite(p) ? p : Date.now()
  } else if (typeof env.ts === 'number' && Number.isFinite(env.ts)) {
    ts = env.ts
  } else {
    ts = Date.now()
  }

  return { ts, ...fields } as VfdLiveSnapshot
}

/**
 * Assina devices/<serial>/data e mantém último snapshot vfd{}.
 * Retorna null até o primeiro /data com vfd presente (ou se device não é inverter).
 */
export function useVfdLive(serial: string | undefined): VfdLiveSnapshot | null {
  const [snap, setSnap] = useState<VfdLiveSnapshot | null>(null)
  useEffect(() => {
    if (!serial) return
    setSnap(null)
    const unsub = subscribeTopic(`devices/${serial}/data`, (payload) => {
      const parsed = parseVfd(payload)
      if (parsed) setSnap(parsed)
    })
    return unsub
  }, [serial])
  return snap
}
