import { api } from '@/lib/api'

export type AccessType = 'owner' | 'shared'
export type SharePermissao = 'leitura' | 'controle'

export type Dispositivo = {
  id: string
  nome: string
  /** Apelido dado pelo owner; NULL = UI mostra serial. (E3.5) */
  apelido: string | null
  serial: string
  modelo: string | null
  ultimo_valor: string | null
  criado_em: string
  online: boolean
  last_seen_at: string | null
  telemetry_interval_s: number
  burst_rate_s: number
  access_type: AccessType
  permissao: SharePermissao
  share_id: string | null
}

export type SetRateInput =
  | { mode: 'default'; rate_s: number }
  | { mode: 'burst'; rate_s: number; duration_s: number }

export type SetRateResponse = {
  ok: true
  request_id: string
  applied_rate_s: number
  mode: 'default' | 'burst'
}

export async function listDispositivos(): Promise<Dispositivo[]> {
  return api.get('dispositivos').json<Dispositivo[]>()
}

export async function deleteDispositivo(id: string): Promise<void> {
  await api.delete(`dispositivos/${id}`).json<{ ok: true }>()
}

export type DispositivoUpdate = { apelido: string | null }

export async function updateDispositivoApelido(
  id: string,
  apelido: string | null,
): Promise<{ id: string; serial: string; apelido: string | null }> {
  const { dispositivo } = await api
    .patch(`dispositivos/${id}`, { json: { apelido } satisfies DispositivoUpdate })
    .json<{
      dispositivo: { id: string; serial: string; apelido: string | null }
    }>()
  return dispositivo
}

export async function setDispositivoRate(
  id: string,
  input: SetRateInput,
): Promise<SetRateResponse> {
  return api
    .post(`dispositivos/${id}/rate`, { json: input })
    .json<SetRateResponse>()
}
