import { HTTPError } from 'ky'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { postComando, type ComandoResponse, type IrrCmd } from '../api'

export type ComandoError = {
  message: string
  status?: number
  raw?: string
}

async function toFriendly(err: unknown): Promise<ComandoError> {
  if (err instanceof HTTPError) {
    const status = err.response.status
    let raw = ''
    try {
      const body = (await err.response.clone().json()) as { error?: string }
      raw = body.error ?? ''
    } catch { /* ignore */ }
    if (status === 403) return { message: 'Sem permissão pra comandar esse dispositivo.', status, raw }
    if (status === 400) return { message: raw || 'Comando inválido.', status, raw }
    if (status === 404) return { message: 'Dispositivo não encontrado.', status, raw }
    if (status >= 500) return { message: 'Erro de servidor. Tente de novo.', status, raw }
    return { message: raw || 'Falha ao enviar comando.', status, raw }
  }
  if (!navigator.onLine) return { message: 'Você está offline.' }
  return { message: err instanceof Error ? err.message : 'Erro inesperado.' }
}

export function useComando(deviceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation<ComandoResponse, ComandoError, { cmd: IrrCmd; params?: Record<string, unknown> }>({
    mutationFn: async (vars) => {
      if (!deviceId) throw new Error('deviceId obrigatório')
      try {
        return await postComando(deviceId, vars.cmd, vars.params)
      } catch (e) {
        const err = await toFriendly(e)
        throw err
      }
    },
    onSuccess: () => {
      // Ack chega async via MQTT subscriber; invalida snapshot depois de 1.5s
      // pra dar tempo do state retained refletir o novo estado.
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['irrigacao', 'snapshot', deviceId] })
      }, 1500)
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })
}
