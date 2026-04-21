import { api } from '@/lib/api'

export type MqttCredentials = {
  username: string
  password: string
  broker: string
}

export type Dispositivo = {
  id: string
  nome: string
  serial: string
  modelo: string | null
  ultimo_valor: string | null
  criado_em: string
  mqtt_credentials?: MqttCredentials
}

export type CreateDispositivoInput = {
  nome: string
  serial: string
  modelo_id?: string | null
  localizacao?: string
}

export async function listDispositivos(): Promise<Dispositivo[]> {
  return api.get('dispositivos').json<Dispositivo[]>()
}

export async function createDispositivo(
  data: CreateDispositivoInput,
): Promise<Dispositivo> {
  const payload: Record<string, unknown> = {
    nome: data.nome,
    serial: data.serial,
  }
  if (data.modelo_id) payload.modelo_id = data.modelo_id
  if (data.localizacao && data.localizacao.trim()) {
    payload.localizacao = data.localizacao.trim()
  }
  return api.post('dispositivos', { json: payload }).json<Dispositivo>()
}

export async function deleteDispositivo(id: string): Promise<void> {
  await api.delete(`dispositivos/${id}`).json<{ ok: true }>()
}

export async function regenerarMqtt(
  id: string,
): Promise<{ mqtt_credentials: MqttCredentials }> {
  return api
    .post(`dispositivos/${id}/regenerar-mqtt`)
    .json<{ mqtt_credentials: MqttCredentials }>()
}
