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
