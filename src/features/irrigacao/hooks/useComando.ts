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

/** Variáveis enviadas para a mutation (mantidas no contexto da decisão). */
export type ComandoVars = {
  cmd: IrrCmd
  params?: Record<string, unknown>
}

/** Quando o ack vem requires_decision/requires_confirmation, hook delega
 *  o tratamento pro componente via callback (que abre o dialog interativo).
 *  onResolved é chamado em qualquer outro ack_status (final) — útil pro
 *  componente fechar dialogs pendentes. */
export type ComandoOptions = {
  onRequiresAction?: (info: {
    kind: 'requires_decision' | 'requires_confirmation'
    response: ComandoSyncResponse
    vars: ComandoVars
  }) => void
  onResolved?: (response: ComandoSyncResponse) => void
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

export function useComando(
  deviceId: string | undefined,
  options?: ComandoOptions,
) {
  const qc = useQueryClient()
  return useMutation<ComandoSyncResponse, ComandoError, ComandoVars>({
    mutationFn: async (vars) => {
      if (!deviceId) throw new Error('deviceId obrigatório')
      try {
        return await postComandoSync(deviceId, vars.cmd, vars.params)
      } catch (e) {
        throw await toFriendly(e)
      }
    },
    onSuccess: (data, vars) => {
      // Ack chegou em ≤10s. Decide o toast com base no ack_status.
      let resolved = true
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
        case 'requires_confirmation':
          resolved = false
          // Delega pro componente abrir o dialog interativo. Se não houver
          // handler, cai num toast.info (igual antes — fallback de segurança).
          if (options?.onRequiresAction) {
            options.onRequiresAction({
              kind: data.ack_status,
              response: data,
              vars,
            })
          } else {
            toast.info(
              data.ack_message ??
                (data.ack_status === 'requires_decision'
                  ? 'O dispositivo pediu uma decisão.'
                  : 'O dispositivo pediu confirmação.'),
            )
          }
          break
        default:
          // ack_status ausente / desconhecido — tratamos como sucesso pra não
          // ficar silencioso. Banco do Node-RED já gravou o ack mesmo assim.
          toast.success('Comando recebido pelo servidor.')
      }
      if (resolved && options?.onResolved) options.onResolved(data)
      qc.invalidateQueries({ queryKey: ['irrigacao', 'snapshot', deviceId] })
    },
    onError: (err) => {
      toast.error(err.message)
      // Erro também resolve o fluxo (fecha dialog pendente).
      if (options?.onResolved) {
        options.onResolved({ cmd_id: '', ack_status: 'refused', ack_message: err.message })
      }
      // No caso 504, o ack pode chegar entre 10s e 30s (expires_at do ESP).
      // Invalidamos o snapshot pra estimular o user a verificar estado atual.
      if (err.status === 504) {
        qc.invalidateQueries({ queryKey: ['irrigacao', 'snapshot', deviceId] })
      }
    },
  })
}
