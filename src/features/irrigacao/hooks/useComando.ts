import { HTTPError } from 'ky'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  postComandoSync,
  type ComandoSyncResponse,
  type IrrCmd,
} from '../api'

export type ComandoError = {
  message: string
  status?: number
  raw?: string
  /** Para o caso 504, o backend devolve cmd_id mesmo sem ack. */
  cmd_id?: string
}

async function toFriendly(err: unknown): Promise<ComandoError> {
  if (err instanceof HTTPError) {
    const status = err.response.status
    let raw = ''
    let cmd_id: string | undefined
    try {
      const body = (await err.response.clone().json()) as {
        error?: string
        status?: string
        cmd_id?: string
      }
      raw = body.error ?? body.status ?? ''
      cmd_id = body.cmd_id
    } catch {
      /* ignore */
    }
    if (status === 503) {
      return {
        message: 'Dispositivo offline. Aguarde reconectar.',
        status,
        raw,
      }
    }
    if (status === 504) {
      return {
        message:
          'Comando enviado mas sem confirmação em 10s. Verifique o estado atual.',
        status,
        raw,
        cmd_id,
      }
    }
    if (status === 403) {
      return { message: 'Sem permissão pra comandar esse dispositivo.', status, raw }
    }
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
  return useMutation<
    ComandoSyncResponse,
    ComandoError,
    { cmd: IrrCmd; params?: Record<string, unknown> }
  >({
    mutationFn: async (vars) => {
      if (!deviceId) throw new Error('deviceId obrigatório')
      try {
        return await postComandoSync(deviceId, vars.cmd, vars.params)
      } catch (e) {
        throw await toFriendly(e)
      }
    },
    onSuccess: (data) => {
      // Ack chegou em ≤10s. Decide o toast com base no ack_status.
      switch (data.ack_status) {
        case 'executed':
        case 'accepted':
          toast.success(data.ack_message ?? 'Comando confirmado pelo dispositivo.')
          break
        case 'refused':
          toast.error(data.ack_message ?? 'Dispositivo recusou o comando.')
          break
        case 'expired':
          toast.warning(
            data.ack_message ??
              'Comando expirou no dispositivo antes de executar.',
          )
          break
        case 'requires_decision':
          // TODO: implementar dialog interativo (Lovable PanelTab.tsx:130-215)
          toast.info(
            data.ack_message ??
              'O dispositivo pediu uma decisão — UI interativa ainda não implementada.',
          )
          break
        case 'requires_confirmation':
          toast.info(
            data.ack_message ??
              'O dispositivo pediu confirmação — UI ainda não implementada.',
          )
          break
        default:
          // ack_status ausente / desconhecido — tratamos como sucesso pra não
          // ficar silencioso. Banco do Node-RED já gravou o ack mesmo assim.
          toast.success('Comando recebido pelo servidor.')
      }
      qc.invalidateQueries({ queryKey: ['irrigacao', 'snapshot', deviceId] })
    },
    onError: (err) => {
      toast.error(err.message)
      // No caso 504, o ack pode chegar entre 10s e 30s (expires_at do ESP).
      // Invalidamos o snapshot pra estimular o user a verificar estado atual.
      if (err.status === 504) {
        qc.invalidateQueries({ queryKey: ['irrigacao', 'snapshot', deviceId] })
      }
    },
  })
}
