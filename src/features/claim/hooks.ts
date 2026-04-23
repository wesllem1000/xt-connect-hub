import { HTTPError } from 'ky'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { claimDispositivo, previewClaim } from './api'
import type { ClaimInput } from './types'

/** Mapeia erro HTTP pra mensagem amigável. */
export function friendlyClaimError(err: unknown): string {
  if (err instanceof HTTPError) {
    const s = err.response.status
    if (s === 404) return 'Código inválido. Confira serial e pairing code na etiqueta.'
    if (s === 409) return 'Este dispositivo já foi ativado. Se você é o dono, ele já está na sua lista.'
    if (s === 403) return 'Faça login pra continuar.'
    if (s >= 500) return 'Erro de conexão. Tente de novo.'
    return 'Não foi possível adicionar o dispositivo.'
  }
  if (!navigator.onLine) return 'Você está offline. Conecte-se e tente de novo.'
  return 'Erro inesperado. Tente de novo.'
}

export function useClaim() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ClaimInput) => claimDispositivo(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispositivos'] })
      qc.invalidateQueries({ queryKey: ['compartilhamentos', 'inbox'] })
    },
  })
}

export function usePreviewClaim(args: {
  token?: string
  serial?: string
  pairing_code?: string
  enabled?: boolean
}) {
  return useQuery({
    queryKey: ['preview-claim', args.token, args.serial, args.pairing_code],
    queryFn: () =>
      previewClaim({
        token: args.token,
        serial: args.serial,
        pairing_code: args.pairing_code,
      }),
    enabled:
      (args.enabled ?? true) &&
      Boolean(args.token || (args.serial && args.pairing_code)),
    retry: false,
  })
}
