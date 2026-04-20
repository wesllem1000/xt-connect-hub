import { api } from '@/lib/api'

export type Dispositivo = {
  id: string
  nome: string
  serial: string
  modelo: string | null
  ultimo_valor: string | null
  criado_em: string
}

export async function listDispositivos(): Promise<Dispositivo[]> {
  return api.get('dispositivos').json<Dispositivo[]>()
}
