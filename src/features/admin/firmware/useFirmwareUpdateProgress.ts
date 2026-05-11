import { useEffect, useState, useRef } from 'react'
import { subscribeTopic } from '@/lib/mqttClient'
import type {
  FirmwareUpdateProgress,
  FirmwareUpdateTerminal,
  FirmwareUpdatePhase,
} from './types'

const VALID_PHASES = new Set<FirmwareUpdatePhase>([
  'starting',
  'downloading',
  'verifying',
  'installing',
  'rebooting',
])

function parseProgressPayload(
  payload: Record<string, unknown>,
): FirmwareUpdateProgress | null {
  const phase = payload.phase
  if (typeof phase !== 'string' || !VALID_PHASES.has(phase as FirmwareUpdatePhase)) {
    return null
  }
  const percent = Number(payload.percent)
  const target_version = String(payload.target_version || '')
  if (!Number.isFinite(percent) || !target_version) return null
  return {
    phase: phase as FirmwareUpdatePhase,
    percent: Math.max(0, Math.min(100, percent)),
    bytes_downloaded:
      typeof payload.bytes_downloaded === 'number'
        ? payload.bytes_downloaded
        : undefined,
    bytes_total:
      typeof payload.bytes_total === 'number' ? payload.bytes_total : undefined,
    target_version,
    ts: Date.now(),
  }
}

export type FirmwareUpdateState = {
  active: boolean
  progress: FirmwareUpdateProgress | null
  terminal: FirmwareUpdateTerminal | null
  startedAt: number | null
}

/**
 * Assina events do device e captura sequência firmware_update_*.
 * Active fica true entre dispatch (caller seta via startTracking) e
 * firmware_update_validated (ou failed/refused).
 */
export function useFirmwareUpdateProgress(serial: string | undefined) {
  const [state, setState] = useState<FirmwareUpdateState>({
    active: false,
    progress: null,
    terminal: null,
    startedAt: null,
  })
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    if (!serial) return
    const unsub = subscribeTopic(`devices/${serial}/events`, (payload) => {
      if (!payload || typeof payload !== 'object') return
      const evt = payload as Record<string, unknown>
      const et = String(evt.event_type || '')
      if (!et.startsWith('firmware_update_')) return
      const ep = (evt.payload as Record<string, unknown>) || {}

      if (et === 'firmware_update_progress') {
        const prog = parseProgressPayload(ep)
        if (prog) {
          setState((s) => ({ ...s, active: true, progress: prog }))
        }
      } else if (et === 'firmware_update_succeeded') {
        setState((s) => ({
          ...s,
          progress: { ...(s.progress ?? { phase: 'installing', percent: 100, target_version: String(ep.target_version || ''), ts: Date.now() }), percent: 100 },
          terminal: {
            kind: 'succeeded',
            target_version: String(ep.target_version || ''),
            ts: Date.now(),
          },
        }))
      } else if (et === 'firmware_update_failed') {
        setState((s) => ({
          ...s,
          terminal: {
            kind: 'failed',
            phase: String(ep.phase || '?'),
            error: String(ep.error || 'unknown'),
            target_version: String(ep.target_version || ''),
            ts: Date.now(),
          },
        }))
      } else if (et === 'firmware_update_validated') {
        setState((s) => ({
          ...s,
          active: false,
          terminal: {
            kind: 'validated',
            fw_version: String(ep.fw_version || ''),
            ts: Date.now(),
          },
        }))
      }
    })
    return unsub
  }, [serial])

  const startTracking = () => {
    setState({
      active: true,
      progress: null,
      terminal: null,
      startedAt: Date.now(),
    })
  }

  const reset = () => {
    setState({ active: false, progress: null, terminal: null, startedAt: null })
  }

  return { ...state, startTracking, reset }
}
