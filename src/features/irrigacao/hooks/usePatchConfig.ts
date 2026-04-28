import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractApiError } from '@/lib/api'

import { patchConfig } from '../api'

export function usePatchConfig(deviceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Record<string, unknown>>) => {
      if (!deviceId) throw new Error('deviceId obrigatório')
      return patchConfig(deviceId, patch)
    },
    onSuccess: () => {
      toast.success('Configuração salva')
      qc.invalidateQueries({ queryKey: ['irrigacao', 'snapshot', deviceId] })
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao salvar configuração')
      toast.error(msg)
    },
  })
}
