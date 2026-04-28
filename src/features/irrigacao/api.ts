import { api } from '@/lib/api'

import type {
  IrrigationAlarme,
  IrrigationConfig,
  IrrigationEvent,
  IrrigationSector,
  IrrigationSnapshot,
  IrrigationTemperatureSensor,
  IrrigationTimer,
  TimerAlvoTipo,
} from './types'

const base = (deviceId: string) => `dispositivos/${deviceId}/irrigacao`

export async function getSnapshot(deviceId: string): Promise<IrrigationSnapshot> {
  return api.get(`${base(deviceId)}/snapshot`).json<IrrigationSnapshot>()
}

export async function getConfig(deviceId: string): Promise<IrrigationConfig> {
  const { config } = await api
    .get(`${base(deviceId)}/config`)
    .json<{ config: IrrigationConfig }>()
  return config
}

export async function getSectors(deviceId: string): Promise<IrrigationSector[]> {
  const { setores } = await api
    .get(`${base(deviceId)}/setores`)
    .json<{ setores: IrrigationSector[] }>()
  return setores
}

export async function getTimers(
  deviceId: string,
  filter?: { alvo_tipo?: TimerAlvoTipo; alvo_id?: string },
): Promise<IrrigationTimer[]> {
  const sp = new URLSearchParams()
  if (filter?.alvo_tipo) sp.set('alvo_tipo', filter.alvo_tipo)
  if (filter?.alvo_id) sp.set('alvo_id', filter.alvo_id)
  const qs = sp.toString()
  const url = `${base(deviceId)}/timers` + (qs ? `?${qs}` : '')
  const { timers } = await api.get(url).json<{ timers: IrrigationTimer[] }>()
  return timers
}

export async function getSensors(
  deviceId: string,
): Promise<IrrigationTemperatureSensor[]> {
  const { sensores } = await api
    .get(`${base(deviceId)}/sensores-temperatura`)
    .json<{ sensores: IrrigationTemperatureSensor[] }>()
  return sensores
}

export type EventFilter = {
  tipo?: string
  from?: string
  to?: string
  alvo_tipo?: TimerAlvoTipo
  limit?: number
  offset?: number
}

export type EventsPage = {
  eventos: IrrigationEvent[]
  paginacao: { limit: number; offset: number; total: number }
}

export async function getEvents(
  deviceId: string,
  filter?: EventFilter,
): Promise<EventsPage> {
  const sp = new URLSearchParams()
  if (filter?.tipo) sp.set('tipo', filter.tipo)
  if (filter?.from) sp.set('from', filter.from)
  if (filter?.to) sp.set('to', filter.to)
  if (filter?.alvo_tipo) sp.set('alvo_tipo', filter.alvo_tipo)
  if (filter?.limit) sp.set('limit', String(filter.limit))
  if (filter?.offset) sp.set('offset', String(filter.offset))
  const qs = sp.toString()
  const url = `${base(deviceId)}/eventos` + (qs ? `?${qs}` : '')
  return api.get(url).json<EventsPage>()
}

export async function getActiveAlarms(
  deviceId: string,
): Promise<IrrigationAlarme[]> {
  const { alarmes } = await api
    .get(`${base(deviceId)}/alarmes/ativos`)
    .json<{ alarmes: IrrigationAlarme[] }>()
  return alarmes
}

// ========= writes (E4.2A) =========

export type IrrCmd =
  | 'pump_on' | 'pump_off'
  | 'sector_open' | 'sector_close' | 'sector_pause' | 'sector_resume'
  | 'mode_set' | 'safe_closure' | 'config_reload' | 'factory_reset'

export type ComandoResponse = {
  cmd_id: string
  issued_at: string
  expires_at: string
}

/** Endpoint legado fire-and-forget (mantido por retrocompat). */
export async function postComando(
  deviceId: string,
  cmd: IrrCmd,
  params: Record<string, unknown> = {},
): Promise<ComandoResponse> {
  return api
    .post(`${base(deviceId)}/comandos`, { json: { cmd, params } })
    .json<ComandoResponse>()
}

export type AckStatus =
  | 'accepted'
  | 'executed'
  | 'refused'
  | 'expired'
  | 'requires_decision'
  | 'requires_confirmation'

export type ComandoSyncResponse = {
  cmd_id: string
  ack_status?: AckStatus
  ack_code?: string | null
  ack_message?: string | null
  result_payload?: unknown
}

/**
 * Endpoint síncrono (Fase 1.6 — _e051): bloqueia até o dispositivo responder
 * o ack via MQTT (`devices/<serial>/commands/ack`) ou estourar 10s de timeout.
 *
 * Códigos:
 *   - 200 → ack chegou (ver ack_status pra desfecho)
 *   - 503 → device offline (não publica)
 *   - 504 → timeout (publicou mas não veio ack em 10s)
 */
export async function postComandoSync(
  deviceId: string,
  cmd: IrrCmd,
  params: Record<string, unknown> = {},
): Promise<ComandoSyncResponse> {
  return api
    .post(`${base(deviceId)}/comandos/sync`, { json: { cmd, params } })
    .json<ComandoSyncResponse>()
}

export async function patchConfig(
  deviceId: string,
  patch: Partial<Record<string, unknown>>,
) {
  const { config } = await api
    .patch(`${base(deviceId)}/config`, { json: patch })
    .json<{ config: unknown }>()
  return config
}

export async function patchSetor(
  deviceId: string,
  numero: number,
  patch: Partial<Record<string, unknown>>,
) {
  const { setor } = await api
    .patch(`${base(deviceId)}/setores/${numero}`, { json: patch })
    .json<{ setor: unknown }>()
  return setor
}

export type PostTimerInput = {
  alvo_tipo: 'pump' | 'sector'
  alvo_id?: string | null
  tipo: 'fixed' | 'cyclic_window' | 'cyclic_continuous'
  nome: string
  hora_inicio?: string
  hora_fim?: string
  duracao_min?: number
  on_minutes?: number
  off_minutes?: number
  dias_semana: number
  observacao?: string
  overlap_confirmed?: boolean
}

export async function postTimer(deviceId: string, input: PostTimerInput) {
  return api
    .post(`${base(deviceId)}/timers`, { json: input })
    .json<{ timer: unknown }>()
}

export async function patchTimer(
  deviceId: string,
  timerId: string,
  patch: Partial<PostTimerInput>,
) {
  return api
    .patch(`${base(deviceId)}/timers/${timerId}`, { json: patch })
    .json<{ timer: unknown }>()
}

export async function deleteTimer(deviceId: string, timerId: string) {
  return api
    .delete(`${base(deviceId)}/timers/${timerId}`)
    .json<{ ok: true; id: string }>()
}
