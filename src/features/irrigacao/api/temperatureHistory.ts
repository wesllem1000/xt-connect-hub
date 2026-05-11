import { api } from '@/lib/api'

export type TempHistoryPoint = {
  ts: string
  value: number
}

export type TempHistoryResponse = {
  sensor: { rom_id: string; nome: string; role: string }
  range: { from: string; to: string; every: string }
  points: TempHistoryPoint[]
}

export async function getTemperatureHistory(
  deviceId: string,
  romId: string,
  params: { from: string; to?: string; every?: string },
): Promise<TempHistoryResponse> {
  const search = new URLSearchParams()
  search.set('from', params.from)
  if (params.to) search.set('to', params.to)
  if (params.every) search.set('every', params.every)
  return api
    .get(`dispositivos/${deviceId}/sensores-temperatura/${romId}/historico`, {
      searchParams: search,
    })
    .json<TempHistoryResponse>()
}
