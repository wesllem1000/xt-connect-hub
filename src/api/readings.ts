import { api } from '@/lib/api'

export type Reading = {
  ts: string
  payload: Record<string, number>
}

export type ListReadingsParams = {
  limit?: number
  since?: string
  until?: string
}

export async function listReadings(
  deviceId: string,
  params: ListReadingsParams = {},
): Promise<Reading[]> {
  const search = new URLSearchParams()
  if (params.limit) search.set('limit', String(params.limit))
  if (params.since) search.set('since', params.since)
  if (params.until) search.set('until', params.until)
  const qs = search.toString()
  const path = qs ? `dispositivos/${deviceId}/readings?${qs}` : `dispositivos/${deviceId}/readings`
  const data = await api.get(path).json<{ readings: Reading[] }>()
  return data.readings
}
