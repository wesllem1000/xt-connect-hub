import { useEffect, useState } from 'react'

import { subscribeTopic } from '@/lib/mqttClient'

export type DeviceBurstState =
  | { active: false }
  | {
      active: true
      rateS: number
      durationS: number
      startedAt: string
      expiresAt: string
    }

type RawPayload = {
  active?: boolean
  rate_s?: number
  duration_s?: number
  started_at?: string
  expires_at?: string
}

function parsePayload(v: unknown): DeviceBurstState | null {
  if (!v || typeof v !== 'object') return null
  const p = v as RawPayload
  if (p.active === false) return { active: false }
  if (p.active === true &&
      typeof p.rate_s === 'number' &&
      typeof p.expires_at === 'string') {
    return {
      active: true,
      rateS: p.rate_s,
      durationS: typeof p.duration_s === 'number' ? p.duration_s : 0,
      startedAt: p.started_at ?? new Date().toISOString(),
      expiresAt: p.expires_at,
    }
  }
  return null
}

/**
 * Estado canônico do burst (modo Tempo Real) servido pelo backend via
 * retained `devices/<serial>/burst-state`. Source of truth única — todos
 * os clientes (multi-aba, multi-usuário) veem o mesmo estado, e reload
 * preserva via retained.
 */
export function useDeviceBurstState(serial: string | undefined): DeviceBurstState {
  const [state, setState] = useState<DeviceBurstState>({ active: false })

  useEffect(() => {
    if (!serial) {
      setState({ active: false })
      return
    }
    const unsub = subscribeTopic(`devices/${serial}/burst-state`, (payload) => {
      const parsed = parsePayload(payload)
      if (parsed) setState(parsed)
    })
    return unsub
  }, [serial])

  // Auto-deactivate client-side se passou do expires_at (cobre lag do
  // sweeper TTL ou perda de evento burst_ended). Safety net visual.
  useEffect(() => {
    if (!state.active) return
    const remaining = new Date(state.expiresAt).getTime() - Date.now()
    if (remaining <= 0) {
      setState({ active: false })
      return
    }
    const id = setTimeout(() => setState({ active: false }), remaining + 500)
    return () => clearTimeout(id)
  }, [state])

  return state
}
